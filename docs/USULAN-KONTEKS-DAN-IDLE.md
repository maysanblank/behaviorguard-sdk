# Usulan: Validitas Pengukuran pada Autentikasi Perilaku Berkelanjutan

**Konteks.** Catatan dosen pembimbing (9 Sep 2026): *"Kalau idle-nya kan bisa aja dia buka
terus ditinggal melakukan sesuatu."*

**Ringkasan.** Catatan itu benar, dan setelah ditelusuri akibatnya ternyata **dua arah, bukan
satu**: idle menaikkan salah-tolak pemilik (FRR) *sekaligus* membuka jendela pengambilalihan
sesi (FAR). Keduanya sudah ditambal dan diukur (C-23). Lebih penting dari tambalannya:
idle ternyata **anggota pertama dari satu kelas masalah yang lebih besar** - situasi ketika
yang berubah adalah *alat ukurnya*, bukan *orangnya*. Dokumen ini memuat perbaikan yang sudah
jalan, angka ukurnya, katalog kasus sejenis, dan satu mekanisme umum yang diusulkan untuk
menanganinya sekaligus.

Menelusuri idle juga memunculkan cacat yang **lebih tua dari idle**: panjang sesi yang
berubah-ubah terbaca sebagai identitas yang berubah. Itu pun sudah diselesaikan, dan tanpa
menyentuh SPEC (§3b, C-24).

---

## 1. Kenapa idle merusak

### 1.1 Akibat pertama - pengukuran (FRR naik)

28 fitur F4 dihitung dari **selisih antar-event** dan dari `duration = ts_akhir − ts_awal`.
Kalau ada jeda mati di tengah sesi, jeda itu ikut masuk ke statistik seolah-olah ia perilaku.
Diukur langsung (`core/idle.test.mjs`, satu rentetan 40 event, ditinggal 12 menit di tengah):

| Fitur | Melintasi jeda (lama) | Per segmen (baru) | Faktor |
|---|---:|---:|---:|
| `temporal_session_duration` | 731,2 dtk | 5,5 dtk | 133× |
| `mouse_click_interval_mean` | 48.708 ms | 710 ms | 69× |
| `keystroke_flight_time_mean` | 34.797 ms | 509 ms | 68× |
| `keystroke_typing_speed` | 0,030 | 1,998 | 67× |

Empat dari 28 fitur meleset satu sampai dua orde besaran, dan bukan sebagai derau acak
melainkan **bias searah**. Ini penting: basis data riset dikumpulkan lewat skenario bertugas
yang padat, hampir tanpa jeda panjang. Jadi model dilatih pada dunia yang padat lalu dipakai
di dunia yang penuh jeda - **ketidakcocokan latih-vs-pakai** yang sistematis. Kelas cacatnya
sama persis dengan C-16/C-17 di `core/DRIFT.md` (fitur mati di produksi karena field tak
pernah diisi), hanya sumbernya kali ini waktu, bukan field yang kosong.

### 1.2 Akibat kedua - keamanan (FAR naik)

Sisi sebaliknya, dan justru yang lebih berbahaya. Selama kursi kosong, sesi itu **sudah
terautentikasi**. Siapa pun yang duduk sesudahnya mewarisi sesi yang sah - *serangan jam
makan siang* (lunch-break attack). Penyusupnya tidak melewati login sama sekali, jadi
satu-satunya sinyal yang tersedia adalah **adanya absen panjang di tengah sesi** - persis
sinyal yang dulu dibuang begitu saja.

Konsekuensinya tajam: **menghapus idle demi FRR saja justru memperlebar lubang ini.** Kalau
jeda cuma dibersihkan lalu dilupakan, sistem kehilangan satu-satunya petunjuk bahwa ada
pergantian orang. Karena itu tambalannya harus dua sisi.

### 1.3 Akibat ketiga - diam dibaca sebagai aman

`endSession()` dulu mengembalikan `null` tanpa jejak untuk buffer di bawah 30 event.
Integrator yang menunggu callback tidak bisa membedakan **"sudah diperiksa, aman"** dari
**"tidak ada bukti sama sekali"**, dan default diam selalu jatuh ke sisi mempercayai.

---

## 2. Yang sudah dikerjakan (C-23)

