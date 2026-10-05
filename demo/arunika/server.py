#!/usr/bin/env python3
"""
server.py - the Arunika demo bank, with its own backend and BehaviorGuard on it.

    pip install flask
    python demo/arunika/server.py            # http://127.0.0.1:8300
    python demo/arunika/server.py --lan      # also reachable from a second laptop on the same network

Arunika is a fictional bank (no real money). Accounts, passwords, balances and history live
here, on the server, like a real site - so the same account can be opened from another
browser or another laptop, which is exactly the account-takeover case.

BehaviorGuard is installed in three places, and nothing else in the bank changed:
  1. the API is mounted inside this app:        app.register_blueprint(create_blueprint(guard), url_prefix='/bg')
  2. after login the page gets a token:         GET /api/bg-token  -> guard.mint_token(email, login session id)
  3. money and security changes ask the guard:  guard.check(...) before /api/transfer, /api/pay, /api/password
     and the one-time code, checked here, is reported to it: guard.report_verified(...)
The browser only captures behavior and sends 34 numbers per window. The verdict that
decides whether money moves is made here; a script in the page cannot talk its way past it.

Demo-only parts are marked DEMO: the one-time code is "delivered" to a simulated phone
(phone.html), and the presenter can wipe a profile without verifying.
"""
import copy
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
# in the repository the library comes from dist/ and server/; in a standalone copy made by
# tools/export_demo.py, from ./behaviorguard/
LOCAL = os.path.join(HERE, 'behaviorguard')
DIST = LOCAL if os.path.isfile(os.path.join(LOCAL, 'behaviorguard.js')) else os.path.join(ROOT, 'dist')
sys.path.insert(0, os.path.join(LOCAL, 'server') if os.path.isdir(os.path.join(LOCAL, 'server')) else os.path.join(ROOT, 'server'))
from flask import Flask, Response, abort, jsonify, redirect, request, send_from_directory, session  # noqa: E402
from guard import Guard, create_blueprint  # noqa: E402
import engine  # noqa: E402

DATA = os.environ.get('ARUNIKA_DATA') or os.path.join(HERE, '.data')
os.makedirs(DATA, exist_ok=True)


def _secret(name, make):
    path = os.path.join(DATA, 'secrets.json')
    try:
        with open(path, encoding='utf-8') as f:
            s = json.load(f)
    except Exception:
        s = {}
    if name not in s:
        s[name] = make()
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(s, f)
    return s[name]


# BehaviorGuard: one tenant, keys generated on first run and kept in .data (never in a page).
# Presentation mode sends 60-event windows; the server accepts them for training (the
# default is 100). Normal 150-event windows are unaffected.
BG_PK = 'pk_arunika_demo'
BG_SK = _secret('bg_sk', lambda: 'sk_' + secrets.token_hex(24))
CFG = copy.deepcopy(engine.CFG)
CFG['session']['minEventsTrain'] = 60
guard = Guard(os.path.join(DATA, 'behaviorguard.db'), tenant=(BG_PK, BG_SK), cfg=CFG,
              windows_per_min=int(os.environ.get('ARUNIKA_WINDOWS_PER_MIN', '12')))

app = Flask(__name__)
app.secret_key = _secret('flask', lambda: secrets.token_hex(32))
app.config.update(SESSION_COOKIE_HTTPONLY=True, SESSION_COOKIE_SAMESITE='Lax', SESSION_COOKIE_NAME='arunika')
app.register_blueprint(create_blueprint(guard), url_prefix='/bg')

DB = os.path.join(DATA, 'arunika.db')
_lock = threading.Lock()
SAMPLE = ('nadia.putri@example.com', 'Nadia Putri', 'arunika123')
DEMO_BALANCE, LOW_BALANCE = 25000000, 1000000


def db():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c


with db() as _c:
    _c.executescript("""
    CREATE TABLE IF NOT EXISTS users(email TEXT PRIMARY KEY, pw TEXT, salt TEXT, data TEXT, created REAL);
    CREATE TABLE IF NOT EXISTS otp(email TEXT, sid TEXT, code_hash TEXT, expires REAL, tries INTEGER, PRIMARY KEY(email, sid));
    CREATE TABLE IF NOT EXISTS phone(id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT, text TEXT, t REAL);
    """)


