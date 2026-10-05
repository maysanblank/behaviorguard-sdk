#!/usr/bin/env python3
"""test_app.py - the server API: keys, tokens, isolation, verification and the gate.

Every check is an attack or a rule the backend must hold on its own, whatever the browser
sends. Run: python server/test_app.py
"""
import json
import os
import random
import re
import sqlite3
import sys
import tempfile
import time

_tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
_tmp.close()
os.environ['BG_ADMIN_TOKEN'] = 'admin-test'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app as srv  # noqa: E402
from guard import Guard, _b64u  # noqa: E402

app = srv.create_app(_tmp.name)
guard = app.config['BG_GUARD']
CLOCK = [int(time.time() * 1000)]
guard.clock = lambda: CLOCK[0]
c = app.test_client()
results = []


def check(name, cond, note=''):
    results.append((name, bool(cond), note))


t = c.post('/tenant', json={'name': 'Test Shop'}).get_json()
pk, sk = t['pk'], t['sk']
check('a new tenant gets a pk AND an sk', pk.startswith('pk_') and sk.startswith('sk_'))
other = c.post('/tenant', json={'name': 'Other Shop'}).get_json()


def H(tok=None, key=pk):
    return {'Authorization': 'Bearer ' + key, **({'X-BG-User-Token': tok} if tok else {})}


tok_a1 = guard.mint_token('andi@example.com', 'login-1', pk=pk, sk=sk)
tok_a2 = guard.mint_token('andi@example.com', 'login-2', pk=pk, sk=sk)
tok_b = guard.mint_token('budi@example.com', 'login-9', pk=pk, sk=sk)

rng = random.Random(5)
owner = [0 if i % 7 == 6 else 0.5 + rng.random() * 3 * (1 + i % 5) for i in range(34)]
stranger = [v * (0.35 + rng.random() * 1.6) for v in owner]


def win(base, spread=0.12, **kw):
    return {'vector': [0 if v == 0 else max(0, v * (1 + rng.uniform(-spread, spread))) for v in base],
            'events': 200, 'activeSec': 30, **kw}


def step(sec=31):
    CLOCK[0] += sec * 1000


def assess(tok, w):
    step()
    return c.post('/v1/assess', json=w, headers=H(tok))


# --- keys and tokens
check('assess with the pk alone -> rejected', c.post('/v1/assess', json=win(owner), headers=H()).status_code == 401)
forged = tok_a1.rsplit('.', 1)[0] + '.' + '0' * 64
check('forged signature -> rejected', c.post('/v1/assess', json=win(owner), headers=H(forged)).status_code == 401)
u, s, exp, sig = tok_a1.split('.')
check('extending the expiry -> rejected', c.get('/v1/session', headers=H('%s.%s.%d.%s' % (u, s, int(exp) + 999, sig))).status_code == 401)
check('moving a token to another login session -> rejected',
      c.get('/v1/session', headers=H('%s.%s.%s.%s' % (u, _b64u(b'login-2'), exp, sig))).status_code == 401)
check('moving a token to another account -> rejected',
      c.get('/v1/session', headers=H('%s.%s.%s.%s' % (_b64u(b'budi@example.com'), s, exp, sig))).status_code == 401)
old_exp = int(time.time()) - 5
old = '%s.%s.%d.%s' % (u, s, old_exp, Guard.sign(pk, sk, 'andi@example.com', 'login-1', old_exp))
check('expired token -> rejected', c.get('/v1/session', headers=H(old)).status_code == 401)
cross = guard.mint_token('andi@example.com', 'login-1', pk=other['pk'], sk=other['sk'])
check('another tenant\'s token with this pk -> rejected', c.get('/v1/session', headers=H(cross)).status_code == 401)

# --- input
bad = win(owner)
bad['vector'] = bad['vector'][:20]
check('a vector of the wrong length -> 400', c.post('/v1/assess', json=bad, headers=H(tok_a1)).status_code == 400)
r = c.post('/v1/assess', data='{"vector": [NaN' + ', 1' * 33 + '], "events": 200}', headers={**H(tok_a1), 'Content-Type': 'application/json'})
check('NaN in the vector -> 400 (Python JSON accepts the literal)', r.status_code == 400, r.status_code)
w = win(owner)
w['userId'] = 'budi@example.com'
r = assess(tok_a1, w)
check('identity comes from the token, never the body', r.status_code == 200 and
      c.get('/v1/session', headers=H(tok_b)).get_json()['enrollment']['done'] == 0)

