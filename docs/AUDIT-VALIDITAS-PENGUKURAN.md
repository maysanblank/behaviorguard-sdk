# Audit: kasus "yang berubah alat ukurnya, bukan orangnya"

Idle (C-23) dan panjang sesi (C-24) ternyata bukan kasus tunggal. Dokumen ini hasil
**menelusuri kode**, bukan menebak dari teori — tiap temuan disertai berkas:baris dan,
kalau bisa, angka hasil menjalankan kodenya sendiri.

Bedanya dengan `USULAN-KONTEKS-DAN-IDLE.md` §4: di sana katalog kasus yang *mungkin*
terjadi pada sistem biometrik perilaku mana pun. Di sini hanya yang **benar-benar ada di
kode ini** dan bisa ditunjuk barisnya.

Kolom **Dampak**: `FRR↑` pemilik asli diganggu · `FAR↑` penyusup lolos · `BLOK` pengguna
sah diblokir keras.

**Status per 10 Sep 2026: 8 dari 12 sudah ditambal (C-25), teruji `core/audit.test.mjs`
32/32.** Empat sisanya sengaja belum: A2+B3 satu paket normalisasi skala yang membuat
baseline lama tidak sebanding (butuh penandaan versi baseline), B5 dan B6 menyentuh
vektor/SPEC. Keempatnya diusulkan, bukan dikirim diam-diam.

| # | Temuan | Dampak | Bukti | Status |
|---|---|---|---|---|
| A1 | Sesi "cuma menelusuri" diblokir sebagai bot | **BLOK** | dijalankan | **SELESAI** (C-25) |
| A2 | Ganti monitor / zoom mengubah kecepatan | FRR↑ | dijalankan | Diusulkan - paket skala |
| A3 | Autofill mematikan 8 fitur keystroke sekaligus | FRR↑ FAR↑ | dijalankan | **SELESAI** (C-25) |
| A4 | Ekor perilaku bocor antar-pengguna | **FAR↑** | baca kode | **SELESAI** (C-25) |
| A5 | `PAGE_STEP` dilatih tapi tak pernah ditangkap | FRR↑ | baca kode | **SELESAI** - API `markStep()` |
| B1 | Dua tab saling menimpa data | FRR↑ | baca kode | **SELESAI** (C-25) |
| B2 | Resolusi layar ikut jadi sidik perangkat | FRR↑ | baca kode | **SELESAI** (C-25) |
| B3 | `scroll_delta` dalam piksel mentah | FRR↑ | baca kode | Diusulkan - paket skala |
| B4 | Layar sentuh mematikan seluruh blok mouse | FRR↑ | baca kode | **SELESAI** (C-25) |
| B5 | Waktu-hari diperlakukan sebagai biometrik | FRR↑ | baca kode | Diusulkan - menyentuh vektor |
| B6 | Fitur konstan di baseline jadi z besar | FRR↑ | baca kode | Diusulkan - menyentuh SPEC |
| B7 | Tanpa IndexedDB, kolam terpotong di 30 | FRR↑ | baca kode | **SELESAI** (C-25) |

---

## A. Terbukti dengan menjalankan kodenya

### A1 · Sesi "cuma menelusuri" diblokir sebagai bot — **BLOK**

`sdk/core/integrity.js:9`

```js
const evs = filtered.length>=10 ? filtered : events;
```

T5 dulu memfilter ke `KEYSTROKE`/`MOUSE_CLICK` supaya throttle 50 ms tidak dikira bot.
Tapi **fallback-nya mengembalikan seluruh event** ketika keystroke+klik < 10 — dan pada
sesi seperti itu isinya justru hampir semua `MOUSE_MOVE`, yang di `capture.js:60-63`
di-throttle tepat 50 ms. Intervalnya jadi **persis konstan**.

Dijalankan pada aliran `mousemove` realistis yang di-throttle:

| Laju mousemove asli | Interval sesudah throttle | Vonis |
|---|---|---|
| 60 Hz | 50,0 ms, std **0,00 ms** | `interval konstan` → **diblokir** |
| 100 Hz | 50,0 ms, std **0,00 ms** | **diblokir** |
| 125 Hz | 56,0 ms, std **0,00 ms** | **diblokir** |
| 144 Hz | 55,6 ms, std 0,50 ms | **diblokir** |

