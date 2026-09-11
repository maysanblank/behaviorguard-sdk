/**
 * config.js - default SDK yang DIKIRIM.
 *
 * Angka resmi diukur dengan SDK ini sendiri (`node tools/eval_sdk.mjs --live`: 653 sesi,
 * 16 subjek, jendela 30 dtk persis setInterval browser, step-up dijawab lewat API publik):
 *   pemilik diminta verifikasi 14,5%   diblokir 0%
 *   penyusup lolos vonis pertama 13,3%   lolos seluruh sesinya 9,2%
 *   ambil-alih ketahuan di sesi pertama 89,6%   tak ketahuan dalam 6 sesi 0%
 *   AUC / EER per pemilik 0,927 / 12,3%
 * Titik operasi lain (k_low) dan mode ketat (session.contextEvents): README "Choosing an
 * operating point" dan core/DRIFT.md C-42, C-43.
 *
 * Angka lama di berkas ini (FRR 16,1% / FAR 5,4%, lalu 16,4% / 13,5%) TIDAK berlaku lagi:
 * yang pertama diukur harness Python atas sesi riset utuh (bukan jendela 30 dtk yang
 * dinilai SDK, lihat C-29), yang kedua sebelum masa berlaku step-up (C-43).
 */
export const DEFAULTS = {
  // C-26/C-27: sempat disimpulkan 10 TERLALU PENDEK (pendaftaran 16 jauh lebih baik).
  // KLAIM ITU DITARIK. Ia diukur lewat tools/reproduce_db.py, yang memakai sklearn
  // OCSVM + bobot IF 0,70 — BUKAN Mahalanobis + IF 0,30 yang dikirim dari file ini.
  // Di mesin yang benar, 10 lawan 16 (himpunan uji identik) memberi AUC 0,948 vs 0,946
  // dan EER 11,6% vs 10,9% — selisihnya di dalam sebaran antar-belahan. Shrinkage
  // adaptif C-22 memang sudah menangani n kecil, jadi menambah sesi tidak menambah apa
  // apa. Tetap 10. Lihat core/DRIFT.md C-27.
  baseline: 10,               // sesi pendaftaran awal
  retrainEvery: 6,            // retrain tiap N sesi pemilik baru
  // detektor-2 ('svm' slot) kini Mahalanobis (bukan centroid) -> diberi bobot mayoritas
  weights: { isolation_forest: 0.30, svm: 0.70, lstm: 0.00 },
  // 28 fitur F4 - nama persis, urutan tetap (deterministik)
  features: [
    'mouse_velocity_mean','mouse_velocity_std','mouse_velocity_max',
    'mouse_acceleration_std','mouse_curvature_mean','mouse_direction_changes',
    'mouse_pause_count','mouse_click_interval_mean','cursor_idle_ratio',
    'cross_mouse_keyboard_coordination','keystroke_dwell_time_mean',
    'keystroke_dwell_time_std','keystroke_flight_time_mean',
    'keystroke_transition_entropy','keystroke_typing_speed',
    'keystroke_cross_field_cadence','keystroke_burst_count',
    'temporal_time_of_day_score','temporal_session_duration',
    'temporal_activity_bursts','nav_page_transition_pattern','nav_scroll_depth_mean',
    'nav_page_count','nav_step_transition_count','form_focus_count','form_blur_count',
    'form_field_switch_rate','cart_action_count'
  ],
  // pita risiko default (fallback) - di runtime dikalibrasi per-user dari baseline
  thresholds: { low: -0.4, medium: -0.8 },
  calibrateThresholds: true,
  // kalibrasi pita risiko: 'parametric' (mean-k*std, efisien titik-operasi) default
  calibrationMode: 'parametric',
  // C-33: k_low 3,3 -> 1,75. Nilai 3,3 dipilih di atas data riset yang 25-42% eventnya
  // KEMBAR (C-29) dan dengan satuan sesi utuh; di SDK sungguhan ia meloloskan 27,6%
  // penyusup di vonis pertamanya. Dipilih ulang dengan SDK ini sendiri, mode live, bukti
  // 150 event, tuning di 8 subjek & lapor di 8 lainnya, 5 belahan: tuner memilih
  // 1,5-2,0 (median 1,75). Hasil lapor rerata: pemilik diminta verifikasi 16,6%
  // [12..19], penyusup lolos vonis pertama 8,9% [4..14], diblokir 0%. Integrator bisa
  // menggeser: init({calibration:{k_low}}) — kecil = ketat, besar = longgar.
  k_low: 1.75, k_med_extra: 2.0, // k_med_extra lebar -> HIGH jadi step-up, bukan block
  q_low: 0.10, q_med: 0.033, // dipakai bila calibrationMode='quantile'
  convergence: { window: 6, cohortLowRate: 0.35, minSessions: 10 },
  iforest: { n_estimators: 100, max_samples: 256, seed: 42 },
  model2: 'mahalanobis',            // 'mahalanobis' | 'centroid'
  mahalanobis: { shrink: 0.3 },     // shrinkage diagonal (Ledoit-Wolf sederhana)
  ocsvm: { gamma: null, seed: 42 },
  // HIGH satu sesi -> step-up (bukan block). Blokir keras hanya bila HIGH berturut >= N.
  blockAfterConsecutiveHigh: 2,
  // MFA behavioral BAWAAN: popup otomatis saat MEDIUM/HIGH (ketik ulang frasa, cek ritme).
  // enabled default true -> "colok library, MFA langsung jalan". Matikan: mfa.enabled=false.
  mfa: {
    enabled: true,
    phrase: 'kunci rahasia saya',   // frasa yang diketik ulang (integrator boleh ganti)
    rounds: 3,                       // berapa kali ketik saat pendaftaran template ritme
    triggerOn: ['MEDIUM', 'HIGH'],   // vonis yang memunculkan popup
    cooldownMs: 15000,               // jangan popup lagi dalam N ms setelah lolos
    timeoutMs: 120000,               // C-18: popup yang diabaikan menutup sendiri
    enrollTimeoutMs: 60000,          // pendaftaran lebih pendek: sifatnya opsional
    enrollSnoozeMs: 86400000,        // C-37: ditutup/diabaikan -> jangan tawarkan lagi 24 jam
    // C-43: sesudah verifikasi TERBUKTI (MFA bawaan / reportStepUp passed), MEDIUM tidak
    // meminta verifikasi ulang selama graceSec; HIGH tetap; absen >= idle.awaySec
    // mencabutnya. eval_sdk --live: pemilik diminta verifikasi 16,4% -> 14,5%, penyusup
    // lolos vonis pertama 13,5% -> 13,3%, ambil-alih tak ketahuan tetap 0%. 0 = mati.
    graceSec: 900,
  },
  // === ACUAN server/config.py ===
  ensembleMinSamples: { isolation_forest: 8, svm: 20, lstm: 24 },
  // C-22: dinaikkan 30→90. Kolam maks lama = base(10)+30 = 40; dgn d=28 fitur itu
  // n≈1.4d, kovarians Mahalanobis masih goyah. Kolam lebih besar membuat shrink
  // adaptif (lihat behaviorguard._rebuildModel) meluruh ke dasar 0.3 → korelasi penuh
  // kelas riset kembali (deteksi penyusup-mirip membaik) untuk pengguna yang terus pakai.
  progressiveMaxPool: 90,
  // C-31: riwayat vonis yang disimpan = blok pendaftaran utuh + historyMax entri terakhir.
  // Harus > progressiveMaxPool (kolam diambil dari sini) + jendela konvergensi.
  historyMax: 240,
  // C-35: sesi yang jarak RMS terstandarnya (tanpa fitur temporal) ke sesi tersimpan mana
  // pun < replayEps dianggap rekam-ulang. Manusia terdekat di data riset: 0,289.
  replayEps: 0.05,
  progressiveDupEps: 1e-3,
  // C-23: `idleGapSec` = jeda yang TIDAK BOLEH diukur melintasinya. Disamakan dengan
  // windowSec (30 dtk): jeda sepanjang satu jendela penilaian bukan lagi perilaku.
  //
  // PERINGATAN HASIL (10 Sep 2026, 5 belahan 8/8, core/DRIFT.md):
  // segmentasi ini adalah KOREKSI KEBENARAN PENGUKURAN yang sahih (durasi 731 -> 5,5
  // dtk, interval klik 48.708 -> 710 ms), tapi ia TIDAK memperbaiki FRR/FAR — malah
  // merugikan daya pisah: EER 10,7% -> 16,1%, rentang [14..19] tidak beririsan dengan
  // kontrol [9..12]. Melonggarkan ambang tidak menolong (30/120/300 dtk: FRR 35,3% ->
  // 39,9% -> 42,3%). JANGAN kutip segmentasi ini sebagai peningkatan akurasi.
  // Nilai ini juga menyetir idleAccounting dan ABSTAIN, yang TIDAK ikut teradili di
  // tolok ukur itu.
  //
  // C-28: `idleCompressSec` MENGGANTIKAN segmentasi di atas untuk jalur PENILAIAN.
  // Tiap jeda ≥ 15 dtk dipendekkan jadi 15 dtk dan sesi dinilai utuh — tak ada event
  // dibuang, sesi tak dipecah. Held-out 5 belahan (AFK 2-20 mnt disuntik ke sesi
  // evaluasi): FRR 18,4% -> 9,7%, FAR 9,2% -> 9,3%, AUC 0,952 -> 0,968. Tanpa AFK
  // netral: FRR 11,0% -> 10,1%, AUC 0,961 -> 0,964. Dengan knob ini nyala, idleGapSec
  // hanya dipakai untuk akuntansi idle, ekor buffer, dan ABSTAIN. 0 = jalur C-23 lama.
  //
  // C-33: `minEventsAssess` 30 -> 150 dan `carryMaxAgeSec` 900. Vonis dulu jatuh tiap
  // jendela 30 dtk (~30-100 event) — satuan yang TIDAK PERNAH diukur: semua angka lama
  // memakai sesi riset utuh (~700 event). Diukur dengan SDK ini sendiri
  // (tools/eval_sdk.mjs --live, jendela 30 dtk persis setInterval browser), EER per
  // pemilik: 30 ev 23,8% | 100 ev 14,2% | 150 ev 12,3% | 200 ev 10,7% (tapi 4,5% sesi
  // penyusup tak pernah mendapat vonis). Kini jendela tetap berdetak tiap 30 dtk, tetapi
  // bukti yang belum cukup DIKUMPULKAN (hingga 15 mnt) sampai 150 event. Untuk aksi
  // sensitif sebelum bukti cukup: `assessNow()`.
  //
  // C-42: `contextEvents` (0 = mati) = MODE KETAT opt-in. Vonis pertama kunjungan tetap di
  // 150 event baru; vonis berikutnya menilai event baru + event yang baru dinilai, sampai
  // N total (hanya tab ini, dibuang setelah absen). Terukur dengan graceSec 900, N=450:
  // penyusup lolos vonis pertama 13,3% -> 10,1%, seluruh sesi 9,2% -> 8,2%, pemilik
  // 14,5% -> 14,5% — TAPI satu dari 15 penyusup lolos 6 sesi berturut di 3 akun (0 -> 3
  // dari 240 pasangan). Karena itu tidak dijadikan default. Lihat core/DRIFT.md C-42.
  session: { minEventsAssess: 150, minEventsTrain: 100, minDurationSec: 5.0, minNonZeroFeatures: 6, windowSec: 30, idleGapSec: 30, idleCompressSec: 15, carryMaxAgeSec: 900, canonicalWindow: 0, contextEvents: 0 },
  // C-23: idle punya DUA konsekuensi, jadi dua ambang berbeda.
  //  - awaySec (300): batas "kursi mungkin kosong". Kepercayaan dari SEBELUM absen
  //    tidak boleh dibawa menyeberang — streak LOW direset, sesi diukur dari nol.
  //  - reverifyAfterSec (900): absen selama ini -> minta verifikasi ulang walau
  //    perilaku sesudahnya terlihat LOW. Ini jawaban untuk serangan "jam makan
  //    siang": pemilik pergi, orang lain duduk di kursi yang sama. 15 menit
  //    sejajar dengan batas idle-timeout PCI DSS 8.2.8 (di sana itu MAKSIMUM).
  //  - emitAbstain: jendela yang isinya idle/bukti kurang TIDAK lagi diam-diam
  //    dianggap aman. Sistem menerbitkan vonis 'UNKNOWN' + action 'ABSTAIN' sekali
  //    per rentetan idle, supaya integrator tahu bedanya "terverifikasi aman" dan
  //    "tidak ada bukti apa-apa" (lihat docs/USULAN-KONTEKS-DAN-IDLE.md §2).
  idle: {
    awaySec: 300,
    reverifyAfterSec: 900,
    emitAbstain: true,
    abstainAfterWindows: 4,   // 4 x windowSec = ~2 menit tanpa bukti -> ABSTAIN
  },
  // === C-24: INVARIANSI PANJANG SESI (ketiganya OPT-IN, default = perilaku lama) ===
  // Ablasi C-23 memunculkan cacat yang lebih tua dari idle: 9 dari 28 fitur adalah
  // hitungan mentah yang membesar bersama panjang sesi, jadi SETIAP perubahan panjang
  // terbaca sebagai perubahan identitas. Terukur: |z| fitur-cacah 0,96 -> 2,02 hanya
  // karena sesi dipotong separuh, tanpa jeda apa pun.
  //
  // Ada dua cara memperbaiki. (a) ubah rumusnya jadi laju -> SPEC v1.3, regenerasi
  // golden, sinkron 4 port, dan semua angka lama kehilangan reprodusibilitas.
  // (b) buat panjangnya KONSTAN, sehingga cacahan otomatis sebanding — nol baris
  // rumus fitur yang berubah. Yang dipilih (b).
  //
  // canonicalWindow (K event): tiap segmen kontigu dipotong jadi jendela K event.
  //   Cacahan berubah makna jadi KOMPOSISI ("dari K event, berapa yang klik") dan
  //   temporal_session_duration jadi KECEPATAN ("berapa lama menghasilkan K event") —
  //   keduanya lebih biometrik daripada "sesinya kebetulan sepanjang apa".
  //   WAJIB dipakai di pendaftaran DAN penilaian, kalau tidak cuma menukar satu
  //   ketidakcocokan latih-vs-pakai dengan yang lain.
  //   Terukur (K=120, tools/idle_ablation.py): |z| fitur-cacah pemilik-dipotong
  //   2,02 -> 1,01, yaitu sama persis dengan sesi utuh. Invariansi pulih penuh.
  //
  // aggregateWindows (M): jendela pendek lebih lemah per-vonis, jadi bukti M jendela
  //   dikumpulkan sebelum divonis. Ini menukar LATENSI dengan KEYAKINAN, bukan FRR
  //   dengan FAR. Terukur: AUC 0,770 (M=1) -> 0,789 -> 0,808 -> 0,829 (M=5).
  //
  // calibrationHoldout: porsi kolam yang disisihkan KHUSUS untuk mengkalibrasi ambang.
  //   `_rebuildModel` mengkalibrasi dari skor vektor yang persis dipakai memfit;
  //   skor in-sample selalu optimistik, jadi ambangnya terlalu rapat dan sesi PEMILIK
  //   berikutnya jatuh di luarnya. Pola yang sama sudah menghantam proyek ini di C-22.
  //   Terukur (K=120, M=3): FRR 46,5% -> 27,8%, EER 32,9% -> 28,6%.
  //
  // SEMUANYA DEFAULT MATI. Invariansinya nyata dan terukur (tabel |z| di atas), tapi
  // KEUNTUNGAN FRR/FAR-nya belum terbukti. Diuji di bawah protokol held-out
  // reproduce_db.py, kanonik 120 lawan kontrolnya: AUC 0,820 vs 0,907 (kalah),
  // 0,802 vs 0,924 (kalah), lalu 0,863 vs 0,825 (menang) — tiga konfigurasi protokol,
  // tiga jawaban. Perbandingannya belum stabil; lihat koreksi di core/DRIFT.md.
  // Default mati karena TIDAK ADA BUKTI ia menolong — bukan karena terbukti merugikan.
  // Nyalakan hanya kalau ada alasan spesifik, dan ukur ulang dengan beberapa belahan
  // 8/8 (`--seeds`) sebelum angkanya dikutip.
  aggregateWindows: 1,
  calibrationHoldout: 0,
};

// normalisasi bobot otomatis jadi 100%
export function normalizeWeights(w){
  const s = (w.isolation_forest||0)+(w.svm||0)+(w.lstm||0);
  if(s<=0) return {...DEFAULTS.weights};
  return {
    isolation_forest: (w.isolation_forest||0)/s,
    svm: (w.svm||0)/s,
    lstm: (w.lstm||0)/s
  };
}
