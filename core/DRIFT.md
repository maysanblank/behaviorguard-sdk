# Laporan Selisih Mesin — 2026-09-03, diperbarui 2026-09-04

> **PERINGATAN KEBASIAN:** angka D-2 di bawah (“0 dari 16 probe berpindah vonis”,
> “selisih skor maksimum 1.271”) diukur SEBELUM detektor-2 diganti ke Mahalanobis
> (2026-09-04). Pengukuran ulang hari ini: **8 dari 16 probe berpindah vonis,
> selisih skor maksimum 4.201**. Lihat bagian “Pengukuran ulang 2026-09-04”.

Repo ini punya **dua salinan mesin yang ditulis tangan terpisah**:

| | Berkas | Perannya |
|---|---|---|
| **A** | `sdk/core/*.js` | mesin yang **benar-benar dipasang** di situs orang |
| **B** | `tools/reproduce_db.py` | mesin yang **menghasilkan angka headline** di README |

Keduanya tidak pernah diuji saling-silang. Berkas ini melaporkan hasil pengujiannya.
Reproduksi: `python core/drift_check.py`.

---

## Hasil pertama: kabar baik

**`sdk/core/*.js` cocok dengan `core/bg_core.py` sebanyak 115/115 pemeriksaan pada
toleransi 1e-9.** Mesin yang dikirim ke pengguna sekarang punya pasangan Python yang
identik sampai digit ke-9, terbukti lewat berkas golden yang sama.

Artinya: dasar untuk "satu otak, banyak bahasa" sudah kokoh. Yang tersisa adalah
selisih antara mesin yang **dikirim** dan mesin yang **divalidasi**.

---

## D-1 · Lantai simpangan baku per-fitur berbeda

| | Perilaku |
|---|---|
| A (dikirim) | `sqrt(var) < 1e-9 ? 1.0 : sqrt(var)` |
| B (validasi) | `sqrt(var) > 1e-6 ? sqrt(var) : 1.0`, lalu `max(std, 1e-3)` |

**Terbukti:** untuk fitur yang nyaris konstan (`std ≈ 1e-7`), A memakai `4.08e-08`
sementara B memakai `1.0` — beda **tujuh orde besaran**. Fitur nyaris-konstan jadi
meledak jadi nilai-z raksasa di A, tapi diredam jadi ~0 di B.

**Kapan menggigit:** akun yang salah satu fiturnya konstan — misalnya `cart_action_count`
selalu 0 karena pengguna tak pernah checkout. Persis kondisi normal, bukan kasus aneh.

**Saran:** adopsi perilaku B (`max(std, 1e-3)`) di kedua sisi. Lebih aman dan tidak
mengubah angka pada data yang variasinya wajar. **Butuh generate ulang golden** dan
jalan ulang `reproduce_db.py` untuk melihat pergeseran angkanya.

---

## D-2 · A meng-clamp nilai ekstrem, B tidak

| | `score_stats` std | nilai-z |
|---|---|---|
| A (dikirim) | dijepit ke `[1e-3, 10]` | dijepit ke `[−6, +6]` |
| B (validasi) | dilantai `1e-6`, **tanpa batas atas** | **tanpa jepitan** |

**Terbukti:**

- untuk kumpulan skor yang sama, `std` A = `10.000` vs B = `25.369`
- untuk skor ekstrem, z A = `6.000` vs B = `39.418`

**Dampak terukur:** pada 3 kasus golden dengan mesin OC-SVM yang disamakan,
**selisih skor maksimum 1.271**. Untuk perbandingan, ambang di kasus-kasus itu berada
di sekitar −1.1 sampai −1.8 — jadi selisihnya **sebesar jarak antar pita risiko.**

Yang menarik: **ambangnya sendiri identik (selisih 0.000)** dan **0 dari 16 probe
berpindah vonis**. Sebabnya masuk akal: ambang dikalibrasi dari skor baseline yang
kalem, sedangkan jepitan ±6 baru bekerja pada sesi pencilan. Jadi selisih ini
**tidak terlihat di data biasa dan hanya muncul justru pada sesi paling mencurigakan** —
tepat sesi yang paling penting untuk dinilai benar.

**Saran:** adopsi perilaku A (jepitan) di kedua sisi. Jepitan itu benar — tanpa itu satu
fitur pencilan bisa mendominasi seluruh skor.

---

## D-3 · Ringkasan pengaman

Ketiga pengaman berperilaku beda; semuanya hanya aktif di kasus ekstrem, bukan di
data biasa. Itu sebabnya selisih ini bisa lolos bertahun-tahun tanpa ketahuan.

---

## D-4 · Angka skripsi memakai rumus SVM yang berbeda

Bagian SVM punya dua versi rumus:

| | Versi rumus SVM |
|---|---|
| A (dikirim) | aproksimasi centroid-RBF — `sdk/core/ocsvm.js`, 36 baris, jalan di browser |
| B (pengukuran skripsi) | `OneClassSVM` scikit-learn — `tools/reproduce_db.py` |

**Terbukti:** dari 16 probe golden, **3 berpindah vonis** hanya karena tukar versi rumus.

Ini **bukan temuan baru** — README sudah mencatatnya jujur (FAR 0.9% dengan versi
scikit-learn vs 36.2% dengan versi ringan). Yang berubah cuma statusnya: dari catatan
kaki jadi selisih yang terukur dan teruji otomatis.

**Keputusan 2026-09-03:** pustaka ini memakai **versi ringan saja**. Versi scikit-learn
tidak ikut dikirim, karena melatihnya butuh scikit-learn yang tidak jalan di browser.
`core/` sekarang cuma punya satu rumus; tidak ada lagi pilihan yang membingungkan.

`tools/reproduce_db.py` **sengaja tidak disentuh** — di situlah angka skripsi
direproduksi, dan itu harus tetap bisa dijalankan apa adanya.

Yang tersisa untuk dikerjakan (ditunda, bukan dilupakan):

- **Beri label pada angka di README** — setiap angka menyebut versi rumus mana yang
  memakainya, supaya `FAR 0.9%` tidak terbaca sebagai janji pustaka ini.
- **Ukur ulang di versi ringan** — termasuk memeriksa ulang pilihan fitur, karena README
  mencatat urutannya terbalik di versi ringan (F4 terburuk 36.2% vs F3 20.6%).
- **Perbaiki rumusnya**, bukan cuma mencatat angkanya. Versi sekarang menggepengkan
  seluruh kolam baseline jadi satu titik rerata. Alternatif yang bisa dilatih di browser
  (mis. jarak ke sesi baseline terdekat) mempertahankan variasi itu.

---

## F-1 · Ekstraksi fitur: waktu lokal → UTC (SUDAH diperbaiki)

Selisih ini bukan A-vs-B seperti D-1..D-4, melainkan **A-vs-dirinya-sendiri di mesin
berbeda**. Fitur `temporal_time_of_day_score` dulu memakai `Date.getHours()` —
**waktu lokal** — sehingga event yang persis sama menghasilkan vektor berbeda tergantung
zona waktu komputer. Itu membuat ekstraksi fitur **tidak deterministik lintas mesin**,
racun bagi klaim "universal".

**Keputusan 2026-09-03 (v1.1.0):** hitung fitur itu **UTC** (`getUTCHours` /
`getUTCMinutes`) di `sdk/core/features.js`, `extension/core/features.js`, dan
`bg_core.py:extract_features`. Ini perbaikan portabilitas, **bukan** penyetelan akurasi —
maknanya tetap "jam berapa sesi mulai", cuma di garis waktu yang sama untuk semua orang.

**Status:** selesai & terbukti. Ekstraksi fitur kini masuk `core/golden.json`
(`feature_cases`, 4 kasus × 28 = 112 pemeriksaan) dan JS == Python **227/227** di
`conformance.py` maupun `conformance.html`. Lihat `SPEC.md` §8–§9.

---

## Urutan perbaikan yang disarankan

Nomor 1 dan 2 murah dan aman dikerjakan kapan saja. Nomor 3 dan 4 ditunda sampai
pustakanya rampung — sesuai rencana: bereskan rumahnya dulu, isinya belakangan.
(F-1 di atas sudah lunas.)

1. **D-2 seragamkan jepitan** ke perilaku A — kecil, memperbaiki sesi pencilan
2. **D-1 seragamkan lantai std** ke perilaku B — perlu generate ulang golden dan jalan
   ulang `reproduce_db.py`, jadi lakukan saat ada waktu memeriksa pergeseran angkanya
3. **Label versi rumus di README**
4. **Ukur ulang + perbaiki rumus SVM**

Setelah tiap perubahan: `python core/conformance.py` dan buka `core/conformance.html`.
Dua-duanya harus tetap **SESUAI** sebelum dianggap selesai.


---

# Pengukuran ulang 2026-09-04 (setelah Mahalanobis)

`python core/drift_check.py`:

```
selisih skor maksimum: 4.201e+00   vonis berbeda: 8/16
KESIMPULAN: primitif BERBEDA
```

Naik dari **0/16 → 8/16** sejak detektor-2 diganti. Arah kesalahannya penting:
beberapa kasus **validasi=HIGH tetapi SDK=LOW** — sesi yang dianggap penyusup oleh
pipeline riset justru **diloloskan** oleh pustaka yang benar-benar dipasang.

**Konsekuensi untuk klaim:** angka FRR/FAR headline berasal dari `reproduce_db.py`
(mesin B). Itu **bukan** angka yang berlaku untuk `sdk/core/*.js` (mesin A). Sampai
D-1/D-2 diseragamkan, setiap angka yang dikutip **wajib menyebut mesinnya**.

Yang belum berubah: D-1 (lantai simpangan baku) dan D-2 (jepitan) masih berbeda —
keduanya tetap di antrean perbaikan, dan sekarang dampaknya terukur jauh lebih besar
dari perkiraan semula.

---

# C-1..C-19 · Celah logika lapisan pertahanan (audit 2026-09-04)

Selisih D-* di atas soal **angka**. Bagian ini soal **logika kontrol keamanan** —
ditemukan lewat penelusuran adversarial, semuanya sudah ditambal dan dikunci uji.

## C-1 · KRITIS — verifikasi ritme gagal-TERBUKA (bypass tempel)

`challenge.js:verify()` mengiterasi panjang **template**, bukan panjang **sample**:

```js
for(let i=0;i<tmpl.dwell.length;i++){
  const d=Math.abs(sample.dwell[i]-tmpl.dwell[i]);  // undefined -> NaN
  if(d > tmpl.k*tmpl.dwellMad[i]) reasons.push(...) // NaN > x === false -> LOLOS
}
```

Sample lebih pendek dari template ⇒ `undefined` ⇒ `NaN` ⇒ perbandingan selalu false
⇒ **nol pelanggaran** ⇒ `ok:true`. Dua jalur nyata:

- **klik kanan → Paste**: nol event ketik → `dwell=[]` → lolos penuh.
- **Ctrl+V**: `'Control'` tersaring, tapi `'v'` lolos filter `key.length===1` →
  hanya 1 dwell terekam, sisanya `undefined` → tetap lolos.

Cek teks (`norm(value)===norm(phrase)`) tidak menolong: penyerang tetap harus tahu
frasanya, tapi begitu tahu, **seluruh lapisan ritme menguap**. Ini jauh di bawah
batas yang sudah diakui di `mfa.js` (“attacker yang menguasai browser”) — ini tidak
butuh perkakas apa pun.

**Tambalan:** `verify()` kini gagal-TERTUTUP — panjang & finitness sample wajib cocok
template; anggaran meleset proporsional (12% dari jumlah pemeriksaan) menggantikan
angka tetap `<=2`; MAD dijepit lantai+langit-langit; frasa < 8 titik ukur ditolak.
`mfa.js` memblokir `paste`/`drop`/`cut`, mengabaikan penekanan bermodifier, dan
menolak sampel yang tidak utuh **sebelum** memanggil `verify()`.
Dikunci: `core/challenge.test.mjs` (20 uji).

## C-2 · KRITIS — penyusup bisa MENDAFTARKAN template MFA-nya sendiri

`_maybeMfa()` memanggil `runMfaChallenge({template: this.challengeTemplate})`. Di
perangkat baru storage kosong ⇒ `challengeTemplate` null ⇒ **mode DAFTAR**. Alurnya:

1. Penyusup buka akun di perangkat baru → perilaku menyimpang → vonis HIGH.
2. Popup muncul dalam mode daftar → penyusup mengetik frasa 3× dengan ritme **miliknya**.
3. `res.passed===true` → `action='MFA_PASSED'`, `_highRun=0`, `mfaVerified=true`.
4. Sesi itu masuk kolam latih → model belajar perilaku penyusup.

Frasa default (`'kunci rahasia saya'`) ada di `config.js` — publik. Ini rantai ATO utuh
yang justru memakai lapisan pertahanan sebagai jalan masuk.

**Tambalan:** pendaftaran tidak pernah terjadi saat sesi dicurigai. Tanpa template,
`_maybeMfa` gagal-tertutup (`mfa.unavailable`) dan aksi risiko tetap berlaku.
Pendaftaran dipindah ke `_maybeEnrollMfa()` — hanya pada vonis **LOW** yang layak
dengan model sudah terbentuk.

## C-3 · Pendaftaran dianggap bukti identitas + lantai lengket tak pernah bersih

`res.passed` bernilai true untuk mode daftar **dan** verifikasi. Sekarang hanya
`res.verified` (verifikasi sungguhan) yang membuktikan identitas. Selain itu, MFA lolos
dulu mereset `_highRun` tapi **tidak** `lastRisk` — lantai lengket terus memaksa vonis
HIGH di sesi berikutnya, memunculkan popup berulang tanpa akhir. Kini ikut direset.

## C-4 · Blokir rate-limit tidak pernah sampai ke integrator

Jalur `checkCollect` gagal me-`return` tanpa memanggil `onRisk`, padahal jalur
integrity memanggilnya. Integrator tidak pernah tahu sesi diblokir. Kini konsisten.

## C-5 · Skor tidak finit gagal-TERBUKA jadi LOW

`toRisk()` memakai `score <= thr`; untuk `NaN` itu **selalu false** ⇒ jatuh ke `LOW`.
Model/statistik rusak karena itu dibaca sebagai “aman”. Kini `!Number.isFinite(score)`
ditangani eksplisit sebagai anomali (`degraded:true`), tidak ikut melatih.

## C-6 · Skor dipalsukan agar cocok dengan level yang dipaksa

`score=Math.min(score,-0.9)` menimpa skor asli saat lantai lengket aktif. Karena ambang
dikalibrasi per-pengguna (`low` bisa −3.5), −0.9 justru sering masuk pita LOW ⇒ `level`
dan `score` **saling bertentangan**, dan angka palsu itu tersimpan ke sesi serta terkirim
ke log cloud. Kini skor asli dipertahankan; kenaikan level ditandai `stickyFloor:true`
dan vonis mentah model ikut dilaporkan (`modelLevel`/`modelScore`).

## C-7 · `clear()` membocorkan template antar-pengguna

`clear()` tidak mereset `challengeTemplate`, `_highRun`, `_mfaPassedAt`. Template
pengguna lama tetap dipakai memverifikasi pengguna berikutnya di tab yang sama.

## C-8 · Fallback bobot Ensemble memakai konfigurasi lama

`new Ensemble(...)` tanpa `weights` memakai `{IF 0.7, SVM 0.3}` — **kebalikan** dari
`DEFAULTS` (`IF 0.30 / detektor-2 0.70`), yaitu konfigurasi W7 lama yang lebih buruk.
Kini mengambil `DEFAULTS.weights`.

## C-9 · Orkestrator extension adalah salinan tangan yang basi

`tools/sync_core.ps1` menyinkronkan `sdk/core/*` dan `storage.js`, **tapi tidak**
`behaviorguard.js`. `extension/behaviorguard.js` terbukti identik dengan versi lama —
artinya seluruh perbaikan C-1..C-8 tidak akan pernah sampai ke extension. Skrip sync
kini mencakup orkestrator dan memverifikasinya.

## C-10 · `storage.del()` melempar error tak tertangkap

Berbeda dari `idbGet`/`idbSet`, `del()` memanggil `db.transaction()` langsung di dalam
`onsuccess` **tanpa** `onupgradeneeded` dan **tanpa** cek `objectStoreNames.contains`.
`try/catch` di sekelilingnya bersifat sinkron sehingga tidak bisa menangkap lemparan di
callback async itu. Akibatnya `NotFoundError: ... object stores was not found` muncul
sebagai error tak tertangkap saat store belum pernah dibuat (mis. `clear()` di profil
baru) — melanggar janji "tidak pernah crash" yang ditulis di kepala berkas itu sendiri.
Ditemukan dari konsol browser saat menguji C-7, bukan dari pembacaan kode.

**Tambalan:** `idbDel()` dibuat sebentuk dengan `idbGet`/`idbSet` (buat store bila perlu,
cek keberadaan, resolusi via `tx.oncomplete`/`onerror`, tak pernah melempar).
Terverifikasi di browser: `del` pada store kosong tidak melempar, dan nol
`unhandledrejection`.

## C-11 · Knob `mfa` didokumentasikan tapi tidak pernah ada

`init()` tidak menerima opsi `mfa` sama sekali, dan auto-boot hanya meneruskan
`['weights','baseline','retrainEvery','features','thresholds']`. Jadi
`window.BehaviorGuardConfig = { mfa:{ enabled:false } }` **diabaikan diam-diam** —
integrator yang ingin menangani step-up sendiri tetap mendapat popup bawaan, tanpa
pesan kesalahan apa pun. Kini `mfa` diterima dan **digabung** (bukan ditimpa) dengan
default, sehingga konfigurasi parsial tetap mewarisi sisanya. Terverifikasi di browser.

## C-12 · Attack simulator mati total

`demo/attack_sim.html` memakai `bg._instance`, padahal ekspor default modul itu
**sudah** singleton-nya (`_instance` hanya ada di `window.BehaviorGuard`). `init()`
melempar di tingkat modul, sehingga `window.run` di bawahnya tidak pernah terpasang dan
keempat tombol serangan diam tanpa jejak di UI. Demo unggulan untuk Arsenal yang tidak
bisa diklik. Diperbaiki jadi `bg._instance || bg`, plus `mfa:{enabled:false}` supaya
simulator otomatis tidak memunculkan popup.

## C-13 · Data seed pemilik ditolak oleh integrity-nya sendiri

`seedOwner()` menaruh `FORM_BLUR` (base+1500) sebagai event **terakhir** padahal mouse
move berjalan sampai base+3570. Integrity menghitung durasi dari `ts[akhir]-ts[0]` = 1,5 s,
jadi 130 event terbaca **87/s** (di atas ambang 80/s) sekaligus non-monoton. Akibatnya
**setiap** sesi pemilik ditandai integrity, `eligible=false`, kolam latih tidak pernah
terisi, model tidak pernah terbentuk — sehingga ketiga vonis HIGH pada simulator
sebetulnya berasal dari heuristik bot, **bukan dari model perilaku**, dan mimicry jatuh ke
jalur enrollment lalu dilaporkan LOW. Demo yang tidak pernah menjalankan mesinnya sendiri.
Diperbaiki: rentang waktu manusiawi (~24 s/sesi), jitter per-event, dan pengurutan
timestamp wajib. Sekarang 24/24 sesi layak dan model terbentuk.

## C-14 · Simulator menyeed tepat di angka yang mematikan detektor utama

Setelah C-13, seed 10 sesi masih berada **di bawah** `ensembleMinSamples.svm = 20`,
sehingga detektor-2 (bobot 0.70) tergerbang mati dan mimicry hanya dilawan Isolation
Forest sendirian. Seed dinaikkan ke 24 dan status gerbang kini dicetak di log demo.

## C-15 · KRITIS — konvergensi membekukan model SEBELUM gerbang ensemble terbuka

Yang terpenting dari sesi ini, dan ditemukan hanya karena C-12/C-13 diperbaiki lebih dulu.

`ensembleMinSamples.svm = 20` sedangkan `baseline = 10`. Bobot gerbang dibekukan ke
`model.n` pada rebuild terakhir. Aturan konvergensi menghentikan retrain begitu ada 6 vonis
LOW berturut-turut — yang untuk pengguna dengan 10 sesi awal konsisten terjadi **sebelum**
kolam mencapai 20. Setelah itu `_rebuildModel()` tidak pernah dipanggil lagi, sehingga:

> **detektor Mahalanobis — yang memikul 70% bobot — tidak pernah aktif seumur hidup
> pengguna itu.** Sistem berjalan dengan Isolation Forest sendirian, persis konfigurasi
> yang terukur jauh lebih lemah.

Terlihat empiris di simulator setelah C-13/C-14:

```
ukuran kolam latih : 24        <- sudah >= 20
model.n            : 10        <- beku
bobot tergerbang   : { isolation_forest: 1, svm: 0 }
skor mentah detektor-2 : -1811   (z terjepit -6, "penyusup" sejelas mungkin)
skor ensemble akhir    : -2.999  (hanya zIF)
ambang low             : -3.300
vonis                  : LOW     <- penyusup lolos
```

**Tambalan:** menyeberangi ambang gerbang adalah perubahan **struktur** model, bukan
adaptasi ke data baru, jadi konvergensi tidak boleh memblokirnya. `_ingestVector` kini
me-rebuild ketika `model.n < ensembleMinSamples.svm` sementara kolam sudah `>=` ambang,
apa pun status konvergensinya, dan menandai `evt.gateReopened`.

**Sesudah:** `model.n = 20`, bobot `{IF 0.30, svm 0.70}`, dan keempat vektor serangan
divonis HIGH — mimicry lewat `[ensemble]`, bukan lagi lewat heuristik. Bar yang ditulis
simulator itu sendiri ("SDK harus HIGH untuk semua") akhirnya terpenuhi.

Dikunci: `core/ensemble.test.mjs` (11 uji) memaku semantik gerbang; perilaku orkestrator
diuji ujung-ke-ujung lewat `demo/attack_sim.html`.

**Catatan untuk angka yang dipublikasikan:** evaluasi held-out di `tools/experiment.py`
membangun ulang model lewat jalurnya sendiri dan tidak melewati `_ingestVector`, sehingga
FRR 16.1% / FAR 5.4% **tidak terpengaruh** bug ini. Yang terpengaruh adalah pustaka yang
benar-benar berjalan di perangkat — persis jenis selisih yang menjadi alasan `DRIFT.md` ada.

## C-16 · KRITIS — sesi manusia diblokir sebagai bot ("velocity konstan")

Ditemukan hanya lewat **uji live sungguhan**. Semua audit sebelumnya memakai
`scoreExternalEvents` dengan event sintetis, yang **melewati `capture.js` sepenuhnya** —
jadi seluruh jalur yang benar-benar dipakai di situs orang belum pernah diuji sama sekali.

`capture.js` tidak pernah mengisi field `velocity` pada `MOUSE_MOVE`, tetapi
`integrity.js` membacanya:

```js
const vels = evs.filter(e=>e.x!=null).map(e=>e.velocity||0);   // selalu 0
if(vs < 0.01) reasons.push('velocity konstan');                // selalu terpicu
```

Setiap nilai runtuh ke 0 → simpangan baku 0 → sesi ditandai bot → `BLOCK_SESSION`.
Terpicu pada sesi yang keystroke+klik-nya kurang dari 10, yaitu sesi yang isinya
kebanyakan **gerak mouse** — persis perilaku pengunjung yang menelusuri halaman tanpa
banyak mengetik. Pada uji live, **2 dari 4 sesi manusia pertama diblokir**.

## C-17 · Satu dari 28 fitur mati di produksi

Akar yang sama. `features.js` §8.4 menghitung
`idle = |{e ∈ MOUSE_MOVE : (e.velocity || 0) < 0.5}|`. Tanpa field itu, **semua** gerakan
terhitung diam, sehingga `cursor_idle_ratio` terkunci di **1,0** selamanya. Terukur di
browser: 40 gerakan → `cursor_idle_ratio = 1`, `yangPunyaFieldVelocity = 0`.

Yang membuatnya serius: di basis data riset fitur ini **bervariasi** (server menghitung
velocity), jadi model dilatih dengan fitur hidup lalu dipakai dengan fitur mati —
ketidakcocokan latih-vs-pakai yang permanen dan tak terlihat dari angka held-out mana pun.

