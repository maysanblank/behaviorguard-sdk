# Memasang BehaviorGuard ke situs Anda

Untuk situs yang **sudah punya login** dan ingin melindungi aksi sensitif (checkout,
transfer, ganti email) tanpa menulis ulang kode yang ada. Contoh yang jalan:
[`demo/shop-checkout/`](../demo/shop-checkout/) (paling kecil) dan
[`demo/arunika/`](../demo/arunika/) (bank lengkap).

> English version: [INTEGRATION.md](INTEGRATION.md)

## Peta: tiga tempat yang disentuh

| # | Di mana | Yang ditambahkan | Kenapa di situ |
|---|---|---|---|
| 1 | Server BehaviorGuard | Flask: pasang di dalam aplikasi Anda. Stack lain: jalankan `server/app.py` | menyimpan profil tiap akun dan membuat keputusan |
| 2 | Backend Anda | route token, pemeriksaan sebelum tiap route sensitif, laporan sesudah OTP Anda | hanya backend yang tahu siapa yang login, dan hanya ia yang boleh memegang `sk` |
| 3 | Halaman Anda | satu tag `<script>` di layout sesudah login | perilaku ditangkap di browser |

Kode login, checkout, dan database Anda **tetap seperti adanya**.

```
browser --(34 angka per jendela 30 detik, token)-->  server BehaviorGuard  (profil, vonis)
   ^                                                      ^        |
   | route token (sesudah login)                          | sk     | check / report (sk)
backend Anda ---------------------------------------------+--------+
   sebelum /api/checkout: "boleh login ini melakukan ini sekarang?"  ->  boleh, atau 403 verify
```

Event mentah (jejak mouse, ketikan) **tidak pernah dikirim**. Penilaian, vonis, cek ritme
ketik, dan izin untuk aksi sensitif ada di server.

---

## Langkah 1 - Server BehaviorGuard

**Flask:** tidak ada yang perlu dijalankan terpisah. Salin `server/guard.py`,
`server/engine.py`, `server/rhythm.py`, dan `core/bg_core.py` (atau salinan datar di
`dist/server/`) ke sebelah aplikasi Anda, lalu pasang:

```python
from guard import Guard, create_blueprint
guard = Guard(os.environ.get('BG_DB', 'behaviorguard.db'), tenant=(os.environ['BG_PK'], os.environ['BG_SK']))
app.register_blueprint(create_blueprint(guard), url_prefix='/bg')
```

Buat kuncinya sekali: `python -c "import secrets; print('pk_' + secrets.token_hex(12)); print('sk_' + secrets.token_hex(24))"`.

**Stack lain:** jalankan layanannya dan buat tenant. `sk` hanya ditampilkan sekali:

```bash
pip install flask
python server/app.py          # http://127.0.0.1:5055
curl -X POST http://127.0.0.1:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"Toko Saya\"}"
```

Dua-duanya: simpan kunci di environment **backend**, jangan pernah di halaman:

```
BG_PK=pk_xxxxxxxx
BG_SK=sk_xxxxxxxx
BG_URL=https://bg.contoh.id        # alamat layanan (tidak perlu kalau dipasang di dalam)
```

Kalau `sk` bocor ke halaman, siapa pun bisa mencetak token untuk user mana pun. Catatan
deploy: [server/README.md](../server/README.md).

---

## Langkah 2 - Backend Anda

Tiga hal, semuanya di sebelah route login (sesudah middleware sesi):

| Apa | Aturan |
|---|---|
| `GET /api/bg-token` | token untuk user yang login **dan sesi login ini**. Ambil user dari sesi, jangan dari request. Belum login: 401. |
| pemeriksaan sebelum tiap route sensitif | tanya BehaviorGuard "boleh login ini melakukan ini sekarang?". Tidak boleh: jawab **403** dengan `{"verify": true}` (halaman memverifikasi lalu mengirim ulang). Sesi diakhiri: **401**, logout-kan user. |
| laporan sesudah faktor milik Anda | saat server *Anda* sudah memeriksa OTP, WebAuthn, atau sandi yang diketik ulang, beri tahu BehaviorGuard. Hanya dengan cara itu verifikasi seperti itu dihitung. |

Token terdiri dari empat bagian, ditandatangani dengan `sk`:

```
b64url(userId) "." b64url(sessionId) "." exp "." hex(HMAC-SHA256(sk, pk|userId|sessionId|exp))
```