Akibatnya di `behaviorguard.js` jalur integrity: `action:'BLOCK_SESSION'`,
`eligible:false`, dan sesi tercatat HIGH. Pengguna yang membaca artikel panjang sambil
menggerakkan mouse — tanpa banyak mengklik — **diblokir sebagai bot.**

Ini kerabat C-16 yang dihidupkan lagi oleh fallback-nya sendiri. Sifatnya rapuh: satu
klik nyasar di ujung sesi bisa menaikkan std di atas 3 ms dan membuatnya lolos, jadi
gejalanya akan terlihat "kadang-kadang" dan susah dilacak dari laporan pengguna.

**Usul:** jangan pernah menilai keteraturan interval pada aliran yang kita throttle
sendiri. Kalau `filtered` < 10, **jangan jatuh ke `events`** — lewati saja cek interval
itu (cek lain tetap jalan), atau hitung interval hanya dari event yang tidak di-throttle.

### A2 · Ganti monitor atau zoom mengubah "kecepatan tangan" — FRR↑

`sdk/core/capture.js:40` — `v = Math.hypot(dx,dy)/dt`, dengan `dx,dy` dalam piksel CSS.

Gerakan tangan **identik**, hanya layarnya berbeda:

| Fitur | 1080p | 4K (2×) | Faktor |
|---|---:|---:|---:|
| `mouse_velocity_mean` | 0,6685 | 1,3371 | **2,00×** |
| `mouse_velocity_max` | 1,2224 | 2,4448 | **2,00×** |
| `mouse_acceleration_std` | 0,0033 | 0,0066 | **2,00×** |
| `mouse_curvature_mean` | 0,0141 | 0,0070 | **0,50×** |

Empat fitur bergeser tepat sebesar rasio skala. Bukan derau — **fungsi linear dari
ukuran layar**. Zoom browser dan pindah ke monitor eksternal memberi efek yang sama.

**Usul:** bagi jarak dengan diagonal viewport di `capture.js` supaya jadi bebas-DPI.
Bisa dilakukan di lapisan capture, **tanpa menyentuh SPEC** — `x`/`y` jadi relatif
viewport. Tapi baseline lama jadi tidak sebanding, jadi butuh pendaftaran ulang atau
penandaan versi.

### A3 · Autofill mematikan 8 fitur keystroke sekaligus — FRR↑ **dan** FAR↑

`sdk/core/capture.js:65-74` tidak memasang listener `paste`, dan password manager
mengisi field **tanpa event keyboard sama sekali**.

Form yang sama, diketik vs diisi autofill:

| Fitur | Diketik | Autofill |
|---|---:|---:|
| `keystroke_dwell_time_mean` | 80,000 | **0** |
| `keystroke_flight_time_mean` | 120,000 | **0** |
| `keystroke_typing_speed` | 4,808 | **0** |
| `keystroke_transition_entropy` | 1,097 | **0** |
| `keystroke_burst_count` | 1,000 | **0** |
| `cross_mouse_keyboard_coordination` | 0,028 | **0** |

**8 dari 8 fitur keystroke jatuh ke nol.** Dua sisi bahayanya:

- **FRR:** pemilik yang memakai password manager terlihat menyimpang tiap kali login.
- **FAR:** penyusup bisa **menyenjatakan** ini — pakai autofill, dan seluruh blok bukti
  keystroke lenyap. Ketiadaan bukti bukan bukti tidak bersalah, tapi model tidak tahu
  bedanya "nol karena tidak mengetik" dan "nol karena begitulah cara orang ini mengetik".

**Usul:** tangkap `paste` dan deteksi pengisian tanpa keystroke, lalu **ABSTAIN pada
blok keystroke** alih-alih memberi nilai nol. Ini persis generalisasi ABSTAIN dari C-23.

### A4 · Ekor perilaku bocor antar-pengguna — **FAR↑**

`sdk/behaviorguard.js:67,94,98,177,180` — kunci `bg:pending` **global**, tidak diberi
ruang nama per pengguna (bandingkan `ns(userId)` = `bg:${id}` yang dipakai untuk sesi).

