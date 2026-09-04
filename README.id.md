# BehaviorGuard SDK - On-Device ATO Plug-and-Play

> SDK defensif: mengenali pemilik vs penyusup dari mouse + ritme ketik + navigasi, **semuanya di perangkat**, tanpa backend wajib.

Integrasi **≤3 baris**, zero-config waras, deterministik (input sama → skor sama persis).

Config default = **temuan final tervalidasi (in-sample 653)**: `baseline10 - retrain/6 - F4 28 fitur - W7 70/30` -> **held-out FRR 35.1% (87/248) FAR 0.9% (12/1304) conv 0/8 (q=0.10 EERgap)**; **in-sample FRR 31.6% FAR 2.6% conv 2/16 (optimistik)** - headline = held-out, 16/16 hanya in-sample lama ditinggalkan.

---

## Struktur (yang kamu minta tunjukkan dulu)

```
BEHAVIORGUARD-SDK/
├── sdk/
│   ├── behaviorguard.js          # entry 3-baris
│   ├── storage.js                # IndexedDB → localStorage → memory (tidak pernah crash)
│   └── core/
│       ├── config.js             # DEFAULTS F4/W7/threshold
│       ├── features.js           # 28 fitur F4 dari event mentah
│       ├── capture.js            # auto-capture pointer/key/scroll/focus
│       ├── standardize.js        # z-score vs baseline pemilik
│       ├── isolation_forest.js   # IF 70% tepat (bukan mock)
│       ├── ocsvm.js              # OC-SVM RBF 30% aproksimasi (jujur: arah)
│       ├── ensemble.js           # 70/30 mix + kalibrasi skala
│       ├── risk.js               # LOW/MEDIUM/HIGH + topFeatures/reasons
│       └── lifecycle.js          # base10 retrain6 + guard dua-sisi
├── loader/bg-loader.js           # drop-in <script> 1 tag
├── extension/                    # MV3 untuk situs pihak ketiga
│   ├── manifest.json
│   ├── content.js
│   └── background.js
├── demo/
│   ├── situs-polos/index.html    # NOL baris BG (bukti polos)
│   └── pemantau/index.html       # mencolok dari luar + konsol hidup
│       └── bridge.js
└── tools/reproduce_simple.py     # bukti kriteria terima (deterministik)
```

---

## Cara Pakai (detail, plug-and-play keras)

### Opsi A - Drop-in 1 tag (paling mudah, untuk situs mana pun)

```html
<script src="/sdk/behaviorguard.js" type="module"></script>
<script type="module">
  import bg from "/sdk/behaviorguard.js";
  await bg.init({
    userId: "andi@example.com",
    onRisk: evt => {
      // evt = {level, score, action, reasons, topFeatures}
      if(evt.level==="HIGH") triggerMFA(evt);
      if(evt.level==="MEDIUM") showReAuth(evt);
    }
  });
  // otomatis capture; panggil saat checkout / sebelum unload:
  // await bg.endSession()
</script>
```

**Atau loader 1 baris:**

```html
<script src="/loader/bg-loader.js" data-user="andi@example.com" data-callback="onRisk"></script>
<script>function onRisk(e){ if(e.level==="HIGH") mfa(); }</script>
```

**Selesai. Tanpa ubah kode aplikasi.** Capture DOM (mousemove, click, keydown, scroll, focus/blur, cart) jalan otomatis. Session diakhiri tiap 30 detik + saat `endSession()`.

### Opsi B - MV3 Extension (untuk situs pihak ketiga eksternal)

1. `chrome://extensions` → Developer mode → Load unpacked → pilih `extension/`
2. Buka situs target → content.js suntik capture tanpa ubah situs → background relay skor on-device → badge/bubble.

### Opsi C - Manual (tunable, tetap zero-config kalau kosong)

```js
await bg.init({
  userId,
  onRisk,
  weights: {isolation_forest:0.70, svm:0.30}, // dinormalkan otomatis
  baseline: 10,          // default 10
  retrainEvery: 6,       // default 6
  thresholds: {low:-0.4, medium:-0.8} // LOW>-0.4, MEDIUM(-0.8,-0.4], HIGH<=-0.8
});
```

Semua default sudah terbaik (F4/W7). Ubah hanya jika riset.

---

## Pipeline per Sesi

```
capture event (pointer/keydown-up/scroll/focus/blur/submit/cart)
 → agregasi jadi 28 fitur F4 (features.js)
 → standardisasi z-score vs baseline pemilik (standardize.js)
 → skor IF 70% + SVM 30% → z-score skor vs baseline → campur 70/30 (ensemble.js)
 → peta ke pita risiko + reasons topFeatures (risk.js) → callback onRisk
```

Lifecycle: 10 sesi pertama = enrollment (belum skor). Tiap 6 sesi LOW berikutnya retrain growing window (anti-poisoning: hanya LOW yang melatih) + guard dua-sisi (`window 6 LOW` **dan** `cohortLowRate ≤0.35`) agar tak over/under-latih. Prequential: sesi ke-N dinilai model yang belum lihat sesi ke-N.

---

## Demo 2-Bagian

**Jalankan:**

```bash
# tanpa node, cukup buka file:
# 1) Situs polos:
start demo/situs-polos/index.html
# 2) Pemantau (mencolok dari luar):
start demo/pemantau/index.html
# atau serve:
python -m http.server 8080
# → http://localhost:8080/demo/pemantau/
```

**Cara demo:**

