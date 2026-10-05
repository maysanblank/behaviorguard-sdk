"""
test_server.py - the Arunika demo bank's backend, with BehaviorGuard installed on it.

Runs the Flask app in-process against a throwaway data folder and checks the parts a
reviewer would poke at: the account lives on the server, money moves only through the
server-side gate, the one-time code is checked by the server and reported to the guard,
a second login does not inherit a verification, a blocked session is logged out by the
server, and the demo phone's codes reach only the browser that holds its key.

    python demo/arunika/test_server.py
"""
import json
import os
import random
import re
import shutil
import sys
import tempfile

TMP = tempfile.mkdtemp(prefix='arunika-test-')
os.environ['ARUNIKA_DATA'] = TMP
os.environ['ARUNIKA_WINDOWS_PER_MIN'] = '1000'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import server as S  # noqa: E402

results = []


def check(name, cond, note=''):
    results.append((name, bool(cond), note))


def client():
    return S.app.test_client()


def me_of(html):
    m = re.search(r'window\.ARUNIKA_ME=(.*?);</script>', html)
    return json.loads(m.group(1)) if m else None


def bg(c, path, body=None, method='POST'):
    tok = c.get('/api/bg-token').get_json()['token']
    h = {'X-BG-User-Token': tok, 'Authorization': 'Bearer ' + S.BG_PK}
    if method == 'GET':
        return c.get('/bg' + path, headers=h)
    return c.open('/bg' + path, method=method, json=body, headers=h)


def otp(c, phone_key=None):
    c.post('/api/otp/send', json={})
    r = c.get('/api/demo/phone?k=%s' % (phone_key or ''))
    if r.status_code != 200:
        return None
    return re.search(r'(\d{6})', r.get_json()['messages'][-1]['text']).group(1)