`sessionId` adalah id apa pun yang **baru di setiap login** (id sesi Anda, atau nilai acak
yang disimpan di sesi saat login). Verifikasi menempel padanya, jadi login penyerang tidak
pernah mewarisi verifikasi pemilik. Umur 15 menit sudah bagus; pustaka mengambil token baru
dari route Anda saat token lama kedaluwarsa.

### Flask (dipasang di dalam)

```python
@app.get('/api/bg-token')
def bg_token():
    if 'user' not in session: return {'error': 'not logged in'}, 401
    session.setdefault('login_id', secrets.token_hex(16))      # atau set di route login Anda
    return {'token': guard.mint_token(session['user'], session['login_id'], ttl=900)}

@app.post('/api/checkout')
def checkout():
    user, sid = session['user'], session['login_id']
    if guard.blocked(user, sid):
        session.clear(); return {'ended': True}, 401
    c = guard.check(user, sid, money=True)                     # always=True untuk ganti sandi/email
    if not c['allowed']: return {'verify': True, 'level': c['level'], 'reason': c['reason']}, 403
    ...                                                        # kode Anda yang sudah ada

@app.post('/api/otp/verify')
def otp_verify():
    ok = cek_otp_saya(session['user'], request.json['code'])   # pemeriksaan Anda sendiri
    guard.report_verified(None, session['user'], session['login_id'], ok)
    return {'ok': ok}
```

Atau pakai [`demo/shop-checkout/bg_backend.py`](../demo/shop-checkout/bg_backend.py), yang
mengerjakan semua itu dari satu baris sesudah route Anda:

```python
from bg_backend import install
install(app, current_user=lambda: session.get("user"),
        send_code=lambda user, code: send_email(user, "Kode verifikasi Anda", code), protect=["/api/checkout"])
```

### Node.js / Express (dengan layanan)

```js
import crypto from 'node:crypto';
const { BG_PK, BG_SK, BG_URL } = process.env;
const b64u = s => Buffer.from(s).toString('base64url');

function bgToken(userId, sessionId, ttl = 900) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = crypto.createHmac('sha256', BG_SK).update(`${BG_PK}|${userId}|${sessionId}|${exp}`).digest('hex');
  return `${b64u(userId)}.${b64u(sessionId)}.${exp}.${sig}`;
}
const bg = (path, body) => fetch(BG_URL + path, { method: 'POST', body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + BG_SK } }).then(r => r.json());

app.get('/api/bg-token', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not logged in' });
  res.json({ token: bgToken(req.session.user, req.session.id), endpoint: BG_URL, pk: BG_PK });
});

// sebelum tiap route sensitif
async function behaviorGate(req, res, next) {
  const c = await bg('/v1/check', { userId: req.session.user, sessionId: req.session.id, money: true });
  if (c.ended) { req.session.destroy(() => {}); return res.status(401).json({ ended: true }); }
  if (!c.allowed) return res.status(403).json({ verify: true, level: c.level, reason: c.reason });
  next();
}
app.post('/api/checkout', behaviorGate, checkoutHandler);

// sesudah pemeriksaan OTP Anda sendiri
await bg('/v1/report', { userId: req.session.user, sessionId: req.session.id, passed: ok });
```

### PHP (tanpa framework, dengan layanan)

`bg.php`:

```php
<?php
function bg_b64u($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function bg_token($user, $sid, $ttl = 900) {
    $pk = getenv('BG_PK'); $sk = getenv('BG_SK'); $exp = time() + $ttl;
    $sig = hash_hmac('sha256', "$pk|$user|$sid|$exp", $sk);
    return bg_b64u($user) . '.' . bg_b64u($sid) . ".$exp.$sig";
}
function bg_call($path, $body) {
    $ctx = stream_context_create(['http' => ['method' => 'POST', 'content' => json_encode($body),
        'header' => "Content-Type: application/json\r\nAuthorization: Bearer " . getenv('BG_SK')]]);
    return json_decode(file_get_contents(getenv('BG_URL') . $path, false, $ctx), true);
}
```

`bg-token.php`:

```php
<?php
session_start(); require 'bg.php'; header('Content-Type: application/json');
if (empty($_SESSION['user'])) { http_response_code(401); exit('{}'); }
echo json_encode(['token' => bg_token($_SESSION['user'], session_id()),
                  'endpoint' => getenv('BG_URL'), 'pk' => getenv('BG_PK')]);
```

Di awal `checkout.php` (dan tiap endpoint sensitif):

