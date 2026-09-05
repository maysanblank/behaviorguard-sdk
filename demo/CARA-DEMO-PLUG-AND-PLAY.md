# Cara demo plug-and-play — tiga situs, tiga arsitektur

Panduan langkah demi langkah untuk memasang BehaviorGuard **secara langsung di depan
penonton**, ke tiga situs yang arsitekturnya berbeda-beda.

Tiga situs di folder ini **belum berisi BehaviorGuard sama sekali**. Itu memang disengaja —
itulah yang membuat demonya meyakinkan: penonton melihat situs polos, lalu melihat kamu
menempel satu baris, lalu melihat sistemnya hidup.

| Folder | Nama toko | Arsitektur | Yang dibuktikan |
|---|---|---|---|
| `toko-klasik/` | Toko Kopi Nusantara | HTML multi-halaman, tanpa framework | Navigasi antar-halaman sungguhan (muat ulang) |
| `pasar-spa/` | Pasar Loka | SPA vanilla, History API | `pushState` — nol muat ulang halaman |
| `butik-react/` | Butik Rasa | React 18 | Framework dengan sistem event sintetis sendiri |

Ketiganya toko lengkap: katalog, detail produk, keranjang, ubah jumlah, hapus item,
formulir pembayaran, dan konfirmasi pesanan. Keranjang bertahan di `localStorage`.

---

## 0. Persiapan (lakukan SEBELUM berdiri di depan orang)

### 0.1 Nyalakan server

Buka **Terminal / PowerShell**, lalu:

```bash
cd "C:\Users\USER\OneDrive\Documents\skripsi\BEHAVIORGUARD-SDK"
python -m http.server 8080
```

Biarkan jendela itu terbuka selama demo. Kalau port 8080 dipakai, ganti angkanya
(`8081`, `8090`, dst.) dan sesuaikan semua alamat di bawah.

> **Penting:** jalankan dari **folder induk** (`BEHAVIORGUARD-SDK`), bukan dari dalam
> folder demo. Situsnya memanggil `../../dist/behaviorguard.js`, jadi folder `dist/`
> harus ikut terlayani.

### 0.2 Cek ketiga situs hidup

Buka di browser, pastikan semuanya tampil dan tombolnya bisa diklik:

- <http://localhost:8080/demo/toko-klasik/index.html>
- <http://localhost:8080/demo/pasar-spa/>
- <http://localhost:8080/demo/butik-react/>

### 0.3 Siapkan editor

Buka **VS Code** di folder proyek. Tiga berkas yang akan kamu sentuh saat demo:

```
demo/toko-klasik/index.html
demo/pasar-spa/index.html
demo/butik-react/index.html
```

Kalau mau lebih aman, buka ketiganya sebagai tab terpisah **sekarang**, supaya saat demo
tinggal pindah tab.

### 0.4 Salin potongan kode ke tempat yang gampang diambil

Simpan teks ini di Notepad atau di clipboard manager. **Ini satu-satunya yang kamu tempel
saat demo:**

```html
<script src="../../dist/behaviorguard.js" data-user="andi@example.com" data-panel defer></script>
```

Itu saja. Satu baris.

---

## 1. Demo situs pertama — Toko Kopi Nusantara (multi-halaman)

### Langkah 1.1 · Tunjukkan situsnya masih polos

Buka <http://localhost:8080/demo/toko-klasik/index.html>

Tekan **F12** → tab **Console**. Ketik lalu Enter:

```js
typeof window.BehaviorGuard
```

Hasilnya `"undefined"`. **Katakan ke penonton:** *"Belum ada apa-apa di situs ini."*

Klik-klik beberapa produk, masuk keranjang, biar terlihat tokonya beneran jalan.

### Langkah 1.2 · Buka berkasnya di editor

Di VS Code buka `demo/toko-klasik/index.html`.

Gulir ke **paling bawah**. Kamu akan lihat empat baris terakhir seperti ini:

```html
<script src="toko.js"></script>
</body>
</html>
```

