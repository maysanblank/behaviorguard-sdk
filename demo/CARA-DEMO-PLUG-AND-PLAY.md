# Cara demo plug-and-play — tiga situs, tiga arsitektur

Panduan langkah demi langkah untuk memasang BehaviorGuard **langsung di depan penonton**,
ke tiga situs yang arsitekturnya berbeda-beda.

Ketiga situs **belum berisi BehaviorGuard sama sekali** — itu memang disengaja. Penonton
melihat situs polos, lalu melihat kamu menempel dua baris, lalu melihat sistemnya hidup.

| Folder | Toko | Arsitektur | Yang dibuktikan |
|---|---|---|---|
| `toko-klasik/` | Toko Kopi Nusantara | HTML multi-halaman, tanpa framework | Navigasi antar-halaman sungguhan |
| `pasar-spa/` | Pasar Loka | SPA vanilla, History API | `pushState` — nol muat ulang |
| `butik-react/` | Butik Rasa | React 18 | Framework dengan event sintetis sendiri |

**Ketiganya punya sistem akun sendiri**: daftar, masuk, keluar. Sebelum masuk, seluruh toko
terkunci. Ini penting untuk demomu — ceritanya dimulai dari **mendaftar akun baru**, bukan
dari akun yang entah dari mana.

---

## 0. Persiapan

### 0.1 Nyalakan server

```bash
cd "C:\Users\USER\OneDrive\Documents\skripsi\BEHAVIORGUARD-SDK"
```

```bash
python -m http.server 8080
```

Biarkan jendela itu terbuka selama demo.

> Wajib dari folder **`BEHAVIORGUARD-SDK`**, bukan dari dalam `demo/`. Situsnya memanggil
> `../../dist/`, jadi folder `dist/` harus ikut dilayani.

### 0.2 Cek ketiga situs hidup

- <http://localhost:8080/demo/toko-klasik/index.html>
- <http://localhost:8080/demo/pasar-spa/>
- <http://localhost:8080/demo/butik-react/>

Ketiganya akan langsung menampilkan layar **"Masuk / Daftar"** karena belum ada akun.

### 0.3 Salin dua baris ini ke Notepad

**Ini satu-satunya yang kamu tempel saat demo, sama persis di ketiga situs:**

```html
<script>window.BehaviorGuardConfig = { userId: window.penggunaAktif && window.penggunaAktif.email, panel: true };</script>
<script src="../../dist/behaviorguard.js" defer></script>
```

**Baris pertama** memberi tahu BehaviorGuard siapa yang sedang masuk — persis seperti
aplikasi nyata, yang selalu tahu penggunanya. Ketiga situs sudah mengumumkan akun aktifnya
lewat `window.penggunaAktif`, jadi baris ini identik di semuanya.

**Baris kedua** memuat pustakanya. Itu saja.

---

## 1. Situs pertama — Toko Kopi Nusantara (multi-halaman)

### Langkah 1.1 · Tunjukkan situsnya masih polos

Buka <http://localhost:8080/demo/toko-klasik/index.html>

Kamu langsung dialihkan ke halaman **Masuk ke akunmu**. Tekan **F12** → **Console**:

```js
typeof window.BehaviorGuard
```

Hasilnya `"undefined"`. **Katakan:** *"Belum ada apa-apa di situs ini."*

### Langkah 1.2 · Daftar akun baru (di depan penonton)

Di tab **"Daftar akun baru"**, isi nama, surel, kata sandi → **Buat akun**.

Kamu masuk ke katalog, dan di kanan atas muncul **"Halo, <namamu>"**.

Di Console:

```js
window.penggunaAktif
```

Muncul `{email: "...", nama: "..."}`. **Katakan:** *"Situsnya sekarang tahu siapa saya.
Ini yang akan dipakai BehaviorGuard sebagai identitas — bukan cookie, bukan perangkat."*

### Langkah 1.3 · Buka berkas di VS Code

Buka `demo/toko-klasik/index.html`, tekan **Ctrl+G**, ketik `32`, Enter.

```html
30  </div></footer>
31  <script src="toko.js"></script>
32  </body>
33  </html>
```

### Langkah 1.4 · Tempel

Klik di **ujung baris 31**, tekan **Enter**, tempel dua baris tadi. Jadinya:

```html
30  </div></footer>
31  <script src="toko.js"></script>
32  <script>window.BehaviorGuardConfig = { userId: window.penggunaAktif && window.penggunaAktif.email, panel: true };</script>
33  <script src="../../dist/behaviorguard.js" defer></script>
34  </body>
35  </html>
```

**Ctrl+S**.

> Urutannya penting: harus **setelah** `toko.js`, karena `toko.js` yang mengisi
> `window.penggunaAktif`.

### Langkah 1.5 · Muat ulang

Browser → **Ctrl+Shift+R**.

Panel muncul di **pojok kanan bawah** bertuliskan **MENGENALI…**. Di Console:

```js
BehaviorGuard._instance.userId
```

