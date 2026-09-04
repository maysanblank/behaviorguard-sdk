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

# C-1..C-15 · Celah logika lapisan pertahanan (audit 2026-09-04)

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

---

## Status verifikasi setelah tambalan

| Uji | Perintah | Hasil |
|---|---|---|
| Mesin Python vs golden | `python core/conformance.py` | 227/227 SESUAI |
| Mesin JS vs golden | `core/conformance.html` | 227/227 SESUAI |
| Regresi step-up C-1 | `core/challenge.test.html` / `.mjs` | 20/20 SESUAI |
| Storage C-10 (browser) | `storage.del` pada store kosong | tidak melempar, 0 error |
| Gerbang detektor C-15/C-8 | `core/ensemble.test.html` / `.mjs` | 11/11 SESUAI |
| Simulator serangan C-12..C-15 | `demo/attack_sim.html` | 4/4 HIGH, mimicry via ensemble |
| Sinkron sdk↔extension | `tools/sync_core.ps1` | identik, exit 0 |

Perubahan C-1..C-15 semuanya di luar cakupan `core/SPEC.md` §1 (challenge, siklus sesi,
rate-limit, penyimpanan) **kecuali** C-8 yang menyentuh default `ensemble.js`; karena itu
conformance dijalankan ulang di kedua sisi dan tetap 227/227.