EMAIL = 'andi.wijaya@example.com'
PW = 'rahasia123'
try:
    # A. sign-up: the account lives on the server
    owner = client()
    r = owner.post('/api/signup', json={'email': EMAIL, 'nama': 'Andi Wijaya', 'hp': '081234567890', 'password': PW})
    j = r.get_json()
    check('A: sign-up creates the account on the server', r.status_code == 200 and j['account']['saldo'] == S.DEMO_BALANCE)
    phone_key = j['phoneKey']
    check('A: the page never receives the password or the phone key in the account object',
          'pw' not in j['account'] and 'phoneKey' not in j['account'])
    check('A: the same email cannot sign up twice', owner.post('/api/signup', json={'email': EMAIL, 'nama': 'X Y', 'hp': '081234567890', 'password': PW}).status_code == 409)
    html = owner.get('/home.html').get_data(as_text=True)
    me = me_of(html)
    check('A: pages carry the logged-in account (window.ARUNIKA_ME)', me and me['account']['email'] == EMAIL and me['session']['email'] == EMAIL)
    check('A: ARUNIKA_ME cannot break out of its script tag', '</script><' not in json.dumps(me) and '<' not in re.search(r'ARUNIKA_ME=(.*?);</script>', html).group(1))
    check('A: server.py and .data are not served', client().get('/server.py').status_code == 404 and client().get('/.data/secrets.json').status_code == 404)
    check('A: the library bundle is served', client().get('/dist/behaviorguard.js').status_code == 200)

    # B. login with the password, from anywhere
    other = client()
    check('B: a wrong password is refused', other.post('/api/login', json={'email': EMAIL, 'password': 'salah12345'}).status_code == 401)
    check('B: an unknown email says so', other.post('/api/login', json={'email': 'nobody@example.com', 'password': PW}).status_code == 404)
    check('B: the right password logs in from a second browser', other.post('/api/login', json={'email': EMAIL, 'password': PW}).status_code == 200)
    check('B: a token is minted only for a logged-in user', client().get('/api/bg-token').status_code == 401)
    t1 = owner.get('/api/bg-token').get_json()['token']
    t2 = other.get('/api/bg-token').get_json()['token']
    check('B: each login gets its own session id in the token', t1.split('.')[1] != t2.split('.')[1] and t1.split('.')[0] == t2.split('.')[0])

    # C. money moves only through the server-side gate
    tx = {'rek': '2203419876', 'nama': 'Budi Santoso', 'bank': 'Arunika', 'amount': 150000}
    bg(owner, '/v1/probe', {'events': 0})          # what assessNow() sends with no evidence
    r = owner.post('/api/transfer', json=tx)
    check('C: a transfer without a verification is refused (403 verify)', r.status_code == 403 and r.get_json()['verify'] is True, r.get_data(as_text=True))
    check('C: no money moved', owner.get('/api/me').get_json()['account']['saldo'] == S.DEMO_BALANCE)
    r = owner.post('/bg/v1/report', json={'userId': EMAIL, 'sessionId': 'x', 'passed': True},
                   headers={'Authorization': 'Bearer ' + S.BG_PK})
    check('C: the page cannot report its own verification (the report needs the secret key)', r.status_code in (401, 403))

    # D. the one-time code, checked by the server, reported to the guard
    owner.post('/api/otp/send', json={})
    bad = owner.post('/api/otp/verify', json={'code': '000000'}).get_json()
    check('D: a wrong code is refused', bad['ok'] is False)
    code = otp(owner, phone_key)
    check('D: the code reaches the phone of the browser that holds its key', code and len(code) == 6)
    check('D: the right code is accepted', owner.post('/api/otp/verify', json={'code': code}).get_json()['ok'] is True)
    st = bg(owner, '/v1/session', method='GET').get_json()
    check('D: BehaviorGuard now knows this login verified (server to server)', st['mfa']['verifiedAgoSec'] is not None and st['mfa']['graceLeftSec'] > 800)
    r = owner.post('/api/transfer', json=tx)
    check('D: the transfer goes through after the verification', r.status_code == 200 and r.get_json()['account']['saldo'] == S.DEMO_BALANCE - 150000, r.get_data(as_text=True))
    check('D: the transfer is in the history on the server', owner.get('/api/me').get_json()['account']['tx'][0]['ket'] == 'Transfer to Budi Santoso')

    # E. the second login (the attacker with the stolen password) inherits nothing
    bg(other, '/v1/probe', {'events': 0})
    r = other.post('/api/transfer', json=tx)
    check('E: a second login does not inherit the owner\'s verification', r.status_code == 403)
    check('E: the phone key is not in the second browser\'s pages', phone_key not in other.get('/home.html').get_data(as_text=True))
    check('E: the phone does not open without its key', other.get('/api/demo/phone?k=guess').status_code == 404)
    other.post('/api/otp/send', json={})
    for _ in range(3):
        last = other.post('/api/otp/verify', json={'code': '%06d' % random.randint(0, 999999)}).get_json()
    check('E: three wrong codes end the attempt', last.get('exhausted') is True)
    check('E: still no money moves for the second login', other.post('/api/transfer', json=tx).status_code == 403)

    # F. the password change always needs a fresh verification
    r = owner.post('/api/password', json={'current': PW, 'new': 'baru12345a'})
    check('F: password change right after a verification is allowed (within 2 minutes)', r.status_code == 200, r.get_data(as_text=True))
    other2 = client()
    other2.post('/api/login', json={'email': EMAIL, 'password': 'baru12345a'})
    r = other2.post('/api/password', json={'current': 'baru12345a', 'new': 'lagi12345b'})
    check('F: password change without a verification is refused', r.status_code == 403)
    check('F: a wrong current password is refused before anything else', other2.post('/api/password', json={'current': 'nope1234', 'new': 'lagi12345b'}).status_code == 400)

    # G. a verdict that ends the session is enforced by the server
    vec = [0.5] * 34
    r = bg(other2, '/v1/assess', {'vector': vec, 'events': 200, 'activeSec': 30,
                                   'integrity': {'suspected': True, 'reasons': ['identical key holds']}})
    v = r.get_json()['verdict']
    check('G: a scripted window ends the session', v['action'] == 'BLOCK_SESSION', v.get('action'))
    r = other2.post('/api/transfer', json=tx)
    check('G: the server answers 401 ended for that login', r.status_code == 401 and r.get_json().get('ended') is True)
    m = me_of(other2.get('/home.html').get_data(as_text=True))
    check('G: that browser is logged out, and the page knows why', m['session'] is None and m['ended'] is True)
    check('G: the owner\'s own login is not logged out by it', me_of(owner.get('/home.html').get_data(as_text=True))['session'] is not None)

    # H. the security log is kept on the account
    owner.post('/api/log', json={'lv': 'ok', 't1': 'Verified before you send this transfer', 't2': 'With a one-time code.'})
    other3 = client()
    other3.post('/api/login', json={'email': EMAIL, 'password': 'baru12345a'})
    check('H: the security log follows the account to another browser', me_of(other3.get('/security.html').get_data(as_text=True))['log'][0]['t1'].startswith('Verified'))

    # I. demo tools
    s = client()
    check('I: the sample account logs in with its history', s.post('/api/sample', json={}).status_code == 200
          and len(s.get('/api/me').get_json()['account']['tx']) > 10)
    s2 = client()
    check('I: the sample account also opens with its password (second laptop)', s2.post('/api/login', json={'email': S.SAMPLE[0], 'password': S.SAMPLE[2]}).status_code == 200)
    r = owner.post('/api/demo/mode', json={'fast': True})
    check('I: presentation mode is kept on the account', r.get_json()['fast'] is True and me_of(other3.get('/home.html').get_data(as_text=True))['account']['fast'] is True)
    r = owner.post('/api/demo/reset', json={})
    check('I: restart deletes the account from the server', r.status_code == 200 and client().post('/api/login', json={'email': EMAIL, 'password': 'baru12345a'}).status_code == 404)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [r for r in results if not r[1]]
print('\nARUNIKA - the demo bank\'s backend with BehaviorGuard')
for name, ok, note in results:
    print('  %s %s%s' % ('OK  ' if ok else 'FAIL', name, '' if ok or not note else '  [%s]' % str(note)[:200]))
print('\n  passed %d / %d\n  RESULT: %s' % (len(results) - len(failed), len(results), 'FAIL' if failed else 'PASS'))
sys.exit(1 if failed else 0)