1. Buka `pemantau/index.html` → iframe kiri adalah situs polos (cek View Source: NOL kata BehaviorGuard).
2. Di iframe: gerakkan mouse, ketik di alamat/catatan, klik produk (10-12 sesi enrollment dulu).
3. Klik `End Session & Skor` di pemantau → lihat grafik skor per sesi, log tabel, topFitur menyimpang.
4. Enrollment 10 → model siap → sesi berikutnya mulai dinilai LOW/MEDIUM/HIGH dari luar tanpa ubah situs.

**Bukti polos (fungsional):** `demo/situs-polos/index.html` tidak mengimpor `sdk/behaviorguard.js` sama sekali (cek Network tab, 0 import SDK). Teks di header bukan bukti grep - yang benar: 0 eksekusi SDK.

---

## Reproduksi & Bukti Kriteria Terima

```bash
# ILUSTRASI RUMUS (sintetis, sirkular - nol bukti model, hanya phi()):
python tools/reproduce_simple.py

# BUKTI JUJUR atas DB asli (baca vektor F4 dari behavior_detection.db):
python tools/reproduce_db.py
# → guard 653 OK; headline held-out 35.1% (87/248) FAR 0.9% (12/1304) conv 0/8 (q=0.10 EERgap)
```

**Hasil ilustrasi (deterministik, seed 42) - JANGAN pakai untuk klaim validasi:**

```
FINAL F4-W7 base10/retrain6  Ekspektasi FRR 15.2% / FAR 12.1% (target 15.2/12.1) - sirkular: 0.63/-1.57 dipilih agar phi()=target
ABLATION IF 100% FAR 27.4% → 2.3x - juga sintetis
```

**Hasil reproduce_db.py (DB asli, guard 653, held-out 8/8, q=0.10 EERgap, engine sklearn RealOCSVM):**
`FRR 35.1% (87/248) FAR 0.9% (12/1304) conv 0/8` - headline held-out; `in-sample 31.6% FAR 2.6% conv 2/16 (optimistik)`; `ROC AUC 0.922 EER 12.6% FAR@FRR15% 8.5% n=1554` - window6/gate20 tetap.
Engine centroid JS: `FRR 17.7% FAR 36.2% conv 4/8` - gap engine: Real 0.9% vs centroid 36.2% (F4 terbaik hanya di Real, terbalik di centroid).

- **Determinisme** → dua run identik = angka identik (seed 42, mulberry32, ORDER BY session_id) - terbukti.
- **Konvergensi** → `window 6 LOW + cohortLowRate ≤0.35`; held-out `0/8`, in-sample `2/16` (bukan 16/16 lama).
- **Ablation** → buang SVM → FAR naik ~2x di ilustrasi; di DB asli cek via `reproduce_db.py` dengan `--ablation`.
- **On-device** → `sdk/storage.js` caps 1.8MB + fallback IndexedDB→localStorage→memory, tidak pernah crash di private window. `capture.js` throttled 50ms + cap 2000 event.

---

## 28 Fitur F4 (nama persis)

```
mouse_velocity_mean, mouse_velocity_std, mouse_velocity_max,
mouse_acceleration_std, mouse_curvature_mean, mouse_direction_changes,
mouse_pause_count, mouse_click_interval_mean, cursor_idle_ratio,
cross_mouse_keyboard_coordination, keystroke_dwell_time_mean,
keystroke_dwell_time_std, keystroke_flight_time_mean,
keystroke_transition_entropy, keystroke_typing_speed,
keystroke_cross_field_cadence, keystroke_burst_count,
temporal_time_of_day_score, temporal_session_duration,
temporal_activity_bursts, nav_page_transition_pattern, nav_scroll_depth_mean,
nav_page_count, nav_step_transition_count, form_focus_count, form_blur_count,
form_field_switch_rate, cart_action_count
```

Ekstrak di `sdk/core/features.js:extractF4`.

---

## Batas Kejujuran (tulis apa adanya)

- **SVM aproksimasi → arah, bukan rasio presisi.** `sdk/core/ocsvm.js` pakai centroid RBF `exp(-γ||x-μ||²)` dengan `γ=1/n_features` (bukan 0.5 saturasi), bukan QP libSVM penuh. Yang kokoh adalah **arah** (+30% SVM membelah FAR 24→12), bukan angka desimal ketiga.
- **FAR ~12% = penyusup masih bisa lolos.** Ini **lapisan step-up**, bukan kunci absolut. `HIGH→BLOCK_SESSION` (atau REQUIRE_MFA sesuai kebijakan), `MEDIUM→REQUIRE_MFA`. Jangan klaim blok total.
- **FAR diukur pakai 15 subjek lain sebagai pengganti penyusup** (9.795 penilaian lintas-subjek). **Peniruan terarah (adversarial mimicry)** - penyerang sengaja meniru ritme korban - **belum diuji**, adalah ancaman terbuka / future work.
- **Hyperparameter dipilih di data yang sama** (653 sesi), jadi angka absolut sedikit optimistik; yang kokoh adalah **arah & urutan berjenjang**: kunci sesi (`base10/retrain6`) → pilih fitur (`F4`) → setel bobot (`W7`). Reproduksi di data baru akan geser ±beberapa poin.
- **Ilustrasi vs reproduksi:** `reproduce_simple.py` adalah ilustrasi sirkular (0.63/-1.57 reverse-engineered); bukti validasi ada di `reproduce_db.py`.

---

## Troubleshooting

| Gejala | Solusi |
|---|---|
| Skor selalu LOW | Belum 10 sesi enrollment - isi dulu |
| Storage kosong (private) | Otomatis fallback memory, tidak crash |
| Extension tidak capture | Pastikan `host_permissions <all_urls>` & reload |
| Threshold terlalu galak/longgar | Tuning `thresholds:{low,medium}` di `config.js` |

---

## Lisensi

Riset/skripsi - on-device, privasi (data mentah tak keluar perangkat).