# ------------------------------------------------------------------ accounts
def _hash(pw, salt):
    return hashlib.pbkdf2_hmac('sha256', pw.encode(), bytes.fromhex(salt), 200_000).hex()


def load(email):
    c = db()
    r = c.execute('SELECT data FROM users WHERE email=?', (email,)).fetchone()
    c.close()
    return json.loads(r['data']) if r else None


def save(a):
    c = db()
    c.execute('UPDATE users SET data=? WHERE email=?', (json.dumps(a), a['email']))
    c.commit()
    c.close()


def create(email, name, password, phone, history):
    salt = secrets.token_hex(16)
    h = int(hashlib.sha256(email.encode()).hexdigest()[:12], 16)
    now = time.time() * 1000
    a = {'email': email, 'nama': name, 'hp': phone or '+62 812-%04d-%04d' % (1000 + h % 9000, 1000 + (h >> 7) % 9000),
         'rekening': str(1000000000 + h % 8999999999)[:10], 'dibuat': now, 'fast': False,
         'phoneKey': secrets.token_urlsafe(18), 'log': []}
    if history:
        a['tx'] = sample_history()
        a['saldo'] = 12847300
        a['penerima'] = [{'nama': 'Budi Santoso', 'bank': 'Arunika', 'rek': '2203419876'},
                         {'nama': 'Rina Wulandari', 'bank': 'Other bank', 'rek': '0081223344'},
                         {'nama': 'Mum', 'bank': 'Arunika', 'rek': '1900345671'}]
    else:
        a['tx'] = [{'id': 'TX000001', 't': now, 'ket': 'Opening deposit', 'kat': 'Income', 'jml': DEMO_BALANCE}]
        a['saldo'] = DEMO_BALANCE
        a['penerima'] = []
        a['baruDaftar'] = True
    c = db()
    c.execute('INSERT INTO users(email,pw,salt,data,created) VALUES(?,?,?,?,?)',
              (email, _hash(password, salt), salt, json.dumps(a), time.time()))
    c.commit()
    c.close()
    return a


def sample_history():
    now, D = time.time() * 1000, 86400000
    rows = [
        (0.2, 'Warung Makan Sederhana', 'Food & drink', -38000), (0.9, 'Ride-hailing to the office', 'Transport', -24500),
        (1.3, 'Transfer from Rina Wulandari', 'Income', 250000), (1.8, 'Apotek Sehat Selalu', 'Shopping', -67500),
        (2.4, 'Prepaid electricity token', 'Bills', -202500), (3.1, 'Toko Buku Pelita', 'Shopping', -129000),
        (4.2, 'Kedai Kopi Senja Pagi', 'Food & drink', -31000), (5.0, 'Transfer to Budi Santoso', 'Transfer', -500000),
        (6.3, 'Phone credit & data 50,000', 'Bills', -51500), (7.1, 'Laundry Bersih Kilat', 'Shopping', -45000),
        (8.6, 'Monthly groceries, Pasar Segar', 'Shopping', -412300), (9.4, 'September salary - PT Kencana Abadi', 'Income', 8750000),
        (10.2, 'Water bill', 'Bills', -96000), (12.5, 'Bakso Pak Kumis', 'Food & drink', -28000),
        (13.9, 'Transfer to Mum', 'Transfer', -1500000), (15.2, 'Parking & tolls', 'Transport', -36000),
        (17.8, 'Home internet subscription', 'Bills', -335000), (19.4, 'Martabak Bangka 88', 'Food & drink', -55000),
        (22.0, 'Train ticket Jakarta-Bandung', 'Transport', -150000), (24.6, 'Transfer from Dimas Pratama', 'Income', 120000),
        (27.3, 'Running shoes', 'Shopping', -489000), (30.1, 'Sate Madura Cak Mat', 'Food & drink', -42000),
    ]
    return [{'id': 'TX%d' % (900100 + i), 't': now - d * D, 'ket': k, 'kat': c, 'jml': j} for i, (d, k, c, j) in enumerate(rows)]


