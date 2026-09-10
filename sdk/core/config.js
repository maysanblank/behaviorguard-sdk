/**
 * config.js - default terbaik hasil validasi prequential 653 sesi / 16 subjek
 * Tahap 1: base10 + retrain/6 | Tahap 2: F4 28 fitur | Tahap 3: detektor-2 Mahalanobis
 * HASIL held-out (8 subjek tak terlihat) untuk konfigurasi INI PERSIS
 * (maha shrink .3, IF .30/maha .70, kalibrasi parametrik k_low 3.3 k_med_extra 2.0):
 *   FRR 16.1%  FAR 5.4%  AUC 0.942  EER 11.9%  FAR@FRR15% 7.7%  konvergen 3/8
 * Reproduksi: `python tools/experiment.py --calib parametric` -> baris "maha s.3 3/7".
 * Model lama (centroid W7, kuantil): FRR 17.7% FAR 36.2% AUC 0.860 EER 21.0%.
 * KOREKSI 2026-09-04: baris ini dulu menulis "AUC 0.956 EER 9.7%" — itu diambil dari
 * run KUANTIL, bukan parametrik, jadi tercampur dua titik operasi. Angka di atas
 * seluruhnya dari satu run yang sama.
 */
export const DEFAULTS = {
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
  k_low: 3.3, k_med_extra: 2.0, // k_low=security-first; k_med_extra lebar -> HIGH jadi MFA, bukan block
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
  },
  // === ACUAN server/config.py ===
  ensembleMinSamples: { isolation_forest: 8, svm: 20, lstm: 24 },
  // C-22: dinaikkan 30→90. Kolam maks lama = base(10)+30 = 40; dgn d=28 fitur itu
  // n≈1.4d, kovarians Mahalanobis masih goyah. Kolam lebih besar membuat shrink
  // adaptif (lihat behaviorguard._rebuildModel) meluruh ke dasar 0.3 → korelasi penuh
  // kelas riset kembali (deteksi penyusup-mirip membaik) untuk pengguna yang terus pakai.
  progressiveMaxPool: 90,
  progressiveDupEps: 1e-3,
  // C-23: `idleGapSec` = jeda yang TIDAK BOLEH diukur melintasinya. Disamakan dengan
  // windowSec (30 dtk): jeda sepanjang satu jendela penilaian bukan lagi perilaku.
  session: { minEventsAssess: 30, minEventsTrain: 100, minDurationSec: 5.0, minNonZeroFeatures: 6, windowSec: 30, idleGapSec: 30, canonicalWindow: 0 },
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
  // SEMUANYA DEFAULT MATI, dan sekarang ada alasan TERUKUR-nya. Diuji ulang di bawah
  // protokol held-out reproduce_db.py yang sah (tools/canonical_holdout.py):
  //   sesi utuh, tanpa AFK (kontrol)       AUC 0,907  EER 17,9%  FAR@FRR15 20,1%
  //   kanonik 120, tanpa AFK               AUC 0,820  EER 24,6%  FAR@FRR15 46,4%
  // Jendela kanonik KALAH telak di korpus ini: jendela 120 event membuang lebih banyak
  // bukti daripada yang diselamatkannya dari ketidakinvariansian panjang sesi.
  // Invariansinya nyata (lihat tabel |z| di atas) tapi harganya terlalu mahal di sini.
  // Ini HASIL NEGATIF dan dilaporkan apa adanya. Nyalakan hanya kalau ada alasan
  // spesifik, dan ukur ulang dengan protokol yang sah sebelum angkanya dikutip.
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
