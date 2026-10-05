"""
guard.py - BehaviorGuard on your backend: storage, tokens and the HTTP API.

Two ways to run it, same code:

  1. Inside your own Flask app (one line, nothing else to run):

        from guard import Guard, create_blueprint
        guard = Guard('behaviorguard.db', tenant=('pk_app', os.environ['BG_SK']))
        app.register_blueprint(create_blueprint(guard), url_prefix='/bg')

     After login, mint a token for the page:  guard.mint_token(user_id, session_id)

  2. As a separate service for any stack (Node, PHP, Laravel, Go...): server/app.py.
     Your backend only signs a token (HMAC-SHA256, a few lines in any language) and,
     if it has its own OTP, reports the result with the secret key.

What the browser sends per 30-second window: 34 numbers and a few counts (events, active
seconds, autofill, script-made inputs, the integrity check, an absence). Raw events and
typed characters never leave the page. Everything else - profile, model, verdict, typing-
rhythm template, verification - lives and is decided here.

Identity is never taken from the request body. The page holds a short-lived token signed
with the tenant's secret key:
    b64url(userId) "." b64url(sessionId) "." exp "." hex(HMAC-SHA256(sk, pk|userId|sessionId|exp))
The session id is the site's own login session: the risk floor and the profile belong to
the account, the step-up grace period belongs to one login. A new id per login is required,
so an attacker cannot inherit the owner's verification.
"""
import base64
import hashlib
import hmac
import json
import math
import os
import secrets
import sqlite3
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
import sys  # noqa: E402
if HERE not in sys.path:
    sys.path.insert(0, HERE)
import engine as E  # noqa: E402

TOKEN_MAX_TTL = 7 * 86400
N_FEATURES = len(E.FEATURES)


def _b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip('=')


def _unb64u(s):
    return base64.urlsafe_b64decode(s + '=' * (-len(s) % 4))


def _now_ms():
    return int(time.time() * 1000)


class GuardError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def _num(x, lo, hi, default=0.0):
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
        return default
    return float(min(hi, max(lo, x)))


def clean_window(b):
    """The only browser input that reaches the engine. Shape and range are checked here."""
    if not isinstance(b, dict):
        raise GuardError(400, 'window must be an object')
    vec = b.get('vector')
    if not isinstance(vec, list) or len(vec) != N_FEATURES:
        raise GuardError(400, 'vector must hold %d numbers' % N_FEATURES)
    out = []
    for x in vec:
        if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x) or abs(x) > 1e9:
            raise GuardError(400, 'vector values must be finite numbers')
        out.append(float(x))
    w = {'vector': out,
         'events': int(_num(b.get('events'), 0, 1e6)),
         'activeSec': _num(b.get('activeSec'), 0, 86400),
         'gapBeforeMs': _num(b.get('gapBeforeMs'), 0, 1e10),
         'keystrokeBypassed': b.get('keystrokeBypassed') is True,
         'synthetic': int(_num(b.get('synthetic'), 0, 1e6))}
    integ = b.get('integrity')
    if isinstance(integ, dict) and integ.get('suspected') is True:
        rs = integ.get('reasons') if isinstance(integ.get('reasons'), list) else []
        w['integrity'] = {'suspected': True, 'reasons': [str(r)[:160] for r in rs[:6]]}
    away = b.get('away')
    if isinstance(away, dict):
        ms = _num(away.get('awayMs'), 0, 1e10)
        if ms > 0:
            w['away'] = {'awayMs': ms, 'reason': ''.join(c for c in str(away.get('reason') or 'no-input')[:40] if c.isprintable())}
    return w


def clean_probe(b):
    if not isinstance(b, dict):
        raise GuardError(400, 'probe must be an object')
    w = {'events': int(_num(b.get('events'), 0, 1e6))}
    if b.get('vector') is not None:
        w.update(clean_window(b))
    if isinstance(b.get('away'), dict):
        ms = _num(b['away'].get('awayMs'), 0, 1e10)
        if ms > 0:
            w['away'] = {'awayMs': ms, 'reason': str(b['away'].get('reason') or 'no-input')[:40]}
    return w


