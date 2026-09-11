# BehaviorGuard Core — Spesifikasi Mesin v1.2.0

Dokumen ini adalah **acuan normatif** mesin penilaian BehaviorGuard. Kalau kode dan
dokumen ini berbeda, **dokumen ini yang benar dan kodenya yang bug.**

Tujuannya satu: siapa pun, di bahasa apa pun, bisa menulis ulang mesin ini dan
**membuktikan** hasilnya identik — bukan sekadar "kelihatannya mirip".

---

## 1. Ruang lingkup

Spec v1.1.0 mencakup **seluruh jalur perhitungan** — dari event mentah sampai vonis:

```
event mentah  --[ §8 ekstraksi fitur ]-->  vektor 28-float  --[ §5 mesin ]-->  vonis
     (v1.1)                                     (format tukar)          (v1.0)
```

- **§8 Ekstraksi fitur** (v1.1) — event mentah → vektor 28-float. Deterministik,
  murni angka, tanpa DOM. Acuan: `sdk/core/features.js` = `bg_core.py:extract_features`.
- **§2–§7 Mesin penilaian** (v1.0) — vektor 28-float → vonis.

**Tetap di luar** spec (khusus per platform, bukan angka murni):

- Penangkapan event (DOM/touch/native) — cuma *mengisi* struktur event di §8.1
- Penyimpanan, jaringan, siklus sesi, rate-limit, integrity, challenge

**Vektor 28-float adalah titik-tukar utama** sistem ini: itu yang disimpan
`baselines.vectors_json` di server dan yang dibaca `reproduce_db.py` dari basis data
riset. §8 kini menutup jalur *sebelum* titik-tukar itu, sehingga port bahasa lain bisa
**membaca perilaku**, bukan cuma menghitung skor dari vektor jadi.

---

## 2. Vektor fitur

28 nama, **urutan tetap dan mengikat** — indeks ke-*i* bermakna sama di semua bahasa.
Daftar persisnya ada di `core/golden.json` kolom `features` dan di `bg_core.py:F4`.

Setiap elemen: bilangan pecahan presisi ganda (IEEE-754 binary64), selalu finit.

---

## 3. Konstanta normatif

| Kunci | Nilai | Fungsi |
|---|---|---|
| `iforest.n_estimators` | 100 | jumlah pohon |
| `iforest.max_samples` | 256 | ukuran subsampel |
| `iforest.seed` | 42 | benih PRNG |
| `weights` | IF 0.30 / SVM 0.70 / LSTM 0.00 | bobot campuran (detektor-2 = Mahalanobis, diberi mayoritas) |
| `model2` / `mahalanobis.shrink` | `mahalanobis` / 0.3 | detektor-2 & shrinkage diagonal (v1.2) |
| `ensembleMinSamples` | IF 8 / SVM 20 / LSTM 24 | gerbang: di bawah ini bobotnya dinolkan |
| `calibrationMode` | `parametric` | mode kalibrasi ambang (v1.2) |
| `k_low` / `k_med_extra` | 1.75 / 2.0 | kalibrasi parametrik: `low = mean − k·std` (v1.3.0; dulu 3.3) |
| `q_low` / `q_med` | 0.10 / 0.033 | kuantil kalibrasi ambang (mode `quantile` lama) |
| `blockAfterConsecutiveHigh` | 2 | aturan-run: block keras hanya bila HIGH berturut ≥ N (lapisan SDK) |
| `baseline` / `retrainEvery` | 10 / 6 | siklus pendaftaran & latih-ulang |
| `stdFloorEps` / `stdFloorValue` | 1e-9 / 1.0 | **S-1** lantai simpangan baku per-fitur |
| `scoreStdMin` / `scoreStdMax` | 1e-3 / 10.0 | **S-2** clamp simpangan baku skor |
| `zClamp` | 6.0 | **S-2** clamp nilai-z |