```php
$c = bg_call('/v1/check', ['userId' => $_SESSION['user'], 'sessionId' => session_id(), 'money' => true]);
if (!empty($c['ended'])) { session_destroy(); http_response_code(401); exit(json_encode(['ended' => true])); }
if (empty($c['allowed'])) { http_response_code(403); exit(json_encode(['verify' => true, 'reason' => $c['reason']])); }
```

Panggil `session_regenerate_id(true)` di route login, supaya tiap login dapat id sesi baru.

### Laravel (dengan layanan)

`routes/web.php`:

```php
use Illuminate\Support\Facades\Http;

Route::middleware('auth')->group(function () {
    Route::get('/api/bg-token', function () {
        $pk = env('BG_PK'); $sk = env('BG_SK'); $user = auth()->user()->email; $sid = session()->getId();
        $exp = time() + 900; $b64 = fn ($s) => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
        $sig = hash_hmac('sha256', "$pk|$user|$sid|$exp", $sk);
        return ['token' => $b64($user) . '.' . $b64($sid) . ".$exp.$sig", 'endpoint' => env('BG_URL'), 'pk' => $pk];
    });
    Route::post('/api/checkout', [CheckoutController::class, 'store'])->middleware('behavior');
});
```

`app/Http/Middleware/BehaviorGate.php` (daftarkan sebagai `behavior`):

```php
public function handle($request, Closure $next) {
    $c = Http::withToken(env('BG_SK'))->post(env('BG_URL') . '/v1/check',
        ['userId' => auth()->user()->email, 'sessionId' => session()->getId(), 'money' => true])->json();
    if (!empty($c['ended'])) { auth()->logout(); return response()->json(['ended' => true], 401); }
    if (empty($c['allowed'])) return response()->json(['verify' => true, 'reason' => $c['reason']], 403);
    return $next($request);
}
```

Laravel sudah memperbarui id sesi saat login. Laravel menolak POST tanpa token CSRF; plug
(Langkah 3) mengirimkannya kalau layout punya `<meta name="csrf-token" content="{{ csrf_token() }}">`.

---

## Langkah 3 - Halaman Anda: satu tag script

**Paling sederhana**, kalau tombol sensitif Anda memang lewat JavaScript Anda sendiri:

```html
<script src="/js/behaviorguard.min.js" data-endpoint="/bg" data-token-url="/api/bg-token" defer></script>
```

(Dengan layanan, `data-endpoint` = alamat layanannya dan `data-pk` = kunci publik Anda; route
token juga boleh mengembalikan keduanya.) Lalu sebelum `fetch('/api/checkout', ...)` panggil
`await BehaviorGuard.assessNow()` supaya server punya penilaian segar, dan kalau jawabannya
403 `verify`, panggil `await BehaviorGuard.stepUp()` lalu kirim ulang request-nya.

**Atau pakai plug, yang mengerjakannya untuk Anda** tanpa menyentuh kode Anda:

1. Salin `dist/behaviorguard.js` dan `demo/shop-checkout/plug-behaviorguard.js` ke folder aset
   publik.
2. Tambahkan ke **layout sesudah login**, sebelum `</body>`:

```html
<script src="/js/plug-behaviorguard.js" data-lib="/js/behaviorguard.js" defer></script>
```

3. Tandai tombol sensitif dengan `data-checkout`:

```html
<button data-checkout>Bayar sekarang</button>
```

Plug mengambil token, menyalakan pustaka dalam mode backend, mengambil penilaian segar saat
tombol yang dijaga diklik, dan saat server Anda menjawab 403 `verify` ia menampilkan
verifikasi lalu mengirim request yang sama sekali lagi (401 `ended` me-logout user). Tombol
yang dirender belakangan (React/Vue) ikut terjaga karena plug mendengar di level dokumen.

| Atribut | Default | Fungsi |
|---|---|---|
| `data-token-url` | `/api/bg-token` | route token |
| `data-code-url` | `/api/bg-code` | route kode via email (cadangan; ditambah `/verify`) |
| `data-reauth-url` | `/api/bg-reauth` | route cek ulang sandi (cadangan yang lebih lemah) |
| `data-lib` | `/dist/behaviorguard.js` | lokasi pustaka |
| `data-gate` | `[data-checkout]` | selector tombol yang dijaga |
| `data-badge` | - | `off` menyembunyikan badge status |
| `data-rhythm` | - | `on` ikut menawarkan verifikasi ritme ketik |