def public(a):
    """What a page may see about the account: never the password or the phone key."""
    return {k: v for k, v in a.items() if k not in ('phoneKey', 'log')}


def add_tx(a, ket, kat, amount):
    ref = 'ARN' + str(int(time.time() * 1000))[-9:]
    a['tx'].insert(0, {'id': ref, 't': time.time() * 1000, 'ket': ket, 'kat': kat, 'jml': amount})
    a['saldo'] += amount
    return ref


def top_up(a):
    # Demo: a balance drained by practice transfers refills itself, so the demo never stops
    # at "insufficient balance". The behavior profile is untouched.
    if a['saldo'] < LOW_BALANCE:
        add_tx(a, 'Demo balance top-up', 'Income', DEMO_BALANCE - a['saldo'])
        return True
    return False


def add_log(a, lv, t1, t2=''):
    a['log'].insert(0, {'t': time.time() * 1000, 'lv': lv, 't1': str(t1)[:120], 't2': str(t2)[:300]})
    del a['log'][60:]


# ------------------------------------------------------------------ login sessions
_fails = {}


def me():
    """(email, sid) of the logged-in user, or (None, None). A login whose behavior verdict
    ended the session is logged out HERE, on the server - closing the page's dialog does not
    keep the attacker in."""
    email, sid = session.get('email'), session.get('sid')
    if not email or not sid or not load(email):
        return None, None
    if guard.blocked(email, sid):
        session.clear()
        session['ended'] = 1
        return None, None
    return email, sid


def login(email):
    session.clear()
    session['email'] = email
    session['sid'] = secrets.token_hex(16)        # a NEW login session id on every login
    session.permanent = False


def need_login():
    email, sid = me()
    if not email:
        abort(Response(json.dumps({'error': 'not logged in', 'ended': bool(session.get('ended'))}), 401, mimetype='application/json'))
    return email, sid


def body():
    return request.get_json(silent=True) or {}


@app.after_request
def headers(resp):
    resp.headers['X-Content-Type-Options'] = 'nosniff'
    resp.headers['Referrer-Policy'] = 'same-origin'
    if request.path.startswith('/api/') or request.path.endswith('.html') or request.path == '/':
        resp.headers['Cache-Control'] = 'no-store'
    return resp


# ------------------------------------------------------------------ pages
PAGES = {'index.html', 'signup.html', 'start.html', 'home.html', 'transfer.html', 'pay.html',
         'history.html', 'security.html', 'phone.html'}


@app.get('/')
def root():
    return redirect('/index.html')


@app.get('/<page>')
def page(page):
    if page not in PAGES:
        abort(404)
    with open(os.path.join(HERE, page), encoding='utf-8') as f:
        html = f.read()
    email, sid = me()
    data = None
    if email:
        with _lock:
            a = load(email)
            if top_up(a):
                save(a)
        data = {'session': {'email': email}, 'account': public(a), 'log': a['log'][:20]}
    if not data:
        data = {'session': None, 'ended': bool(session.pop('ended', None))}
    payload = json.dumps(data).replace('<', '\\u003c')
    html = html.replace('<script', '<script>window.ARUNIKA_ME=%s;</script>\n<script' % payload, 1)
    return Response(html, mimetype='text/html')


@app.get('/favicon.ico')
def favicon():
    return ('', 204)


@app.get('/assets/<path:p>')
def assets(p):
    return send_from_directory(os.path.join(HERE, 'assets'), p)


@app.get('/dist/<path:p>')
def dist(p):
    return send_from_directory(DIST, p)


# ------------------------------------------------------------------ account API
EMAIL = re.compile(r'^[^\s@]+@[^\s@]+\.[^\s@]+$')