**S-1 dan S-2 adalah titik perbedaan yang sudah terbukti** antara dua salinan kode di
repo ini (`sdk/core/*.js` dan `tools/reproduce_db.py`). Nilai di atas = perilaku SDK JS
yang benar-benar dipasang di situs orang. Lihat `core/DRIFT.md`.

---

## 4. PRNG — `mulberry32`

Semua keacakan berasal dari satu generator, dibenihi `seed`, dipanggil dalam urutan
yang mengikat. Aritmetika **tak-bertanda, modulo 2³²**:

```
a := (a + 0x6D2B79F5) mod 2^32
t := a
t := ((t XOR (t >> 15)) * (t OR 1)) mod 2^32
t := (t XOR (t + ((t XOR (t >> 7)) * (t OR 61)) mod 2^32)) mod 2^32
keluaran := ((t XOR (t >> 14)) mod 2^32) / 2^32
```

Bahasa dengan bilangan bulat 64-bit **wajib** memaskerkan tiap perkalian dengan
`0xFFFFFFFF`. Kelalaian di sini adalah penyebab kegagalan port yang paling sering.

---

## 5. Alur perhitungan

Urutannya mengikat. Tiap langkah harus persis di posisi ini.

### 5.1 Statistik baseline
Rerata dan simpangan baku **populasi** (pembagi *n*, bukan *n−1*) per fitur.
Lalu **S-1**: `std[i] := (sqrt(var[i]) < 1e-9) ? 1.0 : sqrt(var[i])`.

### 5.2 Standardisasi
`x_std[i] := (x[i] − mean[i]) / std[i]`. Tanpa clamp di tahap ini.

### 5.3 Isolation Forest
Untuk tiap dari 100 pohon, berurutan dengan **satu** aliran PRNG bersama:

1. Fisher–Yates mundur atas indeks `0..n−1`, `j := floor(rng() × (i+1))`
2. Ambil `n = min(256, |X|)` indeks pertama
3. Bangun pohon rekursif, kedalaman maksimum `ceil(log2(n))`:
   - daun bila `depth >= maxDepth` atau `|points| <= 1`
   - `feat := floor(rng() × n_features)`
   - daun bila `min == max` pada fitur itu
   - `split := min + rng() × (max − min)`
   - kiri `< split`, kanan `>= split`; daun bila salah satu sisi kosong

Panjang lintasan: `depth + c(size_daun)`, dengan
`c(n) = 2(ln(n−1) + 0.5772156649) − 2(n−1)/n`, `c(0)=c(1)=0`, `c(2)=1`.

Skor: `0.5 − 2^(−avg_h / c(n))`. **Makin negatif = makin anomali.**

### 5.4 Detektor-2: Mahalanobis + shrinkage diagonal (v1.2)

Menggantikan centroid-RBF lama (§5.4 v1.1). Satu rumus, portabel, nol dependensi —
padanan `sdk/core/mahalanobis.js`. Dari kolam baseline terstandardisasi `X` (n×d):

1. `μ` = rerata per-fitur; `S` = kovarians `(Σ (x−μ)(x−μ)ᵀ)/(n−1)`.
2. Shrinkage diagonal: `Σ := (1−a)·S + a·μ̄·I` dengan `a = shrink (0.3)`, `μ̄` = rerata
   diagonal `S`; lalu `Σ_ii += 1e-6`.
3. `Σ⁻¹` via Gauss-Jordan **pivot-parsial** (pivot = baris ber-|nilai| maksimum di kolom,
   `>` ketat sehingga maksimum pertama menang; bila `|pivot| < 1e-12` → set `1e-12`).
4. `score(x) = −√( (x−μ)ᵀ Σ⁻¹ (x−μ) )` (di-clamp ke 0 bila negatif). Higher = lebih normal.

