# Pasang BehaviorGuard di web kamu

Panduan ini untuk web yang **sudah punya login** dan ingin menjaga aksi sensitif (checkout,
transfer, ganti email) tanpa membongkar kode yang sudah ada. Contoh hidupnya ada di
[`demo/shop-checkout/`](../demo/shop-checkout/).

> English version: [INTEGRATION.md](INTEGRATION.md)

## Peta: cuma 3 tempat yang disentuh

| # | Tempat | File | Yang ditambah | Kenapa di situ |
|---|---|---|---|---|
| 1 | Server BehaviorGuard | server terpisah | `python server/app.py` + buat tenant | menyimpan baseline & log vonis, menyajikan dashboard |
| 2 | Backend kamu | file yang berisi route login | 2 route: `/api/bg-token`, `/api/bg-reauth` | hanya backend yang tahu siapa yang login dan boleh memegang `sk` |
| 3 | Halaman kamu | layout halaman **sesudah login** | 1 tag `<script>` + atribut `data-checkout` di tombol sensitif | perilaku direkam di browser |

Kode login, checkout, dan database kamu **tidak diubah**.

```
browser  --(34 angka fitur + vonis, tiap 30 detik)-->  server BG :5055 --> dashboard
   ^                                                        ^
   | token (sesudah login)                                  | pk + sk (sekali)
backend kamu  -----------------------------------------------
```
Event mentah (gerakan mouse, ketikan) **tidak pernah dikirim**. Skor dihitung di browser;
server BG menyimpan fitur + vonis untuk baseline lintas-perangkat dan dashboard.

---

## Langkah 1 - Server BehaviorGuard (sekali saja)

```bash
pip install flask
python server/app.py
```

Buat tenant (dapat `pk` publik dan `sk` rahasia; `sk` hanya tampil sekali):

```bash
curl -X POST http://localhost:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"Toko Kamu\"}"
```

Simpan keduanya di environment **backend** kamu (misalnya `.env`), bukan di kode, bukan di
halaman:

```
BG_PK=pk_xxxxxxxx
BG_SK=sk_xxxxxxxx
BG_ENDPOINT=https://bg.domainkamu.id
```

`sk` yang bocor ke halaman = siapa pun bisa mencetak token atas nama user mana pun. Untuk
produksi lihat bagian Deploy di [server/README.md](../server/README.md).

---

## Langkah 2 - Backend kamu: 2 route

Taruh di file yang sama dengan route login kamu, **sesudah** middleware session/auth
terpasang (route ini harus tahu siapa yang sedang login).

| Route | Tugas | Aturan |
|---|---|---|
| `GET /api/bg-token` | cetak token BehaviorGuard untuk user yang login | `userId` diambil dari **session**, tidak pernah dari isi request. User belum login -> 401. |
| `POST /api/bg-reauth` | cek ulang sandi user yang login | dicek di **server** dengan fungsi cek sandi yang sudah kamu pakai saat login. Beri batas percobaan. |

Bentuk jawaban `/api/bg-token`:

```json
{ "enabled": true, "userId": "andi@toko.id", "pk": "pk_...", "endpoint": "https://bg.domainkamu.id",
  "token": "<token>", "fallback": true }
```

Token = `base64url(userId) "." exp "." hex(HMAC-SHA256(sk, pk|userId|exp))`, berlaku 1 jam.

### Flask (dipakai demo)

Salin [`demo/shop-checkout/bg_backend.py`](../demo/shop-checkout/bg_backend.py) ke sebelah
file aplikasi kamu, lalu tambahkan **satu baris** sesudah route login:

```python
from bg_backend import pasang
pasang(app, current_user=lambda: session.get("user"), verify_password=cek_sandi)
```

`cek_sandi(user, sandi) -> bool` adalah fungsi cek sandi yang sudah kamu punya.

### Node.js / Express

```js
import crypto from 'node:crypto';
const BG = { pk: process.env.BG_PK, sk: process.env.BG_SK, endpoint: process.env.BG_ENDPOINT };

function bgToken(userId, ttl = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = crypto.createHmac('sha256', BG.sk).update(`${BG.pk}|${userId}|${exp}`).digest('hex');
  return `${Buffer.from(userId).toString('base64url')}.${exp}.${sig}`;
}

// taruh SESUDAH app.use(session(...)) dan route login
app.get('/api/bg-token', (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ enabled: false });
  res.json({ enabled: true, userId: user, pk: BG.pk, endpoint: BG.endpoint,
             token: bgToken(user), fallback: true });
});

app.post('/api/bg-reauth', express.json(), async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ ok: false });
  res.json({ ok: await cekSandi(user, req.body.password) });   // fungsi cek sandi milikmu
});
```

### PHP (tanpa framework)

