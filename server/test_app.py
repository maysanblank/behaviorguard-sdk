#!/usr/bin/env python3
"""test_app.py - C-39: pk sendirian tidak membuka apa pun.

Setiap uji di sini adalah serangan yang DULU berhasil hanya dengan pk yang terbaca dari
kode halaman. Jalankan: python server/test_app.py
"""
import os, sys, tempfile, time, json

_tmp = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
_tmp.close()
os.environ['BG_DB'] = _tmp.name
os.environ['BG_ADMIN_TOKEN'] = 'admin-uji'
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import app as srv  # noqa: E402

srv.init_db()
c = srv.app.test_client()
results = []


def check(name, cond, note=''):
    results.append((name, bool(cond), note))


t = c.post('/tenant', json={'name': 'Toko Uji'}).get_json()
pk, sk = t['pk'], t['sk']
check('tenant baru mendapat pk DAN sk', pk.startswith('pk_') and sk.startswith('sk_'))
other = c.post('/tenant', json={'name': 'Toko Lain'}).get_json()

H = lambda tok=None, key=pk: {'Authorization': 'Bearer ' + key, **({'X-BG-User-Token': tok} if tok else {})}
tok_a = srv.mint_user_token(pk, sk, 'andi@contoh.id')
tok_b = srv.mint_user_token(pk, sk, 'budi@contoh.id')

# --- baseline
r = c.get('/baseline?u=andi@contoh.id', headers=H())
check('baca baseline dengan pk saja -> DITOLAK', r.status_code == 401, r.status_code)
r = c.post('/baseline', json={'userId': 'andi@contoh.id', 'vectors': [[1.0] * 28]}, headers=H())
check('tulis baseline dengan pk saja (peracunan) -> DITOLAK', r.status_code == 401, r.status_code)
r = c.post('/baseline', json={'vectors': [[0.5] * 28] * 12}, headers=H(tok_a))
check('pemilik dengan token sah bisa menyimpan baseline', r.status_code == 200 and r.get_json()['stored'] == 12)
r = c.post('/baseline', json={'userId': 'andi@contoh.id', 'vectors': [[9.9] * 28]}, headers=H(tok_b))
check('token Budi menulis ke akun Andi -> DITOLAK', r.status_code == 403, r.status_code)
r = c.get('/baseline?u=andi@contoh.id', headers=H(tok_b))
check('token Budi dengan ?u=andi hanya membaca baseline Budi sendiri',
      r.status_code == 200 and r.get_json()['vectors'] == [])
r = c.get('/baseline', headers=H(tok_a))
check('pemilik membaca baseline-nya sendiri', r.status_code == 200 and len(r.get_json()['vectors']) == 12)
forged = tok_a.rsplit('.', 1)[0] + '.' + '0' * 64
check('token dengan tanda tangan palsu -> DITOLAK', c.get('/baseline', headers=H(forged)).status_code == 401)
u, exp, sig = tok_a.split('.')
bumped = f'{u}.{int(exp) + 999}.{sig}'
check('memperpanjang masa berlaku token -> DITOLAK', c.get('/baseline', headers=H(bumped)).status_code == 401)
old = srv._b64u(b'andi@contoh.id') + '.' + str(int(time.time()) - 5) + '.' + srv._sig(sk, pk, 'andi@contoh.id', int(time.time()) - 5)
check('token kedaluwarsa -> DITOLAK', c.get('/baseline', headers=H(old)).status_code == 401)
cross = srv.mint_user_token(other['pk'], other['sk'], 'andi@contoh.id')
check('token tenant lain dipakai dengan pk tenant ini -> DITOLAK', c.get('/baseline', headers=H(cross)).status_code == 401)
# JSON Python menerima literal NaN; klien jahat bisa mengirimnya
r = c.post('/baseline', data='{"vectors": [[NaN, 1], [0.1, 0.2]]}', headers={**H(tok_a), 'Content-Type': 'application/json'})
check('vektor NaN/inf dibuang saat sanitasi', r.status_code == 200 and r.get_json()['stored'] == 1, r.get_json())

# --- log
r = c.post('/log', json={'userId': 'andi@contoh.id', 'level': 'LOW', 'score': 0}, headers=H())
check('memalsukan vonis dengan pk saja -> DITOLAK', r.status_code == 401)
r = c.post('/log', json={'userId': 'andi@contoh.id', 'level': 'LOW'}, headers=H(tok_b))
check('token Budi memalsukan vonis Andi -> DITOLAK', r.status_code == 403)
r = c.post('/log', json={'level': 'HIGH', 'score': -3, 'reasons': ['uji']}, headers=H(tok_a))
check('vonis sah tercatat', r.status_code == 200)

# --- operator & admin
check('dashboard dengan pk -> DITOLAK', c.get('/api/dashboard', headers=H()).status_code == 401)
check('dashboard tanpa kunci -> DITOLAK', c.get('/api/dashboard').status_code == 401)
r = c.get('/api/dashboard', headers={'Authorization': 'Bearer ' + sk})
d = r.get_json() or {}
check('dashboard dengan sk operator -> data tenant INI saja',
      r.status_code == 200 and [a['userId'] for a in d.get('accounts', [])] == ['andi@contoh.id'])
r = c.get('/api/dashboard', headers={'Authorization': 'Bearer ' + other['sk']})
check('sk tenant lain tidak melihat akun tenant ini', r.status_code == 200 and r.get_json()['accounts'] == [])
check('detail akun dengan pk -> DITOLAK', c.get('/api/account?u=andi@contoh.id', headers=H()).status_code == 401)
check('daftar semua tenant tanpa token admin -> DITOLAK', c.get('/tenants').status_code == 403)
check('daftar semua tenant dengan pk -> DITOLAK', c.get('/tenants', headers=H()).status_code == 403)
check('daftar tenant dengan token admin', c.get('/tenants', headers={'Authorization': 'Bearer admin-uji'}).status_code == 200)
html = c.get('/dashboard?pk=' + pk).get_data(as_text=True)
check('halaman dashboard tidak menyisipkan kunci apa pun ke HTML', pk not in html and sk not in html)

failed = [r for r in results if not r[1]]
print('\nSERVER - AUTENTIKASI (C-39)')
for n, ok, note in results:
    print(f"  {'OK  ' if ok else 'FAIL'} {n}" + (f'  [{note}]' if note != '' and not ok else ''))
print(f'\n  lulus {len(results) - len(failed)} / {len(results)}\n  HASIL: {"ADA KEGAGALAN" if failed else "SESUAI"}')
try:
    os.unlink(_tmp.name)
except OSError:
    pass
sys.exit(1 if failed else 0)