Urutan operasi float (loop i-luar/j-dalam, normalisasi baris penuh, eliminasi)
**wajib identik** antar bahasa agar bit-exact 1e-9. Rumus lama tetap ada di `ocsvm.js`
untuk `model2='centroid'`. Latar: centroid menggepengkan kolam jadi satu titik → FAR 36%;
Mahalanobis memperhitungkan kovarians → held-out FAR **5.4%**, FRR **16.1%**, AUC **0.942**, EER **11.9%** di harness riset offline yang menilai sesi utuh (~700 event). Pustaka yang dikirim, diukur per jendela 30 dtk yang benar-benar ia nilai (`tools/eval_sdk.mjs --live`), dilaporkan di README. Lihat `DRIFT.md` C-29.

### 5.5 Kalibrasi & campuran
Untuk tiap sub-model: rerata + simpangan baku skor baseline, lalu **S-2**
`std := clamp(std, 1e-3, 10.0)`. Nilai-z: `z := clamp((s − mean)/std, −6, +6)`.

Bobot digerbang: bila `n < 20` maka `svm := 0`; bila `n < 24` maka `lstm := 0`;
lalu dinormalkan agar berjumlah 1. Bila `svm == 0`, keluarannya `z_IF` murni.
Selain itu: `skor := w_IF · z_IF + w_SVM · z_SVM`.

### 5.6 Ambang
Mode **`parametric`** (default v1.2): dari skor baseline `mean`, `std` (populasi, `std:=1`
bila varian ≤ 1e-12): `low := mean − k_low·std`, `med := mean − (k_low + k_med_extra)·std`.
Tanpa clamp — pita lebih menempel sebaran skor pemilik ketimbang kuantil-10-sampel.

Mode **`quantile`** (lama, `calibrationMode='quantile'`): kuantil interpolasi-linear atas
skor terurut `low := Q(q_low)`, `med := Q(q_med)`; bila `low − med < 0.15` → `med := low − 0.25`;
lalu `low := clamp(low, −3, 1)`, `med := clamp(med, −3, low − 0.05)`.

### 5.7 Vonis & aksi
`skor <= med` → **HIGH**; `skor <= low` → **MEDIUM**; selain itu → **LOW**.
`topFeatures` = 3 fitur dengan |z| terbesar, terurut menurun.

Aksi per-sesi (`to_action`, stateless): **HIGH → `REQUIRE_STEPUP`**, MEDIUM →
`REQUIRE_MFA`, LOW → `ALLOW_SESSION`. HIGH **tidak** langsung memblokir: satu sesi
menyimpang minta verifikasi step-up (pemilik lolos, penyusup gagal). **Pemblokiran keras
(`BLOCK_SESSION`) dipicu lapisan stateful SDK** (`BehaviorGuard.assess`) hanya bila HIGH
berturut ≥ `blockAfterConsecutiveHigh` — pemilik off-day bikin HIGH terpencar (step-up),
pengambilalihan akun bikin HIGH beruntun (block). Held-out: block pemilik 9.7% → 2.4%,
FAR tetap. Lapisan ini **di luar** golden (golden menguji `to_action` stateless).

---

## 6. Kesesuaian — cara membuktikan port kamu benar

Sebuah implementasi disebut **sesuai** hanya bila lulus `core/golden.json`,
toleransi relatif **1e-9**:

- **§8 ekstraksi fitur** — 5 kasus fitur × 28 elemen = **140 pemeriksaan** vektor,
  dari event mentah eksplisit di `feature_cases` (kasus kelima, `_fc_atan2_pi4_edges`,
  berisi gerakan mouse nyata yang berbelok tepat di `pi/4`; v1.3.0).
- **§2–§7 mesin** — 3 kasus, 16 probe = **115 pemeriksaan** vonis, dari `cases`.
- Total **255 pemeriksaan**.

Golden menyimpan **input eksplisit** (bukan generator), jadi port tidak perlu meniru
generator apa pun. Titik antara juga disimpan (`stats_*`, `if_stats`, `svm_stats`,
`gated_weights`) supaya kegagalan bisa dilokalisasi, bukan cuma "hasilnya beda".