`bg-token.php`:

```php
<?php
session_start();                                   // sesi yang sama dengan sistem login kamu
header('Content-Type: application/json');
if (empty($_SESSION['user'])) { http_response_code(401); echo json_encode(['enabled' => false]); exit; }

$pk = getenv('BG_PK'); $sk = getenv('BG_SK'); $user = $_SESSION['user'];
$exp = time() + 3600;
$sig = hash_hmac('sha256', "$pk|$user|$exp", $sk);
$b64 = rtrim(strtr(base64_encode($user), '+/', '-_'), '=');
echo json_encode(['enabled' => true, 'userId' => $user, 'pk' => $pk, 'endpoint' => getenv('BG_ENDPOINT'),
                  'token' => "$b64.$exp.$sig", 'fallback' => true]);
```

`bg-reauth.php`:

```php
<?php
session_start();
header('Content-Type: application/json');
if (empty($_SESSION['user'])) { http_response_code(401); echo json_encode(['ok' => false]); exit; }
$body = json_decode(file_get_contents('php://input'), true);
$hash = ambilHashSandi($_SESSION['user']);        // dari database kamu
echo json_encode(['ok' => password_verify($body['password'] ?? '', $hash)]);
```

Karena alamatnya bukan `/api/...`, beri tahu plug lewat atribut (lihat Langkah 3):
`data-token-url="/bg-token.php" data-reauth-url="/bg-reauth.php"`.

### Laravel

`routes/web.php`:

```php
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

Route::middleware('auth')->group(function () {
    Route::get('/api/bg-token', function () {
        $pk = env('BG_PK'); $sk = env('BG_SK'); $user = auth()->user()->email;
        $exp = time() + 3600;
        $sig = hash_hmac('sha256', "$pk|$user|$exp", $sk);
        $b64 = rtrim(strtr(base64_encode($user), '+/', '-_'), '=');
        return ['enabled' => true, 'userId' => $user, 'pk' => $pk, 'endpoint' => env('BG_ENDPOINT'),
                'token' => "$b64.$exp.$sig", 'fallback' => true];
    });
    Route::post('/api/bg-reauth', function (Request $r) {
        return ['ok' => Hash::check($r->input('password', ''), auth()->user()->password)];
    })->middleware('throttle:5,1');
});
```

POST di Laravel butuh token CSRF. Plug otomatis mengirimnya kalau layout kamu punya
`<meta name="csrf-token" content="{{ csrf_token() }}">` (bawaan starter kit Laravel).

---

## Langkah 3 - Halaman kamu: 1 tag script

1. Salin dua file ke folder aset publik kamu:
   - `dist/behaviorguard.js` (pustakanya)
   - `demo/shop-checkout/plug-behaviorguard.js` (perekat: token, badge, gerbang, konfirmasi sandi)
2. Tambahkan tag ini di **layout halaman sesudah login**, tepat sebelum `</body>`:

```html
<script src="/js/plug-behaviorguard.js" data-lib="/js/behaviorguard.js" defer></script>
```

3. Beri atribut `data-checkout` pada setiap tombol aksi sensitif:

```html
<button data-checkout>Bayar sekarang</button>
<button data-checkout data-bg-reason="mengganti email">Simpan email baru</button>
```

**Kenapa sesudah login, bukan di halaman login?** BehaviorGuard belajar pola **pemilik akun**.
Di halaman login belum ada pemilik, jadi tidak ada yang bisa dijaga.

Contoh letak per jenis web:

| Web kamu | Taruh di |
|---|---|
| HTML biasa | setiap halaman sesudah login, sebelum `</body>` |
| PHP | file footer/layout yang di-`include` halaman member |
| Laravel | `resources/views/layouts/app.blade.php`, sebelum `</body>`, dibungkus `@auth ... @endauth` |
| React / Vue (SPA) | `index.html`. Login tanpa muat ulang halaman tetap tertangkap: plug mencoba nyala lagi sesudah user berinteraksi dan saat tombol yang dijaga diklik |

Atribut yang bisa diatur di tag script:

| Atribut | Default | Fungsi |
|---|---|---|
| `data-token-url` | `/api/bg-token` | alamat route cetak token |
| `data-reauth-url` | `/api/bg-reauth` | alamat route cek ulang sandi |
| `data-lib` | `/dist/behaviorguard.js` | lokasi pustaka |
| `data-user` | - | id user, kalau backend belum dicolok (mode on-device) |
| `data-gate` | `[data-checkout]` | selector tombol yang dijaga |
| `data-badge` | - | isi `off` untuk menyembunyikan badge status |

Tombol yang baru muncul belakangan (dirender React/Vue) tetap ikut dijaga: gerbangnya
mendengar klik di level dokumen.

---

