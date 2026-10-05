#!/usr/bin/env python3
"""
BehaviorGuard server - the backend as a separate service, for any stack.

The browser library sends 34 feature numbers per 30-second window; this service keeps the
account's profile, trains, scores, decides, keeps the typing-rhythm template and checks
verifications. Raw events and typed characters never arrive here.

For a Flask app you do not need this file: mount the same API inside your app with
guard.create_blueprint() (see server/README.md). This service exists for Node, PHP,
Laravel, Go and everything else: your backend only signs a user token after login and,
if it has its own OTP, reports the result.

Keys:
  pk  public, in the page. Opens nothing by itself.
  sk  secret, only on your server. Signs user tokens, reports verifications, opens the
      operator dashboard.

Endpoints (browser, Bearer pk + X-BG-User-Token): see guard.create_blueprint
  POST /v1/assess, /v1/probe, /v1/rhythm/verify, /v1/rhythm/enroll
  GET  /v1/session      DELETE /v1/rhythm, /v1/profile
Server to server (Bearer sk):
  POST /v1/report       {userId, sessionId, passed}
Operator (Bearer sk):
  GET  /api/dashboard, /api/account?u=      GET /dashboard (HTML)
Admin:
  POST /tenant {name} -> {pk, sk}            (sk is shown once)
  GET  /tenants        Bearer $BG_ADMIN_TOKEN (off without it)

Mint a token for a local test:
  python server/app.py mint <pk> <sk> <userId> <sessionId> [ttl_seconds]
"""
import hmac
import json
import os
import secrets
import sqlite3
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
if HERE not in sys.path:
    sys.path.insert(0, HERE)
from flask import Flask, Response, jsonify, request  # noqa: E402
from guard import Guard, create_blueprint  # noqa: E402

DB = os.environ.get('BG_DB') or os.path.join(HERE, 'bg_server.db')
ADMIN_TOKEN = os.environ.get('BG_ADMIN_TOKEN', '')