Tiga lapis, di `sdk/core/idle.js` + orkestrator `sdk/behaviorguard.js`.

**Lapis 1 - Segmentasi.** Aliran event dipecah pada tiap jeda ≥ `session.idleGapSec`
(30 detik = satu jendela penilaian). Tiap segmen kontigu dinilai sendiri-sendiri.
Rumus fitur di `core/SPEC.md` **tidak disentuh sama sekali** - yang berubah hanya *apa yang
disuapkan* ke `extractF4`. Karena itu golden vector dan keempat port (Python/Rust/Java/WASM)
tetap 227/227 tanpa perlu diubah. Ini pilihan desain yang disengaja: menaruh perbaikan di
lapisan sesionisasi, bukan di lapisan fitur, supaya tidak ada satu pun angka lama yang
kehilangan reprodusibilitasnya.

**Lapis 2 - Dua ambang untuk dua akibat.**

| Knob | Default | Arti |
|---|---:|---|
| `session.idleGapSec` | 30 dtk | Jeda yang tidak boleh diukur melintasinya |
| `idle.awaySec` | 300 dtk | "Kursi mungkin kosong": streak LOW direset, kepercayaan tidak menyeberang absen |
| `idle.reverifyAfterSec` | 900 dtk | LOW dinaikkan jadi MEDIUM -> step-up jalan sekali |

Ambang 15 menit sejajar dengan batas idle-timeout PCI DSS 8.2.8 (di sana itu *maksimum*,
jadi memakainya sebagai pemicu verifikasi bersifat konservatif). Dipisah dari `awaySec`
secara sengaja: 5 menit sudah cukup untuk berhenti mengukur melintas, tapi belum cukup untuk
pantas mengganggu pengguna dengan popup.

**Lapis 3 - ABSTAIN.** Jendela tanpa bukti kini menerbitkan vonis `UNKNOWN` / aksi `ABSTAIN`,
**sekali** per rentetan idle (bukan tiap jendela, supaya tab yang ditinggal semalaman tidak
membanjiri log). Sistem boleh berkata *"saya tidak tahu"* alih-alih menebak. Ini bagian yang
paling bisa digeneralisasi - lihat §5.

**Bonus.** Ekor buffer yang masih hidup kini dikembalikan ke buffer alih-alih dibuang tiap
30 detik. Pengguna yang menelusuri pelan-pelan akhirnya terkumpul jadi sesi.

**Status uji.**

| Uji | Perintah | Hasil |
|---|---|---|
| Modul segmentasi + bukti angka §1.1 | `node core/idle.test.mjs` | 33/33 SESUAI |
| Jalur penuh orkestrator | `node core/idle.live.test.mjs` | 20/20 SESUAI |
| Kesesuaian mesin (SPEC tak berubah) | `python core/conformance.py` | 227/227 SESUAI |
| Idem, mesin JS | `node core/conformance.node.mjs` | 227/227 SESUAI |
| Regresi step-up / gerbang / integrity | 3 suite lama | 23/23, 11/11, 10/10 |

---

## 3. Ablasi pada basis data riset - dan satu temuan turunan

`python tools/idle_ablation.py` mengekstrak ulang fitur dari `raw_events` (482.203 event,
19 subjek dengan ≥14 sesi), menyuntikkan **satu** jeda AFK 2-20 menit di titik acak tiap sesi
uji, lalu menilai empat lengan dengan **model dan ambang yang persis sama**. Metrik utamanya
rata-rata |z| terhadap baseline pemilik, dikelompokkan menurut cara fitur bisa dirusak waktu:

| Lengan | fitur-WAKTU | fitur-CACAH | fitur-BENTUK |
|---|---:|---:|---:|
| BERSIH (sesi utuh, tanpa jeda) | **1,12** | 0,95 | 2,60 |
| KONTROL: dipotong saja, tanpa jeda | 1,25 | 2,00 | 3,11 |
| BERGAP, tanpa segmentasi (hari ini) | **12,42** | 0,95 | 2,60 |
| BERGAP + segmentasi (C-23) | **1,14** | 2,01 | 3,13 |

Cara membaca:

- **Kerusakan yang dipersoalkan dosen terukur: |z| fitur-WAKTU naik 1,12 -> 12,42 (11×).**
  Sesi pemilik yang cuma ditinggal sebentar terlihat sejauh 12 simpangan baku dari dirinya
  sendiri. Itu bukan derau, itu identitas palsu.