def clean_sample(s):
    if not isinstance(s, dict):
        return None
    out = {}
    for k in ('dwell', 'flight'):
        a = s.get(k)
        if not isinstance(a, list) or len(a) > 200:
            return None
        out[k] = a
    if s.get('mode') == 'soft':
        out['mode'] = 'soft'
    return out


class _Bucket:
    def __init__(self):
        self.b = {}
        self.lock = threading.Lock()

    def allow(self, key, per_min, now):
        with self.lock:
            tokens, last = self.b.get(key, (per_min, now))
            tokens = min(per_min, tokens + (now - last) / 60000.0 * per_min)
            if tokens < 1:
                self.b[key] = (tokens, now)
                return False
            self.b[key] = (tokens - 1, now)
            return True


class Guard:
    """BehaviorGuard's server side. Thread-safe; state in one SQLite file.

    tenant=(pk, sk): a single site (embedded use). Without it the Guard serves many sites,
    each with its own keys (server/app.py)."""

    def __init__(self, db_path, tenant=None, cfg=None, clock=_now_ms, windows_per_min=12):
        self.db_path = db_path
        self.clock = clock
        self.engine = E.Engine(cfg=cfg, model_cache={})
        self._locks = {}
        self._locks_guard = threading.Lock()
        self._rate = _Bucket()
        self.windows_per_min = windows_per_min
        self._init_db()
        self.tenant = None
        if tenant:
            pk, sk = tenant
            if not (pk and sk):
                raise ValueError('tenant needs a public key and a secret key')
            c = self._db()
            c.execute('INSERT INTO tenants(pk,name,created_at,sk) VALUES(?,?,?,?) '
                      'ON CONFLICT(pk) DO UPDATE SET sk=excluded.sk', (pk, 'embedded', time.time(), sk))
            c.commit()
            c.close()
            self.tenant = (pk, sk)

    # ---------------------------------------------------------- storage
    def _db(self):
        c = sqlite3.connect(self.db_path, timeout=10)
        c.row_factory = sqlite3.Row
        return c

    def _init_db(self):
        c = self._db()
        c.executescript("""
        CREATE TABLE IF NOT EXISTS tenants(pk TEXT PRIMARY KEY, name TEXT, created_at REAL, sk TEXT);
        CREATE TABLE IF NOT EXISTS accounts(pk TEXT, user_id TEXT, state TEXT, updated_at REAL,
            PRIMARY KEY(pk, user_id));
        CREATE TABLE IF NOT EXISTS sessions(pk TEXT, user_id TEXT, sid TEXT, state TEXT, updated_at REAL,
            PRIMARY KEY(pk, user_id, sid));
        CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT, pk TEXT, user_id TEXT,
            level TEXT, score REAL, action TEXT, reasons TEXT, ts REAL, ip TEXT,
            top_features TEXT, convergence TEXT, eligible INTEGER, sessions INTEGER, fp TEXT, sid TEXT);
        CREATE INDEX IF NOT EXISTS logs_user ON logs(pk, user_id, id);
        """)
        try:
            c.execute('ALTER TABLE logs ADD COLUMN sid TEXT')
        except sqlite3.OperationalError:
            pass
        c.commit()
        c.close()

    def _lock(self, key):
        with self._locks_guard:
            lk = self._locks.get(key)
            if lk is None:
                lk = self._locks[key] = threading.Lock()
            return lk

    def _load(self, c, pk, user, sid):
        r = c.execute('SELECT state FROM accounts WHERE pk=? AND user_id=?', (pk, user)).fetchone()
        acc = json.loads(r['state']) if r else E.new_account()
        s = c.execute('SELECT state FROM sessions WHERE pk=? AND user_id=? AND sid=?', (pk, user, sid)).fetchone()
        ses = json.loads(s['state']) if s else E.new_session()
        ses['sid'] = sid
        return acc, ses

    def _save(self, c, pk, user, sid, acc, ses):
        now = time.time()
        c.execute('INSERT INTO accounts(pk,user_id,state,updated_at) VALUES(?,?,?,?) '
                  'ON CONFLICT(pk,user_id) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at',
                  (pk, user, json.dumps(acc, separators=(',', ':')), now))
        c.execute('INSERT INTO sessions(pk,user_id,sid,state,updated_at) VALUES(?,?,?,?,?) '
                  'ON CONFLICT(pk,user_id,sid) DO UPDATE SET state=excluded.state, updated_at=excluded.updated_at',
                  (pk, user, sid, json.dumps(ses, separators=(',', ':')), now))

    def _run(self, pk, user, sid, fn, write=True):
        key = (pk, user)
        with self._lock(key):
            c = self._db()
            try:
                acc, ses = self._load(c, pk, user, sid)
                # a page load after a long absence ends the grace period (as in the SDK's init)
                away = self.engine.cfg['idle']['awaySec'] * 1000
                now = self.clock()
                if ses.get('mfaPassedAt') and ses.get('lastActiveAt') and now - ses['lastActiveAt'] >= away:
                    ses['mfaPassedAt'] = None
                out = fn(acc, ses, now, key)
                if write:
                    self._save(c, pk, user, sid, acc, ses)
                    c.commit()
                return out
            finally:
                c.close()

    # ---------------------------------------------------------- tenants and tokens
    def create_tenant(self, name='site'):
        pk = 'pk_' + secrets.token_hex(12)
        sk = 'sk_' + secrets.token_hex(24)
        c = self._db()
        c.execute('INSERT INTO tenants(pk,name,created_at,sk) VALUES(?,?,?,?)', (pk, str(name)[:80], time.time(), sk))
        c.commit()
        c.close()
        return pk, sk

    def _sk(self, pk):
        if self.tenant:
            return self.tenant[1] if pk == self.tenant[0] else None
        c = self._db()
        r = c.execute('SELECT sk FROM tenants WHERE pk=?', (pk,)).fetchone()
        c.close()
        return r['sk'] if r and r['sk'] else None

    @staticmethod
    def sign(pk, sk, user_id, sid, exp):
        return hmac.new(sk.encode(), ('%s|%s|%s|%d' % (pk, user_id, sid, exp)).encode(), hashlib.sha256).hexdigest()

    def mint_token(self, user_id, sid, ttl=3600, pk=None, sk=None):
        """Called by YOUR backend after login. sid = your login session id (new per login)."""
        pk = pk or (self.tenant and self.tenant[0])
        sk = sk or (self.tenant and self.tenant[1])
        if not (pk and sk and user_id and sid):
            raise ValueError('mint_token needs pk, sk, user_id and sid')
        exp = int(time.time()) + int(min(ttl, TOKEN_MAX_TTL))
        return '%s.%s.%d.%s' % (_b64u(str(user_id).encode()), _b64u(str(sid).encode()), exp,
                                self.sign(pk, sk, str(user_id), str(sid), exp))

    def auth(self, pk, token):
        """-> (pk, userId, sessionId) or GuardError(401)."""
        pk = pk or (self.tenant and self.tenant[0])
        sk = self._sk(pk) if pk else None
        if not sk:
            raise GuardError(401, 'unknown public key')
        try:
            u, s, exp_s, sig = str(token or '').split('.')
            user, sid, exp = _unb64u(u).decode(), _unb64u(s).decode(), int(exp_s)
        except Exception:
            raise GuardError(401, 'user token required')
        now = time.time()
        if exp < now or exp > now + TOKEN_MAX_TTL + 60:
            raise GuardError(401, 'token expired')
        if not hmac.compare_digest(sig, self.sign(pk, sk, user, sid, exp)):
            raise GuardError(401, 'token not valid')
        if not user or not sid or len(user) > 200 or len(sid) > 200:
            raise GuardError(401, 'token not valid')
        return pk, user, sid

    def operator(self, sk):
        """pk of the tenant that owns this secret key, or None."""
        if not sk or not str(sk).startswith('sk_'):
            return None
        if self.tenant:
            return self.tenant[0] if hmac.compare_digest(self.tenant[1], sk) else None
        c = self._db()
        rows = c.execute('SELECT pk, sk FROM tenants WHERE sk IS NOT NULL').fetchall()
        c.close()
        for r in rows:
            if hmac.compare_digest(r['sk'], sk):
                return r['pk']
        return None

    # ---------------------------------------------------------- operations
    def assess(self, pk, user, sid, window, ip=None):
        w = clean_window(window)
        now = self.clock()
        if not self._rate.allow(('a', pk, user, sid), self.windows_per_min, now):
            evt = {'level': 'HIGH', 'score': -2, 'action': 'BLOCK_SESSION', 'blocked': True, 'rateLimited': True,
                   'reasons': ['rate limit: more than %d windows a minute' % self.windows_per_min], 'topFeatures': [], 'eligible': False}
            self._log(pk, user, sid, evt, ip, None)
            return {'verdict': evt}

        def fn(acc, ses, now, key):
            evt = self.engine.assess(acc, ses, w, now, key)
            st = self.engine.status(acc, ses, now, key)
            self._log(pk, user, sid, evt, ip, len(acc['windows']))
            return {'verdict': _jsonable(evt), 'status': st}
        return self._run(pk, user, sid, fn)

    def probe(self, pk, user, sid, window):
        w = clean_probe(window)
        if not self._rate.allow(('p', pk, user, sid), 30, self.clock()):
            raise GuardError(429, 'too many requests')

        def fn(acc, ses, now, key):
            return {'verdict': _jsonable(self.engine.probe(acc, ses, w, now, key)),
                    'status': self.engine.status(acc, ses, now, key)}
        return self._run(pk, user, sid, fn)

    def status(self, pk, user, sid):
        return self._run(pk, user, sid, lambda acc, ses, now, key: self.engine.status(acc, ses, now, key), write=False)

    def rhythm_verify(self, pk, user, sid, sample, window_id=None):
        s = clean_sample(sample)
        if not self._rate.allow(('r', pk, user, sid), 10, self.clock()):
            raise GuardError(429, 'too many attempts')
        wid = int(window_id) if isinstance(window_id, int) and not isinstance(window_id, bool) else None

        def fn(acc, ses, now, key):
            r = self.engine.rhythm_verify(acc, ses, s, now, wid, key)
            self._log_event(pk, user, sid, 'verified' if r.get('ok') else 'verify-failed', now)
            return {**r, 'status': self.engine.status(acc, ses, now, key)}
        return self._run(pk, user, sid, fn)

    def rhythm_enroll(self, pk, user, sid, samples):
        if not isinstance(samples, list) or len(samples) > 10:
            raise GuardError(400, 'samples must be a list')
        ss = [clean_sample(s) for s in samples]

        def fn(acc, ses, now, key):
            r = self.engine.rhythm_enroll(acc, ses, ss, now)
            return {**r, 'status': self.engine.status(acc, ses, now, key)}
        return self._run(pk, user, sid, fn)

    def rhythm_remove(self, pk, user, sid):
        def fn(acc, ses, now, key):
            if not self.engine.verified_recently(ses, now, 120000):
                return {'removed': False, 'reason': 'verify first: removing it needs a verification in the last 2 minutes'}
            acc['template'] = None
            acc['failStreak'] = 0
            return {'removed': True, 'status': self.engine.status(acc, ses, now, key)}
        return self._run(pk, user, sid, fn)

    def forget(self, pk, user, sid=None, require_verified=True):
        """Erase the account's profile, template and log. From the page this needs a
        verification in the last 2 minutes - otherwise an attacker in the session could wipe
        the owner's profile and have the engine learn the attacker instead. Your own backend
        (account deletion) calls it with require_verified=False."""
        key = (pk, user)
        with self._lock(key):
            c = self._db()
            try:
                if require_verified:
                    s = c.execute('SELECT state FROM sessions WHERE pk=? AND user_id=? AND sid=?', (pk, user, sid)).fetchone()
                    ses = json.loads(s['state']) if s else {}
                    if not self.engine.verified_recently(ses, self.clock(), 120000):
                        return {'removed': False, 'reason': 'verify first: erasing the profile needs a verification in the last 2 minutes'}
                c.execute('DELETE FROM accounts WHERE pk=? AND user_id=?', (pk, user))
                c.execute('DELETE FROM sessions WHERE pk=? AND user_id=?', (pk, user))
                c.execute('DELETE FROM logs WHERE pk=? AND user_id=?', (pk, user))
                c.commit()
                self.engine._cache.pop(key, None)
                return {'removed': True}
            finally:
                c.close()

    def report_verified(self, pk, user, sid, passed=True, window_id=None):
        """YOUR backend checked its own factor (OTP, WebAuthn, password) for this login.
        Never expose this to the browser: it is the trust boundary."""
        pk = pk or (self.tenant and self.tenant[0])
        c = self._db()
        known = c.execute('SELECT 1 FROM accounts WHERE pk=? AND user_id=?', (pk, user)).fetchone()
        c.close()
        if not known:
            return {'applied': False, 'reason': 'unknown account'}

        def fn(acc, ses, now, key):
            if passed is not True:
                self._log_event(pk, user, sid, 'verify-failed', now)
                return {'applied': False, 'risk': acc['lastRisk']}
            r = self.engine.apply_verified(acc, ses, now, window_id if isinstance(window_id, int) else None, key)
            self._log_event(pk, user, sid, 'verified', now)
            return {'applied': True, 'trained': r['trained'], 'risk': acc['lastRisk']}
        return self._run(pk, user, sid, fn)

    def check(self, user, sid, pk=None, *, money=False, always=False, max_age_sec=90):
        """The server-side gate for a sensitive action. Your endpoint calls this BEFORE doing
        the action; the browser cannot talk its way past it.

          always=True  the action always needs a verification in the last 2 minutes
                       (password change, new payee, recovery email)
          money=True   moving money: a LOW from a half-built engine (main detector not on
                       yet) is not enough, and UNKNOWN always needs a verification
        Rule: allowed after a recent verification in THIS login (unless HIGH since), or a
        fresh assessNow() of LOW. Anything else -> verify first (fail closed: no fresh
        evidence, no permission).
        -> {'allowed': bool, 'level', 'reason', 'verifiedRecently'}"""
        pk = pk or (self.tenant and self.tenant[0])

        def fn(acc, ses, now, key):
            st = self.engine.status(acc, ses, now, key)
            probe = ses.get('probe')
            fresh = probe and now - probe['at'] <= max_age_sec * 1000
            level = probe['level'] if fresh else 'UNKNOWN'
            if always:
                ok = self.engine.verified_recently(ses, now, 120000)
                return {'allowed': ok, 'level': level, 'verifiedRecently': ok,
                        'reason': 'verified' if ok else 'this action always needs a verification'}
            if self.engine.verified_recently(ses, now) and acc['lastRisk'] != 'HIGH':
                # an assessment taken BEFORE the verification is what the verification answered
                if not fresh or probe['at'] <= ses['mfaPassedAt'] or level != 'HIGH':
                    return {'allowed': True, 'level': level, 'verifiedRecently': True, 'reason': 'verified recently'}
            if not fresh:
                return {'allowed': False, 'level': 'UNKNOWN', 'verifiedRecently': False,
                        'reason': 'no fresh behavior assessment for this session'}
            if level != 'LOW':
                return {'allowed': False, 'level': level, 'verifiedRecently': False,
                        'reason': 'activity does not look like the owner' if level != 'UNKNOWN' else 'not enough evidence yet'}
            if money and not st['model']['mainDetector']:
                return {'allowed': False, 'level': level, 'verifiedRecently': False,
                        'reason': 'the profile is still being built'}
            return {'allowed': True, 'level': level, 'verifiedRecently': False, 'reason': 'matches the owner'}
        return self._run(pk, user, sid, fn, write=False)

    def blocked(self, user, sid, pk=None):
        """True when this login's last verdict ended the session and nothing verified since."""
        pk = pk or (self.tenant and self.tenant[0])

        def fn(acc, ses, now, key):
            lv = ses.get('lastVerdict') or {}
            return bool(lv.get('blocked')) and not (ses.get('mfaPassedAt') and ses['mfaPassedAt'] >= lv.get('at', 0))
        return self._run(pk, user, sid, fn, write=False)

    # ---------------------------------------------------------- log (operator dashboard)
    def _log(self, pk, user, sid, evt, ip, n):
        try:
            c = self._db()
            top = [{'name': t['name'], 'z': float(t['z'])} for t in (evt.get('topFeatures') or [])
                   if isinstance(t.get('z'), (int, float)) and math.isfinite(t['z'])]
            sc = evt.get('score')
            c.execute('INSERT INTO logs(pk,user_id,level,score,action,reasons,ts,ip,top_features,convergence,eligible,sessions,fp,sid) '
                      'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                      (pk, user, evt['level'], sc if isinstance(sc, (int, float)) and math.isfinite(sc) else None,
                       evt.get('action'), json.dumps(list(evt.get('reasons') or [])[:6]), time.time(),
                       (ip or '')[:64], json.dumps(top), evt.get('convergence'),
                       1 if evt.get('eligible') else 0, n, None, sid))
            c.commit()
            c.close()
        except Exception:
            pass

    def _log_event(self, pk, user, sid, what, now):
        lv = {'verified': 'LOW', 'verify-failed': 'HIGH'}.get(what, 'UNKNOWN')
        self._log(pk, user, sid, {'level': lv, 'score': None, 'action': 'MFA_PASSED' if what == 'verified' else 'MFA_FAILED',
                                  'reasons': [what], 'eligible': False}, None, None)