def create_app(db_path=DB, **guard_opts):
    app = Flask(__name__)
    guard = Guard(db_path, **guard_opts)
    app.config['BG_GUARD'] = guard
    app.register_blueprint(create_blueprint(guard))

    def db():
        c = sqlite3.connect(db_path, timeout=10)
        c.row_factory = sqlite3.Row
        return c

    # The page and this service are usually on different origins. Auth is a header token,
    # never a cookie, so a wildcard origin does not let another site act as the user.
    @app.after_request
    def cors(resp):
        resp.headers['Access-Control-Allow-Origin'] = os.environ.get('BG_ALLOWED_ORIGIN', '*')
        resp.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-BG-User-Token'
        resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, DELETE, OPTIONS'
        resp.headers['Access-Control-Max-Age'] = '600'
        return resp

    @app.route('/<path:_any>', methods=['OPTIONS'])
    @app.route('/', methods=['OPTIONS'])
    def preflight(_any=None):
        return ('', 204)

    @app.post('/tenant')
    def tenant():
        if os.environ.get('BG_TENANT_SIGNUP', '1') != '1':
            return jsonify(error='tenant sign-up is off'), 403
        b = request.get_json(silent=True) or {}
        pk, sk = guard.create_tenant((b.get('name') or 'site').strip()[:80])
        return jsonify(pk=pk, sk=sk, note='sk is shown once. Keep it on your server, never in a page.')

    def operator():
        auth = request.headers.get('Authorization', '')
        return guard.operator(auth[7:].strip() if auth.startswith('Bearer ') else '')

    @app.get('/api/dashboard')
    def api_dashboard():
        pk = operator()
        if not pk:
            return jsonify(error='operator sk required'), 401
        d = db()
        try:
            name = (d.execute('SELECT name FROM tenants WHERE pk=?', (pk,)).fetchone() or {'name': ''})['name']
            users = [r['user_id'] for r in d.execute('SELECT DISTINCT user_id FROM logs WHERE pk=?', (pk,))]
            accounts = []
            for u in users:
                last = d.execute("SELECT * FROM logs WHERE pk=? AND user_id=? AND action NOT IN ('MFA_PASSED','MFA_FAILED') "
                                 'ORDER BY id DESC LIMIT 1', (pk, u)).fetchone() \
                    or d.execute('SELECT * FROM logs WHERE pk=? AND user_id=? ORDER BY id DESC LIMIT 1', (pk, u)).fetchone()
                cnt = {r['level']: r['c'] for r in d.execute(
                    'SELECT level, COUNT(*) c FROM logs WHERE pk=? AND user_id=? GROUP BY level', (pk, u))}
                series = [(r['score'] or 0) for r in d.execute(
                    'SELECT score FROM logs WHERE pk=? AND user_id=? AND score IS NOT NULL ORDER BY id DESC LIMIT 24', (pk, u))][::-1]
                accounts.append({
                    'userId': u, 'level': last['level'], 'score': last['score'] or 0, 'action': last['action'],
                    'convergence': last['convergence'], 'sessions': last['sessions'], 'ip': last['ip'],
                    'fp': last['sid'], 'lastTs': last['ts'],
                    'high': cnt.get('HIGH', 0), 'medium': cnt.get('MEDIUM', 0), 'low': cnt.get('LOW', 0),
                    'total': sum(cnt.values()), 'reasons': json.loads(last['reasons'] or '[]'),
                    'topFeatures': json.loads(last['top_features'] or '[]'), 'series': series})
            order = {'HIGH': 0, 'MEDIUM': 1, 'LOW': 2}
            accounts.sort(key=lambda a: (order.get(a['level'], 3), -(a['lastTs'] or 0)))
            events = [{'userId': r['user_id'], 'level': r['level'], 'score': r['score'] or 0, 'ts': r['ts'],
                       'ip': r['ip'], 'convergence': r['convergence'], 'action': r['action'],
                       'reasons': json.loads(r['reasons'] or '[]')}
                      for r in d.execute('SELECT * FROM logs WHERE pk=? ORDER BY id DESC LIMIT 40', (pk,))]
            lvc = {r['level']: r['c'] for r in d.execute('SELECT level, COUNT(*) c FROM logs WHERE pk=? GROUP BY level', (pk,))}
            kpi = {'accounts': len(users), 'events': sum(lvc.values()), 'high': lvc.get('HIGH', 0),
                   'medium': lvc.get('MEDIUM', 0), 'low': lvc.get('LOW', 0),
                   'atRisk': sum(1 for a in accounts if a['level'] == 'HIGH')}
            return jsonify(name=name, pk=pk, generatedAt=time.time(), kpi=kpi, accounts=accounts, events=events)
        finally:
            d.close()

    @app.get('/api/account')
    def api_account():
        pk = operator()
        if not pk:
            return jsonify(error='operator sk required'), 401
        u = request.args.get('u')
        if not u:
            return jsonify(error='userId required'), 400
        d = db()
        try:
            rows = d.execute('SELECT * FROM logs WHERE pk=? AND user_id=? ORDER BY id DESC LIMIT 60', (pk, u)).fetchall()
            if not rows:
                return jsonify(error='not found'), 404
            last = rows[0]
            cnt = {r['level']: r['c'] for r in d.execute(
                'SELECT level, COUNT(*) c FROM logs WHERE pk=? AND user_id=? GROUP BY level', (pk, u))}
            ips = [r['ip'] for r in d.execute('SELECT DISTINCT ip FROM logs WHERE pk=? AND user_id=? AND ip IS NOT NULL AND ip != ""', (pk, u))]
            sids = [r['sid'] for r in d.execute('SELECT DISTINCT sid FROM logs WHERE pk=? AND user_id=? AND sid IS NOT NULL', (pk, u))]
            span = d.execute('SELECT MIN(ts) a, MAX(ts) b FROM logs WHERE pk=? AND user_id=?', (pk, u)).fetchone()
            sessions = [{'level': r['level'], 'score': r['score'] or 0, 'ts': r['ts'], 'ip': r['ip'],
                         'convergence': r['convergence'], 'action': r['action'], 'eligible': r['eligible'],
                         'reasons': json.loads(r['reasons'] or '[]'), 'topFeatures': json.loads(r['top_features'] or '[]')}
                        for r in rows]
            return jsonify(userId=u, level=last['level'], score=last['score'] or 0, action=last['action'],
                           convergence=last['convergence'], sessions_count=last['sessions'],
                           high=cnt.get('HIGH', 0), medium=cnt.get('MEDIUM', 0), low=cnt.get('LOW', 0),
                           total=sum(cnt.values()), ips=ips, fps=sids, firstTs=span['a'], lastTs=span['b'],
                           topFeatures=json.loads(last['top_features'] or '[]'),
                           series=[s['score'] for s in sessions][::-1], sessions=sessions)
        finally:
            d.close()

    @app.get('/tenants')
    def tenants():
        auth = request.headers.get('Authorization', '')
        if not ADMIN_TOKEN or not hmac.compare_digest(auth, 'Bearer ' + ADMIN_TOKEN):
            return jsonify(error='admin only'), 403
        d = db()
        try:
            out = []
            for t in d.execute('SELECT pk, name FROM tenants ORDER BY created_at'):
                acc = d.execute('SELECT COUNT(*) c FROM accounts WHERE pk=?', (t['pk'],)).fetchone()['c']
                out.append({'pk': t['pk'], 'name': t['name'], 'accounts': acc})
            return jsonify(tenants=out)
        finally:
            d.close()

    @app.get('/dashboard')
    def dashboard():
        # The operator pastes the sk on the page (kept in that tab's sessionStorage only);
        # keys never travel in a URL. CSP with a nonce: only this page's own script runs.
        with open(os.path.join(HERE, 'dashboard.html'), encoding='utf-8') as f:
            html = f.read()
        nonce = secrets.token_urlsafe(16)
        html = html.replace('<script>', '<script nonce="%s">' % nonce)
        resp = Response(html, mimetype='text/html')
        resp.headers['Content-Security-Policy'] = (
            "default-src 'none'; script-src 'nonce-%s'; style-src 'unsafe-inline'; connect-src 'self'; "
            "img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" % nonce)
        resp.headers['X-Content-Type-Options'] = 'nosniff'
        resp.headers['Referrer-Policy'] = 'no-referrer'
        resp.headers['Cache-Control'] = 'no-store'
        return resp

    @app.get('/')
    def home():
        return jsonify(service='behaviorguard', ok=True)

    return app


if __name__ == '__main__':
    if len(sys.argv) >= 6 and sys.argv[1] == 'mint':
        g = Guard(DB)
        print(g.mint_token(sys.argv[4], sys.argv[5], int(sys.argv[6]) if len(sys.argv) > 6 else 3600,
                           pk=sys.argv[2], sk=sys.argv[3]))
        sys.exit(0)
    create_app().run(host=os.environ.get('BG_HOST', '127.0.0.1'), port=int(os.environ.get('BG_PORT', '5055')), debug=False)