## Langkah 4 - Web kamu belum punya MFA?

Ini bagian yang paling sering bikin bingung.

**Masalahnya.** BehaviorGuard butuh waktu untuk mengenal pemilik: 10 jendela untuk profil
dasar, 20 jendela supaya detektor utamanya menyala (1 jendela = 30 detik pemakaian). Selama
itu vonisnya `UNKNOWN`, dan untuk aksi sensitif `UNKNOWN` berarti **minta verifikasi**
(gagal-tertutup, sengaja). Kalau web kamu tidak punya cara verifikasi apa pun, user baru
**tidak bisa checkout sama sekali** sampai profilnya terbentuk.

**Jalan keluarnya: sediakan satu cara verifikasi yang diperiksa server.** Pilih salah satu:

| Pilihan | Cara | Kekuatan | Kapan dipakai |
|---|---|---|---|
| A. Ketik ulang sandi | route `/api/bg-reauth` (Langkah 2) | lemah: kalau sandinya yang dicuri, penyerang juga tahu | paling murah, untuk mulai atau demo |
| B. OTP email / SMS | backend kirim kode, cek kode | lebih kuat: penyerang butuh akses email/HP juga | produksi, apalagi yang menyangkut uang |
| C. Verifikasi irama ketik bawaan | user mendaftarkan frasa sekali | kuat untuk sesi yang sudah dikenal | aktifkan begitu user sudah berstatus AMAN |

Pilihan A sudah jadi di demo. Untuk pilihan B, ganti isi route `/api/bg-reauth` supaya
memeriksa kode OTP alih-alih sandi; plug tidak perlu diubah selain teks jendelanya.

Untuk pilihan C, pasang tombol di halaman pengaturan akun:

```html
<button onclick="BehaviorGuard.openEnrollment()">Aktifkan verifikasi irama ketik</button>
```

Pendaftaran hanya bisa dilakukan saat sesi dinilai aman (`BehaviorGuard.status().mfa.canEnroll`).
Sesudah terdaftar, dialog verifikasi bawaan muncul otomatis, dan pilihan A atau B tetap ada
sebagai "gunakan cara lain".

Aturan untuk semua pilihan: jalur cadangan hanya boleh menjawab `true` kalau **server kamu**
sudah memeriksa faktornya ([THREAT-MODEL.md](../THREAT-MODEL.md) bagian 4.14).

---

## Langkah 5 - Cek apakah berhasil

- [ ] Badge di kiri bawah muncul dan tertulis **mode: backend**.
- [ ] DevTools > Network: ada request ke server BG (`/baseline`, `/log`), isinya angka fitur,
      **bukan** daftar gerakan mouse atau huruf.
- [ ] User baru klik tombol sensitif -> muncul konfirmasi sandi -> sandi salah ditolak,
      sandi benar lanjut.
- [ ] Dashboard `http://<server-bg>:5055/dashboard` (tempel `sk`) menampilkan vonis user tadi.

## Masalah umum

| Gejala | Penyebab | Perbaikan |
|---|---|---|
| Badge tertulis `mode: on-device` | `/api/bg-token` 404/401, atau server BG mati | cek route Langkah 2 dan `BG_ENDPOINT` |
| Badge tidak muncul sama sekali | tag dipasang di halaman sebelum login, atau path `data-lib` salah | lihat Console: pesan `[plug]` menjelaskan alasannya |
| Konfirmasi sandi tidak muncul, aksi langsung ditahan | `/api/bg-token` menjawab `fallback: false` atau tanpa `fallback` | pasang route `/api/bg-reauth` dan kirim `fallback: true` |
| Error 419 di Laravel | token CSRF tidak ada | tambahkan `<meta name="csrf-token">` di layout |
| Tiap aksi sensitif selalu minta verifikasi | masih masa belajar (badge "belajar x/10") | normal; akan berhenti sesudah pemilik dikenali |

## Batasan yang wajib kamu tahu

- **Gerbang di browser bisa dilewati.** Penyerang yang membuka DevTools atau memanggil
  `/api/checkout` langsung tidak melewati plug sama sekali. BehaviorGuard mendeteksi dan
  meminta verifikasi di sisi pengguna; ia **bukan pengganti** pemeriksaan di server. Untuk
  transaksi bernilai besar, backend kamu tetap harus punya aturannya sendiri (batas nominal,
  OTP yang dicek server). Lihat [THREAT-MODEL.md](../THREAT-MODEL.md) bagian 4.2.
- **Masa belajar adalah celah.** Penyerang yang login dari perangkat baru dengan sandi curian
  bertemu profil kosong. Karena itu aksi sensitif selama `UNKNOWN` selalu meminta verifikasi,
  dan pilihan B (OTP) jauh lebih aman daripada A untuk masa ini.