@app.post('/api/signup')
def signup():
    b = body()
    email = str(b.get('email') or '').strip().lower()
    name = re.sub(r'\s+', ' ', str(b.get('nama') or '')).strip()[:60]
    pw = str(b.get('password') or '')
    hp = re.sub(r'\D', '', str(b.get('hp') or ''))
    if not EMAIL.match(email) or len(email) > 120:
        return jsonify(error='That email is not valid.'), 400
    if len(name) < 3:
        return jsonify(error='Enter your full name.'), 400
    if len(pw) < 8 or not re.search(r'\d', pw) or not re.search(r'[a-z]', pw, re.I):
        return jsonify(error='Password needs at least 8 characters, letters and numbers.'), 400
    if len(hp) < 9:
        return jsonify(error='The mobile number is incomplete.'), 400
    with _lock:
        if load(email):
            return jsonify(error='exists'), 409
        a = create(email, name, pw, '+62 %s-%s-%s' % (hp[:3], hp[3:7], hp[7:11]), history=False)
    login(email)
    return jsonify(ok=True, account=public(a), phoneKey=a['phoneKey'])


@app.post('/api/login')
def do_login():
    b = body()
    email = str(b.get('email') or '').strip().lower()
    pw = str(b.get('password') or '')
    now = time.time()
    recent = [t for t in _fails.get(email, []) if now - t < 300]
    if len(recent) >= 10:
        return jsonify(error='Too many attempts. Try again in a few minutes.'), 429
    c = db()
    r = c.execute('SELECT pw, salt FROM users WHERE email=?', (email,)).fetchone()
    c.close()
    if not r:
        return jsonify(error='unknown'), 404
    if not hmac.compare_digest(r['pw'], _hash(pw, r['salt'])):
        _fails[email] = recent + [now]
        return jsonify(error='wrong'), 401
    _fails.pop(email, None)
    login(email)
    return jsonify(ok=True)


@app.post('/api/sample')
def sample():
    """The presenter's sample account, with history. Its behavior profile is whatever the
    server holds for it; log in with the same email and password from a second laptop and
    that laptop is judged against it."""
    email, name, pw = SAMPLE
    with _lock:
        a = load(email) or create(email, name, pw, None, history=True)
    login(email)
    return jsonify(ok=True, phoneKey=a['phoneKey'])


@app.post('/api/logout')
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get('/api/me')
def api_me():
    email, _ = need_login()
    a = load(email)
    return jsonify(session={'email': email}, account=public(a), log=a['log'][:20])


@app.get('/api/bg-token')
def bg_token():
    """Step 2 of the install: the page asks for a short-lived token for THIS login."""
    email, sid = need_login()
    return jsonify(token=guard.mint_token(email, sid, ttl=900))


@app.post('/api/log')
def api_log():
    email, _ = need_login()
    b = body()
    lv = b.get('lv') if b.get('lv') in ('ok', 'warn', 'bad', 'info') else 'info'
    with _lock:
        a = load(email)
        add_log(a, lv, b.get('t1') or '', b.get('t2') or '')
        save(a)
        return jsonify(log=a['log'][:20])


# ------------------------------------------------------------------ the server-side gate
def gate(email, sid, money=False, always=False):
    """Step 3 of the install. None = go ahead; otherwise the response to send back."""
    if guard.blocked(email, sid):
        session.clear()
        session['ended'] = 1
        return jsonify(error='session ended', ended=True), 401
    c = guard.check(email, sid, money=money, always=always)
    if not c['allowed']:
        return jsonify(error='verify', verify=True, level=c['level'], reason=c['reason']), 403
    return None


@app.post('/api/transfer')
def transfer():
    email, sid = need_login()
    b = body()
    try:
        amount = int(b.get('amount'))
    except (TypeError, ValueError):
        return jsonify(error='Enter an amount.'), 400
    rek = re.sub(r'\D', '', str(b.get('rek') or ''))[:10]
    name = str(b.get('nama') or '').strip()[:60]
    bank = str(b.get('bank') or 'Arunika').strip()[:40]
    if len(rek) != 10 or not name:
        return jsonify(error='The account number must have 10 digits.'), 400
    if amount < 10000:
        return jsonify(error='The minimum amount is Rp 10,000.'), 400
    if amount > 50000000:
        return jsonify(error='Over the daily transfer limit.'), 400
    fee = 0 if bank == 'Arunika' else 2500
    stop = gate(email, sid, money=True)
    if stop:
        return stop
    with _lock:
        a = load(email)
        if amount + fee > a['saldo']:
            return jsonify(error='Insufficient balance.'), 400
        ref = add_tx(a, 'Transfer to ' + name, 'Transfer', -(amount + fee))
        if not any(p['rek'] == rek for p in a['penerima']):
            a['penerima'].append({'nama': name, 'bank': bank, 'rek': rek})
        save(a)
    return jsonify(ok=True, ref=ref, fee=fee, account=public(a))