- **Segmentasi memulihkannya nyaris sempurna: 12,42 -> 1,14**, berhimpit dengan lengan bersih.
- **Kolom fitur-CACAH memperlihatkan temuan turunan.** Segmentasi menaikkannya 0,95 -> 2,01 -
  tapi lengan KONTROL (sesi bersih yang dipotong di titik yang sama, tanpa jeda) juga 2,00.
  Artinya kenaikan itu **bukan ongkos segmentasi**, melainkan efek "sesi jadi lebih pendek"
  yang sudah ada dengan atau tanpa idle. Kontrol inilah yang mencegah salah baca.

**Temuan turunan - SUDAH DISELESAIKAN, lihat §3b.** Sembilan dari 28 fitur adalah **cacahan mentah** -
`mouse_direction_changes`, `mouse_pause_count`, `form_focus_count`, `nav_page_count`,
`cart_action_count`, dan seterusnya - yang ikut membesar bersama panjang sesi. Akibatnya
**setiap perubahan panjang sesi terbaca sebagai perubahan identitas**. Ini masalah yang
berdiri sendiri, lebih tua dari idle, dan menyentuh setiap kasus di §4 yang mengubah panjang
sesi. Perbaikan yang jelas adalah normalisasi laju (`cacah / durasi_aktif`) - tapi itu
menyentuh `core/SPEC.md`, jadi perlu versi SPEC baru + regenerasi golden + sinkron empat
port, dan semua angka lama kehilangan reprodusibilitasnya. **Ternyata ada jalan yang
menghindari semua ongkos itu; lihat §3b.**

> **Batas yang wajib disebut kalau angka ini dikutip.** FRR/FAR absolut dari
> `idle_ablation.py` **bukan** angka headline skripsi: modelnya dibangun dari 10 sesi
> baseline tanpa protokol held-out/prequential `reproduce_db.py`, jadi titik operasinya jauh
> lebih longgar (FAR ~97%). Yang sahih dibaca hanya **selisih antar-lengan**, karena keempat
> lengan memakai model dan ambang identik. Jeda juga disuntik sintetis dengan asumsi pengguna
> melanjutkan perilaku yang sama sesudah kembali; ini mengisolasi efek **waktu**, dan bukan
> pengganti uji lapangan.

---

## 3b. Menyelesaikannya tanpa menyentuh SPEC (C-24)

Perbaikan yang jelas untuk §3 adalah mengubah rumusnya jadi laju. Ongkosnya berat: SPEC
v1.3, regenerasi golden, sinkron empat port, dan **semua angka lama kehilangan
reprodusibilitasnya**. Ada jalan kedua yang menghindari semuanya.

**Masalahnya bukan rumusnya, tapi panjangnya yang berubah-ubah.** Jadi jangan ubah rumus -
**samakan panjangnya.** Tiap segmen kontigu dipotong jadi **jendela kanonik** berukuran
tetap K event. Cacahan otomatis sebanding, tanpa satu baris pun rumus fitur berubah.

Di bawah jendela kanonik, fiturnya bahkan berubah makna menjadi lebih baik:

- cacahan -> **komposisi**: "dari K event, berapa yang klik"
- `temporal_session_duration` -> **kecepatan**: "berapa lama menghasilkan K event"

Keduanya lebih biometrik daripada "sesinya kebetulan sepanjang apa". Syarat mutlaknya:
dipakai di **pendaftaran DAN penilaian** - kalau hanya salah satu, kita cuma menukar satu
ketidakcocokan latih-vs-pakai dengan yang lain.

**Hasil** (`tools/idle_ablation.py --canonical 120`, rata-rata |z|):

| Lengan | fitur-WAKTU | fitur-CACAH | fitur-BENTUK |
|---|---:|---:|---:|
| Bersih, sesi utuh | 0,83 | 1,00 | 1,90 |
| Kontrol: dipotong saja | 0,84 | **1,01** | 1,90 |
| Bergap, tanpa segmentasi | 8,41 | 1,00 | 1,91 |
| Bergap + segmentasi (C-23) | 0,84 | **1,00** | 1,89 |