Alurnya: pengguna A menutup halaman → ekornya disimpan ke `bg:pending` → **pengguna B
login di browser yang sama** → `init()` membaca `bg:pending` tanpa memeriksa pemiliknya →
`scoreExternalEvents(chunk)` → **perilaku A dinilai, dan mungkin dilatihkan, sebagai
B.** Di komputer bersama, warnet, atau sekadar logout-login, ini meracuni baseline.

`clear()` memang menghapusnya, tapi hanya kalau integrator memanggilnya.

**Usul:** beri ruang nama — `bg:pending:${userId}` — dan buang pending yang pemiliknya
tidak cocok. Perbaikan kecil, dampaknya keamanan.

### A5 · `PAGE_STEP` dilatih tapi tidak pernah ditangkap — FRR↑

`sdk/core/features.js:28`

```js
const navEv = events.filter(e=> is(e,'NAVIGATION')||is(e,'PAGE_STEP'));
```

Basis data riset berisi **2.672 event `PAGE_STEP`**; `capture.js` **tidak pernah
menerbitkannya** (bandingkan daftar listener di `capture.js:65-74`). Jadi
`nav_step_transition_count` dan `nav_page_transition_pattern` dihitung dari populasi
event yang berbeda saat dilatih dan saat dipakai.

Tipe event lain yang ada di DB riset tapi tidak pernah ditangkap SDK: `COPY`, `PASTE`,
`WISHLIST`, `CHALLENGE_INPUT`, `MFA_ACTION`. Empat yang terakhir tidak masuk F4, jadi
tidak berdampak; `PAGE_STEP` masuk.

Ini kelas cacat yang sama persis dengan C-17 (fitur mati di produksi karena datanya tak
pernah ada). **Usul:** terbitkan `PAGE_STEP` di capture, atau keluarkan dari `navEv`
dan akui satu fitur nav memang tidak dipakai.

---

## B. Terbukti dengan membaca kode (belum dieksekusi)

### B1 · Dua tab saling menimpa — FRR↑

Tiap tab menjalankan instance sendiri dengan array `sessions` sendiri di memori, lalu
`storage.set(ns(userId), {sessions...})` — **penulis terakhir menang**. Sesi yang
dikumpulkan tab lain hilang. `bg:pending` lebih buruk: dua tab menambahkan ke array yang
sama, jadi event dari dua halaman berbeda **tergabung jadi satu "sesi"**.

**Usul:** kunci antar-tab (`BroadcastChannel` atau `localStorage` lock), atau tunjuk satu
tab sebagai pemimpin.

### B2 · Resolusi layar ikut jadi sidik perangkat — FRR↑

`sdk/core/fingerprint.js:8` memasukkan `screen.width+'x'+screen.height` ke sidik. Colok
monitor eksternal → sidik berubah → `behaviorguard.js:60-62` memaksa `lastRisk='MEDIUM'`,
dan lantai lengket menahannya sampai tiga sesi LOW berturut.

Colok monitor bukan ganti perangkat. **Usul:** keluarkan resolusi dari sidik (ia sudah
ditangani B3/A2 sebagai konteks), atau perlakukan perubahan resolusi sebagai
"konteks baru", bukan "perangkat mencurigakan".

### B3 · `scroll_delta` dalam piksel mentah — FRR↑

`sdk/core/capture.js:48` menyimpan `Math.abs(cur-lastScrollY)` dalam piksel; dibaca
`features.js:121` jadi `nav_scroll_depth_mean`. Nilainya bergantung tinggi viewport dan
panjang halaman, bukan pada kebiasaan menggulir orangnya. Layar lebih tinggi → satu
gulir memindahkan lebih banyak piksel.

**Usul:** normalisasi ke tinggi viewport. Menyentuh makna field di SPEC, jadi masuk
paket yang sama dengan A2.

### B4 · Layar sentuh mematikan seluruh blok mouse — FRR↑

`capture.js:65-74` hanya memasang `mousemove`/`click`/`scroll`/`keydown`/`keyup`. Di
layar sentuh, `mousemove` praktis tidak pernah muncul, sehingga **sembilan fitur mouse
jadi nol** — persis pola A3, tapi untuk blok yang lain.