@app.post('/api/pay')
def pay():
    email, sid = need_login()
    b = body()
    try:
        amount = int(b.get('amount'))
    except (TypeError, ValueError):
        return jsonify(error='Choose an amount first.'), 400
    label = str(b.get('label') or 'Payment').strip()[:80]
    number = re.sub(r'\D', '', str(b.get('number') or ''))[:13]
    if len(number) < 8:
        return jsonify(error='The number is incomplete.'), 400
    if amount <= 0 or amount > 5000000:
        return jsonify(error='That amount is not valid.'), 400
    stop = gate(email, sid, money=True)
    if stop:
        return stop
    with _lock:
        a = load(email)
        if amount > a['saldo']:
            return jsonify(error='Insufficient balance.'), 400
        ref = add_tx(a, label + ' · ' + number, 'Bills', -amount)
        save(a)
    token = ' '.join('%04d' % secrets.randbelow(10000) for _ in range(5)) if b.get('kind') == 'listrik' else None
    return jsonify(ok=True, ref=ref, token=token, account=public(a))


@app.post('/api/password')
def password():
    email, sid = need_login()
    b = body()
    cur, new = str(b.get('current') or ''), str(b.get('new') or '')
    c = db()
    r = c.execute('SELECT pw, salt FROM users WHERE email=?', (email,)).fetchone()
    c.close()
    if not hmac.compare_digest(r['pw'], _hash(cur, r['salt'])):
        return jsonify(error='The current password is not right.'), 400
    if len(new) < 8 or not re.search(r'\d', new) or not re.search(r'[a-z]', new, re.I):
        return jsonify(error='The new password needs at least 8 characters, letters and numbers.'), 400
    stop = gate(email, sid, always=True)
    if stop:
        return stop
    salt = secrets.token_hex(16)
    with _lock:
        c = db()
        c.execute('UPDATE users SET pw=?, salt=? WHERE email=?', (_hash(new, salt), salt, email))
        c.commit()
        c.close()
    return jsonify(ok=True)


# ------------------------------------------------------------------ one-time code (the fallback)
def mask(hp):
    d = re.sub(r'\D', '', hp)
    return '+62 %s-••••-••%s' % (d[2:5], d[-2:]) if len(d) >= 7 else 'your registered number'


@app.post('/api/otp/send')
def otp_send():
    email, sid = need_login()
    code = '%06d' % (100000 + secrets.randbelow(900000))
    c = db()
    c.execute('INSERT OR REPLACE INTO otp(email,sid,code_hash,expires,tries) VALUES(?,?,?,?,0)',
              (email, sid, hashlib.sha256((sid + code).encode()).hexdigest(), time.time() + 300))
    # DEMO: a real bank sends an SMS here. The demo "delivers" it to phone.html.
    c.execute('INSERT INTO phone(email,text,t) VALUES(?,?,?)', (email,
              'ARUNIKA: Your verification code is %s. Never share this code with anyone, including Arunika staff.' % code,
              time.time() * 1000))
    c.commit()
    c.close()
    return jsonify(sent=True, to=mask(load(email)['hp']))