**Tambalan C-16+C-17:** `capture.js` menghitung `velocity` (piksel/milidetik) dari pasangan
gerakan berurutan; `integrity.js` hanya menilai event yang benar-benar membawa velocity.
Sesudah: velocity terisi 40/40, `cursor_idle_ratio` 1,0 → **0,875**, dan "velocity konstan"
tidak muncul lagi. Dikunci: `core/integrity.test.mjs` (10 uji), masuk CI.

## C-18 · KRITIS — popup step-up yang diabaikan mematikan seluruh lapisan MFA

`runMfaChallenge` mengembalikan Promise yang **hanya** selesai kalau pengguna menekan
tombol. Tanpa batas waktu:

1. `_ingestVector` menunggunya → **`endSession()` tidak pernah selesai**. Integrator yang
   menulis `await bg.endSession()` menggantung tanpa batas.
2. `finally { this._mfaBusy = false }` tidak pernah dijalankan → `_mfaBusy` tetap `true`
   → **setiap step-up berikutnya di halaman itu dilewati diam-diam**. Satu popup terlantar
   mematikan MFA untuk sisa hidup halaman.

Terlihat di uji live: popup pendaftaran muncul di sesi 11, panggilan uji timeout di 45 detik,
dan sesudahnya `mfaBusy:true` dengan popup masih menggantung di DOM.

**Tambalan:**
- `runMfaChallenge` menerima `timeoutMs` (default 120 dtk verifikasi / 60 dtk pendaftaran);
  saat habis, overlay dibuang dan Promise selesai `{cancelled:true, timedOut:true}`.
- **Pendaftaran template tidak lagi ditunggu** oleh jalur vonis. Itu prompt penyiapan di
  sesi LOW yang tenang, bukan bagian dari vonis. Verifikasi tetap ditunggu, karena vonisnya
  memang bergantung pada hasilnya.

Sesudah: sesi 11 memberi vonis nyata dan `endSession()` selesai dalam **3 ms** meskipun
popup pendaftaran sedang terbuka; popup uji dengan `timeoutMs:1500` menutup sendiri di
1.935 ms dengan `{timedOut:true}`.

---

## Catatan metodologi: kenapa C-16..C-18 lolos dari 15 audit sebelumnya

Semuanya karena satu kebiasaan uji yang salah. C-1..C-15 diverifikasi lewat
`scoreExternalEvents(events)` — yang menerima event **buatan** dan **melewati `capture.js`**.
Artinya seluruh jalur produksi (DOM → capture → fitur → vonis → popup) tidak pernah
dijalankan sekali pun, dan tiga bug yang hanya hidup di jalur itu tetap tak terlihat
meskipun conformance 227/227, uji step-up 20/20, dan uji gerbang 11/11 semuanya hijau.

**Aturan baru:** setiap perubahan pada `capture.js`, `mfa.js`, atau orkestrator wajib
diuji lewat halaman nyata dengan event DOM, bukan lewat `scoreExternalEvents`.

Dua jebakan harness yang sempat menghasilkan temuan palsu dan perlu diingat:
- **Aksi `type` otomatis memakai `insertText`**, tidak memancarkan `keydown`/`keyup` —
  sempat terbaca sebagai "0 event KEYSTROKE" padahal penangkapannya baik-baik saja.
- **Tab tersembunyi men-throttle `setTimeout` ke ~1/detik**, sehingga 12 detik interaksi
  hanya menghasilkan 18 event dan setiap sesi terlihat gagal gerbang kelayakan. Pakai
  busy-wait (`performance.now()`) untuk pacing saat mengukur.

## C-19 · Pustaka DIAM TOTAL selama seluruh fase pendaftaran

Ditemukan saat menyiapkan demo alur lengkap: daftar akun -> sistem belajar -> dikenali.

Cabang pendaftaran di `_ingestVector` menyusun `enrollEvt` lalu langsung `return` —
**tanpa pernah memanggil `this.onRisk(...)`**. Akibatnya, sepanjang 10 sesi pertama:
tidak ada callback, tidak ada event `behaviorguard:risk`, dan panel bawaan mandek di
"MENGENALI..." tanpa pernah bergerak. Hanya `endSession()` yang mengembalikan nilainya,
sehingga integrasi berbasis event — cara yang justru didokumentasikan di README dan
QUICKSTART — tidak melihat apa pun.

Ini fase yang paling perlu terlihat: pengguna baru mendaftar dan perlu tahu sistemnya
sedang belajar, bukan menggantung. Integrator yang membangun indikator progres tidak
punya sumber data sama sekali.

**Tambalan:** cabang pendaftaran kini memanggil `onRisk` dan menyertakan
`enrollment: { selesai, perlu, siap }` supaya progresnya bisa ditampilkan tanpa
mengurai teks alasan. Panel bawaan diperbarui: menampilkan "MENGENALI 3/10" dengan bar
progres, bukan lagi teks statis.

Terverifikasi di browser: tiga sesi berturut menghasilkan panel 1/10 -> 2/10 -> 3/10
(bar 10% -> 20% -> 30%) dan integrator menerima tiga event.

---

## C-20 · KRITIS — pemilik asli terkunci dari MFA-nya sendiri (FRR ~64%)

Dilaporkan dari pemakaian nyata: "awal sekali MFA works, lama-lama ritme gue sendiri
ga pernah lolos, dan sekarang SEMUA sesi kena MFA." Dipicu setelah orang lain (tempo
lambat) memancing MFA lalu gagal beberapa kali.

Dua cacat yang saling menguatkan:

1. **Template ritme kelewat ketat.** `challenge.js` membandingkan dwell/flight ABSOLUT
   per posisi dengan toleransi `k·MAD`, MAD dilantai `MAD_FLOOR_REL = 0.08` (8% median).
   Pendaftaran 3-ronde yang konsisten menghasilkan MAD kecil → toleransi ~2.5·8%·median.
   Tapi tempo ketik manusia **bergeser serentak antar-sesi** (capek, mood, keyboard lain):
   variasi 12–20% itu wajar dan langsung menembus anggaran meleset. Terukur (simulasi
   jitter Gauss realistis, frasa 18 karakter): FRR pemilik **63.6%** — pemilik ditolak
   pada mayoritas percobaan. FAR tetap 0% (orang lain memang ditolak — itu benar).

2. **Efek domino ke lantai lengket (`lastRisk`).** Lantai hanya bersih ke LOW saat MFA
   `verified`. Karena verify pemilik nyaris tak pernah lolos, lantai tak pernah turun →
   tiap sesi berikutnya dipaksa MEDIUM/HIGH → MFA muncul terus. Satu episode buruk jadi
   MFA permanen. Makin sering gagal → pemilik makin kesal → ritme makin menyimpang →
   spiral. Inilah "semua sesinya MFA".

**Tambalan** (`core/challenge.js`, disalin ke `extension/`, dibundel ke `dist/`):

- **Normalisasi tempo global sebelum banding per-posisi.** Yang membedakan ORANG adalah
  pola RELATIF antar-posisi, bukan kecepatan absolut. Sampel diskalakan dengan rasio
  `median(template)/median(sampel)`, dijepit `[0.5, 2.0]`. Drift pemilik (±20%) terkoreksi
  penuh; sampel bertempo ekstrem (robot / tempel-datar 300 ms) tak bisa diskalakan agar
  cocok sehingga tetap ditolak — pola relatif penyusup tetap kelihatan beda.
- **`MAD_FLOOR_REL` 0.08 → 0.12** — 12% = jitter antar-sesi manusia yang wajar.

Terukur setelah tambalan (harness sama): FRR pemilik **63.6% → ~2%**, FAR (termasuk
penyusup bertempo lambat 1.6×) tetap **~0.2%**. Vektor uji terkunci lama tetap hijau
(pemilik sah lolos, penyusup flat 300/600 ditolak, tempel/NaN/Infinity ditolak).

Dikunci: `core/challenge.test.mjs` +3 uji regresi (pemilik ±18–20% drift → lolos;
penyusup pola relatif beda → ditolak).

Catatan: verify `challenge.js` murni & tanpa state — template TIDAK ternoda oleh
kegagalan orang lain. Ini murni ambang, bukan peracunan; pemulihan otomatis begitu
kode ini terpasang (tak perlu reset). Bila pengguna ingin bersih total setelah pola
kesal menjejak: `BehaviorGuard._instance.clear()` lalu daftar ulang.

---

## C-21 · Event hilang saat pindah halaman + pending sub-ambang dibuang tiap init

Dilaporkan dari pemakaian nyata: "pindah halaman terus-terusan, sesi tak keambil-ambil"
dan "2 sesi pertama tak pernah naik ke MENGENALI 1/10". Dua kebocoran lifecycle di
`behaviorguard.js` (bukan MFA / bukan logika plug-and-play):

1. **`visibilitychange:hidden` men-drain-dan-membuang sebelum `beforeunload` sempat
   menyimpan.** Handler `hidden` memanggil `endSession()` yang `capture.drain()`;
   sesi < `minEventsAssess` (30) di-`return null` → seluruh event dibuang. Saat NAVIGASI
   halaman penuh, `hidden` jalan LEBIH DULU dari `beforeunload`, jadi `beforeunload`
   yang bertugas menyimpan ekor ke `bg:pending` menemukan buffer **kosong**. Terukur di
   browser: 25 event → setelah `hidden`, buffer 0 dan `bg:pending` kosong = HILANG.
2. **Init membuang pending yang belum cukup.** Blok pemulihan `bg:pending` memanggil
   `storage.set('bg:pending', null)` **tanpa syarat** — bahkan saat `chunk` < 30 dan
   belum di-skor. Jadi ekor dari halaman-halaman pendek tak pernah berakumulasi jadi
   sesi utuh; tiap init membuangnya. (Bonus: `storage.set` menulis ke IndexedDB, store
   yang BEDA dari `bg:pending` di localStorage — jadi baris itu memang tak nyambung.)

Akibat gabungan: di situs multi-halaman (mis. `demo/toko-klasik`), menelusuri
halaman-ke-halaman membuang ekor tiap transisi → sesi tak pernah cukup panjang untuk
`minEventsTrain` (100) → pendaftaran mandek di 0/10.

**Tambalan** (`behaviorguard.js`, disalin ke `extension/`, dibundel ke `dist/`):

- `bg:pending` kini AKUMULATOR ekor lintas-halaman via raw localStorage. Handler
  `visibilitychange:hidden` **tidak lagi membuang**: kalau ≥30 → `endSession()`
  (skor); kalau < 30 → `_bankTail()` menyimpan ekor lalu drain.
- `_bankTail()` baru: simpan ≤200 event terakhir ke `bg:pending` (cap 800), lalu drain
  → **idempoten**, jadi `pagehide` + `beforeunload` boleh memanggilnya berkali-kali
  tanpa dobel. `beforeunload`/`pagehide` sekarang bank SINKRON (skor async tak sempat
  flush saat halaman mati).
- Init: kalau pending < 30 → **kembalikan** ke `bg:pending` (tunggu halaman berikut
  menambah); kalau ≥30 → skor satu `chunk` (≤200) lalu simpan SISANYA. Baris
  `storage.set('bg:pending', null)` tanpa syarat dihapus.

Terverifikasi di browser (import ESM segar): `_bankTail` menyimpan 25 event (bukan buang),
idempoten, akumulasi 22→44 lintas "halaman"; init menahan pending 20 (dulu dibuang) dan
mengonsumsi pending 150. Siklus 6-halaman: `bg:pending` berputar 22→44→flush→22 persis
benar (nol event hilang). Catatan: vonis akhir dgn event SINTETIS ketrigger heuristik
bot C-16 (timing terlalu teratur) — pendaftaran dgn event ASLI wajib diuji via DOM nyata
(aturan di bawah). Lihat [[feedback_test_real_path_not_synthetic]].

Terkait, **misconfig demo `lab-akurasi`**: tombol "Akhiri sesi" kebuka di 30 event
(`minEventsAssess`) padahal LAYAK butuh 100 (`minEventsTrain`) → 2 sesi pertama yang
pendek diakhiri, dinilai "tidak layak", panel diam di 0/10. Diperbaiki: tombol dikunci
sampai `minEventsTrain`, teks pencacah ikut ambang itu.

---

## C-22 · KRITIS — pemilik divonis MEDIUM SELAMANYA mulai sesi ~20 (FRR 98%)