**Usul:** ini kandidat terkuat untuk **baseline per konteks** (lihat
`USULAN-KONTEKS-DAN-IDLE.md` §5): sentuh dan mouse adalah dua alat ukur, bukan dua orang.

### B5 · Waktu-hari diperlakukan sebagai biometrik — FRR↑

`temporal_time_of_day_score` adalah 1 dari 28 fitur identitas. Ia bukan sifat tubuh —
ia **konteks**. Shift malam, lembur, atau perjalanan lintas zona waktu menggesernya
tanpa identitas berubah sedikit pun.

**Usul:** keluarkan dari vektor identitas dan pakai sebagai sinyal risiko terpisah.
Kebetulan `reproduce_db.py` sudah punya lengan `F4_MINUS_TEMP` — jadi ongkos
pengujiannya nyaris nol, tinggal dibandingkan.

### B6 · Fitur konstan di baseline jadi z besar — FRR↑

`sdk/core/standardize.js:14`

```js
const std = variance.map(v => Math.sqrt(v) < 1e-9 ? 1 : Math.sqrt(v));
```

Kalau sebuah fitur **konstan** selama pendaftaran — misalnya `cart_action_count` selalu
0 karena pengguna belum pernah memakai keranjang — simpangan bakunya dipaksa jadi 1.
Begitu ia pertama kali menambahkan 3 barang: `z = 3`. Sistem membaca "3 simpangan baku"
padahal yang terjadi cuma **pengguna melakukan sesuatu yang baru**.

Ini menghukum eksplorasi fitur aplikasi, dan paling sering kena pada pengguna baru.

**Usul:** tandai fitur yang konstan di baseline dan kecilkan bobotnya, atau pakai prior
lebar untuk fitur yang belum pernah terlihat bervariasi.

### B7 · Tanpa IndexedDB, kolam terpotong di 30 — FRR↑

`sdk/storage.js:109` memotong ke `sessions.slice(-30)` sebelum menulis ke localStorage.
IndexedDB menerima yang utuh, jadi biasanya aman — tapi di mode penyamaran atau browser
yang memblokir IDB, kolam **terpotong di 30** padahal `progressiveMaxPool` = 90.

C-22 sudah menunjukkan apa yang terjadi kalau kolam terlalu kecil dibanding d=28:
kovarians goyah, shrink adaptif menahan diri, deteksi melemah. Di jalur ini gejalanya
muncul **hanya di sebagian pengguna**, jadi mudah disalahartikan sebagai perbedaan orang.

**Usul:** simpan bentuk ringkas (vektor saja, tanpa `feat`) supaya lebih banyak sesi
muat, dan laporkan mode penyimpanan yang sedang aktif lewat `getState()`.

---

## Saran urutan pengerjaan

Kalau harus memilih, urutan ini yang menurut saya paling masuk akal:

1. **A1** — satu-satunya yang **memblokir pengguna sah**. Perbaikannya paling kecil.
2. **A4** — satu-satunya yang bocor **antar-pengguna**; ini isu keamanan, bukan akurasi.
3. **A3** — dua arah sekaligus (FRR dan FAR), dan sekaligus jadi contoh kedua
   penerapan ABSTAIN, yang memperkuat argumen umum di §5 usulan.
4. **A5** — kecil, dan menutup satu lagi ketidakcocokan latih-vs-pakai (kerabat C-17).
5. **B5** — ongkos ujinya hampir nol karena lengan `F4_MINUS_TEMP` sudah ada.
6. **A2 + B3** — satu paket normalisasi skala; lebih besar karena baseline lama jadi
   tidak sebanding.
7. **B4** — paling besar; sebaiknya digabung ke pekerjaan baseline per konteks.

Nomor 1–4 semuanya perbaikan kecil yang tidak menyentuh SPEC dan tidak mengubah satu pun
angka headline. Nomor 6–7 mengubah arti data yang tersimpan, jadi perlu penandaan versi
baseline.

**Yang belum dilakukan:** temuan kelompok B belum dibuktikan dengan menjalankan kode,
baru dengan membaca. Sebelum salah satunya masuk skripsi sebagai klaim, sebaiknya
dibuatkan probe seperti A1–A3 dulu.