Bandingkan kolom fitur-CACAH dengan tabel §3 (0,95 vs **2,02**). Di sini keempat lengan
berhimpit di 1,00 - **invariansi pulih penuh**. Dan kolom fitur-WAKTU membuktikan kedua
perbaikan ini saling melengkapi, bukan menggantikan: kanonikalisasi sendirian tidak
menyembuhkan idle (8,41), segmentasi sendirian tidak menyembuhkan panjang sesi.

### Dua konsekuensi yang menyusul, dan penyelesaiannya

**(i) Jendela pendek = bukti lebih sedikit per vonis.** Godaannya adalah melonggarkan
ambang, tapi itu cuma memindahkan kesalahan ke sisi FAR. Yang benar: **kumpulkan bukti M
jendela lalu vonis rata-ratanya** - menukar **latensi dengan keyakinan**, bukan FRR dengan
FAR. Terukur: AUC 0,770 (M=1) -> 0,789 -> 0,808 -> **0,829** (M=5), FAR 25,0% -> **9,4%**.

Satu jebakan yang layak dicatat di skripsi: jalan pintas analitik "rapatkan ambang sebesar
`std/√M`" **salah, dan salahnya searah**. Rumus itu mengandaikan jendela saling bebas,
padahal jendela berurutan dari sesi yang sama berkorelasi - sebaran nyatanya lebih lebar,
ambangnya jadi terlalu rapat, dan pemilik yang ditolak (diuji: FRR tertahan di 46,5%).
Yang benar adalah **mengagregasi skor latih dengan cara yang persis sama** lalu
mengkalibrasi di atasnya, sehingga korelasinya ikut terbawa tanpa perlu diasumsikan.

**(ii) Ambang dikalibrasi di dalam sampel.** Setelah (i) diperbaiki FRR ternyata masih
tinggi, dan akarnya lebih mendasar: `_rebuildModel` mengkalibrasi ambang dari skor vektor
yang **persis dipakai memfit** detektornya. Skor in-sample selalu optimistik - model memang
dipas-paskan ke titik-titik itu - jadi ambangnya terlalu rapat dan sesi pemilik berikutnya
jatuh di luarnya. **Ini mekanisme yang sama persis dengan C-22**, satu lapis lebih tinggi.
Menyisihkan 30% kolam khusus untuk kalibrasi: **FRR 46,5% -> 27,8%, EER 32,9% -> 28,6%**.

### Apa yang dikirim, dan apa yang belum

Ketiganya sudah terpasang di SDK sebagai knob, **semuanya default MATI**:

```js
BehaviorGuard.init({
  userId: 'andi@contoh.id',
  session: { canonicalWindow: 120 },   // 0 = mati (default)
  aggregateWindows: 3,                 // 1 = mati (default)
  calibrationHoldout: 0.3,             // 0 = mati (default)
});
```

Default mati bukan sikap malu-malu, melainkan syarat kejujuran: kalau default berubah,
seluruh angka headline di `config.js` kehilangan reprodusibilitasnya dalam satu commit.

**Yang wajib dijujurkan.** Ketiganya terbukti **arahnya**, bukan **titik operasinya**. Pada
harness ablasi, EER kanonik (~28-33%) masih jauh di bawah EER 11,9% protokol sesi-utuh.
Sebagian karena harness ablasi memang longgar, sebagian karena jendela 120 event memang
membawa bukti lebih sedikit daripada sesi ~600 event. **Sebelum angkanya dikutip di
skripsi, jalankan ulang dengan protokol held-out `reproduce_db.py`.**

Pertukaran sesungguhnya: kanonikalisasi menukar **daya pisah puncak** dengan
**invariansi**. Lengan bersih tanpa kanonikalisasi mencapai AUC 0,810 - tapi begitu panjang
sesinya berubah ia jatuh ke 0,636. Dengan kanonikalisasi ia bertahan di 0,742-0,746 di
**semua** lengan. Dan karena di produksi sesi memang berupa jendela 30 detik, tidak pernah
sesi riset utuh, rezim yang invarian itulah yang cocok dengan kondisi penyebaran.

---

## 4. Katalog kasus sejenis