# --- enrollment, then the profile follows the account
for _ in range(10):
    r = assess(tok_a1, win(owner))
st = r.get_json()['status']
check('10 windows enroll the account (window 1 was sent above)', st['phase'] == 'protecting' and st['enrollment']['done'] == 10, st['enrollment'])
r = assess(tok_a2, win(owner))
check('a NEW login (another laptop) is scored against the profile at once',
      r.get_json()['verdict'].get('enrollment') is None and r.get_json()['verdict']['level'] in ('LOW', 'MEDIUM', 'HIGH'))
for _ in range(12):
    assess(tok_a1, win(owner))
r = assess(tok_a2, win(stranger))
v1 = r.get_json()['verdict']
r = assess(tok_a2, win(stranger))
v2 = r.get_json()['verdict']
check('a stranger on the owner\'s account: HIGH, then the session is ended',
      v1['level'] == 'HIGH' and v2['action'] == 'BLOCK_SESSION' and v2['blocked'] is True, (v1['level'], v2['action']))
check('guard.blocked() reports the ended login to the site', guard.blocked('andi@example.com', 'login-2', pk=pk))
# --- the server-side gate
step()
c.post('/v1/probe', json=win(stranger), headers=H(tok_a2))
g = guard.check('andi@example.com', 'login-2', pk=pk, money=True)
check('check(): stranger -> not allowed', g['allowed'] is False and g['level'] == 'HIGH', g)
step(200)
g = guard.check('andi@example.com', 'login-1', pk=pk, money=True)
check('check(): no fresh assessment -> not allowed (fail closed)', g['allowed'] is False and g['level'] == 'UNKNOWN', g)

# --- verification: the site's own factor, reported by its server
r = c.post('/v1/report', json={'userId': 'andi@example.com', 'sessionId': 'login-1', 'passed': True}, headers=H())
check('report with the pk -> rejected', r.status_code == 401)
r = c.post('/v1/report', json={'userId': 'andi@example.com', 'sessionId': 'login-1', 'passed': True},
           headers={'Authorization': 'Bearer ' + other['sk']})
check('another tenant\'s sk cannot verify this account', r.status_code == 200 and
      not guard.check('andi@example.com', 'login-1', pk=pk)['verifiedRecently'])
r = c.post('/v1/report', json={'userId': 'andi@example.com', 'sessionId': 'login-1', 'passed': True},
           headers={'Authorization': 'Bearer ' + sk})
check('report with this tenant\'s sk is applied', r.status_code == 200 and r.get_json()['applied'] is True)
g1 = guard.check('andi@example.com', 'login-1', pk=pk, money=True)
g2 = guard.check('andi@example.com', 'login-2', pk=pk, money=True)
check('the verified login may act', g1['allowed'] is True and g1['verifiedRecently'] is True, g1)
check('ANOTHER login of the same account does not inherit it', g2['allowed'] is False and g2['verifiedRecently'] is False, g2)
check('check(always=True) wants a verification in the last 2 minutes', guard.check('andi@example.com', 'login-1', pk=pk, always=True)['allowed'])
step(180)
check('... and not 3 minutes later', not guard.check('andi@example.com', 'login-1', pk=pk, always=True)['allowed'])

# --- typing rhythm, kept and checked on the server
person = {'dwell': [rng.uniform(70, 160) for _ in range(20)], 'flight': [rng.uniform(40, 260) for _ in range(19)]}


def typed(p, j=0.08):
    return {'dwell': [d * (1 + rng.uniform(-j, j)) for d in p['dwell']], 'flight': [f * (1 + rng.uniform(-j, j)) for f in p['flight']]}


