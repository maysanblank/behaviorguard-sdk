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
  },
  // === ACUAN server/config.py ===
  ensembleMinSamples: { isolation_forest: 8, svm: 20, lstm: 24 },
  progressiveMaxPool: 30,
  progressiveDupEps: 1e-3,
  session: { minEventsAssess: 30, minEventsTrain: 100, minDurationSec: 5.0, minNonZeroFeatures: 6, windowSec: 30 }
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