Idle adalah anggota pertama dari kelas ini: **situasi di mana yang berubah adalah alat
ukurnya, bukan orangnya.** Sistem biometrik perilaku menyimpulkan identitas dari sinyal yang
sebenarnya campuran `identitas × perangkat × konteks × kondisi badan`. Setiap kasus di bawah
menggeser salah satu faktor selain identitas - dan sistem yang naif membacanya sebagai
"orang lain".

Kolom **Dampak**: `FRR↑` = pemilik asli diganggu; `FAR↑` = penyusup lolos.

### A. Kehadiran dan perhatian

| # | Kasus | Dampak | Status |
|---|---|---|---|
| A1 | **Idle/AFK** - halaman dibuka lalu ditinggal | FRR↑ | **Selesai (C-23)** |
| A2 | **Tab latar / jendela tak fokus** - browser men-throttle timer jadi 1/menit dan tidak mengirim `mousemove`; jendela 30 detik diam-diam jadi jendela beberapa menit | FRR↑ | Sebagian: `visibilitychange` sudah dipantau; throttling timer belum dikompensasi |
| A3 | **Multitasking cepat** - bolak-balik ke WhatsApp/Excel di tengah mengisi form | FRR↑ | Selesai lewat segmentasi (jeda < 5 mnt = idle, bukan away) |
| A4 | **Sesi sangat pendek** - buka, klik satu hal, pergi | FRR↑ | Selesai: ABSTAIN, bukan tebakan |
| A5 | **Ambil-alih sesi tak terjaga** - pemilik pergi, orang lain duduk | **FAR↑** | **Selesai (C-23 lapis 2)** |

### B. Lingkungan dan perangkat - *alat ukurnya yang ganti*

| # | Kasus | Dampak | Usulan |
|---|---|---|---|
| B1 | **Ganti modalitas input** - mouse ↔ trackpad ↔ layar sentuh ↔ stylus. Distribusi kecepatan, kelengkungan, dan percepatan berbeda total | FRR↑ berat | Baseline **per konteks** (§5). Trackpad dan mouse adalah dua alat ukur, bukan dua orang |
| B2 | **Ganti resolusi / monitor eksternal / zoom browser** - kecepatan dalam px/ms ikut berubah walau tangan bergerak sama | FRR↑ | Normalisasi skala: bagi jarak dengan diagonal viewport -> satuan bebas-DPI |
| B3 | **Perangkat lambat / halaman berat** - event digabung (coalescing), muncul jeda dan kecepatan palsu | FRR↑ | Deteksi coalescing; turunkan bobot sesi ber-jank atau ABSTAIN |
| B4 | **Ponsel vs laptop** - seluruh blok fitur mouse nol di layar sentuh | FRR↑ berat | Kasus khusus B1; wajib baseline terpisah |
| B5 | **Remote desktop / VDI / screen sharing** - semua timing terdistorsi jaringan | FRR↑ **dan** FAR↑ | Deteksi + ABSTAIN. Juga vektor serangan tersendiri: penyerang bisa sengaja lewat RDP untuk mengaburkan ritmenya |
| B6 | **Setelan OS berubah** - akselerasi pointer, `prefers-reduced-motion`, mode hemat baterai | FRR↑ | Masuk kunci konteks |

### C. Variasi manusia yang sah

| # | Kasus | Dampak | Usulan |
|---|---|---|---|
| C1 | **Kondisi badan** - cedera, lelah, sakit, mengantuk, atau satu tangan (memegang kopi, menggendong anak) | FRR↑ | Tidak bisa dihilangkan. Jawabannya step-up yang ramah, bukan blokir |
| C2 | **Posisi tubuh** - laptop di pangkuan, di kereta, sambil rebahan | FRR↑ | Idem |
| C3 | **Drift jangka panjang** - pengguna makin mahir memakai aplikasinya | FRR↑ | Sudah ditangani trust-loop + retrain progresif |
| C4 | **Zona waktu / shift malam / DST** - `temporal_time_of_day_score` menyimpang padahal orangnya sama | FRR↑ | Fitur ini **konteks, bukan biometrik**. Usul: keluarkan dari vektor identitas, pakai sebagai sinyal risiko terpisah |
| C5 | **Teknologi bantu** - pembaca layar, navigasi keyboard-saja, input suara, switch access | FRR↑ berat | **Isu inklusi dan etika, bukan sekadar akurasi.** Sistem yang tidak menanganinya secara sistematis mengunci pengguna disabilitas dari akunnya sendiri. Wajib masuk bab batasan |