### Langkah 1.3 · Tempel satu baris

Letakkan kursor **tepat sebelum** `</body>`, tekan Enter untuk memberi baris kosong, lalu
tempel:

```html
<script src="../../dist/behaviorguard.js" data-user="andi@example.com" data-panel defer></script>
```

Hasil akhirnya jadi begini:

```html
<script src="toko.js"></script>
<script src="../../dist/behaviorguard.js" data-user="andi@example.com" data-panel defer></script>
</body>
</html>
```

Tekan **Ctrl+S**.

### Langkah 1.4 · Muat ulang dan tunjukkan hasilnya

Kembali ke browser, tekan **Ctrl+Shift+R** (muat ulang tanpa cache).

Yang akan terlihat:
- **Panel kecil muncul di pojok kanan bawah** bertuliskan BehaviorGuard dan status
  *"MENGENALI…"*. Itu panel bawaan, muncul karena atribut `data-panel`.
- Di Console, ketik lagi `typeof window.BehaviorGuard` → sekarang `"object"`.

**Katakan:** *"Satu baris. Tanpa build, tanpa npm install, tanpa backend. Situsnya tidak
saya ubah sedikit pun selain menempel satu tag."*

### Langkah 1.5 · Pasang di halaman lain (opsional tapi bagus)

Ulangi Langkah 1.3 untuk tiga berkas lain di folder yang sama:

```
demo/toko-klasik/produk.html
demo/toko-klasik/keranjang.html
demo/toko-klasik/checkout.html
```

Potongan kodenya **sama persis**. Setelah itu, berpindah halaman tetap melanjutkan sesi
yang sama karena `data-user`-nya sama.

**Katakan:** *"Situs multi-halaman butuh tagnya di tiap halaman — sama seperti Google
Analytics. Baselinenya tetap satu karena diikat ke user id, bukan ke halaman."*

---

## 2. Demo situs kedua — Pasar Loka (SPA, `pushState`)

Ini demo yang paling berbobot secara teknis. **Ceritanya:** kebanyakan pelacak pihak ketiga
kehilangan jejak di SPA karena tidak ada muat-ulang halaman.

### Langkah 2.1 · Tunjukkan ini benar-benar SPA

Buka <http://localhost:8080/demo/pasar-spa/>

Klik menu **Belanja → Keranjang → Bayar → Tentang**. Tunjukkan dua hal:
- Alamat di address bar **berubah** (`?r=/keranjang`, `?r=/checkout`)
- **Ikon muat-ulang browser tidak pernah berputar** — halaman tidak pernah dimuat ulang

Di setiap layar ada kotak kecil `rute aktif: /keranjang — tanpa muat ulang`.

### Langkah 2.2 · Tempel tagnya

Buka `demo/pasar-spa/index.html` di VS Code.

Berkas ini panjang (satu berkas berisi semua). Tekan **Ctrl+End** untuk lompat ke paling
bawah. Kamu akan lihat:

```html
</script>
</body>
</html>
```

Letakkan kursor **tepat sebelum** `</body>` lalu tempel — perhatikan `data-user`-nya
**berbeda**, karena ini pengguna dan toko yang lain:

```html
<script src="../../dist/behaviorguard.js" data-user="siti@pasarloka.id" data-panel defer></script>
```

**Ctrl+S**.

### Langkah 2.3 · Muat ulang dan buktikan `pushState` tertangkap

**Ctrl+Shift+R** di browser. Panel muncul di pojok.

Sekarang buka **Console** (F12) dan tempel perintah ini:

```js
BehaviorGuard._instance.capture.peek().filter(e => e.event_type === 'NAVIGATION').length
```

Hasilnya `0` — belum pindah menu.

Klik menu **Keranjang**, lalu **Bayar**, lalu jalankan perintah yang sama lagi.
Sekarang hasilnya **`2`**.

**Katakan:** *"Situs ini tidak pernah memuat ulang halaman. BehaviorGuard tetap tahu
penggunanya berpindah, karena dia mengaitkan diri ke `history.pushState`. Ini yang biasanya
gagal di SPA."*

