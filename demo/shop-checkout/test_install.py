"""
test_install.py - the install demo, before and after the one backend line.

    python demo/shop-checkout/test_install.py

Checks that the plain store lets any session pay, and that after
install(app, ...) the same route asks BehaviorGuard first: no fresh assessment or
verification -> 403, the password fallback is checked by the server and reported to the
guard, a second login inherits nothing, and a session the verdict ended gets 401.
"""
import importlib
import os
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
os.environ.setdefault('BG_PK', 'pk_test_shop')
os.environ.setdefault('BG_SK', 'sk_test_shop_secret')
os.environ['BG_DB'] = os.path.join(tempfile.mkdtemp(prefix='shop-test-'), 'bg.db')

results = []


def check(name, cond, note=''):
    results.append((name, bool(cond), note))


def fresh_shop():
    import shop
    return importlib.reload(shop)


def bg(c, path, body=None, method='POST'):
    tok = c.get('/api/bg-token').get_json()['token']
    h = {'X-BG-User-Token': tok, 'Authorization': 'Bearer ' + os.environ['BG_PK']}
    return c.get('/bg' + path, headers=h) if method == 'GET' else c.open('/bg' + path, method=method, json=body, headers=h)


# 1. the plain store
shop = fresh_shop()
c = shop.app.test_client()
c.post('/api/login', json={'email': 'owner@example.com', 'password': 'secret-1'})
r = c.post('/api/checkout', json={'items': ['coffee']})
check('plain: any session can pay, nothing asked', r.status_code == 200 and r.get_json()['ok'])
check('plain: no BehaviorGuard routes', c.get('/api/bg-token').status_code == 404)

# 2. the one install line
shop = fresh_shop()
from flask import session  # noqa: E402
import bg_backend  # noqa: E402
guard = bg_backend.install(shop.app, current_user=lambda: session.get('user'),
                           send_code=lambda user, code: shop.send_email(user, 'Your verification code', code),
                           protect=['/api/checkout'])


def mailbox_code(user):
    return [m['text'] for m in shop.MAILBOX[user]['mail'] if m['subject'] == 'Your verification code'][-1]


owner = shop.app.test_client()
owner.post('/api/login', json={'email': 'owner@example.com', 'password': 'secret-1'})
t = owner.get('/api/bg-token')
check('installed: the logged-in user gets a token', t.status_code == 200 and t.get_json()['endpoint'] == '/bg')
check('installed: the token response never carries the secret key', os.environ['BG_SK'] not in t.get_data(as_text=True))
check('installed: no token without a log-in', shop.app.test_client().get('/api/bg-token').status_code == 401)
bg(owner, '/v1/probe', {'events': 0})
r = owner.post('/api/checkout', json={'items': ['coffee']})
check('installed: paying without a verification -> 403 verify', r.status_code == 403 and r.get_json()['verify'] is True, r.get_data(as_text=True))
check('installed: the store\'s own code did not run (no order)', owner.get('/api/orders').get_json()['orders'] == [])
check('installed: the token says the fallback is an emailed code', t.get_json()['fallback'] == 'code')
check("installed: a code is sent to the account's mailbox", owner.post('/api/bg-code', json={}).get_json()['sent'] is True)
check('installed: a wrong code is refused by the server', owner.post('/api/bg-code/verify', json={'code': '000000'}).get_json()['ok'] is False)
check('installed: the right code is accepted', owner.post('/api/bg-code/verify', json={'code': mailbox_code('owner@example.com')}).get_json()['ok'] is True)
check('installed: the password fallback is not offered alongside the code', owner.post('/api/bg-reauth', json={'password': 'secret-1'}).status_code == 404)
st = bg(owner, '/v1/session', method='GET').get_json()
check('installed: the guard knows this login verified', st['mfa']['graceLeftSec'] > 800)
r = owner.post('/api/checkout', json={'items': ['coffee']})
check('installed: now the payment goes through', r.status_code == 200 and r.get_json()['ok'], r.get_data(as_text=True))
check('installed: other routes are not gated', owner.get('/api/orders').status_code == 200)

# 3. the attacker with the stolen password
att = shop.app.test_client()
att.post('/api/login', json={'email': 'owner@example.com', 'password': 'secret-1'})
bg(att, '/v1/probe', {'events': 0})
check('attacker: a second login does not inherit the verification', att.post('/api/checkout', json={'items': ['tea']}).status_code == 403)
att.post('/api/bg-code', json={})
for _ in range(3):
    last = att.post('/api/bg-code/verify', json={'code': '123456'}).get_json()
check('attacker: without the mailbox, three guesses end the code', last['ok'] is False and last.get('left') == 0)
check('attacker: and a correct code after that is refused', att.post('/api/bg-code/verify', json={'code': mailbox_code('owner@example.com')}).get_json()['ok'] is False)
check('attacker: still no payment', att.post('/api/checkout', json={'items': ['tea']}).status_code == 403)
v = bg(att, '/v1/assess', {'vector': [0.5] * 34, 'events': 200, 'activeSec': 30,
                           'integrity': {'suspected': True, 'reasons': ['identical key holds']}}).get_json()['verdict']
check('attacker: a scripted window ends the session', v['action'] == 'BLOCK_SESSION')
r = att.post('/api/checkout', json={'items': ['tea']})
check('attacker: the server answers 401 ended', r.status_code == 401 and r.get_json()['ended'] is True)
check('attacker: and that login is gone', att.get('/api/me').get_json()['user'] is None)
check('owner: still logged in', owner.get('/api/me').get_json()['user'] == 'owner@example.com')

failed = [x for x in results if not x[1]]
print('\nSHOP-CHECKOUT - installing BehaviorGuard on a plain store\'s backend')
for name, ok, note in results:
    print('  %s %s%s' % ('OK  ' if ok else 'FAIL', name, '' if ok or not note else '  [%s]' % str(note)[:200]))
print('\n  passed %d / %d\n  RESULT: %s' % (len(results) - len(failed), len(results), 'FAIL' if failed else 'PASS'))
sys.exit(1 if failed else 0)