### D. Jalur input yang bukan pengetikan

| # | Kasus | Dampak | Usulan |
|---|---|---|---|
| D1 | **Autofill password manager / browser** - form terisi dengan **nol** keystroke; seluruh blok `keystroke_*` jadi degenerate | FRR↑ **dan** FAR↑ | Deteksi eksplisit. Sesi tanpa keystroke tidak boleh dinilai LOW dengan percaya diri - itu ABSTAIN, karena bukti keystroke-nya memang tidak ada |
| D2 | **Salin-tempel** - 30 karakter masuk lewat 2 event | FRR↑ | Sudah ditangani di lapis MFA (C-1 menolak tempel); belum di lapis skoring sesi |
| D3 | **Ekstensi mengubah DOM** - translate, adblock, autofill pihak ketiga | FRR↑ | Masuk kunci konteks |

### E. Identitas jamak yang sah

| # | Kasus | Dampak | Usulan |
|---|---|---|---|
| E1 | **Akun dipakai bersama** - keluarga, toko, asisten admin | FRR↑ | Baseline multi-modal (campuran), atau terima dan turunkan sensitivitas. Harus jadi keputusan produk yang eksplisit, bukan kecelakaan |
| E2 | **Komputer bersama / kios / warnet** | FRR↑ dan FAR↑ | Perpendek `reverifyAfterSec` untuk konteks ini |
| E3 | **Delegasi sah** - admin membantu pelanggan lewat akun pelanggan | FAR↑ (secara teknis benar mencurigai) | Butuh jalur "delegasi" di sisi aplikasi |

### F. Pergeseran populasi

| # | Kasus | Dampak | Usulan |
|---|---|---|---|
| F1 | **Aplikasi didesain ulang** - fitur navigasi/form bergeser untuk **semua** pengguna serentak | FRR↑ massal | Pantau tingkat non-LOW agregat; lonjakan mendadak = drift populasi, bukan gelombang penyusup. Ini alarm operasional yang penting |
| F2 | **Versi browser mengubah throttling event** | FRR↑ massal | Idem |

### G. Serangan terhadap mitigasinya sendiri

Bagian ini yang paling sering hilang dari usulan sejenis, padahal setiap mitigasi di atas
menciptakan permukaan serang baru.

| # | Kasus | Dampak | Usulan |
|---|---|---|---|
| G1 | **Padding idle** - penyerang sengaja menyisipkan jeda supaya event per jendela selalu di bawah 30 dan sesinya tak pernah dinilai | **FAR↑** | Inilah alasan ABSTAIN harus *terlihat*. Diam-diam-tidak-menilai persis yang diincar penyerang; ABSTAIN + kebijakan integrator ("aksi bernilai tinggi butuh vonis, bukan sekadar tiadanya vonis") menutupnya |
| G2 | **Meniru pola idle pemilik** | FAR↑ | Sisa risiko; sebut di bab batasan |
| G3 | **Menyenjatakan D1** - penyerang memakai autofill supaya blok keystroke kosong dan tak ada yang bisa dibandingkan | FAR↑ | Sama seperti G1: ketiadaan bukti ≠ bukti tidak bersalah |
| G4 | **Klaim konteks palsu** - jika baseline per konteks diterapkan, penyerang mengaku "konteks baru" untuk dapat baseline longgar | FAR↑ | Konteks baru **tidak pernah** otomatis tepercaya: ia harus melewati pendaftaran sendiri dengan step-up, bukan mewarisi kepercayaan konteks lama |
| G5 | **Replay event mentah** | FAR↑ | Sudah ditangani `integrity.js` + rate-limit |

---

## 5. Mekanisme umum yang diusulkan

Dua puluh lebih kasus di §4 tidak butuh dua puluh tambalan. Hampir semuanya jatuh ke tiga
pertanyaan yang sama, dan tiga pertanyaan itu bisa dijadikan **satu gerbang di depan
pen-skoran**:

```
event mentah
     |
     v
[ GERBANG VALIDITAS PENGUKURAN ]  <-- usulan
     |
     +--> (a) apakah ini benar-benar perilaku?      -> kalau bukan: potong (C-23 lapis 1)
     +--> (b) apakah buktinya cukup?                -> kalau tidak: ABSTAIN (C-23 lapis 3)
     +--> (c) apakah alat ukurnya masih sama?       -> kalau bukan: baseline konteks lain
     |
     v
skor -> LOW / MEDIUM / HIGH
```

**Perubahan konseptual utama: tambahkan keluaran ke-4, ABSTAIN.** Sistem hari ini wajib
memilih LOW/MEDIUM/HIGH untuk setiap sesi - termasuk sesi yang datanya tidak layak dinilai.
Sistem biometrik yang boleh berkata *"bukti tidak cukup"* lebih jujur **dan** lebih aman
daripada yang menebak, karena tebakan pada bukti kosong selalu bias ke arah menerima.
Ini sudah jalan untuk kasus idle; usulnya adalah menggeneralisasikannya ke D1 (tanpa
keystroke), B3 (sesi ber-jank), B5 (terdeteksi remote), dan A4 (sesi terlalu pendek).

**Kunci konteks (`contextKey`).** Baseline dipisah per
`modalitas_input × bucket_viewport × kelas_perangkat`. Alasannya bukan akurasi semata: satu
baseline **tidak bisa** mewakili dua alat ukur yang berbeda - trackpad dan mouse menghasilkan
distribusi kecepatan yang berbeda dari orang yang sama. Menggabungkan keduanya dalam satu
baseline melebarkan sebarannya, dan baseline yang melebar berarti **penyusup lebih mudah
masuk**. Jadi memisahkan konteks memperbaiki FRR *dan* FAR sekaligus. Syarat wajibnya (G4):
konteks baru menjalani pendaftarannya sendiri dengan step-up, tidak pernah mewarisi
kepercayaan konteks lama.

**Normalisasi skala.** Kecepatan dinyatakan dalam px/ms hari ini. Membaginya dengan diagonal
viewport membuatnya bebas-DPI dan menutup B2 hampir gratis. Ini menyentuh SPEC, jadi masuk
Tahap 2 bersama normalisasi laju dari §3.

---

## 6. Usulan metrik baru untuk skripsi

FRR/FAR saja tidak bisa menangkap masalah yang dokumen ini bahas - sistem bisa punya FRR 0%
justru karena ia menilai jauh lebih sedikit sesi daripada yang dikira. Usul: laporkan dua
angka tambahan berdampingan.

1. **Cakupan (coverage)** - berapa persen waktu-sesi yang benar-benar sempat diverifikasi,
   bukan ABSTAIN. Ini yang G1 serang, dan tanpa metrik ini serangannya tak terlihat.
   FRR/FAR harus dilaporkan **bersyarat pada cakupan**; FRR 5% pada cakupan 30% jauh lebih
   lemah daripada FRR 12% pada cakupan 90%, walau angka pertama terlihat lebih bagus.
2. **Waktu-ke-deteksi (time-to-detect)** - untuk skenario ambil-alih (A5), berapa detik
   perilaku penyusup dibutuhkan sampai vonis non-LOW keluar. Ini metrik yang tepat untuk
   autentikasi *berkelanjutan*, sementara FAR adalah metrik untuk autentikasi *satu-gerbang*.

Dua metrik ini yang membuat pembahasan idle naik dari "tambalan bug" jadi kontribusi metodologis.

---

## 7. Rencana bertahap

| Tahap | Isi | Menyentuh SPEC? | Status |
|---|---|---|---|
| **1** | Segmentasi idle, dua ambang absen, ABSTAIN | Tidak | **Selesai, teruji** |
| **2** | Invariansi panjang sesi: jendela kanonik + agregasi bukti + kalibrasi luar-sampel (§3b) | **Tidak** - jalur alternatif yang menghindari SPEC v1.3 | **Selesai, teruji, default mati** |
| **2b** | Normalisasi skala kecepatan bebas-DPI (B2) | Bisa di lapisan capture, tanpa SPEC | Diusulkan |
| **3** | Kunci konteks + baseline per konteks (B1/B4/B6) dengan pendaftaran terpisah | Tidak (lapisan siklus hidup) | Diusulkan |
| **4** | Generalisasi ABSTAIN (D1, B3, B5) + metrik cakupan & waktu-ke-deteksi | Tidak | Diusulkan |