---

## 3. Demo situs ketiga — Butik Rasa (React 18)

**Ceritanya:** React punya sistem event sintetisnya sendiri di atas DOM. Banyak orang
mengira skrip luar jadi tidak bisa membaca interaksi. Buktikan sebaliknya.

### Langkah 3.1 · Tunjukkan ini React beneran

Buka <http://localhost:8080/demo/butik-react/>

Di Console ketik:

```js
React.version
```

Hasilnya `"18.3.1"`. Klik filter kategori (**atasan / bawahan / kain / aksesori**) —
daftarnya dirender ulang oleh komponen React.

### Langkah 3.2 · Tempel tagnya

Buka `demo/butik-react/index.html`, **Ctrl+End**, tempel sebelum `</body>`:

```html
<script src="../../dist/behaviorguard.js" data-user="rina@butikrasa.id" data-panel defer></script>
```

**Ctrl+S**, lalu **Ctrl+Shift+R** di browser.

### Langkah 3.3 · Buktikan interaksi React tetap tertangkap

Klik beberapa tombol **"Masukkan keranjang"**, ganti ukuran, ketik di formulir pembayaran.
Lalu di Console:

```js
BehaviorGuard._instance.capture.peek().length
```

Angkanya naik. Untuk melihat rinciannya:

```js
BehaviorGuard._instance.capture.peek()
  .reduce((a, e) => { a[e.event_type] = (a[e.event_type] || 0) + 1; return a; }, {})
```

Akan muncul `MOUSE_MOVE`, `MOUSE_CLICK`, `KEYSTROKE`, `FORM_FOCUS`, dan seterusnya.

**Katakan:** *"React merender ulang seluruh antarmuka dan memakai event sintetisnya
sendiri. BehaviorGuard mendengarkan di tingkat `document`, jadi dia tidak peduli
frameworknya apa."*

---

## 4. Menunjukkan vonisnya hidup (bagian paling meyakinkan)

Sampai sini kamu baru membuktikan **pemasangannya** universal. Untuk menunjukkan
**deteksinya** bekerja, kamu butuh baseline yang sudah terisi.

> ### ⚠️ Baca ini, jangan sampai kejadian di depan penonton
>
> Model butuh **10 sesi pendaftaran** sebelum mengeluarkan vonis, dan satu sesi berakhir
> tiap **30 detik** (atau saat tab disembunyikan / halaman ditutup). Dari nol, itu sekitar
> **5 menit interaksi aktif terus-menerus**. Penonton tidak akan menunggu selama itu.
>
> **Solusi: lakukan pendaftaran SEBELUM demo**, pakai `data-user` yang sama. Datang ke
> booth dengan baseline yang sudah matang, lalu yang kamu peragakan adalah **pergantian
> orang** — itu yang dramatis.

### 4.1 Isi baseline sebelum demo

1. Pasang tag di salah satu situs (misalnya `toko-klasik`).
2. Buka situsnya, lalu **gunakan tokonya seperti manusia normal** selama ~5 menit:
   gerakkan mouse, ketik di formulir, klik produk, buka keranjang, isi checkout.
   Jangan diam — sesi butuh minimal 100 event dan 5 detik untuk dihitung layak.
3. Pantau progresnya di Console:

```js
BehaviorGuard._instance.getState().sessions.length
```

Kalau sudah **≥ 10**, cek modelnya sudah jadi:

```js
BehaviorGuard._instance.getState().hasModel   // harus true
```

4. **Selesaikan popup "Atur verifikasi keamanan" satu kali.** Popup ini muncul di sesi LOW
   pertama setelah pendaftaran selesai. Ketik frasanya **3 kali** dengan ritme normalmu.

   > Kalau popup ini kamu abaikan, template ritme tidak pernah tersimpan, dan saat vonis
   > HIGH nanti step-up **tidak akan muncul** — itu perilaku aman yang disengaja (penyusup
   > tidak boleh mendaftarkan ritmenya sendiri), tapi di panggung akan terlihat seperti
   > fiturnya rusak. Jadi selesaikan sekarang.