r = c.post('/v1/rhythm/enroll', json={'samples': [typed(person) for _ in range(3)]}, headers=H(tok_a2))
check('enrolling a rhythm from the suspected login -> refused', r.get_json()['enrolled'] is False and 'suspicion' in r.get_json()['reason'])
step()
c.post('/v1/report', json={'userId': 'andi@example.com', 'sessionId': 'login-1', 'passed': True}, headers={'Authorization': 'Bearer ' + sk})
assess(tok_a1, win(owner))
r = c.post('/v1/rhythm/enroll', json={'samples': [typed(person) for _ in range(3)]}, headers=H(tok_a1))
check('enrolling from a trusted login works', r.get_json()['enrolled'] is True, r.get_json())
row = sqlite3.connect(_tmp.name).execute("SELECT state FROM accounts WHERE user_id='andi@example.com'").fetchone()[0]
check('the template is stored on the server', json.loads(row)['template']['rounds'] == 3)
check('the session status never contains the template', 'dwell' not in json.dumps(c.get('/v1/session', headers=H(tok_a1)).get_json()))
r = c.post('/v1/rhythm/verify', json={'sample': typed(person, 0.06)}, headers=H(tok_a1))
check('the owner\'s rhythm verifies on the server', r.get_json()['ok'] is True, r.get_json())
imp = {'dwell': [rng.uniform(70, 160) for _ in range(20)], 'flight': [rng.uniform(40, 260) for _ in range(19)]}
outs = [c.post('/v1/rhythm/verify', json={'sample': typed(imp)}, headers=H(tok_a2)).get_json() for _ in range(3)]
check('3 wrong attempts close the dialog and count a failure', outs[-1].get('attemptsExhausted') is True and outs[-1]['failStreak'] == 1, outs[-1])
short = typed(person)
short['dwell'] = short['dwell'][:-3]
check('an incomplete sample (paste) is rejected', c.post('/v1/rhythm/verify', json={'sample': short}, headers=H(tok_a2)).get_json()['ok'] is False)
for _ in range(2):
    for _ in range(3):
        step(2)
        last = c.post('/v1/rhythm/verify', json={'sample': typed(imp)}, headers=H(tok_a2)).get_json()
check('3 failed dialogs in a row lock the rhythm path', last.get('locked') is True, last)
step(60)
r = c.post('/v1/rhythm/verify', json={'sample': typed(person, 0.05)}, headers=H(tok_a2)).get_json()
check('once locked, even the right rhythm is refused (needs the site\'s own factor)', r['ok'] is False and r.get('locked'), r)
check('removing the template without a fresh verification -> refused',
      c.delete('/v1/rhythm', headers=H(tok_a2)).get_json()['removed'] is False)
check('erasing the profile without a fresh verification -> refused',
      c.delete('/v1/profile', headers=H(tok_b)).get_json()['removed'] is False)

# --- operator side
check('dashboard with the pk -> rejected', c.get('/api/dashboard', headers=H()).status_code == 401)
check('dashboard without a key -> rejected', c.get('/api/dashboard').status_code == 401)
d = c.get('/api/dashboard', headers={'Authorization': 'Bearer ' + sk}).get_json() or {}
check('dashboard with the operator sk: this tenant\'s accounts only',
      sorted(a['userId'] for a in d.get('accounts', [])) == ['andi@example.com'], [a['userId'] for a in d.get('accounts', [])])
check('another tenant\'s sk sees nothing of this tenant',
      c.get('/api/dashboard', headers={'Authorization': 'Bearer ' + other['sk']}).get_json()['accounts'] == [])
check('account detail with the pk -> rejected', c.get('/api/account?u=andi@example.com', headers=H()).status_code == 401)
check('tenant list without the admin token -> rejected', c.get('/tenants').status_code == 403)
check('tenant list with the admin token', c.get('/tenants', headers={'Authorization': 'Bearer admin-test'}).status_code == 200)
resp = c.get('/dashboard?pk=' + pk)
html = resp.get_data(as_text=True)
check('the dashboard page carries no key', pk not in html and sk not in html)
csp = resp.headers.get('Content-Security-Policy', '')
m = re.search(r"'nonce-([^']+)'", csp)
check('the dashboard is served with a nonce CSP (no inline script allowed)',
      m and 'nonce="%s"' % m.group(1) in html and "'unsafe-inline'" not in csp.split('script-src')[1].split(';')[0])