**Kenapa sesudah login, bukan di halaman login?** BehaviorGuard mempelajari **pemilik akun**.
Di halaman login belum ada pemiliknya.

---

## Langkah 4 - Situs Anda belum punya MFA?

**Masalahnya.** Akun baru belum punya profil: 10 jendela untuk baseline dan 20 sebelum
detektor utama menyala (satu jendela = 30 detik pemakaian). Sampai saat itu jawaban server
untuk aksi uang adalah "verifikasi dulu" (gagal-tertutup, disengaja). Kalau situs Anda tidak
punya cara memverifikasi siapa pun, user baru tidak bisa checkout sampai profilnya ada.

**Solusinya: satu metode verifikasi yang diperiksa server Anda**, dilaporkan lewat
`report_verified` (atau `POST /v1/report`):

| Opsi | Caranya | Kekuatan | Kapan |
|---|---|---|---|
| A. Ketik ulang sandi | `install(..., verify_password=)` (`/api/bg-reauth`) | lemah: kalau sandi dicuri, penyerang juga tahu | sekadar mencoba |
| B. Kode email / SMS | `install(..., send_code=)` (`/api/bg-code`), atau route OTP Anda sendiri | lebih kuat: penyerang juga butuh kotak surat atau HP-nya | produksi, apa pun yang menyangkut uang (dipakai demo) |
| C. Cek ritme ketik bawaan | user mendaftarkan frasa sekali; server menyimpan template dan memeriksanya | kuat untuk pemilik yang sudah terdaftar | setelah user dikenali |

Untuk opsi C tambahkan tombol di halaman pengaturan akun:

```html
<button onclick="BehaviorGuard.openEnrollment()">Nyalakan verifikasi ritme ketik</button>
```

Pendaftaran hanya boleh saat sesi tepercaya (`BehaviorGuard.status().mfa.canEnroll`). Sesudah
itu dialog bawaan muncul sendiri, dengan A atau B sebagai "gunakan cara lain".

---

## Langkah 5 - Cek bahwa ia jalan

- [ ] DevTools > Network: request ke `/bg/v1/assess` membawa `vector` 34 angka dan hitungan,
      **bukan** daftar gerakan mouse atau huruf.
- [ ] `BehaviorGuard.status().mode` bernilai `"backend"`.
- [ ] Aksi sensitif user baru dijawab 403 oleh route Anda, verifikasi muncul, dan sesudahnya
      request yang sama berhasil.
- [ ] Login ke akun yang sama dari **browser kedua**: `status().phase` langsung `protecting`
      (profilnya ada di server), dan login itu tidak ikut memakai verifikasi login pertama.
- [ ] Panggil route terlindung dengan `curl` dan cookie sesi yang sah tapi tanpa penilaian:
      403.

## Masalah umum

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| `status().mode` bernilai `local` | tidak ada `data-endpoint`, atau tidak ada token/route token | cek Langkah 3 dan bahwa `/api/bg-token` menjawab saat login |
| Semua request ke `/bg` 401 | token ditandatangani dengan kunci salah, `pk` salah, atau urutan empat bagiannya beda | bandingkan dengan `python server/app.py mint <pk> <sk> <user> <sid>` |
| Semua aksi sensitif minta verifikasi | masih belajar (`status().enrollment`), atau halaman tidak memanggil `assessNow()` sebelum request | wajar saat belajar; kalau tidak, tambahkan penilaiannya (plug sudah melakukannya) |
| Verifikasi lolos tapi kiriman ulang tetap 403 | route OTP Anda tidak memanggil `report_verified` untuk id sesi login **ini** | laporkan dengan id sesi yang sama dengan yang ada di token |
| Error 419 di Laravel | token CSRF tidak ada | tambahkan `<meta name="csrf-token">` di layout |

## Batasan yang perlu diketahui

- **Masa belajar.** Akun yang benar-benar baru belum punya pembanding, jadi server meminta
  verifikasi; opsi B (OTP) jauh lebih aman daripada A di masa ini.
- **Ukuran yang dipalsukan.** Orang yang menguasai browser sepenuhnya bisa mengirim vektor
  fitur karangan. Vektor itu tetap harus tampak seperti pemilik bagi model di setiap jendela;
  itulah masalah peniruan terarah di [THREAT-MODEL.md](../THREAT-MODEL.md). Tetap pakai aturan
  server Anda sendiri untuk aksi bernilai besar (batas nominal, OTP untuk penerima baru).