5. **Jangan tekan tombol Reset**, dan jangan buka situs dalam mode penyamaran. Baseline
   tersimpan di `localStorage` dan bertahan setelah muat ulang.

### 4.2 Saat demo: peragakan pergantian orang

1. Kamu pakai situsnya sebentar → panel tetap **LOW / hijau**.
2. **Minta penonton yang memakai mouse dan keyboardmu** selama ~30 detik. Suruh dia
   mengetik di formulir dan menggerakkan mouse dengan gayanya sendiri.
3. Tunggu sesi berakhir (30 detik), atau paksa berakhir lewat Console:

```js
await BehaviorGuard.endSession()
```

4. Panel berubah jadi **MEDIUM** atau **HIGH**, dan popup verifikasi ritme muncul.
5. Suruh penonton mencoba mengetik frasanya — **ritmenya tidak cocok, ditolak**.
   Lalu kamu yang mengetik — **lolos**.

Itu inti ceritanya: *"Login-nya sah. Sesinya tidak."*

### 4.3 Kalau mau menunjukkan serangan otomatis

Buka <http://localhost:8080/demo/attack_sim.html>, tunggu seedingnya selesai
(~10 detik), lalu klik keempat tombol serangan. Keempatnya harus **HIGH**, dan yang
Mimicry tertangkap oleh **ensemble**, bukan oleh heuristik bot.

---

## 5. Mengembalikan situs ke kondisi polos

Supaya bisa mengulang demo dari nol untuk penonton berikutnya:

**Hapus baris yang kamu tempel** di berkas terkait, simpan, muat ulang.

Untuk menghapus baseline (mulai dari sesi 1 lagi), di Console:

```js
await BehaviorGuard._instance.clear()
```

Atau bersihkan seluruh data situs: F12 → tab **Application** → **Storage** →
**Clear site data**.

---

## 6. Kalau ada yang tidak beres

| Gejala | Penyebab & solusi |
|---|---|
| Panel tidak muncul | Server dijalankan dari folder yang salah. Harus dari `BEHAVIORGUARD-SDK`, bukan dari dalam `demo/`. |
| Console: `404 behaviorguard.js` | Path `../../dist/` salah karena kedalaman folder berbeda. Dari `demo/nama-situs/` memang `../../dist/`. |
| `typeof window.BehaviorGuard` tetap `undefined` | Tag tertempel **setelah** `</body>`, atau lupa Ctrl+S, atau browser memakai cache — pakai **Ctrl+Shift+R**. |
| Vonis selalu LOW | Pendaftaran belum selesai. Cek `getState().sessions.length`, harus ≥ 10. |
| Sesi tidak bertambah | Interaksinya terlalu sedikit. Satu sesi butuh ≥ 100 event, ≥ 5 detik. Gerakkan mouse dan ketik, jangan diam. |
| Popup verifikasi tidak muncul saat HIGH | Template ritme belum didaftarkan. Ulangi langkah 4.1 nomor 4. |
| SPA jadi 404 setelah muat ulang | Seharusnya tidak terjadi — rutenya disimpan di query (`?r=/keranjang`). Kalau tetap terjadi, pastikan kamu membuka `/demo/pasar-spa/` dengan garis miring di akhir. |
| Situs React kosong | `vendor/react.js` hilang. Cek folder `demo/butik-react/vendor/` berisi dua berkas. |

---

## 7. Ringkasan untuk dihafal

Tiga situs, tiga arsitektur, **satu baris yang sama persis**:

```html
<script src="../../dist/behaviorguard.js" data-user="EMAIL" data-panel defer></script>
```

- **Multi-halaman** → tempel di tiap halaman
- **SPA** → tempel sekali, `pushState` tetap terbaca
- **React** → tempel sekali, event sintetis tetap terbaca

Nol dependensi, nol build, nol backend, satu berkas 88 KB.