check('a new nonce on every request', m and m.group(1) not in c.get('/dashboard').headers.get('Content-Security-Policy', ''))
XSS = '<img src=x onerror=alert(1)>'
step()
assess(tok_b, {**win(owner), 'integrity': {'suspected': True, 'reasons': [XSS * 20] * 20}})
row = sqlite3.connect(_tmp.name).execute("SELECT reasons, ip FROM logs WHERE user_id='budi@example.com' ORDER BY id DESC LIMIT 1").fetchone()
rs = json.loads(row[0])
check('browser-sent reasons are capped (6 x 160) before the log', len(rs) <= 6 and all(len(x) <= 160 for x in rs))
check('the dashboard escapes every value it renders', 'function esc(' in html and '${esc(a.userId)}' in html)
step()
c.post('/v1/assess', json=win(owner), headers={**H(tok_b), 'X-Forwarded-For': '6.6.6.6'})
ip = sqlite3.connect(_tmp.name).execute("SELECT ip FROM logs WHERE user_id='budi@example.com' ORDER BY id DESC LIMIT 1").fetchone()[0]
check('a spoofed X-Forwarded-For is not trusted without BG_TRUST_PROXY', ip != '6.6.6.6', ip)
codes = [c.post('/v1/assess', json=win(owner), headers=H(tok_b)).get_json()['verdict'].get('rateLimited') for _ in range(14)]
check('more than 12 windows a minute -> rate limited', any(codes))

# an attacker's ended login must not end the owner's login on its next window
tc1 = guard.mint_token('cici@example.com', 'c-owner', pk=pk, sk=sk)
tc2 = guard.mint_token('cici@example.com', 'c-attacker', pk=pk, sk=sk)
levels = [assess(tc1, win(owner, spread=0.03)).get_json()['verdict'] for _ in range(24)]
owner_ok = [v['level'] for v in levels if not v.get('enrollment')][-4:]
a1 = assess(tc2, win(stranger)).get_json()['verdict']
a2 = assess(tc2, win(stranger)).get_json()['verdict']
o1 = assess(tc1, win(owner, spread=0.03)).get_json()['verdict']
check('the attacker\'s login is ended after two HIGH', a2['action'] == 'BLOCK_SESSION', (a1['level'], a2['action']))
check('the owner\'s next window asks the owner to verify (the account was attacked)...',
      o1['level'] == 'HIGH' and o1.get('stickyFloor') is True, (owner_ok, o1['level'], o1.get('modelLevel')))
check('... but does not end the owner\'s login (the run is counted per login)',
      o1['action'] != 'BLOCK_SESSION' and not guard.blocked('cici@example.com', 'c-owner', pk=pk), o1['action'])

# server to server: the HTTP form of check() and forget(), for stacks that are not Python
SK = {'Authorization': 'Bearer ' + sk}
check('/v1/check with the pk -> rejected', c.post('/v1/check', json={'userId': 'andi@example.com', 'sessionId': 'login-2'}, headers=H()).status_code == 401)
r = c.post('/v1/check', json={'userId': 'andi@example.com', 'sessionId': 'login-2', 'money': True}, headers=SK).get_json()
check('/v1/check reports an ended login', r['allowed'] is False and r['ended'] is True, r)
r = c.post('/v1/check', json={'userId': 'andi@example.com', 'sessionId': 'login-1', 'money': True}, headers=SK).get_json()
g = guard.check('andi@example.com', 'login-1', pk=pk, money=True)
check('/v1/check gives the same answer as guard.check()', r['allowed'] == g['allowed'] and r['reason'] == g['reason'] and r['ended'] is False, (r, g))
check('/v1/check needs both ids', c.post('/v1/check', json={'userId': 'andi@example.com'}, headers=SK).status_code == 400)
check('/v1/forget with the pk -> rejected', c.post('/v1/forget', json={'userId': 'budi@example.com'}, headers=H()).status_code == 401)
r = c.post('/v1/forget', json={'userId': 'budi@example.com'}, headers=SK).get_json()
check('/v1/forget with the sk erases the account', r['removed'] is True and
      sqlite3.connect(_tmp.name).execute("SELECT COUNT(*) FROM accounts WHERE user_id='budi@example.com'").fetchone()[0] == 0)

failed = [r for r in results if not r[1]]
print('\nSERVER API')
for n, ok, note in results:
    print('  %s %s' % ('OK  ' if ok else 'FAIL', n) + ('  [%s]' % (note,) if note != '' and not ok else ''))
print('\n  passed %d / %d\n  RESULT: %s' % (len(results) - len(failed), len(results), 'FAIL' if failed else 'PASS'))
try:
    os.unlink(_tmp.name)
except OSError:
    pass
sys.exit(1 if failed else 0)