Dilaporkan penguji (Kepler) dari pemakaian nyata: "1–10 baseline, 10–20 LOW, 20-seterusnya
MEDIUM" — pemilik sendiri, terus divonis MEDIUM → MFA tiap sesi → (C-20) MFA gagal → macet.
"Sudah gw variasiin biar toleransi idle lebih besar, tetap MFA." Angka **20** kuncinya:
`ensembleMinSamples.svm = 20` = gerbang detektor Mahalanobis (bobot 0.70, dominan).

**Akar (statistik, bukan idle-time):** Mahalanobis nge-fit kovarians **d×d dengan d=28
fitur**, tapi gerbangnya buka di **n=20 sampel**. **n < d** → kovarians *under-determined*
/ overfit: jarak Mahalanobis titik in-sample (data latih) kecil palsu, `svm_stats` (mean/std
skor) dan ambang dikalibrasi dari skor in-sample yang optimistik. Sesi PEMILIK baru
(out-of-sample) jaraknya jauh lebih besar → `zSVM` sangat negatif → skor ensembel nyemplung
di bawah ambang → MEDIUM. Karena `progressiveMaxPool=30` (kolam maks base10+30 = 40 ≈ 1.4d),
kondisi ini **tak pernah pulih** — FRR mentok ~45% bahkan di kolam penuh.

Terukur (kode model asli, `_rebuildModel`+`scoreVector`, distribusi pemilik Gauss 28-dim,
simulasi — bukan data riset): FRR pemilik out-of-sample per ukuran kolam:

| kolam | 15/19 (gerbang tutup) | 20 | 25 | 30 | 40 | 60 | 90/100 |
|---|---|---|---|---|---|---|---|
| **sebelum** | 0% | **98.6%** | 92% | 85% | 45% | 14% | 6% |
| **sesudah** | 0% | **9.0%** | 4.8% | 6.5% | 5.0% | 5.5% | 2.3% |

FAR (penyusup jelas-beda ≥1.5σ) tetap ~0% di kedua kasus.

Kenapa "10–20 LOW" lalu "20+ MEDIUM": di bawah 20, gerbang Maha TUTUP → Isolation Forest
sendirian (lunak, menggeneralisasi) → LOW. Di 20, gerbang BUKA → Maha overfit dominan → MEDIUM.
Ini kebalikan C-15 (dulu gerbang beku TERTUTUP selamanya); memperbaiki C-15 justru memunculkan
C-22 karena gerbang akhirnya benar-benar terbuka — di jumlah sampel yang masih < dimensi.

**Tambalan** (hanya jalur LIVE `behaviorguard.js._rebuildModel` + `config.js`; **golden/
conformance TIDAK tersentuh** karena keduanya nge-fit Maha via `cfg.mahalanobis.shrink` tetap
langsung, bukan lewat orchestrator — dikonfirmasi Python 227/227 & JS 227/227 tetap SESUAI):

- **Shrinkage ADAPTIF** terhadap rasio sampel/dimensi: `shrink = clamp(0.3, 0.9, d/n)`.
  Saat n<d, shrink berat menarik kovarians ke Euclidean-terstandardisasi (aman, tak overfit);
  meluruh ke dasar 0.3 saat n≥~3d → korelasi penuh kelas riset kembali.
- **`progressiveMaxPool` 30→90** supaya kolam bisa tumbuh, shrink meluruh, dan deteksi
  penyusup-mirip membaik seiring pemakaian.

**Batas yang WAJIB dijujurkan (threat model):** dengan sampel < ~2d, korelasi antar-fitur
tak bisa diestimasi, jadi penyusup yang SANGAT mirip pemilik (< ~1σ) belum tertangkap andal
sampai kolam pemilik cukup besar. Ini inheren pada belajar on-device few-shot; baseline lama
*pura-pura* bisa (full covariance) dan justru itu yang mengunci pemilik. Deteksi menguat saat
data pemilik bertambah.

**Kopling tiga bug:** C-22 (pemilik tak lagi keliru MEDIUM) + C-20 (MFA pemilik akhirnya lolos)
+ sifat lantai-lengket (`lastRisk` hanya bersih saat MFA `verified`) — ketiganya harus benar
bareng; kalau salah satu bocor, satu episode buruk jadi MFA permanen (spiral yang dilaporkan
Kepler). C-21 memastikan sesinya kekumpul dari awal supaya kolam tumbuh sehat.

Diverifikasi 2026-09-07 di browser: end-to-end `_rebuildModel`+`scoreVector` (tabel di atas),
plus 4 suite hijau (JS conformance 227/227, step-up 23/23, gerbang 11/11, integrity 10/10).

---

## C-23 · Waktu idle ikut terukur sebagai perilaku (+ jendela ambil-alih sesi)

**Dilaporkan oleh dosen pembimbing, 2026-09-09.** "Kalau idle-nya kan bisa aja dia buka
terus ditinggal melakukan sesuatu." Benar, dan akibatnya ada **dua**, bukan satu.

**Akibat 1 — pengukuran (FRR).** Fitur F4 dihitung dari selisih antar-event dan dari
`duration = ts_akhir − ts_awal`. Jeda mati ikut masuk seolah-olah ia perilaku. Terukur
(`core/idle.test.mjs`, satu rentetan 40 event, ditinggal 12 menit di tengah):

| Fitur | Melintasi jeda (lama) | Per segmen (baru) | Faktor |
|---|---|---|---|
| `temporal_session_duration` | 731,2 dtk | 5,5 dtk | 133× |
| `mouse_click_interval_mean` | 48.708 ms | 710 ms | 69× |
| `keystroke_flight_time_mean` | 34.797 ms | 509 ms | 68× |
| `keystroke_typing_speed` | 0,030 | 1,998 | 67× |

Empat dari 28 fitur meleset satu-dua orde besaran — dan bukan derau acak, melainkan bias
searah. Basis data riset berisi sesi berbasis-tugas yang PADAT, jadi ini ketidakcocokan
**latih-vs-pakai** yang sistematis: kelas cacat yang sama dengan C-16/C-17, hanya sumbernya
waktu, bukan field yang kosong. Pemilik yang sekadar meninggalkan tab dinilai menyimpang.

**Akibat 2 — keamanan (FAR).** Sisi sebaliknya, dan justru yang lebih berbahaya: selama
kursi kosong, sesi itu **sudah terautentikasi**. Siapa pun yang duduk sesudahnya mewarisi
sesi yang sah ("serangan jam makan siang"). Karena penyusupnya tidak melewati login,
satu-satunya sinyal yang tersedia adalah adanya absen panjang di tengah sesi — persis
sinyal yang dulu dibuang. Menghapus idle demi FRR saja justru **memperlebar** lubang ini.

**Akibat 3 — diam dibaca aman.** `endSession()` dulu mengembalikan `null` tanpa jejak untuk
buffer < 30 event. Integrator yang menunggu callback tidak bisa membedakan "sudah diperiksa,
aman" dari "tak ada bukti sama sekali", dan default diam selalu jatuh ke sisi mempercayai.

**Tambalan (tiga lapis, `sdk/core/idle.js` + orkestrator):**

1. **Segmentasi.** Aliran event dipecah pada tiap jeda ≥ `session.idleGapSec` (30 dtk =
   satu jendela penilaian). Tiap segmen kontigu dinilai SENDIRI. Rumus fitur di
   `core/SPEC.md` **tidak disentuh** — yang berubah hanya apa yang disuapkan ke
   `extractF4`. Karena itu golden dan keempat port tetap 227/227 tanpa diubah.
2. **Dua ambang, dua akibat.** `idle.awaySec` (5 mnt) = batas "kursi mungkin kosong":
   streak LOW direset, kepercayaan dari sebelum absen tidak menyeberang.
   `idle.reverifyAfterSec` (15 mnt, sejajar batas idle-timeout PCI DSS 8.2.8) = LOW
   dinaikkan jadi MEDIUM supaya step-up jalan sekali. Sengaja dipisah: 5 menit cukup untuk
   berhenti mengukur melintas, tapi belum cukup untuk mengganggu pengguna.
3. **ABSTAIN.** Jendela tanpa bukti menerbitkan vonis `UNKNOWN` / aksi `ABSTAIN` **sekali**
   per rentetan idle (bukan tiap jendela, supaya tab yang ditinggal semalaman tidak
   membanjiri log). Sistem boleh bilang "saya tidak tahu" alih-alih menebak.

**Bonus dari lapis 1:** ekor buffer yang masih hidup kini DIKEMBALIKAN ke buffer, bukan
dibuang tiap 30 detik. Pengguna yang menelusuri pelan-pelan akhirnya terkumpul jadi sesi.

**Batas yang wajib dijujurkan.** Segmentasi menghapus jeda dari pengukuran, tapi ia tidak
bisa membedakan *ditinggal* dari *membaca tanpa menyentuh apa pun* — keduanya sama-sama
sunyi di lapisan DOM. Itulah kenapa jawabannya bukan menebak, melainkan ABSTAIN + verifikasi
ulang pada absen panjang. Ambang 30/300/900 dtk adalah pilihan rekayasa, belum dituning
terhadap data lapangan; ketiganya dibuka sebagai knob `init({session, idle})`.

**Uji:** `core/idle.test.mjs` 33/33 (modul + bukti angka di tabel atas),
`core/idle.live.test.mjs` 20/20 (jalur penuh orkestrator: dua vonis dari satu batch bergap,
`resumedAfterAway`, LOW→MEDIUM, ABSTAIN). Usulan lengkap + kasus sejenis:
`docs/USULAN-KONTEKS-DAN-IDLE.md`.

---

## C-24 · Panjang sesi yang berubah terbaca sebagai identitas yang berubah

**Ditemukan saat mengukur C-23, bukan dilaporkan.** Ablasi C-23 memakai lengan KONTROL —
sesi bersih yang dipotong di titik yang sama, tanpa jeda apa pun. Kontrol itu yang
membongkarnya: |z| fitur-cacah naik **0,96 → 2,02** hanya karena sesinya lebih pendek.
Tanpa lengan kontrol, kenaikan itu akan salah dibaca sebagai ongkos segmentasi C-23.

**Akar.** Sembilan dari 28 fitur adalah **hitungan mentah** — `mouse_direction_changes`,
`mouse_pause_count`, `keystroke_burst_count`, `temporal_activity_bursts`, `nav_page_count`,
`nav_step_transition_count`, `form_focus_count`, `form_blur_count`, `cart_action_count` —
yang ikut membesar bersama panjang sesi. Akibatnya **setiap** perubahan panjang sesi
terbaca sebagai perubahan identitas. Ini lebih tua dari idle dan menyentuh hampir semua
kasus di `docs/USULAN-KONTEKS-DAN-IDLE.md` §4 yang mengubah panjang sesi.

**Dua jalan, dan kenapa yang kedua dipilih.**
(a) Ubah rumusnya jadi laju (`cacah / durasi_aktif`) → SPEC v1.3, regenerasi golden,
sinkron empat port, dan **semua angka lama kehilangan reprodusibilitasnya**.
(b) Buat panjangnya KONSTAN, sehingga cacahan otomatis sebanding → **nol baris rumus
fitur yang berubah**. Dipilih (b), alasan yang sama dengan C-23: perbaikan ditaruh di
lapisan sesionisasi, bukan lapisan fitur.