| Implementasi | Cara uji | Status |
|---|---|---|
| Python `core/bg_core.py` | `python core/conformance.py` | **SESUAI** 255/255 |
| JS `sdk/core/*.js` (browser) | buka `core/conformance.html` lewat server lokal | **SESUAI** 255/255 |
| JS `sdk/core/*.js` (Node/CI) | `node core/conformance.node.mjs` | **SESUAI** 255/255 |
| Rust `ports/rust` | `cd ports/rust && cargo run --release` | **SESUAI** 255/255 |
| Java `ports/java` (JVM/Android) | `java ports/java/BgConformance.java core/golden.json` | **SESUAI** 255/255 |
| **WASM** `ports/wasm/bg_core.wasm` | `node ports/wasm/run.mjs` (atau `ports/wasm/index.html`) | **SESUAI** 255/255 |
| Port baru (Go/Swift/C#) | tiru logika `conformance.py`; lihat `ports/README.md` | — |

Semua port **nol dependensi** (pustaka standar saja, termasuk pembaca JSON kecil
buatan sendiri di port terkompilasi). CI menjalankan keempatnya tiap push —
`.github/workflows/conformance.yml`.

Bikin ulang golden **hanya** kalau spec berubah, dan catat alasannya di `DRIFT.md`:

```bash
python core/gen_golden.py
```

---

## 7. Versi

Semantik: **mayor** = angka berubah; **minor** = permukaan bertambah, angka lama tetap;
**tambal** = klarifikasi dokumen saja. `golden.json` mencantumkan `spec_version` yang
dipatuhinya.

- **v1.2.0** (2026-09-04) — **MAYOR**: detektor-2 centroid-RBF → **Mahalanobis+shrinkage**
  (§5.4), kalibrasi ambang → **parametrik** (§5.6), bobot IF/SVM 0.70/0.30 → **0.30/0.70**,
  aksi HIGH `BLOCK_SESSION` → **`REQUIRE_STEPUP`** + aturan-run block (§5.7). `golden.json`
  di-regen; angka mesin berubah menyeluruh. Held-out: FAR 36.2% → **5.4%**, EER 21.0% → **11.9%**;
  block pemilik 9.7% → **2.4%**. Ekstraksi fitur (§8) tak berubah. Lihat `DRIFT.md`.
- **v1.1.0** (2026-09-03) — menambah §8 ekstraksi fitur. Angka mesin v1.0 **tidak
  berubah** (golden `cases` identik). Satu-satunya perubahan angka: fitur
  `temporal_time_of_day_score` kini dihitung UTC, bukan waktu lokal — perbaikan
  portabilitas, bukan penyetelan akurasi. Lihat §9 dan `DRIFT.md` (F-1).
- **v1.0.0** (2026-09-03) — mesin penilaian (vektor → vonis).

---

## 8. Ekstraksi fitur (event mentah → vektor 28-float)

Bagian ini **normatif**. Acuan kode: `sdk/core/features.js:extractF4` dan padanan
persisnya `bg_core.py:extract_features`. Keduanya lulus `feature_cases` yang sama.

### 8.1 Struktur event

Masukan = **daftar event terurut** (list of records). Tiap event punya:

| Kolom | Tipe | Wajib | Dibaca oleh |
|---|---|---|---|
| `event_type` | string | ya | pemilahan tipe |
| `timestamp` | epoch **milidetik** | ya | hampir semua fitur waktu |
| `x`, `y` | angka piksel | untuk gerak | kecepatan/arah/kurvatur |
| `key` | string | untuk ketik | entropi transisi |
| `hold_time` | milidetik | untuk ketik | dwell mean/std |
| `velocity` | angka | opsional | `cursor_idle_ratio` (lihat 8.4) |
| `page_url` | string | untuk navigasi | hitung halaman/transisi |
| `scroll_delta` | angka | untuk scroll | kedalaman scroll |

Nilai kolom yang hilang/None diperlakukan sebagai **0** (padanan `x || 0` di JS),
kecuali `hold_time` yang di-*filter* (hanya yang non-None ikut rata-rata) dan `key`
yang jadi string kosong.

Tipe `event_type` yang dikenal: `MOUSE_MOVE`, `MOUSE_CLICK`, `MOUSE_SCROLL`,
`KEYSTROKE`, `FORM_FOCUS`, `FORM_BLUR`, `NAVIGATION`, `PAGE_STEP`, `CART_ACTION`.

### 8.2 Aturan umum

- **`mean`** = rata-rata aritmetika; array kosong → `0`.
- **`std`** = simpangan baku **populasi** (pembagi *n*); array kosong → `0`.
- **`safe(v)`** = `v` bila angka finit, selain itu `0`. Keluaran **selalu** 28 finit.
- **Urutan mouse gabungan** `mouse_ev` = `[…MOUSE_MOVE, …MOUSE_CLICK, …MOUSE_SCROLL]`
  (digabung menurut tipe, **bukan** diurut waktu). Loop kinematik jalan atas urutan ini.
- Event tetap dalam urutan masukannya untuk `flight_time`, entropi, dan burst.

### 8.3 Kinematik mouse (loop atas `mouse_ev`, i=1..)

Untuk tiap pasang `(p=mouse_ev[i-1], c=mouse_ev[i])`, `dt = c.ts − p.ts`:

- `dt ≤ 0` → **lewati** pasangan itu.
- `dist = hypot(c.x−p.x, c.y−p.y)`, `v = dist/dt` → masuk `velocities`.
- **arah**: bila `dist > 0`, `dir = atan2(dy,dx)`; bila ada `last_dir` dan
  `|dir − last_dir| > π/4 + 1e-9` → `direction_changes += 1`; set `last_dir = dir`.
  (v1.3: `1e-9` normatif. Gerakan piksel bulat sangat sering berselisih arah TEPAT π/4,
  dan `atan2` antar-libm beda 1–2 ulp di situ -> tanpa toleransi perbandingannya berbalik
  di satu bahasa saja. Terukur: 5 dari 192 sesi nyata.)
- **akselerasi**: bila `|velocities| > 1`, `a = (v − velocities[−2])/dt` → `accelerations`.
- **kurvatur** (butuh 3 titik, `i ≥ 2`, `p2 = mouse_ev[i-2]`):
  `area = x0(y1−y2) + x1(y2−y0) + x2(y0−y1)`; `sa,sb,sc` = panjang sisi;
  bila `sa·sb·sc > 0` → tambah `|4·area/(sa·sb·sc)|` ke `curvatures`.
- **pause**: bila `dt > 100` → `pauses += 1`.

`click_intervals` = selisih timestamp antar `MOUSE_CLICK` berurutan.

### 8.4 `cursor_idle_ratio`

Hanya bila ada `MOUSE_MOVE`:
`idle = |{e ∈ MOUSE_MOVE : (e.velocity || 0) < 0.5}|`, `ratio = idle / |MOUSE_MOVE|`.
Bila hasilnya **tepat 0** dan ada `velocities`, pakai cadangan:
`ratio = |{v ∈ velocities : v < 0.05}| / |velocities|`.
Tanpa MOUSE_MOVE → `0`.

### 8.5 Koordinasi mouse–keyboard

Gabung `mouse_ev + key_ev`, **urutkan stabil menurut timestamp**. Hitung
`alternations` = berapa kali tipe (`mouse`/`keyboard`) berganti antar-event bersebelahan.
`cross_mouse_keyboard_coordination = alternations / |gabungan|` (0 bila kosong).
Tipe ditentukan oleh apakah `event_type` mengandung substring `"MOUSE"`.

### 8.6 Keystroke

- `hold_times` = `hold_time` yang non-None → dwell mean & std.
- `flight_times` = selisih timestamp antar KEYSTROKE berurutan (urutan masukan).
- **entropi transisi**: bila `<2` keystroke → `0`. Selain itu, hitung frekuensi
  bigram `key[i-1]->key[i]` (`n−1` transisi); `H = −Σ p·ln(p + 1e-9)` dengan
  `p = count/(n−1)`.
- **burst**: telusuri KEYSTROKE berurutan; `dt < 333` memulai burst baru (naikkan
  `burst_count` saat *masuk* burst), `dt ≥ 333` mengakhirinya.
- `typing_speed = |key_ev| / duration` bila `duration > 0`, selain itu `0`.
- **cross-field cadence**: untuk tiap `FORM_FOCUS` (timestamp terurut), ambil KEYSTROKE
  terakhir *sebelum* dan pertama *pada/atau sesudah* fokus itu; selisihnya masuk
  `cross_gaps`. Fiturnya = `mean(cross_gaps)`.

### 8.7 Temporal

- `first_ts = events[0].ts || session_start_ts || 0`; `last_ts = events[−1].ts || first_ts`.
- `duration = (last_ts − first_ts)/1000` detik.
- **`temporal_time_of_day_score` = `(UTChours + UTCminutes/60)/24`** dari `first_ts`.
  **Wajib UTC** (bukan waktu lokal) — lihat §9.
- **activity bursts**: kelompokkan event per detik (`floor(ts/1000)`), ambil array
  cacah per-detik; `bursts = |{c : c > mean + 2·std}|`.

### 8.8 Navigasi & form

- `nav_ev` = event `NAVIGATION` atau `PAGE_STEP`.
- `nav_page_transition_pattern = |unik(page_url di nav_ev)| / |page_url di nav_ev|`
  (0 bila tak ada).
- `nav_scroll_depth_mean = mean(|scroll_delta|)` atas `MOUSE_SCROLL`.
- `nav_page_count = |unik(page_url atas SEMUA event)|`.
- `nav_step_transition_count = |nav_ev|`.
- `form_focus_count`, `form_blur_count` = cacah event terkait.
- `form_field_switch_rate = mean(selisih>0 antar FORM_FOCUS terurut waktu)`.
- `cart_action_count = |CART_ACTION|`.

### 8.9 Perakitan keluaran

Susun ke-28 nilai **menurut urutan F4** (§2). Tiap nilai dibungkus `safe(value || 0)`.
Hasil: dict/array 28 elemen, semua finit — siap masuk §5 sebagai vektor fitur.

---

## 9. Determinisme & portabilitas (F-1: waktu UTC)

Ekstraksi fitur harus memberi **vektor identik untuk event identik, di mesin & zona
waktu mana pun**. Satu-satunya pelanggaran di kode asli adalah
`temporal_time_of_day_score`, yang memakai `Date.getHours()` — **waktu lokal**. Dua
komputer di zona waktu berbeda akan menghasilkan fitur ke-18 yang berbeda dari input
yang sama, lalu berbeda pula standardisasi dan skornya.

**Keputusan v1.1:** fitur itu dihitung **UTC** (`getUTCHours` / `getUTCMinutes`), di
`features.js` maupun `bg_core.py`. Ini perbaikan **portabilitas**, bukan penyetelan
akurasi — nilainya masih "jam berapa sesi dimulai", cuma di garis waktu yang sama untuk
semua orang. Dicatat sebagai **F-1** di `DRIFT.md`.

Sumber non-determinisme lain sudah aman: tak ada `Date.now()` yang dipakai selama
`timestamp` event terisi; semua pengurutan **stabil**; transkendental (`atan2`, `log`,
`hypot`, `sqrt`) dipakai pada input yang dijauhkan dari ambang rapuh di `feature_cases`,
sehingga selisih ULB antar-runtime tetap di bawah toleransi 1e-9.