Muncul surel akun yang tadi kamu daftarkan. **Katakan:** *"Dua baris. Tanpa build, tanpa
npm install, tanpa backend, dan identitasnya otomatis ikut akun yang login."*

### Langkah 1.6 · Pasang di halaman lain

Ulangi untuk empat berkas sisanya. Dua baris yang ditempel **sama persis**:

| Berkas | Ctrl+G ke baris | Tempel setelah baris |
|---|---|---|
| `masuk.html` | `35` | 34 |
| `produk.html` | `30` | 29 |
| `keranjang.html` | `32` | 31 |
| `checkout.html` | `57` | 56 |

**Katakan:** *"Situs multi-halaman butuh tagnya di tiap halaman — sama seperti Google
Analytics. Tapi profilnya tetap satu, karena diikat ke akun."*

---

## 2. Situs kedua — Pasar Loka (SPA)

Cuma **satu berkas**, tempel **sekali**.

### Langkah 2.1 · Tunjukkan ini beneran SPA

Buka <http://localhost:8080/demo/pasar-spa/> → daftar akun baru dulu.

Setelah masuk, klik **Belanja → Keranjang → Bayar → Tentang**. Tunjukkan:
- Alamat berubah (`?r=/keranjang`, `?r=/checkout`)
- **Ikon reload browser tidak pernah berputar**

Di tiap layar ada kotak: `rute aktif: /keranjang — tanpa muat ulang`.

### Langkah 2.2 · Tempel

Buka `demo/pasar-spa/index.html`, **Ctrl+End**.

```html
348  })();
349  </script>
350  </body>
351  </html>
```

Klik ujung **baris 349**, Enter, tempel dua baris tadi. **Ctrl+S** → **Ctrl+Shift+R**.

### Langkah 2.3 · Buktikan `pushState` tertangkap

Di Console:

```js
BehaviorGuard._instance.capture.peek().filter(e => e.event_type === 'NAVIGATION').length
```

Hasilnya `0`. Klik **Keranjang**, lalu **Bayar**, jalankan lagi → hasilnya **`2`**.

**Katakan:** *"Situs ini tidak pernah memuat ulang halaman. BehaviorGuard tetap tahu
penggunanya berpindah, karena dia mengaitkan diri ke `history.pushState`. Ini yang biasanya
gagal di SPA."*

---

## 3. Situs ketiga — Butik Rasa (React 18)

Cuma **satu berkas**, tempel **sekali**.

### Langkah 3.1 · Tunjukkan ini React beneran

Buka <http://localhost:8080/demo/butik-react/> → daftar akun baru.

Di Console: `React.version` → `"18.3.1"`. Klik filter kategori — daftarnya dirender ulang
oleh komponen React.

### Langkah 3.2 · Tempel

Buka `demo/butik-react/index.html`, **Ctrl+End**.

```html
410  })();
411  </script>
412  </body>
413  </html>
```

Klik ujung **baris 411**, Enter, tempel. **Ctrl+S** → **Ctrl+Shift+R**.

### Langkah 3.3 · Buktikan interaksi React tertangkap

Klik beberapa tombol, ganti ukuran, ketik di formulir. Lalu:

```js
BehaviorGuard._instance.capture.peek().reduce((a,e)=>{a[e.event_type]=(a[e.event_type]||0)+1;return a},{})
```

Muncul `MOUSE_MOVE`, `MOUSE_CLICK`, `KEYSTROKE`, `FORM_FOCUS`.

**Katakan:** *"React merender ulang seluruh antarmuka dan pakai event sintetisnya sendiri.
BehaviorGuard mendengar di tingkat `document`, jadi dia tidak peduli frameworknya apa."*

---

## 4. Cerita utuh: dari daftar akun sampai dikenali

Ini bagian yang paling meyakinkan, dan urutannya persis seperti pengalaman pengguna nyata.

### Yang akan terlihat di panel

| Tahap | Panel |
|---|---|
| Baru daftar, sesi 1 | **MENGENALI 1/10** + bar 10% |
| Sesi ke-5 | **MENGENALI 5/10** + bar 50% |
| Sesi ke-10 | **MENGENALI 10/10** — *"profil siap"* |
| Sesi ke-11+ | **LOW · AMAN** dengan skor perilaku |
| Orang lain memakai | **MEDIUM · WASPADA** atau **HIGH · BAHAYA** |

Bar progresnya bergerak tiap sesi berakhir — jadi penonton melihat sistemnya **sedang
belajar**, bukan menggantung.

### ⚠️ Yang harus kamu lakukan SEBELUM berdiri di depan orang

Satu sesi berakhir tiap **30 detik**, dan butuh **10 sesi**. Artinya dari akun baru sampai
vonis pertama ≈ **5 menit interaksi aktif terus-menerus**. Penonton tidak akan menunggu.

**Rencana yang benar:**