Di bawah jendela kanonik, cacahan berubah makna jadi **komposisi** ("dari K event, berapa
yang klik") dan `temporal_session_duration` jadi **kecepatan** ("berapa lama menghasilkan
K event") — keduanya justru lebih biometrik daripada "sesinya kebetulan sepanjang apa".
Syarat mutlak: dipakai di **pendaftaran DAN penilaian**, kalau tidak kita cuma menukar
satu ketidakcocokan latih-vs-pakai dengan yang lain.

**Tiga knob, SEMUANYA default mati** (`session.canonicalWindow: 0`, `aggregateWindows: 1`,
`calibrationHoldout: 0`) sehingga jalur lama tak tersentuh dan angka headline tetap sah.

**Terukur** (`tools/idle_ablation.py --canonical 120`, 19 subjek, 482.203 event mentah;
rata-rata |z| terhadap baseline pemilik):

| Lengan | fitur-WAKTU | fitur-CACAH | fitur-BENTUK |
|---|---:|---:|---:|
| Bersih, sesi utuh | 0,83 | 1,00 | 1,90 |
| Kontrol: dipotong saja | 0,84 | **1,01** | 1,90 |
| Bergap, tanpa segmentasi | 8,41 | 1,00 | 1,91 |
| Bergap + segmentasi (C-23) | 0,84 | **1,00** | 1,89 |

Bandingkan dengan tabel C-23 (tanpa kanonikalisasi): kolom fitur-CACAH di sana 0,95 vs
**2,02**. Di sini keempat lengan berhimpit di 1,00 — **invariansi pulih penuh**. Kolom
fitur-WAKTU membuktikan keduanya diperlukan: kanonikalisasi sendirian tidak menyembuhkan
idle (8,41), segmentasi sendirian tidak menyembuhkan panjang sesi.

**Agregasi bukti.** Jendela yang lebih pendek berarti bukti lebih sedikit per vonis.
Jawabannya bukan melonggarkan ambang — itu memindahkan kesalahan ke sisi FAR — melainkan
menunda vonis sampai M jendela terkumpul lalu memvonis rata-ratanya. Yang ditukar
**latensi dengan keyakinan**, bukan FRR dengan FAR:

| M | AUC | FAR | catatan |
|---:|---:|---:|---|
| 1 | 0,770 | 25,0% | vonis per jendela |
| 2 | 0,789 | 16,9% | |
| 3 | 0,808 | 12,9% | |
| 5 | 0,829 | 9,4% | |

Jalan pintas yang menggoda — rapatkan ambang sebesar `std/sqrt(M)` — **salah, dan salahnya
searah**: jendela berurutan dari sesi yang sama berkorelasi, jadi sebaran nyatanya lebih
lebar dan ambangnya jadi terlalu rapat. Diuji: koreksi analitik itu meninggalkan FRR di
46,5%. Yang benar adalah mengagregasi skor LATIH dengan cara yang persis sama lalu
mengkalibrasi di atasnya, sehingga korelasinya ikut terbawa tanpa perlu diasumsikan.

**Kalibrasi ambang di luar sampel.** Ternyata sisa FRR bukan soal korelasi, melainkan
`_rebuildModel` mengkalibrasi ambang dari skor vektor yang **persis dipakai memfit**
detektor. Skor in-sample selalu optimistik, ambang jadi terlalu rapat, dan sesi pemilik
berikutnya jatuh di luarnya — **mekanisme yang sama persis dengan C-22**, satu lapis lebih
tinggi. Menyisihkan 30% kolam khusus untuk kalibrasi: **FRR 46,5% → 27,8%, EER 32,9% →
28,6%** (AUC tetap, karena kalibrasi menggeser titik operasi, bukan daya pisah).

**Yang WAJIB dijujurkan.** Ketiga knob terbukti **arahnya**, bukan **titik operasinya**.
Pada harness ablasi, EER kanonik (~28–33%) masih jauh di bawah EER 11,9% protokol
sesi-utuh yang dilaporkan `config.js`. Sebagian karena harness ablasi memang longgar
(lihat catatan batas di skripnya), sebagian karena jendela 120 event memang membawa bukti
lebih sedikit daripada sesi ~600 event. **Karena itu ketiganya default mati.** Sebelum
angkanya dikutip di skripsi, jalankan ulang dengan protokol held-out `reproduce_db.py`.

Pertukaran yang sebenarnya: kanonikalisasi menukar **daya pisah puncak** dengan
**invariansi**. Perhatikan lengan bersih tanpa kanonikalisasi AUC 0,810, tapi begitu
panjang sesinya berubah ia jatuh ke 0,636; dengan kanonikalisasi ia bertahan di
0,742–0,746 di SEMUA lengan. Dan karena di produksi sesi memang berupa jendela 30 detik —
tidak pernah sesi riset utuh — rezim yang invarian itulah yang cocok dengan penyebaran.

**Uji:** `core/invariance.test.mjs` 26/26, dengan uji pertama mengunci bahwa default
tidak mengubah apa pun. Bukti invariansi di sana: pergeseran fitur-cacah akibat masukan
500 vs 260 event turun dari **117,0 → 1,0**.

---

## Validasi held-out untuk C-23 dan C-24 - VONIS AKHIR (5 belahan)

> **Riwayat koreksi.** Versi pertama bagian ini mengklaim C-23 melampaui kontrol
> (AUC 0,907 -> 0,941). Klaim itu **ditarik**: ia berbalik begitu grid `q` dilebarkan,
> lalu berbalik lagi begitu kalibrasi dipindah ke luar sampel - tiga konfigurasi
> protokol, tiga jawaban, untuk perubahan kode yang persis sama. Sebabnya ditelusuri
> ke tiga cacat protokol (di bawah), ketiganya kini diperbaiki, dan hasilnya diulang
> atas **5 belahan 8/8** dengan grid `q` yang sama untuk semua lengan. Bagian ini
> melaporkan hasil yang diperbaiki itu. **Ia negatif untuk C-23.**

### Cacat protokol yang diperbaiki

1. **`q` mentok di pinggir grid.** Di jalankan awal SEMUA kondisi memilih 0,10 - nilai
   terkecil yang tersedia. Tuner ingin lebih longgar tapi tak diberi pilihan, jadi tiap
   lengan dinilai pada titik operasi yang bukan pilihannya sendiri. **Inilah sumber FRR
   50-60% yang bikin panik itu - artefak penempatan ambang, bukan kegagalan sistem.**
   Grid dilebarkan ke [0,01 .. 0,15]; FRR kontrol turun 35,5% -> 23,0%.
2. **`q` ikut memilih data latih.** Kolam hanya bertambah dari sesi yang divonis LOW,
   jadi mengubah `q` mengubah kolam, sehingga mengubah model. Dua nilai `q` bukan dua
   titik pada satu kurva; itu dua model. Karena itu grid harus **sama untuk semua lengan**.
3. **Satu belahan tidak punya sebaran.** FOLD-REPORT hanya 8 subjek. Kini 5 belahan
   (benih 42/7/13/2026/99) dan **[min..maks] dilaporkan**, bukan satu bilangan.

### Hasil, 5 belahan, grid `q` bersama

| Kondisi | FRR | FAR | AUC | EER | FAR@FRR15 |
|---|---:|---:|---:|---:|---:|
| 1. utuh, tanpa AFK (kontrol) | 23,0% | 2,0% | **0,946** | **10,4%** | **4,1%** |
| 2. utuh, dengan AFK | **32,8%** | 1,3% | 0,938 | 10,7% | 5,7% |
| 3. + segmentasi C-23 @30 dtk, dgn AFK | 35,3% | 2,8% | 0,905 | 16,1% | 17,4% |
| 4. + segmentasi C-23 @120 dtk, dgn AFK | 39,9% | 2,0% | 0,903 | 15,9% | 17,7% |
| 5. + segmentasi C-23 @300 dtk, dgn AFK | 42,3% | 2,4% | 0,907 | 13,9% | 12,2% |

Rentang EER: kontrol [9..12], AFK [8..13], C-23@30 **[14..19]**, @120 [14..19], @300 [12..16].

### Tiga temuan

**(a) Kerusakan idle nyata, tapi muncul di FRR - BUKAN di AUC.** Baris 2 vs 1: FRR
23,0% -> 32,8% (+9,8 poin), sementara AUC nyaris tak bergerak (0,946 -> 0,938) dan EER
tetap (~10,5%). Mekanismenya: jeda AFK disuntikkan ke sesi evaluasi **pemilik maupun
penyusup**, jadi distorsinya searah untuk keduanya - **peringkat lestari, kalibrasi
bergeser.** AUC adalah metrik peringkat, jadi ia **buta** terhadap mode kegagalan ini.
Ini sendiri layak masuk skripsi: melaporkan AUC saja akan menyembunyikan keluhan
pembimbing sepenuhnya. Koreksi: klaim lama "kerusakan idle terkonfirmasi lewat AUC
0,907 -> 0,874" **tidak bertahan**; yang bertahan adalah kerusakan di FRR.

**(b) Segmentasi C-23 tidak memperbaikinya, dan merusak daya pisah.** Baris 3 vs 2: FRR
tidak turun (35,3%), dan EER 10,7% -> 16,1% dengan FAR@FRR15 5,7% -> 17,4%. Rentang EER
C-23 [14..19] **tidak beririsan** dengan kontrol [9..12] maupun dengan lengan AFK [8..13]
di kelima belahan. Ini negatif yang konsisten, bukan derau.

**(c) Hipotesis "ambang 30 detik terlalu agresif" DITOLAK.** Dugaannya: memotong tiap
jeda 30 detik ikut mencincang jeda berpikir biasa, jadi C-23 membayar ongkos "sesi lebih
pendek" yang sama seperti C-24. Kalau benar, melonggarkan ambang seharusnya menolong.
Ia **tidak**: 30 -> 120 -> 300 detik justru memperburuk FRR secara monoton
(35,3% -> 39,9% -> 42,3%) sementara AUC diam di ~0,905. EER membaik sedikit di 300 detik
(13,9%) tapi tetap di luar rentang kontrol. Jadi kerugiannya **bukan** soal panjang
segmen, dan melonggarkan ambang bukan jalan keluarnya.

### Apa yang boleh dan tidak boleh diklaim

**BOLEH** (mekanis, tak bergantung protokol, `core/idle.test.mjs`): jeda 12 menit tidak
boleh masuk `mouse_click_interval_mean`. Segmentasi memulihkan `temporal_session_duration`
731,2 -> 5,5 dtk, interval klik 48.708 -> 710 ms, |z| fitur-waktu 12,42 -> 1,14. Itu
**koreksi kebenaran pengukuran** dan ia berdiri sendiri.

**BOLEH**: kerusakan idle nyata di titik operasi yang sah, terlihat di FRR (+9,8 poin).

**TIDAK BOLEH**: bahwa segmentasi C-23 memperbaiki FRR/FAR. Buktinya sekarang justru
**sebaliknya**, konsisten di 5 belahan dan 3 ambang jeda. Ini **hasil negatif** dan
dilaporkan apa adanya.

**BELUM TERUJI**: lapisan kedua dan ketiga C-23 - pelacakan kehadiran (`awaySec`,
`reverifyAfterSec`) dan ABSTAIN. Keduanya **mekanisme keamanan**, bukan perubahan
penilaian, jadi tolok ukur ini secara struktural tidak bisa mengukurnya: korpusnya tidak
punya skenario ambil-alih-sesi-tak-dijaga. Argumennya kebijakan (PCI DSS 8.2.8), bukan
empiris, dan harus disajikan begitu.

**BELUM BISA DIKLAIM juga**: bahwa C-24 pasti kalah. Ia kalah di dua konfigurasi (0,820
dan 0,802 lawan 0,907 dan 0,924) tapi menang di satu (0,863 lawan 0,825). Alasan
mengirimnya default-mati tetap berlaku - **tidak ada bukti ia menolong** - tapi "terbukti
merugikan" terlalu jauh.

### Konsekuensi untuk default

Preseden C-24 berlaku sama kerasnya untuk segmentasi C-23: **fitur yang tidak terbukti
menolong tidak boleh nyala secara default.** Buktinya untuk C-23 bahkan lebih kuat dari
C-24 - bukan sekadar "tak ada bukti menolong" melainkan bukti konsisten bahwa ia
merugikan daya pisah. Yang menahan flip otomatis: `idleGapSec` yang sama juga menyalakan
`idleAccounting` dan ABSTAIN, jadi mematikannya begitu saja ikut mematikan dua mekanisme
yang tidak sedang diadili. Memisahkan ketiganya jadi knob terpisah adalah langkah
berikutnya, dan sampai itu dikerjakan angka di tabel ini yang berlaku - **bukan** asumsi
bahwa C-23 nyala itu lebih baik.

### Pelajaran metodologisnya

Layak jadi temuan tersendiri di skripsi: **pada protokol few-shot on-device seperti ini,
evaluasinya sendiri adalah sumber ketidakpastian terbesar.** Kolam latih yang tumbuh dari
vonisnya sendiri menciptakan umpan balik antara ambang dan data; grid `q` yang mentok di
pinggir bisa menciptakan FRR 50-60% dari ketiadaan; dan dengan 8 subjek pelapor, satu
belahan tunggal tidak cukup untuk memeringkat apa pun. Angka apa pun dari protokol ini -
**termasuk angka headline lama** - sebaiknya dilaporkan dengan sebaran atas beberapa
belahan, bukan sebagai satu bilangan.

Reproduksi:
`python tools/canonical_holdout.py --only 1 2 3 --idle-gap-sec 30 120 300 --seeds 42 7 13 2026 99 --q-grid 0.01 0.02 0.03 0.05 0.08 0.10 0.12 0.15`

---

## C-25 - Audit "yang berubah alat ukurnya, bukan orangnya"

Setelah C-23 dan C-24, kelas cacatnya ditelusuri ke seluruh kode. Dua belas temuan, tiga
di antaranya dibuktikan dengan menjalankan kodenya. Rincian di
`docs/AUDIT-VALIDITAS-PENGUKURAN.md`; yang ditambal:

**A1 - KRITIS, sesi "cuma menelusuri" diblokir sebagai bot.** Fallback
`filtered.length>=10 ? filtered : events` di `integrity.js` MEMBATALKAN maksud T5: saat
keystroke+klik < 10, ia jatuh ke seluruh event, yang isinya `MOUSE_MOVE` hasil throttle
50 ms kita sendiri. Intervalnya bukan mirip-mirip melainkan **persis konstan** - terukur
60Hz std 0,00 ms; 100Hz 0,00; 125Hz 0,00; 144Hz 0,50. Semuanya < 3 ms ->
`BLOCK_SESSION` untuk manusia yang membaca artikel sambil menggerakkan mouse. Rapuh
pula: satu klik nyasar menaikkan std di atas ambang, jadi gejalanya "kadang-kadang" dan
nyaris mustahil dilacak dari laporan pengguna. **Aturan barunya: jangan pernah menilai
keteraturan interval pada aliran yang kita throttle sendiri.** Kalau bukti kurang,
lewati cek itu - jangan ganti sumbernya.

**A3 - Autofill mematikan 8 fitur keystroke sekaligus.** Terukur: dwell 80->0, flight
120->0, speed 4,81->0, entropi 1,10->0; **8 dari 8 fitur jatuh ke nol**. Dua arah:
pemilik yang memakai password manager terlihat menyimpang tiap login, DAN penyusup bisa
menyenjatakannya untuk menghapus seluruh blok bukti ketikan. `paste` kini ditangkap, dan
"form tersentuh tapi tak diketik" ditandai `partialEvidence:'keystroke'`. Vonisnya
**tidak** dinaikkan - menghukum pemakaian password manager itu salah sasaran - tapi sesi
itu tak pernah melatih model dan tak bisa membangun streak LOW. Bukti sebagian boleh
dipakai menilai, tidak boleh dipakai **mempercayai**.

**A4 - Ekor perilaku bocor antar-pengguna.** `bg:pending` adalah kunci GLOBAL, tidak
ber-ruang-nama seperti sesi. Pengguna A menutup halaman -> ekornya tersimpan -> B login
di browser yang sama -> ekor A dinilai, dan bisa ikut melatih, sebagai B. Kini
`bg:pending:<userId>`; kunci lama dibuang saat init karena pemiliknya tak bisa dipastikan.

**A5 - `PAGE_STEP` dilatih tapi tak pernah ditangkap.** `features.js` membaca
`NAVIGATION | PAGE_STEP`, basis data riset punya 2.672 PAGE_STEP (semuanya alur
checkout), `capture.js` tak pernah menerbitkannya - kerabat C-17. Semantik "langkah" itu
urusan aplikasi, bukan DOM, jadi jalan yang jujur adalah API eksplisit `markStep(nama)`,
bukan menebak dari submit/pushState lalu diam-diam salah.

**B1 - Dua tab diukur menyatu.** Dua tab aktif bersamaan tidak punya jeda untuk dipotong
segmentasi idle, jadi keduanya menyatu jadi satu "sesi" yang tidak mewakili siapa pun.
Prinsip C-23 dipakai lagi: kalau dua pengukuran datang dari alat berbeda, pisahkan.
Event dicap `tabId` dan `groupByStream` memisahkannya sebelum apa pun diukur. Ditambah
pemilihan pemimpin lewat denyut localStorage supaya hanya satu tab yang menilai dan
menulis; dulu penulis terakhir menang dan sesi tab lain hilang diam-diam.

**B2 - Resolusi layar keluar dari sidik perangkat.** Colok monitor eksternal bukan ganti
perangkat, padahal dulu itu memaksa `lastRisk='MEDIUM'` plus lantai lengket. Resolusi
adalah konteks (ia menggeser skala kecepatan), bukan identitas mesin.

**B4 - Layar sentuh.** `touchmove` kini ditangkap dan dipetakan ke `MOUSE_MOVE` (bertanda
`touch:true`). Tanpa ini sembilan fitur mouse nol dan pengguna ponsel tak pernah bisa
dinilai sama sekali. Tidak mengubah apa pun di desktop.

**B7 - Kolam terpotong di 30 tanpa IndexedDB.** localStorage dulu memotong ke 30 sesi
padahal `progressiveMaxPool` = 90; C-22 sudah menunjukkan akibat kolam terlalu kecil
dibanding d=28. Kini `feat` (murni untuk penjelasan) dibuang dan 90 vektor disimpan.

**Belum ditambal, sengaja.** A2 (kecepatan px/ms bergantung ukuran layar - terukur 2,00x
pada monitor 2x lebih besar, curvature 0,50x) dan B3 (`scroll_delta` piksel mentah)
adalah satu paket normalisasi skala yang **membuat baseline lama tidak sebanding**, jadi
butuh penandaan versi baseline. B5 (waktu-hari sebagai biometrik) dan B6 (fitur konstan
di baseline -> z besar) menyentuh vektor/SPEC. Keempatnya diusulkan, bukan dikirim.

**Uji:** `core/audit.test.mjs` 32/32, seluruh suite lama tetap hijau (conformance 227/227
di Python dan JS, idle 33/33, jalur penuh 20/20, invariansi 26/26, step-up 23/23, gerbang
11/11, integrity 10/10).

---

## C-26 - FRR 23% dan panjang pendaftaran (DIUKUR DI MESIN YANG SALAH - lihat C-27)

> **Ditarik 10 Sep 2026.** Seluruh tabel di bagian ini memakai `reproduce_db.py`, yang
> ternyata memakai sklearn OCSVM dengan bobot IF 0,70 - sedangkan yang DIKIRIM adalah
> Mahalanobis dengan bobot IF 0,30. Di mesin yang benar, FRR-nya 12,1% (bukan 28,4%)
> dan keunggulan pendaftaran 16 sesi LARUT ke dalam sebaran. Bagian ini dipertahankan
> sebagai catatan proses; kesimpulannya hanya berlaku untuk mesin OCSVM. Lihat C-27.

### Catatan asli (mesin OCSVM)


FRR 23% pada FAR 2% tidak layak kirim. Bagian ini membongkar dari mana angka itu
datang. Alatnya `tools/frr_levers.py`, yang **mereproduksi `reproduce_db.py` digit per
digit** sebelum tuas apa pun dipasang - versi pertamanya tidak, karena menghilangkan
separuh syarat konvergensi, dan itu sendiri memakan 0,11 AUC. Harness yang tidak diadu
dulu dengan acuannya tidak bisa dipercaya.

### Dua diagnosis yang menentukan arah

**FRR menyebar rata**, 11% sampai 56% di kedelapan subjek pelapor. Jadi sistemik, bukan
segelintir subjek berdata kotor.

**Ambang ORACLE** (dipilih setelah melihat jawabannya) pada FAR<=2% masih memberi FRR
**20,6%**. Jadi penempatan ambang menyumbang ~13 poin dan itu gratis, tapi 20,6%
sisanya adalah langit-langit SKOR-nya. Tambahan: oracle satu-ambang-untuk-semua (28,6%)
tertinggal 8 poin dari oracle per-pengguna (20,6%), murni karena satu penggaris dipaksa
muat ke skala skor yang berbeda-beda.

### Empat tuas model - SEMUANYA GAGAL

Diuji atas 5 belahan 8/8, grid q bersama:

| Tuas | FRR | FAR | AUC | EER | Vonis |
|---|---:|---:|---:|---:|---|
| (tanpa tuas) | 28,4% | 4,1% | 0,919 | 13,9% | acuan |
| kalibrasi leave-one-out | 18,3% | 7,8% | 0,923 | 14,0% | **hanya geser titik operasi** |
| z-norm kohort | 18,5% | 20,7% | 0,826 | 22,2% | ditolak |
| kurangi dimensi 28->12 | 27,0% | 2,1% | 0,926 | 13,3% | netral |
| agregasi 2-3 jendela | 13,5% | 28,5% | 0,864 | 21,0% | ditolak |

**LOO sempat terlihat menang di satu belahan** (AUC 0,922 -> 0,931) dan ditarik setelah
5 belahan: AUC 0,923 vs 0,919 dan EER 14,0% vs 13,9% - selisihnya nol. FRR turun, FAR
naik sepadan. Ini pelajaran yang SAMA dengan koreksi C-23 di atas, dan tetap terulang.

Mekanisme LOO tetap layak dicatat walau efeknya nol: sesi baru masuk kolam latih hanya
setelah divonis LOW, jadi ambang yang terlalu ketat memblokir data pemilik masuk ke
modelnya SENDIRI - kolam kelaparan dan tetap sempit. Umpan balik itu nyata; yang tidak
terbukti adalah bahwa memperbaikinya menggeser daya pisah.

**Dua implementasi agregasi lebih dulu SALAH**, dan salahnya di kelas yang sama dengan
C-16/C-17: (a) ambang dikalibrasi pada skor tunggal tapi vonis diambil dari rerata-k -
sebaran rerata jauh lebih sempit, FAR meledak ke 35%; (b) skor beberapa penyusup BERBEDA
dirata-ratakan, yang mengarang "orang rata-rata" yang justru lebih dekat ke pusat model
pemilik daripada penyusup mana pun. Keduanya diperbaiki; sesudah diperbaiki agregasi
tetap kalah. Kalau merata-ratakan merusak, daya bedanya tidak terletak di pergeseran
rata-rata melainkan di sesi-sesi EKSTREM - dan merata-ratakan menghapus yang ekstrem.
(Hipotesis, konsisten dengan data, belum diuji terpisah.)

**Pembingkaian "cuma diminta verifikasi ulang" juga gugur.** FRR digabung dari MEDIUM
(step-up, pemilik lanjut) dan HIGH (blokir). Dipisah: dari FRR 28,4%, sebanyak **24,0%
adalah HIGH**. Mayoritasnya blokir keras, jadi pembingkaian itu tidak sah dan tidak
dipakai.

### Yang berhasil: panjang pendaftaran

`baseline` = 10 sesi pendaftaran untuk d=28 fitur. Dinaikkan ke 16, **dengan himpunan uji
DIBUAT IDENTIK** lewat `--eval-from` (tanpa itu, menaikkan baseline memindahkan sesi
10..15 dari 'diuji' ke 'mendaftar', dan sebagian 'perbaikan' hanyalah efek membuang soal
dari ujian):

| Diuji pada sesi >=16 | FRR | blokir | FAR | AUC | EER | FAR@FRR15 |
|---|---:|---:|---:|---:|---:|---:|
| pendaftaran 10 sesi | 32,1% | 27,6% | 4,1% | 0,904 | 16,0% | 16,4% |
| pendaftaran 16 sesi | **23,6%** | **21,6%** | **0,7%** | **0,930** | **12,9%** | **5,2%** |

Rentang EER 5 belahan: [11..23] -> **[12..15]**.

Ini satu-satunya perubahan di sesi ini yang memperbaiki **FRR dan FAR sekaligus**, ikut
menaikkan metrik bebas-ambang, DAN mempersempit sebarannya. FAR@FRR15 membaik 3x.

Perhatikan arah confound-nya: pendaftaran 10 justru jadi LEBIH BURUK saat diuji dari sesi
16 (28,4% -> 32,1%). Model yang didaftar terlalu pendek makin tertinggal seiring waktu -
konsisten dengan lingkaran umpan balik kolam di atas.

**Manfaatnya jenuh setelah 16.** Diuji pada sesi >=22, 22 lawan 16: AUC 0,911 vs 0,910,
EER 16,3% vs 15,6%, FAR@FRR15 20,9% vs 16,2% - nol, bahkan sedikit merugikan. Jadi
klaimnya adalah "10 terlalu pendek", BUKAN "makin panjang makin baik".

Kedua perbandingan itu memakai himpunan uji yang berbeda (>=16 dan >=22), jadi angkanya
TIDAK boleh dirantai. Yang sah: pada uji >=16, 16 mengalahkan 10; pada uji >=22, 22 tidak
mengalahkan 16.

### Konsekuensi untuk default - BELUM diubah, sengaja

`config.js: baseline` masih 10. Menaikkannya ke 16 menukar 6 sesi tanpa perlindungan
dengan FAR@FRR15 3x lebih baik - itu keputusan produk, bukan keputusan metrik, dan ia
membuat SELURUH angka headline yang sudah ada tidak sebanding lagi. Diusulkan, tidak
dikirim.

Reproduksi:
`python tools/frr_levers.py --levers none --seeds 42 7 13 2026 99 --baseline 16 --eval-from 16`

---

## C-27 - KRITIS: yang DIUKUR bukan yang DIKIRIM (mesin ensemble)

Kelas cacat C-16/C-17 - "yang dilatih dan yang dipakai bukan besaran yang sama" -
ternyata juga ada di **lapisan evaluasinya sendiri**, dan itu membuat sistem ini
dinilai jauh lebih buruk daripada kemampuan sebenarnya.

| | detektor-2 | bobot |
|---|---|---|
| `sdk/core/config.js` (**yang dikirim**) | `model2:'mahalanobis'` | IF **0,30** / slot-2 **0,70** |
| `tools/reproduce_db.py` (**yang mengukur**) | sklearn `RealOCSVM` | IF **0,70** / slot-2 **0,30** |

Bukan hanya mesinnya berbeda - **bobotnya terbalik.** Jadi seluruh angka yang pernah
dihasilkan `reproduce_db.py`, termasuk semua tabel C-23..C-26 di atas, mengukur sistem
yang tidak pernah dijalankan pengguna mana pun.

`core/bg_core.py:Mahalanobis` adalah padanan bit-per-bit `sdk/core/mahalanobis.js`, jadi
`frr_levers.py --scorer maha` memakai kelas itu LANGSUNG, bukan tiruan. Shrinkage
adaptif C-22 direplikasi dari `behaviorguard._rebuildModel`: `min(0.9, max(0.3, d/n))`.

### Selisihnya, 5 belahan 8/8, grid q bersama

| Mesin | FRR | blokir | FAR | AUC | EER | FAR@FRR15 |
|---|---:|---:|---:|---:|---:|---:|
| OCSVM, IF 0,70 (yang diukur selama ini) | 28,4% | 24,0% | 4,1% | 0,919 | 13,9% | 11,9% |
| **Mahalanobis, IF 0,30 (yang dikirim)** | **12,1%** | **10,7%** | 12,6% | **0,954** | **10,8%** | **6,9%** |

Rentang FRR [22..35] -> **[9..15]**; rentang EER [10..20] -> [9..15].

**FRR 23-28% yang memicu seluruh penyelidikan ini tidak pernah nyata.** Ia milik mesin
yang tidak dikirim. Metrik bebas-ambang ikut membaik semuanya, jadi ini bukan pertukaran
titik operasi melainkan mesin yang memang lebih baik di korpus ini.

Yang tetap harus disebut jujur: pada titik operasi hasil tuning, FAR-nya 12,6% lawan
4,1%. Tunernya memang mencari |FRR-FAR| terkecil sehingga mendarat dekat EER. FAR@FRR15
= 6,9% adalah angka yang dipakai kalau titik operasinya digeser ke FRR 15%.

### Akibatnya untuk C-26 - KLAIM PENDAFTARAN DITARIK

C-26 menyimpulkan pendaftaran 10 sesi terlalu pendek dan 16 jauh lebih baik. Diulang di
mesin yang benar, dengan himpunan uji tetap identik (`--eval-from 16`):

| Mahalanobis, uji sesi >=16 | FRR | FAR | AUC | EER | FAR@FRR15 |
|---|---:|---:|---:|---:|---:|
| pendaftaran 10 | 12,4% | 12,9% | 0,948 | 11,6% | 8,4% |
| pendaftaran 16 | 11,4% | 12,7% | 0,946 | 10,9% | 6,6% |

Selisihnya di dalam sebaran antar-belahan. **Manfaat pendaftaran panjang itu artefak
mesin yang lemah.** Masuk akal secara mekanis: OCSVM kelaparan sampel, sementara
Mahalanobis + shrinkage adaptif C-22 memang dirancang untuk n kecil - jadi menambah
sampel tidak menambah apa-apa. Tabel C-26 dipertahankan sebagai catatan, TAPI
kesimpulannya hanya berlaku untuk mesin OCSVM dan tidak boleh dikutip.

### Empat tuas C-26 juga tidak sah lagi - dan diuji ulang, semuanya kalah

LOO, z-norm, pengurangan dimensi, dan agregasi semuanya diukur di mesin OCSVM. Diuji
ulang di mesin yang dikirim, 5 belahan:

| Di atas Mahalanobis + IF 0,30 | FRR | FAR | AUC | EER | FAR@FRR15 |
|---|---:|---:|---:|---:|---:|
| tanpa tuas | 12,1% | 12,6% | **0,954** | **10,8%** | **6,9%** |
| + kalibrasi LOO | 14,2% | 16,1% | 0,940 | 13,9% | 11,9% |
| + pembeda kohort | 10,7% | 18,3% | 0,897 | 15,1% | 15,1% |

**Konfigurasi terbaik adalah yang SUDAH dikirim.** Tidak ada satu pun tuas yang menambah
apa-apa di atasnya. LOO yang di mesin OCSVM sempat terlihat menolong justru MERUGIKAN di
sini - ambang in-sample yang terlalu ketat itu masalah OCSVM, bukan masalah Mahalanobis.
Pembeda dua kelas juga kalah: dengan 10..30 contoh positif lawan ratusan negatif, ia
mempelajari batas antar-subjek di korpus ini, bukan identitas pemiliknya.

Kesimpulan yang bertahan: masalahnya tidak pernah ada di model, di ambang, di jumlah
fitur, di agregasi, atau di panjang pendaftaran. Masalahnya ada di **alat ukurnya**. Diagnosis yang TETAP berlaku
karena ia sifat protokol, bukan sifat mesin: FRR menyebar rata antar subjek, dan kolam
latih hanya tumbuh dari sesi yang divonis LOW sehingga ambang ketat membuat kolam
kelaparan.

### Yang harus dikerjakan

`reproduce_db.py` HARUS diberi mode yang memakai Mahalanobis + bobot SDK, dan angka
headline skripsi dihitung ulang di sana. Sampai itu selesai, setiap angka dari
`reproduce_db.py` wajib diberi label mesin yang dipakainya.

Reproduksi:
`python tools/frr_levers.py --levers none --seeds 42 7 13 2026 99 --scorer maha --w-if 0.30`

---

### Angka setelah `reproduce_db.py` diperbaiki

Tiga cacat skrip diperbaiki sekaligus, dan ketiganya berdiri sendiri:

1. **Mesin** - default kini Mahalanobis + shrink adaptif, bobot IF 0,30 / slot-2 0,70,
   sama dengan `sdk/core/config.js`. `--legacy-ocsvm` mereproduksi angka lama TAPI
   mencetak peringatan. Kalau `bg_core.Mahalanobis` gagal diimpor skrip BERHENTI -
   jatuh diam-diam ke OCSVM justru cacat yang sedang diperbaiki.
2. **Grid q** - `[0,10..0,20]` selalu memilih 0,10, yaitu nilai TERKECIL yang tersedia.
   Tuner tidak sedang memilih, ia sedang dibatasi. Dilebarkan ke `[0,01..0,20]`.
3. **Alarm ujung grid** - kalau q terpilih menyentuh ujung, skrip berteriak. Ia langsung
   berbunyi lagi di mesin baru (q=0,01, ujung bawah), jadi angka belahan-tunggal pun
   masih titik operasi yang dipaksakan.

**Belahan tunggal seed 42 TIDAK memutuskan apa pun.** Mahalanobis unggul AUC (0,931 vs
0,922) dan FRR (14,5% vs 35,1%) tapi KALAH EER (14,9% vs 12,6%) dan FAR@FRR15 (13,8% vs
8,5%). Baru di 5 belahan Mahalanobis unggul di semua metrik. Ini penegasan ketiga di
dokumen ini bahwa **satu belahan 8 subjek tidak cukup untuk memeringkat apa pun.**

### Idle diukur ulang di mesin yang dikirim (5 belahan, grid q bersama)

| Kondisi | FRR | FAR | AUC | EER | FAR@FRR15 |
|---|---:|---:|---:|---:|---:|
| 1. tanpa AFK (kontrol) | **11,0%** | 11,2% | **0,961** | **9,8%** | **5,0%** |
| 2. dengan AFK, tanpa C-23 | 18,4% | 9,2% | 0,952 | 11,1% | 7,6% |
| 3. dengan AFK + segmentasi C-23 | 18,8% | 13,9% | 0,927 | 14,3% | 13,6% |

**Kerusakan idle NYATA di mesin yang benar**: FRR 11,0% -> 18,4%, +7,4 poin. Keluhan
pembimbing valid, dan kali ini terukur pada sistem yang benar-benar dikirim.

**C-23 tetap TIDAK memperbaikinya**: FRR tidak turun (18,8%), dan daya pisah malah rusak
(AUC 0,952 -> 0,927, EER 11,1% -> 14,3%). Berbeda dengan temuan pendaftaran C-26 yang
larut begitu mesinnya dibetulkan, kesimpulan C-23 **bertahan lintas mesin**. Itu membuatnya
jauh lebih kuat sebagai hasil negatif.

**Angka jujur sistem yang dikirim**, 5 belahan, grid q lebar, tanpa AFK:
FRR 11,0% - FAR 11,2% - AUC 0,961 - EER 9,8% - FAR@FRR15 5,0%.

### Apa yang tidak tersentuh oleh perbaikan mesin

Temuan audit C-25 (A1 sesi menelusuri diblokir sebagai bot, A3 autofill, A4 ekor bocor
antar-pengguna, B1 dua tab, B4 layar sentuh) **tidak diukur oleh tolok ukur ini dan tidak
bisa diukur olehnya**: korpusnya tidak punya aliran throttled yang salah divonis, tidak
punya autofill, tidak punya dua tab, tidak punya sesi sentuh. Semuanya cacat KEBENARAN,
dibuktikan dengan menjalankan kodenya (`core/audit.test.mjs` 32/32), bukan cacat yang
muncul sebagai FRR/FAR. Mesin yang lebih baik tidak memperbaiki satu pun: pengguna yang
diblokir karena A1 tetap diblokir seberapa pun bagusnya Mahalanobis.

Jadi keduanya menjawab pertanyaan berbeda dan tidak saling menggantikan - dan itu sendiri
adalah alasan kenapa laporan yang HANYA berisi FRR/FAR tidak cukup untuk sistem ini.

### Yang MASIH cacat di protokolnya, belum disentuh

- **Melapor dari SATU belahan 8 subjek.** Sumber setiap pembalikan di dokumen ini.
- **Kriteria pemilihan q mengejar FRR ~ FAR**, jadi selalu mendarat dekat EER. Untuk
  sistem keamanan biasanya FAR ditetapkan lebih dulu, baru FRR dilaporkan. Itulah kenapa
  FAR di semua tabel di atas berkisar 9-14%.

Keduanya mengubah DEFINISI angka headline, jadi tidak diubah sepihak.

---

## C-28 - AFK: pendekkan jedanya, jangan pecah sesinya

Di mesin yang dikirim, AFK menaikkan FRR **11,0% -> 18,4%** dan segmentasi C-23 tidak
menurunkannya (18,8%). Syaratnya satu: FRR harus turun **tanpa** menaikkan FAR.
Menggeser ambang tidak dihitung sebagai perbaikan.

### Delapan tuas yang gagal lebih dulu

Semuanya di atas kondisi 2 (AFK, Mahalanobis + IF 0,30, 5 belahan). Tuas yang
menggeser titik operasi dibandingkan **pada FAR yang disamakan**. Tanpa itu, penurunan
FRR yang dibayar dengan FAR tampak seperti perbaikan.

| Tuas | Hasil | Kenapa gugur |
|---|---|---|
| grid q dilebarkan ke 0,001 | FRR 18,0% pada FAR 9,5% | cuma tukar titik operasi |
| z-norm skor | AUC 0,707 | merusak daya pisah |
| kalibrasi LOO | netral sampai lebih buruk | sama dengan C-27 |
| agregasi 2 / 3 sesi | AUC 0,704 / 0,735 | merusak daya pisah |
| skor robust (median/MAD) | AUC 0,821 | merusak daya pisah |
| pembeda kohort | AUC 0,715 | merusak daya pisah |
| k-sesi-berturut, FAR disamakan | k=1 14,9% / k=2 15,8% / k=3 18,6% | k>1 tidak menolong |
| ambang parametrik, FAR disamakan | mean-z·sd 17,0%, med-z·MAD 16,3% (vs 14,9%) | lebih buruk dari kuantil |

Oracle ambang per-pengguna masih 5,6 poin di bawah, tapi celah itu tidak bisa dicapai
oleh aturan apa pun yang tidak melihat jawabannya.

**Pola yang menyatukan kelima kegagalan AUC:** skor penyusup punya ekor ekstrem yang
panjang (agg1: rerata -22,5, sd 76,6), dan daya bedanya ada di ekor itu. Setiap tuas yang
**menghaluskan** skor (rata-rata, z-norm, median, kohort) memotong ekornya, sehingga daya
pisahnya ikut hilang. Ini menguji hipotesis C-26 yang dulu belum diuji, dan hasilnya
mendukung hipotesis itu.

### Diagnosis: yang rusak cuma enam fitur, dan semuanya dibagi waktu

Ada 493 pasangan sesi (sama, dengan vs tanpa AFK). Pergeseran diukur dalam satuan sd
baseline:

| Fitur | Geser |
|---|---:|
| `mouse_click_interval_mean` | 1,31 sd |
| `keystroke_typing_speed` | 1,24 sd |
| `form_field_switch_rate` | 1,20 sd |
| `keystroke_cross_field_cadence` | 0,79 sd |
| `keystroke_flight_time_mean` | 0,67 sd |
| `temporal_session_duration` | 0,58 sd |
| 22 fitur lainnya | ≤ 0,06 sd |

Perilakunya tidak berubah. Yang rusak adalah **penyebut waktunya**. Karena itu obatnya
cukup di waktu, dan fitur lain tidak perlu diapa-apakan.

### Tambalan: kompresi waktu diam

`sdk/core/idle.js:compressIdle` memendekkan setiap jeda ≥ `session.idleCompressSec`
(15 dtk) menjadi 15 dtk. Tidak ada event yang dibuang, dan sesi tetap dinilai utuh. Ini
berbeda dari C-23. Segmentasi memendekkan **sesi**, sehingga sembilan fitur-cacah ikut
mengecil (C-24). Kompresi hanya memendekkan **waktu kosongnya**. Rumus fitur di
`core/SPEC.md` tidak disentuh, jadi hasilnya tetap 227/227.

Diukur dengan 5 belahan 8/8 dan grid q `[0,01..0,20]` yang sama untuk semua lengan:

| Kondisi | FRR | FAR | AUC | EER | FAR@FRR15 |
|---|---:|---:|---:|---:|---:|
| 1. tanpa AFK (kontrol) | 11,0% | 11,2% | 0,961 | 9,8% | 5,0% |
| 2. AFK, tanpa perbaikan | 18,4% | 9,2% | 0,952 | 11,1% | 7,6% |
| 3. AFK + segmentasi C-23 | 18,8% | 13,9% | 0,927 | 14,3% | 13,6% |
| **AFK + kompresi 15 dtk** | **9,7%** | **9,3%** | **0,968** | **8,9%** | **5,0%** |
| AFK + kompresi 30 dtk | 11,9% | 8,4% | 0,967 | 8,6% | 5,3% |
| AFK + kompresi 60 dtk | 12,7% | 8,9% | 0,963 | 9,6% | 6,4% |
| tanpa AFK + kompresi 10 dtk | 9,8% | 10,9% | 0,964 | 9,6% | 5,0% |
| tanpa AFK + kompresi 15 dtk | 10,1% | 11,7% | 0,964 | 10,0% | 5,8% |
| tanpa AFK + kompresi 20 dtk | 10,5% | 10,7% | 0,964 | 10,1% | 5,1% |

FRR turun 8,7 poin sementara FAR tetap (9,2% -> 9,3%). AUC dan EER ikut membaik, jadi
ini bukan tukar titik operasi. Pada sesi tanpa AFK kompresi netral di semua ambang yang
diuji: selisihnya masih di dalam sebaran antar-belahan, dan tidak ada ambang yang
merugikan. Artinya jeda berpikir alami tidak ikut rusak.

### Dua varian yang ikut diuji dan DITOLAK

**Pisah di jeda "away".** Menggabungkan sebelum-dan-sesudah absen jadi satu vonis punya
harga keamanan. Kalau yang kembali ke kursi orang lain, perilakunya tercampur dengan
perilaku pemilik. Varian yang tetap memecah di jeda panjang lalu mengompresi tiap
potongannya menghapus manfaatnya:

| | FRR | FAR | AUC | EER |
|---|---:|---:|---:|---:|
| kompresi, sesi utuh | 9,7% | 9,3% | 0,968 | 8,9% |
| kompresi + pisah @ 5 mnt | 18,5% | 12,2% | 0,934 | 12,8% |
| kompresi + pisah @ 15 mnt | 19,3% | 10,8% | 0,933 | 14,4% |

Jadi yang merusak adalah **memendekkan sesi**, bukan jedanya. Hasil ini sejalan dengan
C-23 dan C-24. Sisi keamanannya tetap ditangani, tapi lewat jalur lain: jeda terpanjang
diukur dari timestamp **asli** sebelum dikompresi, sehingga `resumedAfterAway`, reset
streak LOW, dan kenaikan LOW->MEDIUM untuk absen ≥ `reverifyAfterSec` tetap jalan
(`core/idle.live.test.mjs` bagian E).

**Kolam latih lebih besar.** `reproduce_db.py` membatasi kolam di 30 vektor, sedangkan
SDK mengirim `baseline + progressiveMaxPool` = 10 + 90. Ini selisih "yang diukur ≠ yang
dikirim" yang sekelas dengan C-27, jadi diukur. Efeknya kecil sekali: tanpa AFK EER 9,8%
-> 9,7%, AUC 0,961 -> 0,962. Dengan AFK + kompresi hasilnya 8,6% / 9,0% / 0,972 / 7,9%,
juga di dalam sebaran. `run_fold(max_pool=...)` kini tersedia. Default-nya tetap 30
supaya angka lama bisa direproduksi.

### Kurva panjang pendaftaran: datar

Klaim C-26 ("pendaftaran 10 terlalu pendek") sudah ditarik di C-27. Ia diuji ulang
lebih lebar di mesin yang dikirim dengan himpunan uji tetap (sesi ≥ 20, `--eval-from 20`):

| Pendaftaran | FRR | FAR | AUC | EER | FAR@FRR15 |
|---:|---:|---:|---:|---:|---:|
| 5 | 13,6% | 10,7% | 0,940 | 12,5% | 9,2% |
| 10 | 14,1% | 13,0% | 0,941 | 12,8% | 9,9% |
| 15 | 14,0% | 12,7% | 0,933 | 12,6% | 9,3% |
| 20 | 14,0% | 13,1% | 0,935 | 13,4% | 10,7% |

Datar dari 5 sampai 20. Menambah sesi pendaftaran **tidak** menurunkan FRR dasar ~10-11%.
Ini konsisten dengan C-22/C-27: Mahalanobis + shrinkage adaptif sudah dirancang untuk n
kecil.

### Yang WAJIB dijujurkan

- **AFK-nya sintetis.** Jeda 2-20 menit disuntikkan ke sesi evaluasi di satu titik.
  Sebagian pemulihan memang sudah pasti terjadi oleh konstruksinya, karena yang disuntik
  adalah waktu, dan waktu itulah yang dikompresi. Bukti bahwa manfaatnya bukan cuma
  artefak: (a) pada data asli tanpa suntikan, kompresi netral sampai sedikit membaik;
  (b) AUC/EER dengan AFK + kompresi **melampaui** kontrol tanpa AFK (0,968 vs 0,961).
  Data AFK lapangan belum ada.
- **Satu batch yang melintasi absen menghasilkan satu vonis.** Untuk absen 5-15 menit,
  satu-satunya penanganan keamanan adalah reset streak. Di jalur live (jendela 30 dtk)
  ini jarang terjadi karena ekor basi tidak dibawa ke jendela berikutnya. Di
  `scoreExternalEvents` dengan batch panjang, hal ini bisa terjadi.
- **FRR dasar ~10-11% pada sesi normal TIDAK tersentuh.** Tuas ambang, tuas agregasi,
  dan panjang pendaftaran semuanya sudah habis. Yang tersisa harus dicari di
  representasi (fitur apa yang dipakai), bukan di pengambilan keputusan.

**Uji:** `core/compress.test.mjs` 22/22 (sifat dasar, 5 fitur berpenyebut waktu pulih,
fitur-bentuk identik, fitur-cacah tidak mengecil). `core/idle.live.test.mjs` 33/33: A-D
mengunci jalur C-23 lama lewat `idleCompressSec:0`, dan E mengunci jalur baru. Seluruh
suite lama tetap hijau.

Reproduksi:
`python tools/canonical_holdout.py --only 1 2 7 8 --seeds 42 7 13 2026 99 --q-grid 0.01 0.02 0.03 0.05 0.08 0.10 0.12 0.15 0.18 0.20`

---

## Status verifikasi setelah tambalan

| Uji | Perintah | Hasil |
|---|---|---|
| Mesin Python vs golden | `python core/conformance.py` | 227/227 SESUAI |
| Mesin JS vs golden | `core/conformance.html` | 227/227 SESUAI |
| Regresi step-up C-1 + drift tempo C-20 | `core/challenge.test.html` / `.mjs` | 23/23 SESUAI |
| FRR/FAR MFA sebelum vs sesudah C-20 | simulasi jitter Gauss (frasa 18 char) | FRR 63.6%→~2%, FAR ~0% |
| Storage C-10 (browser) | `storage.del` pada store kosong | tidak melempar, 0 error |
| Gerbang detektor C-15/C-8 | `core/ensemble.test.html` / `.mjs` | 11/11 SESUAI |
| Simulator serangan C-12..C-15 | `demo/attack_sim.html` | 4/4 HIGH, mimicry via ensemble |
| Heuristik integrity C-16 | `core/integrity.test.html` / `.mjs` | 10/10 SESUAI |
| Jalur live penuh C-16..C-18 | halaman nyata + event DOM | enrollment 10/10, vonis LOW/MEDIUM benar, persisten setelah reload |
| Sinkron sdk↔extension | `tools/sync_core.ps1` | identik, exit 0 |
| Segmentasi idle C-23 | `core/idle.test.mjs` / `.html` | 33/33 SESUAI |
| Jalur penuh idle C-23 | `core/idle.live.test.mjs` | 20/20 SESUAI |
| Invariansi panjang sesi C-24 | `core/invariance.test.mjs` / `.html` | 26/26 SESUAI |
| Audit validitas pengukuran C-25 | `core/audit.test.mjs` | 32/32 SESUAI |
| Validasi held-out C-23/C-24 | `python tools/canonical_holdout.py --seeds 42 7 13 2026 99` | NEGATIF untuk segmentasi C-23 |
| Kompresi waktu diam C-28 | `core/compress.test.mjs` | 22/22 SESUAI |
| Jalur penuh idle C-23 + C-28 | `core/idle.live.test.mjs` | 33/33 SESUAI |
| Held-out C-28 | `python tools/canonical_holdout.py --only 1 2 7 8 ...` | AFK: FRR 18,4% -> 9,7%, FAR tetap |

Perubahan C-1..C-19 semuanya di luar cakupan `core/SPEC.md` §1 (challenge, siklus sesi,
rate-limit, penyimpanan) **kecuali** C-8 yang menyentuh default `ensemble.js`; karena itu
conformance dijalankan ulang di kedua sisi dan tetap 227/227.
