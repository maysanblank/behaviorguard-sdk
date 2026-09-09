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

Perubahan C-1..C-19 semuanya di luar cakupan `core/SPEC.md` §1 (challenge, siklus sesi,
rate-limit, penyimpanan) **kecuali** C-8 yang menyentuh default `ensemble.js`; karena itu
conformance dijalankan ulang di kedua sisi dan tetap 227/227.
