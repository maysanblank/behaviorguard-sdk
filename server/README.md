# BehaviorGuard server (opsional)

Backend kecil multi-tenant untuk dua hal: **baseline yang ikut pengguna lintas perangkat**
dan **log vonis untuk dashboard operator**. Yang disimpan hanya **34 angka fitur per jendela**
dan vonisnya. Event mentah dan huruf ketikan tidak pernah sampai ke sini.

Pustaka berjalan penuh tanpa server ini. Server hanya aktif kalau situs memberi `pk`,
`endpoint`, **dan** token pengguna.

## Jalankan

```bash
pip install flask
python server/app.py          # http://0.0.0.0:5055
python server/test_app.py     # 35 uji: auth, IDOR, peracunan, XSS, CSP
```

Variabel lingkungan: `BG_DB` (lokasi SQLite), `BG_ADMIN_TOKEN` (menyalakan `GET /tenants`),
`BG_TRUST_PROXY=1` (hanya bila di balik proxy yang menimpa `X-Forwarded-For`).

## Tiga kunci, tiga peran

| Kunci | Di mana | Membuka |
|---|---|---|
| `pk_...` (publik) | di halaman, `data-pk` | **tidak ada apa pun sendirian** |
| `sk_...` (rahasia) | hanya di server Anda | dashboard operator + mencetak token pengguna |
| token pengguna | dicetak server Anda sesudah login, berumur pendek | baseline & log **akun itu saja** |

Token: `b64url(userId) "." exp "." hex(HMAC-SHA256(sk, pk|userId|exp))`, maksimal 7 hari.
Server mengambil `userId` dari token, tidak pernah dari isi permintaan.

## Alur

1. **Buat tenant** (sk hanya tampil sekali):
   ```bash
   curl -X POST http://localhost:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"Toko Andi\"}"
   ```
2. **Cetak token** di backend Anda sesudah pengguna login. Node:
   ```js
   import crypto from 'node:crypto';
   function bgToken(pk, sk, userId, ttlSec = 3600) {
     const exp = Math.floor(Date.now() / 1000) + ttlSec;
     const sig = crypto.createHmac('sha256', sk).update(`${pk}|${userId}|${exp}`).digest('hex');
     return `${Buffer.from(userId).toString('base64url')}.${exp}.${sig}`;
   }
   ```
   Uji lokal: `python server/app.py mint <pk> <sk> <userId> [ttl_detik]`.
3. **Pasang di halaman**:
   ```html
   <script src="/dist/behaviorguard.js" data-user="andi@contoh.id"
           data-pk="pk_xxx" data-endpoint="https://bg.contoh.id" data-user-token="<token>"></script>
   ```
   Token kedaluwarsa? Perbarui dengan `BehaviorGuard.setUserToken(tokenBaru)`.
4. **Dashboard**: buka `http://localhost:5055/dashboard`, tempel `sk`. Kunci disimpan di
   sessionStorage tab itu saja dan dikirim lewat header, tidak pernah lewat URL.

## Endpoint

| Method | Path | Auth | Fungsi |
|---|---|---|---|
| POST | `/tenant` | - | buat tenant -> `{pk, sk}` |
| GET | `/baseline` | `pk` + token | baseline akun pemilik token |
| POST | `/baseline` `{vectors}` | `pk` + token | simpan baseline (NaN/inf dibuang, maks 100 x 40) |
| POST | `/log` `{level, score, ...}` | `pk` + token | catat vonis (disaring, lihat bawah) |
| GET | `/api/dashboard` | `sk` | data dashboard tenant ini |
| GET | `/api/account?u=` | `sk` | detail satu akun |
| GET | `/tenants` | `BG_ADMIN_TOKEN` | daftar tenant (mati tanpa env) |
| GET | `/dashboard` | - | halaman statis; CSP ber-nonce |

## Yang dijaga (dan kenapa)

- **`pk` bocor itu normal** — ia ada di setiap halaman. Dulu `pk` saja cukup untuk membaca
  dan **menimpa** template perilaku akun mana pun (penyerang dijadikan "pemilik"). Kini
  tidak ada operasi akun tanpa token (C-39).
- **Isi log adalah kiriman klien.** Dashboard meng-escape semua nilai dan dikirim dengan
  CSP ber-nonce; server juga membatasi bentuknya: level daftar putih, action `A-Z_`,
  alasan 6 x 160 karakter, nama fitur `a-z0-9_`, jam klien yang ngawur diganti jam server
  (C-41).
- **Perangkat yang sudah terdaftar tidak pernah menerima baseline dari server.** Hanya
  perangkat baru yang mengadopsinya.

Sisa risiko: siapa pun yang memegang token sah seorang pengguna bisa menulis baseline
server milik pengguna itu, dan perangkat BARU miliknya akan mengadopsinya. Cetak token
berumur pendek, hanya sesudah autentikasi yang Anda percaya. Belum ada rate-limit di
`/tenant`; CORS `*` disengaja (SDK berjalan di origin mana pun). Ini implementasi rujukan
(Flask + SQLite), bukan layanan yang sudah dikeraskan. Lihat THREAT-MODEL.md §4.7.

## Deploy

Di balik nginx + gunicorn: `gunicorn -w 2 -b 127.0.0.1:5055 app:app` (panggil `init_db()`
sekali), set `BG_TRUST_PROXY=1`, simpan `BG_DB` di volume persisten atau ganti ke Postgres.