def _jsonable(o):
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _jsonable(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_jsonable(v) for v in o]
    return o


# ---------------------------------------------------------------- HTTP (Flask)
def create_blueprint(guard, name='behaviorguard'):
    """The browser API. Mount it anywhere: app.register_blueprint(create_blueprint(g), url_prefix='/bg')

      POST   /v1/assess          one 30-second window      -> {verdict, status}
      POST   /v1/probe           assessNow() before an action -> {verdict, status}
      GET    /v1/session         status for the page
      POST   /v1/rhythm/verify   {sample, windowId}         typing-rhythm step-up
      POST   /v1/rhythm/enroll   {samples}                  set up typing-rhythm verification
      DELETE /v1/rhythm          remove it (needs a fresh verification)
      DELETE /v1/profile         erase the profile (needs a fresh verification)
      POST   /v1/report          Bearer sk, from YOUR server: {userId, sessionId, passed}
      POST   /v1/check           Bearer sk, from YOUR server: {userId, sessionId, money, always}
      POST   /v1/forget          Bearer sk, from YOUR server: {userId} (the account was deleted)
    Browser calls carry `Authorization: Bearer <pk>` (optional when embedded) and
    `X-BG-User-Token: <token>`."""
    from flask import Blueprint, jsonify, request

    bp = Blueprint(name, __name__)

    def who():
        auth = request.headers.get('Authorization', '')
        pk = auth[7:].strip() if auth.startswith('Bearer ') else None
        return guard.auth(pk, request.headers.get('X-BG-User-Token', ''))

    def body():
        b = request.get_json(silent=True)
        return b if isinstance(b, dict) else {}

    @bp.errorhandler(GuardError)
    def _err(e):
        return jsonify(error=e.message), e.status

    def ip():
        if os.environ.get('BG_TRUST_PROXY') == '1':
            x = request.headers.get('X-Forwarded-For', '').split(',')[0].strip()
            if x:
                return x[:64]
        return (request.remote_addr or '')[:64]

    @bp.post('/v1/assess')
    def assess():
        pk, u, s = who()
        return jsonify(guard.assess(pk, u, s, body(), ip()))

    @bp.post('/v1/probe')
    def probe():
        pk, u, s = who()
        return jsonify(guard.probe(pk, u, s, body()))

    @bp.get('/v1/session')
    def session_status():
        pk, u, s = who()
        return jsonify(guard.status(pk, u, s))

    @bp.post('/v1/rhythm/verify')
    def rhythm_verify():
        pk, u, s = who()
        b = body()
        return jsonify(guard.rhythm_verify(pk, u, s, b.get('sample'), b.get('windowId')))

    @bp.post('/v1/rhythm/enroll')
    def rhythm_enroll():
        pk, u, s = who()
        return jsonify(guard.rhythm_enroll(pk, u, s, body().get('samples')))

    @bp.delete('/v1/rhythm')
    def rhythm_remove():
        pk, u, s = who()
        return jsonify(guard.rhythm_remove(pk, u, s))

    @bp.delete('/v1/profile')
    def profile_remove():
        pk, u, s = who()
        return jsonify(guard.forget(pk, u, s))

    @bp.post('/v1/report')
    def report():
        auth = request.headers.get('Authorization', '')
        pk = guard.operator(auth[7:].strip() if auth.startswith('Bearer ') else '')
        if not pk:
            return jsonify(error='secret key required'), 401
        b = body()
        u, s = b.get('userId'), b.get('sessionId')
        if not isinstance(u, str) or not isinstance(s, str) or not u or not s:
            return jsonify(error='userId and sessionId required'), 400
        return jsonify(guard.report_verified(pk, u, s, b.get('passed') is True, b.get('windowId')))

    @bp.post('/v1/check')
    def server_check():
        """YOUR backend asks before a sensitive action (Bearer sk): the HTTP form of
        guard.check() and guard.blocked(), for stacks that do not run this module."""
        auth = request.headers.get('Authorization', '')
        pk = guard.operator(auth[7:].strip() if auth.startswith('Bearer ') else '')
        if not pk:
            return jsonify(error='secret key required'), 401
        b = body()
        u, s = b.get('userId'), b.get('sessionId')
        if not isinstance(u, str) or not isinstance(s, str) or not u or not s:
            return jsonify(error='userId and sessionId required'), 400
        if guard.blocked(u, s, pk=pk):
            return jsonify(allowed=False, ended=True, level='HIGH', verifiedRecently=False,
                           reason='the behavior verdict ended this session')
        r = guard.check(u, s, pk=pk, money=b.get('money') is True, always=b.get('always') is True)
        return jsonify(ended=False, **r)

    @bp.post('/v1/forget')
    def server_forget():
        """YOUR backend deleted the account (Bearer sk): erase its profile and template."""
        auth = request.headers.get('Authorization', '')
        pk = guard.operator(auth[7:].strip() if auth.startswith('Bearer ') else '')
        if not pk:
            return jsonify(error='secret key required'), 401
        u = body().get('userId')
        if not isinstance(u, str) or not u:
            return jsonify(error='userId required'), 400
        return jsonify(guard.forget(pk, u, require_verified=False))

    return bp