@app.post('/api/otp/verify')
def otp_verify():
    email, sid = need_login()
    code = re.sub(r'\D', '', str(body().get('code') or ''))
    c = db()
    try:
        r = c.execute('SELECT * FROM otp WHERE email=? AND sid=?', (email, sid)).fetchone()
        if not r or r['expires'] < time.time():
            return jsonify(ok=False, error='The code has expired. Send a new one.')
        if r['tries'] >= 3:
            return jsonify(ok=False, error='Wrong code 3 times.', exhausted=True)
        if hmac.compare_digest(r['code_hash'], hashlib.sha256((sid + code).encode()).hexdigest()):
            c.execute('DELETE FROM otp WHERE email=? AND sid=?', (email, sid))
            c.commit()
            # the trust boundary: this server checked the code, and tells BehaviorGuard so
            guard.report_verified(BG_PK, email, sid, True)
            return jsonify(ok=True)
        tries = r['tries'] + 1
        c.execute('UPDATE otp SET tries=? WHERE email=? AND sid=?', (tries, email, sid))
        c.commit()
        if tries >= 3:
            guard.report_verified(BG_PK, email, sid, False)
            return jsonify(ok=False, error='Wrong code 3 times.', exhausted=True)
        return jsonify(ok=False, error='That code does not match. %d attempts left.' % (3 - tries))
    finally:
        c.close()


@app.get('/api/demo/phone')
def demo_phone():
    """DEMO: the account's simulated phone. Opened with the account's phone key, which only
    the browser that created the account (or the presenter's phone.html link) holds - so a
    second laptop that logged in with the stolen password does not see the codes."""
    key = str(request.args.get('k') or '')
    after = int(request.args.get('after') or 0)
    c = db()
    try:
        email = None
        for r in c.execute('SELECT email, data FROM users'):
            if hmac.compare_digest(json.loads(r['data']).get('phoneKey', ''), key):
                email = r['email']
                break
        if not email:
            return jsonify(error='unknown phone'), 404
        a = load(email)
        msgs = [{'id': r['id'], 'text': r['text'], 't': r['t']} for r in c.execute(
            'SELECT * FROM phone WHERE email=? AND id>? ORDER BY id DESC LIMIT 10', (email, after))]
        return jsonify(owner=a['nama'], number=mask(a['hp']), messages=msgs[::-1])
    finally:
        c.close()


# ------------------------------------------------------------------ DEMO presenter actions
@app.post('/api/demo/mode')
def demo_mode():
    """DEMO: presentation mode (60-event windows) for this account. The profile is erased,
    because windows of a different size give a profile that is not comparable."""
    email, _ = need_login()
    with _lock:
        a = load(email)
        a['fast'] = bool(body().get('fast'))
        add_log(a, 'info', 'Presentation mode ' + ('on' if a['fast'] else 'off'), 'Behavior profile erased; learning starts over.')
        save(a)
    guard.forget(BG_PK, email, require_verified=False)
    return jsonify(ok=True, fast=a['fast'])


@app.post('/api/demo/forget-profile')
def demo_forget():
    """DEMO: erase the behavior profile without verifying (the presenter panel's reset).
    The real button on the Security page goes through BehaviorGuard.forget(), which verifies."""
    email, _ = need_login()
    guard.forget(BG_PK, email, require_verified=False)
    with _lock:
        a = load(email)
        add_log(a, 'info', 'Behavior profile erased (demo panel)', 'Learning starts over.')
        save(a)
    return jsonify(ok=True)


@app.post('/api/demo/reset')
def demo_reset():
    """DEMO: delete this account completely (bank data and behavior profile) and log out."""
    email, _ = need_login()
    guard.forget(BG_PK, email, require_verified=False)
    with _lock:
        c = db()
        for t in ('users', 'otp', 'phone'):
            c.execute('DELETE FROM %s WHERE email=?' % t, (email,))
        c.commit()
        c.close()
    session.clear()
    return jsonify(ok=True)


if __name__ == '__main__':
    import logging
    logging.getLogger('werkzeug').setLevel(logging.WARNING)
    lan = '--lan' in sys.argv
    port = int(os.environ.get('PORT', '8300'))
    print('Arunika (demo bank with BehaviorGuard on its backend)')
    print('  open   http://127.0.0.1:%d' % port)
    if lan:
        print('  LAN    http://<this laptop\'s IP>:%d   (second laptop: log in with the same account)' % port)
    print('  sample account  %s / %s' % (SAMPLE[0], SAMPLE[2]))
    print('  data   %s' % DATA)
    app.run(host='0.0.0.0' if lan else '127.0.0.1', port=port, debug=False, threaded=True)