1. **Sebelum booth:** daftar akun (misalnya `andi@tokokopi.id`), pasang tagnya, lalu pakai
   tokonya seperti manusia normal ~5 menit — gerakkan mouse, ketik di formulir, klik produk,
   isi checkout. Jangan diam; satu sesi butuh ≥100 event dan ≥5 detik.

   Pantau di Console:
   ```js
   BehaviorGuard._instance.getState().sessions.length
   ```
   Kalau sudah ≥ 10:
   ```js
   BehaviorGuard._instance.getState().hasModel   // harus true
   ```

2. **Selesaikan popup "Atur verifikasi keamanan" satu kali.** Muncul di sesi LOW pertama
   setelah pendaftaran selesai. Ketik frasanya **3 kali** dengan ritme normalmu.

   > Kalau diabaikan, template ritme tidak tersimpan, dan saat vonis HIGH nanti step-up
   > **tidak akan muncul** — itu perilaku aman yang disengaja (penyusup tidak boleh
   > mendaftarkan ritmenya sendiri), tapi di panggung terlihat seperti fiturnya rusak.

3. **Jangan tekan Keluar, jangan Reset, jangan mode penyamaran.** Profil tersimpan di
   `localStorage` dan bertahan setelah muat ulang.

### Saat demo: dua pilihan cerita

**Cerita A — "sistemnya sedang belajar"** (kalau mau menunjukkan dari nol)
Daftar akun baru di depan penonton, pakai tokonya ~1 menit, tunjukkan panel bergerak
**1/10 → 2/10 → 3/10**. Tidak perlu menunggu sampai 10; yang penting terlihat progresnya.

**Cerita B — "login sah, sesinya tidak"** (pakai akun yang sudah matang)
1. Masuk dengan akun yang sudah kamu latih. Pakai sebentar → panel **LOW · AMAN**.
2. **Minta penonton memakai mouse dan keyboardmu** ~30 detik dengan gayanya sendiri.
3. Tunggu sesi berakhir, atau paksa lewat Console:
   ```js
   await BehaviorGuard.endSession()
   ```
4. Panel berubah **MEDIUM** atau **HIGH**, popup verifikasi ritme muncul.
5. Penonton mencoba mengetik frasanya → **ditolak**. Kamu ketik → **lolos**.

Kalimat penutupnya: *"Login-nya sah. Sesinya tidak."*

### Serangan otomatis (opsional)

<http://localhost:8080/demo/attack_sim.html> — tunggu seeding ~10 detik, klik keempat
tombol. Semuanya harus **HIGH**, dan yang Mimicry tertangkap oleh **ensemble**, bukan oleh
heuristik bot.

---

## 5. Mengulang demo dari nol

**Hapus dua baris** yang kamu tempel, simpan, muat ulang.

Hapus profil perilaku saja (akun tetap ada):
```js
await BehaviorGuard._instance.clear()
```

Hapus semuanya termasuk akun: F12 → **Application** → **Storage** → **Clear site data**.

---

## 6. Kalau ada yang tidak beres

| Gejala | Penyebab & solusi |
|---|---|
| Panel tidak muncul | Server dijalankan dari folder salah. Harus dari `BEHAVIORGUARD-SDK`. |
| Console: `404 behaviorguard.js` | Dari `demo/nama-situs/` path-nya memang `../../dist/`. |
| `BehaviorGuard._instance.userId` = `undefined` | Kamu belum masuk akun, atau baris config ditempel **sebelum** skrip situsnya. Harus **setelah**. |
| `typeof window.BehaviorGuard` tetap `undefined` | Tag ketempel setelah `</body>`, lupa Ctrl+S, atau pakai F5 — harus **Ctrl+Shift+R**. |
| Panel diam di MENGENALI 0 | Interaksi terlalu sedikit. Satu sesi butuh ≥100 event dan ≥5 detik. Gerakkan mouse dan ketik. |
| Sesi tidak bertambah | Sama seperti di atas. Cek `getState().sessions.length`. |
| Popup verifikasi tidak muncul saat HIGH | Template ritme belum didaftarkan. Ulangi bagian 4 nomor 2. |
| Situs React kosong | `vendor/react.js` hilang. Cek `demo/butik-react/vendor/` berisi dua berkas. |

---

## 7. Ringkasan

Tiga arsitektur, **dua baris yang sama persis**:

```html
<script>window.BehaviorGuardConfig = { userId: window.penggunaAktif && window.penggunaAktif.email, panel: true };</script>
<script src="../../dist/behaviorguard.js" defer></script>
```

| Situs | Berkas | Ctrl+G |
|---|---|---|
| Toko Kopi | `toko-klasik/index.html` | 32 |
| ↳ | `toko-klasik/masuk.html` | 35 |
| ↳ | `toko-klasik/produk.html` | 30 |
| ↳ | `toko-klasik/keranjang.html` | 32 |
| ↳ | `toko-klasik/checkout.html` | 57 |
| Pasar Loka | `pasar-spa/index.html` | Ctrl+End (349) |
| Butik Rasa | `butik-react/index.html` | Ctrl+End (411) |

Nol dependensi, nol build, nol backend, satu berkas ~89 KB.