**Untuk bab batasan skripsi**, yang wajib dijujurkan apa adanya:

- Ambang 30 / 300 / 900 detik adalah **pilihan rekayasa yang beralasan, belum dituning
  terhadap data lapangan**. Ketiganya dibuka sebagai knob `init({session, idle})`.
- Segmentasi menghapus jeda dari pengukuran, tapi **tidak bisa membedakan *ditinggal* dari
  *membaca tanpa menyentuh apa pun*** - keduanya sama-sama sunyi di lapisan DOM. Justru itu
  alasan jawabannya ABSTAIN + verifikasi ulang, bukan tebakan.
- Ablasi §3 memakai jeda sintetis dengan asumsi perilaku pengguna tidak berubah sesudah
  kembali. Itu mengisolasi efek waktu secara bersih, tapi bukan pengganti uji lapangan.
- Kasus C5 (teknologi bantu) dan E1 (akun bersama) **belum ditangani**, dan keduanya
  menyangkut pengguna nyata, bukan sekadar angka.

---

## 8. Ringkasan untuk bimbingan

1. Catatannya benar, dan setelah ditelusuri akibatnya **dua arah**: idle menaikkan FRR lewat
   fitur yang rusak, *dan* menaikkan FAR lewat jendela pengambilalihan sesi.
2. Kerusakannya terukur: |z| fitur berbasis waktu naik **1,12 -> 12,42** karena satu jeda AFK.
   Segmentasi mengembalikannya ke **1,14**.
3. Perbaikannya **tidak menyentuh `core/SPEC.md`** - golden dan keempat port tetap 227/227.
   Yang berubah cuma apa yang disuapkan ke ekstraktor fitur.
4. Sisi keamanannya ditangani terpisah dengan ambang sendiri: absen ≥15 menit memicu
   verifikasi ulang walau perilaku sesudahnya terlihat normal.
5. Ablasinya memunculkan **temuan turunan**: 9 dari 28 fitur adalah cacahan mentah yang
   membesar bersama panjang sesi, jadi setiap perubahan panjang sesi terbaca sebagai
   perubahan identitas. Itu masalah yang lebih tua dari idle dan jadi usulan Tahap 2.
6. Temuan itu **sudah diselesaikan juga**, dan tanpa menyentuh SPEC (§3b): masalahnya bukan
   rumusnya melainkan panjangnya yang berubah-ubah, jadi panjangnya yang disamakan
   (**jendela kanonik**). |z| fitur-cacah 2,02 -> **1,01**, sama persis dengan sesi utuh.
   Dua konsekuensinya juga ditutup: agregasi bukti M jendela (AUC 0,770 -> 0,829) dan
   kalibrasi ambang di luar sampel (FRR 46,5% -> 27,8%, akarnya ternyata C-22 lagi).
   Semuanya **default mati** - arahnya terbukti, titik operasinya belum dituning.
7. Idle ternyata anggota pertama dari satu kelas: **kapan yang berubah alat ukurnya, bukan
   orangnya** (§4, 20+ kasus). Usulnya satu mekanisme untuk semuanya - gerbang validitas
   pengukuran dengan keluaran ke-4 **ABSTAIN**, karena sistem biometrik yang boleh berkata
   "saya tidak tahu" lebih jujur dan lebih aman daripada yang menebak.

---

### Berkas terkait

| Berkas | Isi |
|---|---|
| `sdk/core/idle.js` | Segmentasi, akuntansi waktu aktif, klasifikasi jeda |
| `sdk/core/config.js` | Knob `session.idleGapSec`, `idle.*` |
| `sdk/behaviorguard.js` | Pelacak kehadiran, kebijakan kembali-dari-absen, ABSTAIN |
| `core/idle.test.mjs` / `.html` | 33 uji modul + bukti angka §1.1 |
| `core/idle.live.test.mjs` | 20 uji jalur penuh orkestrator |
| `core/invariance.test.mjs` / `.html` | 26 uji C-24; uji pertama mengunci "default tidak mengubah apa pun" |
| `tools/idle_ablation.py` | Ablasi §3 pada basis data riset |
| `core/DRIFT.md` § C-23, C-24 | Catatan cacat dalam format audit repo ini |
