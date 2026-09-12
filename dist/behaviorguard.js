/* BehaviorGuard bundle - AUTO-GENERATED oleh tools/bundle.py. Jangan edit tangan. */
(function(){
'use strict';
var __CURRENT = document.currentScript;
var __M = {};

/* ---- core/config.js ---- */
__M["core/config.js"] = (function(){
/**
 * config.js - default SDK yang DIKIRIM.
 *
 * Angka resmi diukur dengan SDK ini sendiri (`node tools/eval_sdk.mjs --live`: 653 sesi,
 * 16 subjek, jendela 30 dtk persis setInterval browser, sesi URUT WAKTU seperti pemakaian
 * nyata, step-up dijawab lewat API publik):
 *   pemilik diminta verifikasi 11,4%   diblokir 0%
 *   penyusup lolos vonis pertama 10,5%   lolos seluruh sesinya 7,9%
 *   (penyusup yang memakai akun di jam biasa pemilik: 14,3% / 10,8%)
 *   ambil-alih ketahuan di sesi pertama 95,0%   tak ketahuan dalam 6 sesi 0,4% (1/240)
 *   AUC / EER per pemilik 0,953 / 10,1%
 * Titik operasi lain (k_low) dan mode ketat (session.contextEvents): README "Choosing an
 * operating point" dan core/DRIFT.md C-42, C-43.
 *
 * Angka lama di berkas ini (FRR 16,1% / FAR 5,4%, lalu 16,4% / 13,5%) TIDAK berlaku lagi:
 * yang pertama diukur harness Python atas sesi riset utuh (bukan jendela 30 dtk yang
 * dinilai SDK, lihat C-29), yang kedua sebelum masa berlaku step-up (C-43).
 */
const DEFAULTS = {
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
  // 34 fitur F4 (28 + 6 ritme ketik C-44) - nama persis, urutan tetap (deterministik)
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
    'form_field_switch_rate','cart_action_count',
    // C-44: ritme ketik yang tak tercemar jeda panjang + kebiasaan koreksi & tangan.
    // eval_sdk --live (sesi urut waktu): pemilik diminta verifikasi 12,2% -> 11,4%,
    // penyusup lolos vonis pertama 12,6% -> 10,5%, AUC per-pemilik 0,942 -> 0,953.
    'keystroke_flight_median','keystroke_flight_iqr','keystroke_backspace_ratio',
    'keystroke_cross_hand_ratio','keystroke_dwell_median','keystroke_shift_ratio'
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
    timeoutMs: 120000,               // C-18: popup yang diabaikan menutup sendiri (C-45: sejak input terakhir)
    enrollTimeoutMs: 90000,          // C-45: dihitung dari ketidakaktifan, bukan sejak dialog dibuka
    enrollSnoozeMs: 86400000,        // C-37: ditutup/diabaikan -> jangan tawarkan lagi 24 jam
    // C-43: sesudah verifikasi TERBUKTI (MFA bawaan / reportStepUp passed), MEDIUM tidak
    // meminta verifikasi ulang selama graceSec; HIGH tetap; absen >= idle.awaySec
    // mencabutnya. eval_sdk --live: pemilik diminta verifikasi 16,4% -> 14,5%, penyusup
    // lolos vonis pertama 13,5% -> 13,3%, ambil-alih tak ketahuan tetap 0%. 0 = mati.
    // (Angka C-43 itu diukur pada 28 fitur, sesi urut-id. Tanpa grace pada mesin C-44:
    // pemilik 12,5% -> 11,4% dengan grace, penyusup 10,5% sama.)
    graceSec: 900,
    // C-45: tampilan & jalur cadangan dialog (semuanya opsional)
    //   onFallback: async ({level, reasons, trigger, why}) => boolean  - OTP/WebAuthn milik
    //               integrator, DIVERIFIKASI SERVER; memunculkan tombol "Gunakan cara lain"
    //   autoEnroll: false -> pendaftaran irama hanya lewat BehaviorGuard.enrollMfa()
    //   brand, accent (warna CSS), theme ('auto'|'light'|'dark'), lang ('id'|'en'), texts
    autoEnroll: true,
    theme: 'auto',
    // C-46: batas waktu untuk `onFallback` MILIK INTEGRATOR. Promise yang tak pernah selesai
    // dulu menyangkutkan seluruh lapisan step-up seumur halaman. 0 = tanpa batas (jangan).
    fallbackTimeoutMs: 300000,
    // C-45: sesudah N dialog irama gagal BERTURUT (lintas kunjungan), jalur irama dikunci dan
    // verifikasi hanya lewat onFallback sampai berhasil. 0 = tanpa batas (tidak disarankan).
    lockAfterFailures: 3,
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
  // C-44 (34 fitur, urut waktu), N=450 + k_low 2,0: pemilik 11,0%, penyusup vonis pertama
  // 8,7%, seluruh sesi 7,9%, tak pernah ketahuan 0/240 — tapi pada data ber-AFK penyusup
  // naik (5,6% -> 6,5% seluruh sesi), jadi tetap opt-in.
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
function normalizeWeights(w){
  const s = (w.isolation_forest||0)+(w.svm||0)+(w.lstm||0);
  if(s<=0) return {...DEFAULTS.weights};
  return {
    isolation_forest: (w.isolation_forest||0)/s,
    svm: (w.svm||0)/s,
    lstm: (w.lstm||0)/s
  };
}
return {DEFAULTS: DEFAULTS, normalizeWeights: normalizeWeights};
})();

/* ---- core/standardize.js ---- */
__M["core/standardize.js"] = (function(){
/**
 * standardize.js - z-score terhadap sebaran baseline pemilik (deterministik)
 */
function computeStats(vectors){
  // vectors: n x d
  if(!vectors.length) return {mean:[], std:[]};
  const d=vectors[0].length;
  const mean=new Array(d).fill(0);
  for(const v of vectors) for(let i=0;i<d;i++) mean[i]+=v[i];
  for(let i=0;i<d;i++) mean[i]/=vectors.length;
  const variance=new Array(d).fill(0);
  for(const v of vectors) for(let i=0;i<d;i++){ const diff=v[i]-mean[i]; variance[i]+=diff*diff; }
  for(let i=0;i<d;i++) variance[i]= variance[i]/vectors.length;
  const std=variance.map(v=> Math.sqrt(v) < 1e-9 ? 1 : Math.sqrt(v));
  return {mean,std};
}
function standardize(vec, stats){
  return vec.map((v,i)=> (v-stats.mean[i])/stats.std[i]);
}
function standardizeBatch(X, stats){ return X.map(v=> standardize(v, stats)); }

// untuk skor ensemble: z-score skor terhadap baseline
function scoreStats(scores){
  const m=scores.reduce((s,v)=>s+v,0)/scores.length;
  let s=Math.sqrt(scores.reduce((a,val)=>a+(val-m)**2,0)/scores.length);
  // guard: jangan biarkan std < 1e-6 membesarkan noise (OCSVM saturasi)
  if(!Number.isFinite(s) || s < 1e-3) s = 1e-3;
  // juga jangan std raksasa >10 mengecilkan sinyal
  if(s > 10) s = 10;
  return {mean:m, std:s};
}
function zScore(val, st){
  // clamp z ke [-6,6] agar tidak overflow
  const z=(val - st.mean)/st.std;
  return Math.max(-6, Math.min(6, z));
}
return {computeStats: computeStats, standardize: standardize, standardizeBatch: standardizeBatch, scoreStats: scoreStats, zScore: zScore};
})();

/* ---- core/features.js ---- */
__M["core/features.js"] = (function(){
/**
 * features.js - ekstraksi 34 fitur F4 dari event mentah (on-device, deterministik)
 * Input: event[] {event_type, timestamp, x,y, key, hold_time, page_url, scroll_delta, ...}
 * Output: {featureName: float} lengkap 34, selalu finite
 */
const { DEFAULTS } = __M["core/config.js"];

const F4 = DEFAULTS.features;

// helper
const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0;
const std  = a => { if(!a.length) return 0; const m=mean(a); return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length); };
const safe = v => (Number.isFinite(v) ? v : 0);

function extractF4(events, sessionStartTs){
  if(!events || !events.length){
    const o={}; F4.forEach(k=>o[k]=0); return o;
  }
  // pisah per tipe
  const is = (e,t) => e.event_type===t;
  const mouseMove = events.filter(e=> is(e,'MOUSE_MOVE'));
  const mouseClick= events.filter(e=> is(e,'MOUSE_CLICK'));
  const mouseEv   = [...mouseMove, ...mouseClick, ...events.filter(e=> is(e,'MOUSE_SCROLL'))];
  const keyEv     = events.filter(e=> is(e,'KEYSTROKE'));
  const scrollEv  = events.filter(e=> is(e,'MOUSE_SCROLL'));
  const focusEv   = events.filter(e=> is(e,'FORM_FOCUS'));
  const blurEv    = events.filter(e=> is(e,'FORM_BLUR'));
  const navEv     = events.filter(e=> is(e,'NAVIGATION')||is(e,'PAGE_STEP'));

  // --- mouse velocity / acceleration / curvature ---
  let velocities=[], accelerations=[], pauses=0, directionChanges=0, lastDir=null, curvatures=[];
  for(let i=1;i<mouseEv.length;i++){
    const p=mouseEv[i-1], c=mouseEv[i];
    const dt=(c.timestamp||0)-(p.timestamp||0); if(dt<=0) continue;
    const dx=(c.x||0)-(p.x||0), dy=(c.y||0)-(p.y||0);
    const dist=Math.hypot(dx,dy);
    const v=dist/dt; velocities.push(v);
    if(dist>0){
      const dir=Math.atan2(dy,dx);
      // SPEC 1.3 (C-34): toleransi 1e-9 di atas pi/4. Gerakan piksel bulat sangat sering
      // berselisih arah TEPAT pi/4 (482 pasangan di 192 sesi riset), dan atan2 V8 vs libm
      // Python berbeda 1-2 ulp di sana -> perbandingan berbalik di satu bahasa saja.
      if(lastDir!==null && Math.abs(dir-lastDir)>Math.PI/4+1e-9) directionChanges++;
      lastDir=dir;
    }
    if(velocities.length>1){
      const a=(v-velocities[velocities.length-2])/dt; accelerations.push(a);
    }
    if(i>=2){
      const p2=mouseEv[i-2];
      const x0=p2.x||0,y0=p2.y||0,x1=p.x||0,y1=p.y||0,x2=c.x||0,y2=c.y||0;
      const area=x0*(y1-y2)+x1*(y2-y0)+x2*(y0-y1);
      const sa=Math.hypot(x1-x0,y1-y0), sb=Math.hypot(x2-x1,y2-y1), sc=Math.hypot(x2-x0,y2-y0);
      if(sa*sb*sc>0) curvatures.push(Math.abs(4*area/(sa*sb*sc)));
    }
    if(dt>100) pauses++; // jeda dianggap pause
  }
  const clickIntervals=[];
  for(let i=1;i<mouseClick.length;i++) clickIntervals.push((mouseClick[i].timestamp||0)-(mouseClick[i-1].timestamp||0));

  // cursor_idle_ratio
  let cursorIdle=0;
  if(mouseMove.length){
    let idle=0; for(const e of mouseMove) if((e.velocity||0)<0.5) idle++;
    cursorIdle=idle/mouseMove.length;
    // fallback kalau velocity tidak ada: hitung dari jarak kecil
    if(cursorIdle===0 && velocities.length){
      const slow=velocities.filter(v=>v<0.05).length;
      cursorIdle=slow/velocities.length;
    }
  }

  // cross_mouse_keyboard_coordination
  let alternations=0, lastType=null;
  const allMK=[...mouseEv, ...keyEv].sort((a,b)=>(a.timestamp||0)-(b.timestamp||0));
  for(const e of allMK){
    const cur = (e.event_type||'').includes('MOUSE')?'mouse':'keyboard';
    if(lastType && lastType!==cur) alternations++;
    lastType=cur;
  }
  const crossCoord = allMK.length ? alternations/allMK.length : 0;

  // keystroke
  const holdTimes = keyEv.map(e=>e.hold_time).filter(v=>v!=null);
  const flightTimes=[];
  for(let i=1;i<keyEv.length;i++) flightTimes.push((keyEv[i].timestamp||0)-(keyEv[i-1].timestamp||0));
  const keyEntropy = (()=>{
    if(keyEv.length<2) return 0;
    const trans={}; for(let i=1;i<keyEv.length;i++){ const k=(keyEv[i-1].key||'')+'->'+(keyEv[i].key||''); trans[k]=(trans[k]||0)+1; }
    const total=keyEv.length-1; let h=0; for(const c of Object.values(trans)){ const p=c/total; h-=p*Math.log(p+1e-9); } return h;
  })();
  const burstCount = (()=>{
    let c=0,inBurst=false;
    for(let i=1;i<keyEv.length;i++){ const dt=(keyEv[i].timestamp||0)-(keyEv[i-1].timestamp||0); if(dt<333){ if(!inBurst){c++; inBurst=true;} } else inBurst=false; }
    return c;
  })();
  const focusTimes = focusEv.map(e=>e.timestamp||0).sort((a,b)=>a-b);
  const ksTimes = keyEv.map(e=>e.timestamp||0).sort((a,b)=>a-b);
  const crossGaps=[];
  for(const ft of focusTimes){
    const before=ksTimes.filter(t=>t<ft).pop();
    const after=ksTimes.find(t=>t>=ft);
    if(before!=null && after!=null) crossGaps.push(after-before);
  }

  // temporal
  const firstTs=events[0].timestamp||sessionStartTs||Date.now();
  const lastTs=events[events.length-1].timestamp||firstTs;
  const duration=(lastTs-firstTs)/1000;
  const d=new Date(firstTs);
  // SPEC v1.1 D-3: pakai UTC (bukan waktu lokal) supaya vektor identik lintas zona waktu.
  const timeOfDay=(d.getUTCHours()+d.getUTCMinutes()/60)/24;
  const perSec={}; events.forEach(e=>{ const s=Math.floor((e.timestamp||0)/1000); perSec[s]=(perSec[s]||0)+1; });
  const counts=Object.values(perSec);
  const mAct=mean(counts), sAct=std(counts);
  const bursts=counts.filter(c=>c>mAct+2*sAct).length;

  // navigasi & form
  const pageUrls=navEv.map(e=>e.page_url).filter(Boolean);
  const uniquePages=new Set(pageUrls).size;
  // page count dari semua event yang punya page_url (lebih akurat)
  const allPages=new Set(events.map(e=>e.page_url).filter(Boolean)).size;
  const pageTrans = pageUrls.length ? uniquePages/pageUrls.length : 0;
  const scrollDeltas=scrollEv.map(e=>Math.abs(e.scroll_delta||0));
  // time per page (dari nav event)
  const pageMap={};
  for(const e of navEv){ const u=e.page_url||''; if(!u) continue; const ts=e.timestamp||0; if(!pageMap[u]) pageMap[u]={first:ts,last:ts}; else pageMap[u].last=ts; }
  const perPageTimes=Object.values(pageMap).map(p=>(p.last-p.first)/1000).filter(v=>v>0);
  const focusTimesSorted=focusEv.map(e=>e.timestamp||0).sort((a,b)=>a-b);
  const fieldGaps=[];
  for(let i=1;i<focusTimesSorted.length;i++){ const g=focusTimesSorted[i]-focusTimesSorted[i-1]; if(g>0) fieldGaps.push(g); }

  // aman untuk sesi panjang: hindari spread + stack overflow
  const vmax=velocities.length ? velocities.reduce((m,v)=>v>m?v:m, -Infinity) : 0;
  const out={
    mouse_velocity_mean: safe(mean(velocities)),
    mouse_velocity_std: safe(std(velocities)),
    mouse_velocity_max: safe(vmax),
    mouse_acceleration_std: safe(std(accelerations)),
    mouse_curvature_mean: safe(mean(curvatures)),
    mouse_direction_changes: safe(directionChanges),
    mouse_pause_count: safe(pauses),
    mouse_click_interval_mean: safe(mean(clickIntervals)),
    cursor_idle_ratio: safe(cursorIdle),
    cross_mouse_keyboard_coordination: safe(crossCoord),
    keystroke_dwell_time_mean: safe(mean(holdTimes)),
    keystroke_dwell_time_std: safe(std(holdTimes)),
    keystroke_flight_time_mean: safe(mean(flightTimes)),
    keystroke_transition_entropy: safe(keyEntropy),
    keystroke_typing_speed: safe(duration>0? keyEv.length/(duration):0),
    keystroke_cross_field_cadence: safe(mean(crossGaps)),
    keystroke_burst_count: safe(burstCount),
    temporal_time_of_day_score: safe(timeOfDay),
    temporal_session_duration: safe(duration),
    temporal_activity_bursts: safe(bursts),
    nav_page_transition_pattern: safe(pageTrans),
    nav_scroll_depth_mean: safe(mean(scrollDeltas)),
    nav_page_count: safe(allPages),
    nav_step_transition_count: safe(navEv.length),
    form_focus_count: safe(focusEv.length),
    form_blur_count: safe(blurEv.length),
    form_field_switch_rate: safe(mean(fieldGaps)),
    cart_action_count: safe(events.filter(e=>e.event_type==='CART_ACTION').length),
    ...keystrokeRhythm(keyEv)
  };
  // pastikan semua fitur ada & finite, urutan deterministik
  const res={}; F4.forEach(k=>res[k]=safe(out[k]||0));
  return res;
}

// ---- C-44 (SPEC 1.4): ritme ketik yang lebih tajam -------------------------------
// Rata-rata jeda antar-tombol (keystroke_flight_time_mean) tercampur jeda PANJANG antar
// kolom/berpikir, jadi yang terukur lebih banyak "tugas" daripada "orang". Di sini hanya
// jeda < 1 dtk yang dihitung, dengan median & IQR (tahan pencilan), ditambah kebiasaan
// koreksi (Backspace), pemakaian Shift, dan beda kecepatan pindah-tangan vs tangan-sama.
// Kelas tangan dari `kc` (dicatat capture dari posisi fisik tombol); data tanpa `kc`
// (riset) memakai tata letak QWERTY dari karakter ASCII-nya.
const HAND_L='qwertasdfgzxcvb', HAND_R='yuiophjklnm';
function keyClass(e){
  if(typeof e.kc==='string' && e.kc) return e.kc;
  const k=e.key;
  if(typeof k!=='string') return 'O';
  if(k.length===1 && k.charCodeAt(0)<128){
    let c=k; const code=k.charCodeAt(0); if(code>=65 && code<=90) c=String.fromCharCode(code+32);
    if(HAND_L.indexOf(c)>=0) return 'L';
    if(HAND_R.indexOf(c)>=0) return 'R';
    if(c>='0' && c<='9') return 'D';
    if(c===' ') return 'S';
    return 'P';
  }
  if(k==='Backspace' || k==='Delete') return 'E';
  if(k==='Shift') return 'H';
  return 'O';
}
function median(a){
  if(!a.length) return 0;
  const b=a.slice().sort((x,y)=>x-y), m=Math.floor(b.length/2);
  return b.length%2 ? b[m] : (b[m-1]+b[m])/2;
}
function keystrokeRhythm(keyEv){
  const fl=[], same=[], cross=[], dw=[];
  let back=0, shift=0, letters=0;
  for(let i=0;i<keyEv.length;i++){
    const e=keyEv[i], c=keyClass(e);
    if(c==='E') back++;
    if(c==='H') shift++;
    if(c==='L' || c==='R') letters++;
    const h=e.hold_time;
    if(h!=null && h>0 && h<1000) dw.push(h);
    if(i>0){
      const p=keyEv[i-1], dt=(e.timestamp||0)-(p.timestamp||0);
      if(dt>0 && dt<1000){
        fl.push(dt);
        const pc=keyClass(p);
        if((pc==='L' || pc==='R') && (c==='L' || c==='R')) (pc===c ? same : cross).push(dt);
      }
    }
  }
  let iqr=0;
  if(fl.length>3){ const b=fl.slice().sort((x,y)=>x-y); iqr=b[Math.floor(b.length*0.75)]-b[Math.floor(b.length*0.25)]; }
  const ms=median(same), mc=median(cross);
  return {
    keystroke_flight_median: safe(median(fl)),
    keystroke_flight_iqr: safe(iqr),
    keystroke_backspace_ratio: safe(keyEv.length ? back/keyEv.length : 0),
    keystroke_cross_hand_ratio: safe(ms>0 && mc>0 ? mc/ms : 0),
    keystroke_dwell_median: safe(median(dw)),
    keystroke_shift_ratio: safe(letters ? shift/letters : 0),
  };
}

function featuresToVector(featObj){
  return F4.map(k=> featObj[k]||0);
}
return {F4: F4, extractF4: extractF4, keyClass: keyClass, featuresToVector: featuresToVector};
})();

/* ---- core/ensemble.js ---- */
__M["core/ensemble.js"] = (function(){
/**
 * ensemble.js - gabung IF + detektor-2 (bobot dari config), samakan skala via z-score baseline
 */
const { scoreStats, zScore } = __M["core/standardize.js"];
const { normalizeWeights, DEFAULTS } = __M["core/config.js"];

function gateWeights(weights, n){
  const minS=DEFAULTS.ensembleMinSamples;
  let w={...weights};
  if(n < minS.svm) w.svm=0;
  if(n < minS.lstm) w.lstm=0;
  // isolation_forest selalu ada (min 8) - jika n<8 fallback tetap IF
  return normalizeWeights(w);
}

class Ensemble {
  constructor(iforest, ocsvm, weights, n){
    this.iforest=iforest; this.ocsvm=ocsvm;
    // C-8: fallback ini dulu {0.7, 0.3} — bobot W7 LAMA, kebalikan dari DEFAULTS
    // (IF 0.30 / detektor-2 0.70). Konstruksi tanpa `weights` diam-diam memakai
    // konfigurasi lama yang lebih buruk. Sekarang satu sumber kebenaran.
    this.weights=normalizeWeights(weights||DEFAULTS.weights);
    this.ifStats=null; this.svmStats=null;
    this.n=n||0;
    this.gatedWeights=this.weights;
  }
  // latih: hitung stats skor baseline untuk kalibrasi
  calibrate(X_std, n){
    if(n!=null) this.n=n;
    const ifScores=this.iforest.predict(X_std);
    const svmScores=this.ocsvm.predict(X_std);
    this.ifStats=scoreStats(ifScores);
    this.svmStats=scoreStats(svmScores);
    this.gatedWeights=gateWeights(this.weights, this.n);
  }
  scoreOne(x_std){
    const rawIF=this.iforest.scoreOne(x_std);
    const rawSVM=this.ocsvm.scoreOne(x_std);
    const zIF = this.ifStats ? zScore(rawIF, this.ifStats) : rawIF;
    const zSVM= this.svmStats? zScore(rawSVM,this.svmStats): rawSVM;
    const w=this.gatedWeights || this.weights;
    if(!this.svmStats) return zIF;
    // gating: jika n<20, svm dibungkam -> IF murni
    if(w.svm===0) return zIF;
    return w.isolation_forest*zIF + w.svm*zSVM;
  }
  predict(X_std){ return X_std.map(x=> this.scoreOne(x)); }
}
return {Ensemble: Ensemble};
})();

/* ---- core/risk.js ---- */
__M["core/risk.js"] = (function(){
/**
 * risk.js - pita risiko + reasons (top fitur menyimpang)
 */
const { DEFAULTS } = __M["core/config.js"];

function toRisk(score, thresholds=DEFAULTS.thresholds){
  if(score <= thresholds.medium) return 'HIGH';
  if(score <= thresholds.low) return 'MEDIUM';
  return 'LOW';
}
function quantile(sorted, q){
  if(!sorted.length) return -0.4;
  const idx=q*(sorted.length-1);
  const lo=Math.floor(idx), hi=Math.ceil(idx);
  if(lo===hi) return sorted[lo];
  const frac=idx-lo;
  return sorted[lo]*(1-frac)+sorted[hi]*frac;
}
function calibrateThresholds(baselineScores, q_low=null, q_med=null){
  const cfg_q_low = q_low ?? 0.15;
  const cfg_q_med = q_med ?? 0.05;
  const s=[...baselineScores].sort((a,b)=>a-b);
  // LOW di 15th percentile (~15% baseline bukan-LOW), MEDIUM/HIGH di 5th
  let low=quantile(s, cfg_q_low);
  let med=quantile(s, cfg_q_med);
  if(low - med < 0.15) med=low-0.25;
  low=Math.max(-3, Math.min(1, low));
  med=Math.max(-3, Math.min(low-0.05, med));
  return {low, medium: med};
}
// Kalibrasi PARAMETRIK: low = mean - k_low*std skor baseline; MEDIUM lebih ketat.
// Padanan PERSIS bg_core.py:calibrate_thresholds_parametric.
// Default parameter = DEFAULTS (C-33): dulu 3,3/0,6, beda dengan config (1,75/2,0).
function calibrateThresholdsParametric(baselineScores, k_low=DEFAULTS.k_low, k_med_extra=DEFAULTS.k_med_extra){
  const n=baselineScores.length;
  if(n===0) return {low:-0.4, medium:-0.8};
  let m=0; for(const x of baselineScores) m+=x; m/=n;
  let v=0; for(const x of baselineScores) v+=(x-m)*(x-m); v/=n;
  const sd = v>1e-12 ? Math.sqrt(v) : 1.0;
  return {low: m - k_low*sd, medium: m - (k_low + k_med_extra)*sd};
}
function toAction(level){
  // Aksi PER-SESI (stateless). HIGH tidak langsung memblokir: satu sesi menyimpang
  // -> minta verifikasi STEP-UP (pemilik lolos, penyusup gagal). Pemblokiran keras
  // dipicu RENTETAN HIGH -> lapisan stateful di behaviorguard.js.
  if(level==='HIGH') return 'REQUIRE_STEPUP';
  if(level==='MEDIUM') return 'REQUIRE_MFA';
  return 'ALLOW_SESSION';
}
// top fitur paling menyimpang (abs z-score terbesar)
function topFeatures(vec_std, featureNames, k=3){
  const arr=featureNames.map((name,i)=>({name, z: vec_std[i], abs: Math.abs(vec_std[i])}));
  arr.sort((a,b)=>b.abs-a.abs);
  return arr.slice(0,k);
}
function reasonsFrom(top){
  return top.map(t=> `${t.name} z=${t.z.toFixed(2)}`);
}
return {toRisk: toRisk, calibrateThresholds: calibrateThresholds, calibrateThresholdsParametric: calibrateThresholdsParametric, toAction: toAction, topFeatures: topFeatures, reasonsFrom: reasonsFrom};
})();

/* ---- core/isolation_forest.js ---- */
__M["core/isolation_forest.js"] = (function(){
/**
 * isolation_forest.js - implementasi tepat, deterministik, tanpa dependensi
 * anomalyScore makin negatif = makin anomali (konsisten dengan risk mapping)
 * Deterministik via mulberry32 seed 42
 */
function mulberry32(a){ return function(){ let t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }
function cFactor(n){ if(n<=1) return 0; if(n===2) return 1; return 2*(Math.log(n-1)+0.5772156649) - 2*(n-1)/n; }

class IsolationForest {
  constructor({n_estimators=100, max_samples=256, seed=42}={}){
    this.n_estimators=n_estimators; this.max_samples=max_samples; this.seed=seed;
    this.trees=[]; this.n_features=0; this.c=1;
  }
  fit(X){
    // X: array of vectors (n x d)
    if(!X.length) return;
    this.n_features=X[0].length;
    const n=Math.min(this.max_samples, X.length);
    this.c=cFactor(n);
    const rng=mulberry32(this.seed);
    this.trees=[];
    for(let t=0;t<this.n_estimators;t++){
      // subsample deterministik
      const idx=[...Array(X.length).keys()];
      // fisher-yates dengan rng
      for(let i=idx.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [idx[i],idx[j]]=[idx[j],idx[i]]; }
      const sample=idx.slice(0,n).map(i=>X[i]);
      this.trees.push(this._buildTree(sample,0,Math.ceil(Math.log2(n)),rng));
    }
  }
  _buildTree(points, depth, maxDepth, rng){
    if(depth>=maxDepth || points.length<=1) return {size:points.length, leaf:true};
    const feat=Math.floor(rng()*this.n_features);
    const vals=points.map(p=>p[feat]);
    const min=Math.min(...vals), max=Math.max(...vals);
    if(min===max) return {size:points.length, leaf:true};
    const split=min+rng()*(max-min);
    const left=points.filter(p=>p[feat]<split);
    const right=points.filter(p=>p[feat]>=split);
    // hindari split kosong
    if(!left.length||!right.length) return {size:points.length, leaf:true};
    return {feat, split, left:this._buildTree(left,depth+1,maxDepth,rng), right:this._buildTree(right,depth+1,maxDepth,rng)};
  }
  _pathLength(x, node, depth){
    if(node.leaf) return depth + cFactor(node.size);
    if(x[node.feat] < node.split) return this._pathLength(x, node.left, depth+1);
    return this._pathLength(x, node.right, depth+1);
  }
  // skor mentah: E[h(x)] -> anomaly score MAP ke rentang ~ [-1, 1]
  // 2^{-E/c} in (0,1); kami map ke 0.5 - score agar positif=normal
  scoreOne(x){
    if(!this.trees.length) return 0;
    const avgH = this.trees.reduce((s,t)=>s+this._pathLength(x,t,0),0)/this.trees.length;
    const anom = Math.pow(2, -avgH/this.c); // 0..1, 1=anomali
    // map: normal → 0.3..0.6, anomali → negatif
    // kami balik: score = 0.5 - anom (so high = normal ~0.5, low = anom -0.5)
    return 0.5 - anom;
  }
  predict(X){ return X.map(x=>this.scoreOne(x)); }
}
return {IsolationForest: IsolationForest};
})();

/* ---- core/ocsvm.js ---- */
__M["core/ocsvm.js"] = (function(){
/**
 * ocsvm.js - One-Class SVM RBF aproksimasi (arah, bukan rasio presisi)
 * Jujur di README: ini aproksimasi. Yang kokoh adalah ARAH +30% SVM membelah FAR.
 * Implementasi: centroid RBF di ruang terstandardisasi
 * score = exp(-gamma * ||x - mean||^2) - threshold ; positif=normal
 * Deterministik.
 */
class OCSVM {
  constructor({gamma=null, n_features=28}={}){
    this.gamma = gamma != null ? gamma : 1.0/n_features;
    this.mean=null; this.threshold=0;
  }
  fit(X){
    if(!X.length) return;
    const d=X[0].length;
    this.mean=new Array(d).fill(0);
    for(const v of X) for(let i=0;i<d;i++) this.mean[i]+=v[i];
    for(let i=0;i<d;i++) this.mean[i]/=X.length;
    // hitung skor training untuk tentukan threshold (mis. 10th percentile ~ nu=0.1)
    const scores=X.map(x=> this._raw(x));
    scores.sort((a,b)=>a-b);
    const idx=Math.floor(scores.length*0.10);
    this.threshold=scores[idx]||0;
  }
  _raw(x){
    let dist2=0; for(let i=0;i<x.length;i++){ const d=x[i]-this.mean[i]; dist2+=d*d; }
    return Math.exp(-this.gamma*dist2);
  }
  scoreOne(x){
    if(!this.mean) return 0;
    const r=this._raw(x);
    // map ke rentang sebanding IF: (r - threshold) ~ [-0.5,0.5]
    return r - this.threshold - 0.1; // geser biar mean ~0
  }
  predict(X){ return X.map(x=>this.scoreOne(x)); }
}
return {OCSVM: OCSVM};
})();

/* ---- core/mahalanobis.js ---- */
__M["core/mahalanobis.js"] = (function(){
/**
 * mahalanobis.js - Detektor jarak Mahalanobis + shrinkage diagonal.
 *
 * Pengganti centroid-RBF (ocsvm.js): alih-alih meng-collapse kolam baseline
 * jadi SATU titik rata-rata (buang bentuk distribusi -> FAR 36%), Mahalanobis
 * memperhitungkan kovarians antar-fitur (elips, bukan lingkaran) sehingga
 * penyusup di dekat rata-rata tetap tertangkap. Held-out FAR 36.2% -> 5.4%.
 *
 * Browser-trainable, NOL dependensi, deterministik. Padanan PERSIS bit-per-bit
 * dengan core/bg_core.py:Mahalanobis (urutan operasi float dijaga identik).
 * scoreOne = -sqrt((x-mu)^T Sigma^-1 (x-mu)); higher = lebih normal (sebanding IF).
 */
class Mahalanobis {
  constructor({ shrink = 0.3, n_features = 28 } = {}) {
    this.shrink = shrink;
    this.mean = null;
    this.inv = null;
  }
  fit(X) {
    if (!X.length) return;
    const n = X.length, d = X[0].length;
    const mean = new Array(d).fill(0);
    for (const v of X) for (let i = 0; i < d; i++) mean[i] += v[i];
    for (let i = 0; i < d; i++) mean[i] /= n;
    // kovarians (i luar, j dalam - sama seperti Python)
    const cov = Array.from({ length: d }, () => new Array(d).fill(0));
    for (const v of X) {
      const dv = new Array(d);
      for (let i = 0; i < d; i++) dv[i] = v[i] - mean[i];
      for (let i = 0; i < d; i++) {
        const di = dv[i], row = cov[i];
        for (let j = 0; j < d; j++) row[j] += di * dv[j];
      }
    }
    const denom = n > 1 ? n - 1 : 1;
    for (let i = 0; i < d; i++) for (let j = 0; j < d; j++) cov[i][j] /= denom;
    // shrinkage diagonal: (1-a)S + a*mu*I
    let mu = 0;
    for (let i = 0; i < d; i++) mu += cov[i][i];
    mu /= d;
    const a = this.shrink;
    for (let i = 0; i < d; i++) {
      for (let j = 0; j < d; j++) cov[i][j] = (1 - a) * cov[i][j] + (i === j ? a * mu : 0);
      cov[i][i] += 1e-6;
    }
    this.mean = mean;
    this.inv = Mahalanobis._inv(cov, d);
  }
  static _inv(A, d) {
    // Gauss-Jordan pivot-parsial. Urutan operasi tetap -> bit-identik lintas bahasa.
    const M = A.map((row, i) => {
      const ext = row.slice();
      for (let j = 0; j < d; j++) ext.push(i === j ? 1 : 0);
      return ext;
    });
    for (let col = 0; col < d; col++) {
      let piv = col, best = Math.abs(M[col][col]);
      for (let r = col + 1; r < d; r++) {
        if (Math.abs(M[r][col]) > best) { best = Math.abs(M[r][col]); piv = r; }
      }
      if (Math.abs(M[piv][col]) < 1e-12) M[piv][col] = 1e-12;
      if (piv !== col) { const t = M[col]; M[col] = M[piv]; M[piv] = t; }
      const pv = M[col][col];
      for (let k = 0; k < 2 * d; k++) M[col][k] /= pv;
      for (let r = 0; r < d; r++) {
        if (r !== col && M[r][col] !== 0) {
          const f = M[r][col];
          for (let k = 0; k < 2 * d; k++) M[r][k] -= f * M[col][k];
        }
      }
    }
    return M.map(row => row.slice(d));
  }
  scoreOne(x) {
    if (!this.mean || !this.inv) return 0;
    const d = x.length;
    const dv = new Array(d);
    for (let i = 0; i < d; i++) dv[i] = x[i] - this.mean[i];
    let m2 = 0;
    for (let i = 0; i < d; i++) {
      let t = 0;
      for (let j = 0; j < d; j++) t += this.inv[i][j] * dv[j];
      m2 += dv[i] * t;
    }
    return -Math.sqrt(m2 > 0 ? m2 : 0);
  }
  predict(X) { return X.map(x => this.scoreOne(x)); }
}
return {Mahalanobis: Mahalanobis};
})();

/* ---- core/capture.js ---- */
__M["core/capture.js"] = (function(){
/**
 * capture.js - auto-capture DOM (pointer/key/scroll/focus/blur/submit/cart)
 * Tanpa ubah kode aplikasi. Tahan tab-switch/refresh. Caps & robust.
 */
function createCapture(onEvent){
  const MAX_BUF=2000; // cap 2000 event per sesi (hindari volume gila mousemove)
  const buf=[];
  let dropped=0;
  // C-46: PERILAKU HARUS DATANG DARI MANUSIA. `isTrusted` false = event yang DIBUAT skrip
  // (`el.click()`, `dispatchEvent(new KeyboardEvent(...))`), bukan dari perangkat masukan.
  // Tanpa saringan ini, penyerang yang sudah menjalankan skrip di halaman tidak perlu
  // menebak perilaku pemilik sama sekali: ia cukup MENYIARKAN aliran event bergaya manusia
  // (jitter acak, jeda wajar) sampai modelnya sendiri yang meyakinkan pustaka bahwa
  // pemiliklah yang duduk di sini - dan karena vektor palsu itu dinilai LOW, ia bahkan ikut
  // MELATIH kolam baseline. Itu meracuni profil, bukan sekadar melewati satu vonis.
  // `!== false` (bukan `=== true`): peramban sangat lama tanpa properti ini tidak ikut
  // disaring - gagal ke perilaku lama, bukan diam-diam buta.
  // Yang dijatuhkan tetap DIHITUNG: banyaknya masukan sintetis adalah sinyal tersendiri
  // (lihat behaviorguard._assessEvents), bukan sesuatu yang boleh hilang tanpa jejak.
  let synthetic=0;
  const real=e=>{ if(e && e.isTrusted===false){ synthetic++; return false; } return true; };
  const push=e=>{
    e.timestamp=Date.now();
    if(buf.length >= MAX_BUF){ dropped++; return; }
    buf.push(e);
    try{ onEvent&&onEvent(e); }catch{}
  };
  let attached=false;
  let handlers=null;
  function attach(){
    if(attached) return; attached=true;
    const opts={capture:true, passive:true};
    const downAt=new Map();
    // C-30 PRIVASI: `key` DULU menyimpan KARAKTER ASLI yang diketik — termasuk di kolom
    // kata sandi. Momen paling berbahaya justru login: ketik sandi -> Enter -> halaman
    // pindah -> `_bankTail()` menyimpan 200 event terakhir sebagai JSON TEKS BIASA di
    // localStorage. Sandi tertinggal di browser, terbaca skrip mana pun di origin itu.
    // Satu-satunya fitur yang memakai identitas tombol adalah
    // keystroke_transition_entropy, dan ia hanya butuh tahu "sama atau beda dengan
    // tombol sebelumnya". Jadi tiap karakter diganti token urut-kemunculan (k1, k2, ..)
    // lewat peta yang HANYA hidup di memori halaman ini dan tidak pernah disimpan.
    // Pemetaan injektif -> hitungan transisi identik -> entropi identik persis. Nama
    // tombol khusus (Backspace, Enter, Shift, ..) bukan rahasia dan dibiarkan.
    // Yang tersisa untuk sandi hanyalah POLA pengulangan (mis. k1 k2 k1), bukan isinya.
    const keyTok=new Map();
    const tokenOf=k=>{
      if(typeof k!=='string' || k.length!==1) return k;      // tombol bernama / kosong
      let t=keyTok.get(k);
      if(!t){ t='k'+(keyTok.size+1); keyTok.set(k,t); }
      return t;
    };
    // C-44: KELAS POSISI tombol (tangan kiri/kanan, angka, spasi) untuk
    // keystroke_cross_hand_ratio — dari e.code (posisi FISIK, tak bergantung tata letak),
    // bukan dari hurufnya. Di kolom kata sandi kelasnya TIDAK direkam: urutan kiri/kanan
    // sandi mempersempit tebakan, jadi di sana hanya waktu tekan yang diambil.
    const LEFT_CODES=new Set(['KeyQ','KeyW','KeyE','KeyR','KeyT','KeyA','KeyS','KeyD','KeyF','KeyG','KeyZ','KeyX','KeyC','KeyV','KeyB']);
    const codeClass=e=>{
      try{ if(e.target && e.target.matches && e.target.matches('input[type=password]')) return undefined; }catch{}
      const c=e.code||'';
      if(c.startsWith('Key')) return LEFT_CODES.has(c)? 'L' : 'R';
      if(c.startsWith('Digit') || c.startsWith('Numpad')) return 'D';
      if(c==='Space') return 'S';
      return undefined;                                    // tombol lain: cukup nama tombolnya
    };
    // C-30: ketikan di popup MFA milik BG sendiri BUKAN perilaku alami — itu frasa tetap
    // yang diketik berulang dengan sengaja. Dulu ikut terekam dan mencemari fitur ketik
    // jendela berikutnya (plus FORM_FOCUS/BLUR dari kolom popup). Gerak mouse tetap
    // direkam: menggerakkan mouse ke popup adalah gerakan tangan yang wajar.
    const NON_TEXT=new Set(['checkbox','radio','button','submit','reset','range','color','file','image','hidden']);
    const isTextEntry=t=>{
      try{
        if(t.isContentEditable || t.tagName==='TEXTAREA') return true;
        if(t.tagName!=='INPUT') return false;          // SELECT dan lainnya
        return !NON_TEXT.has(String(t.type||'text').toLowerCase());
      }catch{ return true; }
    };
    const fromBg=e=>{ try{ return !!(e && e.target && e.target.closest && e.target.closest('[data-bg-mfa]')); }catch{ return false; } };
    let lastScrollY=window.scrollY;
    // C-16/C-17: `velocity` DULU TIDAK PERNAH DIISI di sini, padahal dua tempat
    // membacanya. Akibatnya di pemakaian nyata (bukan data riset):
    //   1. integrity.js membaca `e.velocity||0` -> selalu 0 -> std 0 -> sesi manusia
    //      biasa ditandai "velocity konstan" dan diblokir sebagai bot. Terpicu pada
    //      sesi yang keystroke+klik-nya < 10, yaitu sesi yang isinya kebanyakan
    //      gerak mouse — persis perilaku pengunjung yang cuma menelusuri halaman.
    //   2. features.js SPEC 8.4 menghitung idle = jumlah gerakan dgn velocity < 0.5;
    //      tanpa field itu SEMUA gerakan terhitung diam -> `cursor_idle_ratio` terkunci
    //      di 1.0. Satu dari 28 fitur jadi mati di produksi, padahal saat model
    //      dilatih dari basis data riset fitur itu bervariasi — ketidakcocokan
    //      latih-vs-pakai yang permanen.
    // Satuan piksel per milidetik, sama seperti `velocities` di features.js.
    let lastMovePt=null;
    const withVelocity=e=>{
      const now=Date.now();
      let v=0;
      if(lastMovePt){
        const dt=now-lastMovePt.t;
        if(dt>0){ const dx=e.clientX-lastMovePt.x, dy=e.clientY-lastMovePt.y; v=Math.hypot(dx,dy)/dt; }
      }
      lastMovePt={x:e.clientX, y:e.clientY, t:now};
      return Number.isFinite(v)? v : 0;
    };
    handlers={
      move: e=> push({event_type:'MOUSE_MOVE', x:e.clientX, y:e.clientY, velocity: withVelocity(e), page_url: location.href}),
      click: e=> { if(fromBg(e) || !real(e)) return; push({event_type:'MOUSE_CLICK', x:e.clientX, y:e.clientY, page_url: location.href}); },
      // `scroll` tidak bisa disaring dengan isTrusted: menggulir lewat window.scrollTo()
      // menerbitkan event dengan isTrusted TRUE. Yang diukur di sini memang selisih posisi,
      // bukan gerak tangan; biarkan apa adanya dan jangan mengaku menyaringnya.
      scroll: e=> { const cur=window.scrollY; const delta=Math.abs(cur-lastScrollY); lastScrollY=cur; if(delta===0) return; push({event_type:'MOUSE_SCROLL', scroll_delta: delta, scroll_velocity: 0, page_url: location.href}); },
      // auto-repeat (tombol ditahan) menembakkan keydown berulang; yang dihitung tahan
      // adalah tekanan PERTAMA, jadi pengulangan diabaikan. Entri dihapus di keyup supaya
      // keydown yang hilang (fokus pindah) tidak meninggalkan t0 basi bermenit-menit.
      kd: e=> { if(fromBg(e) || e.repeat || !real(e)) return; downAt.set(e.code, Date.now()); },
      ku: e=> { if(fromBg(e) || !real(e)) return; const t0=downAt.get(e.code); downAt.delete(e.code); const hold=t0? Date.now()-t0 : 80; const ev={event_type:'KEYSTROKE', key:tokenOf(e.key), hold_time: hold, page_url: location.href}; const kc=codeClass(e); if(kc) ev.kc=kc; if(e.key==='Unidentified' || e.keyCode===229 || e.isComposing) ev.soft=true; push(ev); },
      // C-45: `txt` = kolom yang MEMANG diisi dengan mengetik. Fokus ke <select>, kotak
      // centang, atau tombol radio tidak pernah menghasilkan ketikan, dan dulu terbaca sebagai
      // "form tersentuh tapi tidak diketik" (A3, autofill) -> jendelanya tak layak melatih dan
      // ditandai bukti sebagian. Fiturnya (form_focus_count) tidak berubah: event yang sama.
      // C-46: fokus/blur SENGAJA tidak disaring isTrusted. `el.focus()` yang dipanggil situs
      // (autofocus kolom pertama, pindah kolom otomatis sesudah 4 digit) menerbitkan event
      // tak-tepercaya, padahal itu perilaku aplikasi yang normal dan ikut terhitung saat data
      // riset dikumpulkan. Menyaringnya di sini hanya akan membuat form_focus_count di
      // pemakaian berbeda dari saat model dilatih. Kedua fitur itu struktural, bukan biometrik
      // waktu — nilai sinyalnya tidak sepadan dengan risiko ketidakcocokan latih-vs-pakai.
      focus: e=> { try{ if(fromBg(e)) return; if(e.target && e.target.matches && e.target.matches('input,textarea,select,[contenteditable]')) push({event_type:'FORM_FOCUS', txt: isTextEntry(e.target), page_url: location.href}); }catch{} },
      blur: e=> { try{ if(fromBg(e)) return; if(e.target && e.target.matches && e.target.matches('input,textarea,select,[contenteditable]')) push({event_type:'FORM_BLUR', page_url: location.href}); }catch{} },
      nav: ()=> push({event_type:'NAVIGATION', page_url: location.href}),
      // A3: form yang diisi password manager / autofill / tempel TIDAK menghasilkan
      // satu pun event keyboard, sehingga KEDELAPAN fitur keystroke jatuh ke nol
      // (terukur: dwell 80->0, flight 120->0, speed 4,8->0, entropi 1,1->0, dst).
      // Dua arah bahayanya: pemilik yang memakai password manager terlihat menyimpang
      // tiap login, DAN penyusup bisa menyenjatakannya untuk menghapus seluruh blok
      // bukti ketikan. Nol di sini berarti "tidak ada bukti", bukan "beginilah cara
      // orang ini mengetik" — dan model tidak bisa membedakannya sendiri.
      // Peristiwanya ditandai di sini; keputusannya (ABSTAIN pada blok keystroke)
      // ada di behaviorguard.js, sama seperti C-23 menandai idle lalu memutuskan.
      paste: e=>{ if(fromBg(e)) return; try{
        const n=(e.clipboardData && e.clipboardData.getData ? (e.clipboardData.getData('text')||'') : '').length;
        push({event_type:'PASTE', chars:n, page_url: location.href});
      }catch{ push({event_type:'PASTE', chars:0, page_url: location.href}); } },
      // B4: di layar sentuh `mousemove` praktis tidak pernah muncul, sehingga SEMBILAN
      // fitur mouse jadi nol — pola yang sama dengan A3, blok yang berbeda. Sentuhan
      // dan mouse adalah dua ALAT UKUR untuk gerakan yang sama, jadi ia dipetakan ke
      // tipe event yang sama; tanpa ini, pengguna ponsel tidak pernah bisa dinilai
      // sama sekali. Ditandai `touch:true` supaya lapisan konteks bisa memisahkan
      // baselinenya kalau nanti diperlukan.
      touch: e=>{ try{
        const t=e.touches && e.touches[0]; if(!t) return;
        push({event_type:'MOUSE_MOVE', x:t.clientX, y:t.clientY, velocity: withVelocity(t), touch:true, page_url: location.href});
      }catch{} },
      // klik yang sama sudah dihitung di handler `click`, jadi di sini disaring TANPA menghitung
      cart: e=>{ try{ if(e && e.isTrusted===false) return; const t=e.target && e.target.closest && e.target.closest('[data-bg-cart], .add-to-cart, [data-cart]'); if(t) push({event_type:'CART_ACTION', page_url: location.href}); }catch{} }
    };
    // mousemove throttled: 1 per 50ms untuk cap volume
    //
    // C-46: saringan isTrusted WAJIB di depan throttle, bukan di dalam handler.move. Kalau
    // di dalam, event tiruan tetap lolos throttle lebih dulu dan MEMPERBARUI `lastMove` —
    // sehingga skrip yang membanjiri mousemove 1000/dtk membuat gerakan mouse ASLI selalu
    // jatuh di dalam jendela 50 ms dan tak pernah terekam. Menolak event palsu jadi malah
    // membungkam yang asli; penyerang tidak perlu memalsukan perilaku, cukup menghapusnya.
    let lastMove=0;
    const throttledMove=e=>{
      if(!real(e)) return;
      const now=Date.now();
      if(now-lastMove < 50) return;
      lastMove=now; handlers.move(e);
    };
    handlers.throttledMove=throttledMove;

    document.addEventListener('mousemove', throttledMove, opts);
    document.addEventListener('click', handlers.click, opts);
    document.addEventListener('click', handlers.cart, opts);
    window.addEventListener('scroll', handlers.scroll, opts);
    document.addEventListener('keydown', handlers.kd, opts);
    document.addEventListener('keyup', handlers.ku, opts);
    document.addEventListener('focusin', handlers.focus, opts);
    document.addEventListener('focusout', handlers.blur, opts);
    window.addEventListener('popstate', handlers.nav);
    document.addEventListener('submit', handlers.nav, opts);
    document.addEventListener('paste', handlers.paste, opts);
    // touchmove di-throttle memakai penjaga yang sama dengan mousemove
    handlers.throttledTouch=e=>{ if(!real(e)) return; const now=Date.now(); if(now-lastMove < 50) return; lastMove=now; handlers.touch(e); };
    document.addEventListener('touchmove', handlers.throttledTouch, opts);
  }
  function detach(){
    if(!attached) return;
    attached=false;
    const h=handlers; if(!h) return;
    document.removeEventListener('mousemove', h.throttledMove);
    document.removeEventListener('click', h.click);
    document.removeEventListener('click', h.cart);
    window.removeEventListener('scroll', h.scroll);
    document.removeEventListener('keydown', h.kd);
    document.removeEventListener('keyup', h.ku);
    document.removeEventListener('focusin', h.focus);
    document.removeEventListener('focusout', h.blur);
    window.removeEventListener('popstate', h.nav);
    document.removeEventListener('submit', h.nav);
    document.removeEventListener('paste', h.paste);
    document.removeEventListener('touchmove', h.throttledTouch);
    handlers=null;
  }
  // `synthetic` sengaja TIDAK direset di drain: ia hitungan KUMULATIF seumur kunjungan,
  // supaya orkestrator bisa mengambil selisihnya per vonis (lihat behaviorguard._ingestVector).
  function drain(){ const c=[...buf]; buf.length=0; dropped=0; return c; }
  function peek(){ return [...buf]; }
  return { attach, detach, drain, peek, get buffer(){ return buf; }, get dropped(){ return dropped; },
           get synthetic(){ return synthetic; } };
}
return {createCapture: createCapture};
})();

/* ---- core/idle.js ---- */
__M["core/idle.js"] = (function(){
/**
 * idle.js — segmentasi sesi berbasis jeda idle + akuntansi waktu aktif (C-23)
 *
 * MASALAH. Fitur F4 dihitung dari SELISIH antar-event dan dari `duration` =
 * (timestamp terakhir − timestamp pertama). Kalau pengguna membuka halaman lalu
 * ditinggal — ambil minum, angkat telepon, pindah ke aplikasi lain — jeda mati itu
 * ikut masuk ke dalam statistik seolah-olah ia perilaku:
 *
 *   mouse_click_interval_mean     satu jeda 10 menit menarik rata-rata 2 dtk → 300 dtk
 *   keystroke_flight_time_mean    idem: satu selisih raksasa mendominasi mean
 *   keystroke_typing_speed        keyEv.length / duration → runtuh ke ~0
 *   keystroke_cross_field_cadence gap fokus→ketik melintasi jeda
 *   form_field_switch_rate        mean jeda antar-fokus melintasi jeda
 *   temporal_session_duration     durasi = jam, padahal interaksinya 20 detik
 *   mouse_velocity/acceleration   gerakan pertama sesudah jeda: dt raksasa → v≈0
 *
 * Model dilatih dari sesi riset berbasis-tugas yang PADAT (pengguna mengerjakan
 * skenario tanpa jeda panjang). Jadi jeda idle bukan cuma menambah derau: ia
 * menciptakan ketidakcocokan latih-vs-pakai yang sistematis — kelas cacat yang
 * sama dengan C-16/C-17, hanya sumbernya waktu, bukan field yang kosong.
 *
 * PRINSIP. Idle BUKAN perilaku, jadi ia tidak boleh diukur. Ia dipotong keluar,
 * bukan dirata-rata masuk. Aliran event dipecah pada tiap jeda ≥ `gapMs`;
 * `extractF4` hanya pernah melihat potongan yang KONTIGU. Rumus fitur di
 * core/SPEC.md tidak berubah sedikit pun — yang berubah hanya APA yang disuapkan
 * ke sana. Karena itu golden vector dan keempat port (Python/Rust/Java/WASM)
 * tetap hijau tanpa disentuh.
 *
 * Idle punya DUA konsekuensi berbeda, jadi ambangnya dua:
 *   gapMs  (ukur)  — jeda yang tidak boleh diukur melintasinya.        default 30 dtk
 *   awayMs (aman)  — jeda yang berarti kursinya mungkin kosong, dan orang yang
 *                    duduk sesudahnya belum tentu orang yang sama.     default 5 mnt
 * Lihat behaviorguard.js `_onCaptureEvent` / `resumedAfterAway` untuk lapis kedua.
 */

const GAP_MS_DEFAULT  = 30_000;    // = session.windowSec: jeda sepanjang satu jendela penilaian bukan perilaku
const AWAY_MS_DEFAULT = 300_000;   // 5 menit: batas "kursi mungkin kosong"

/**
 * B1: pisahkan event menurut ALIRAN asalnya (tab) sebelum apa pun diukur.
 *
 * Dua tab aplikasi yang sama menulis ke akumulator pending yang sama, jadi event
 * dari dua halaman berbeda — yang dipakai bergantian, saling menyela dalam waktu —
 * dulu tergabung jadi satu "sesi". Segmentasi idle tidak menolong di sini: kedua
 * aliran itu aktif BERSAMAAN, jadi tak ada jeda untuk dipotong. Yang tercipta
 * adalah orang ketiga yang tidak pernah ada: selisih antar-event melompat-lompat
 * antara dua konteks, dan tak satu pun mencerminkan perilaku siapa pun.
 *
 * Prinsipnya sama dengan C-23: kalau dua pengukuran datang dari alat yang berbeda,
 * jangan dirata-ratakan — pisahkan. Event tanpa `tabId` (data lama, atau event yang
 * disuntik integrator) diperlakukan sebagai satu aliran bersama, jadi perilaku lama
 * tidak berubah.
 */
function groupByStream(events){
  if(!events || !events.length) return [];
  const byTab=new Map();
  for(const e of events){
    const k=e && e.tabId ? e.tabId : '';
    if(!byTab.has(k)) byTab.set(k, []);
    byTab.get(k).push(e);
  }
  // urut deterministik: aliran dengan event paling awal lebih dulu
  return [...byTab.values()].sort((a,b)=>(a[0].timestamp||0)-(b[0].timestamp||0));
}

/**
 * C-29: buang event yang IDENTIK PERSIS (jenis, milidetik, koordinat, tombol, tahan,
 * gulir, halaman — semuanya sama). Dua gerakan tangan tidak mungkin identik sampai
 * milidetik dan piksel; kembaran seperti itu selalu artefak pencatatan: pendengar
 * terpasang dua kali, batch terkirim ulang, ekor `bg:pending` ikut terbaca dua kali.
 *
 * Terukur di basis data riset: 25-42% event tiap jenis adalah kembaran identik, tidak
 * merata antar-sesi. Akibatnya (a) `checkIntegrity` menuduh 458 dari 653 sesi MANUSIA
 * sebagai bot ("timestamp duplikat") -> BLOCK_SESSION; sesudah kembaran dibuang: 0.
 * (b) fitur-cacah berlipat dua dan flight-time berisi nol di sebagian sesi saja, jadi
 * dua sesi dari orang yang sama terlihat seperti dua orang. Kembaran tidak membawa
 * informasi perilaku apa pun, jadi membuangnya tidak menghapus bukti — ia memulihkan
 * pengukurannya. Urutan dipertahankan; tidak memutasi masukan.
 */
function dropExactDuplicates(events){
  if(!events || events.length<2) return events ? [...events] : [];
  const seen=new Set(), out=[];
  for(const e of events){
    if(!e){ continue; }
    const k=`${e.event_type}|${e.timestamp}|${e.x}|${e.y}|${e.key}|${e.hold_time}|${e.scroll_delta}|${e.page_url}|${e.velocity}|${e.tabId}`;
    if(seen.has(k)) continue;
    seen.add(k); out.push(e);
  }
  return out;
}

/** Urutkan menaik menurut timestamp tanpa memutasi masukan. Akumulator
 *  `bg:pending` menggabung ekor dari banyak halaman, jadi urutan tidak dijamin. */
function byTs(events){
  return [...events].sort((a,b)=>(a.timestamp||0)-(b.timestamp||0));
}

/**
 * Pecah event menjadi segmen kontigu: potong di tiap jeda ≥ gapMs.
 * @returns {{events:Array, startTs:number, endTs:number, durationMs:number,
 *            gapBeforeMs:number}[]} urut menurut waktu; array kosong bila tak ada event.
 */
function segmentByIdle(events, gapMs=GAP_MS_DEFAULT){
  if(!events || !events.length) return [];
  const ev=byTs(events);
  const segs=[];
  let cur=[ev[0]];
  let gapBefore=0;
  for(let i=1;i<ev.length;i++){
    const gap=(ev[i].timestamp||0)-(ev[i-1].timestamp||0);
    if(gap >= gapMs){
      segs.push(mkSeg(cur, gapBefore));
      cur=[ev[i]];
      gapBefore=gap;
    } else {
      cur.push(ev[i]);
    }
  }
  segs.push(mkSeg(cur, gapBefore));
  return segs;
}

/**
 * C-28: PENDEKKAN tiap jeda ≥ gapMs jadi gapMs — jangan pecah sesinya.
 *
 * Segmentasi (di atas) memang membuang jeda dari pengukuran, tapi sekaligus
 * memendekkan SESI: sembilan fitur-cacah ikut mengecil (C-24), dan held-out 5
 * belahan menunjukkan ia merusak daya pisah. Kompresi hanya memendekkan WAKTU
 * KOSONG. Tak ada event yang dibuang, jumlahnya tetap, urutannya tetap; tiap event
 * sesudah jeda digeser mundur sebesar kelebihan jedanya. Jeda berpikir (< gapMs)
 * tidak tersentuh sama sekali.
 *
 * Tidak memutasi masukan. Padanan Python: tools/idle_ablation.py:compress_idle.
 * @returns {Array} event baru, urut waktu, timestamp sudah dikompresi
 */
function compressIdle(events, gapMs){
  if(!events || !events.length) return [];
  if(!(gapMs > 0)) return byTs(events);
  const ev=byTs(events);
  const out=new Array(ev.length);
  let shift=0, prev=null;
  for(let i=0;i<ev.length;i++){
    const t=ev[i].timestamp||0;
    if(prev!==null && t-prev >= gapMs) shift+=(t-prev)-gapMs;
    prev=t;
    out[i]={ ...ev[i], timestamp: t-shift };
  }
  return out;
}

function mkSeg(list, gapBeforeMs){
  const startTs=list[0].timestamp||0;
  const endTs=list[list.length-1].timestamp||startTs;
  return { events:list, startTs, endTs, durationMs: endTs-startTs, gapBeforeMs };
}

/**
 * Akuntansi waktu: berapa yang benar-benar aktif, berapa yang mati.
 * Dipakai untuk telemetri (`evt.idle`) dan untuk memutuskan ABSTAIN — sistem
 * boleh bilang "bukti tidak cukup" alih-alih menebak dari sesi yang isinya jeda.
 */
function idleAccounting(events, gapMs=GAP_MS_DEFAULT){
  const empty={ wallMs:0, activeMs:0, idleMs:0, activeRatio:0, gaps:[], longestGapMs:0, segments:0 };
  if(!events || !events.length) return empty;
  const segs=segmentByIdle(events, gapMs);
  const ev=byTs(events);
  const wallMs=(ev[ev.length-1].timestamp||0)-(ev[0].timestamp||0);
  let activeMs=0;
  const gaps=[];
  for(const s of segs){
    activeMs+=s.durationMs;
    if(s.gapBeforeMs>0) gaps.push(s.gapBeforeMs);
  }
  const idleMs=Math.max(0, wallMs-activeMs);
  const longestGapMs=gaps.length ? gaps.reduce((m,g)=>g>m?g:m, 0) : 0;
  return {
    wallMs, activeMs, idleMs,
    activeRatio: wallMs>0 ? activeMs/wallMs : 1,
    gaps, longestGapMs, segments: segs.length
  };
}

/**
 * Klasifikasi satu jeda. 'micro' = masih perilaku (jeda berpikir, baca sebentar);
 * 'idle' = jangan diukur melintasinya; 'away' = kursi mungkin kosong.
 */
function classifyGap(gapMs, gapThresholdMs=GAP_MS_DEFAULT, awayThresholdMs=AWAY_MS_DEFAULT){
  if(gapMs >= awayThresholdMs) return 'away';
  if(gapMs >= gapThresholdMs) return 'idle';
  return 'micro';
}

/**
 * Bagi hasil segmentasi menjadi (a) segmen yang layak dinilai, (b) EKOR yang
 * masih terbuka — segmen terakhir yang belum cukup panjang tapi event barunya
 * masih baru, jadi pengguna kemungkinan masih aktif dan ia harus dikembalikan ke
 * buffer supaya terus tumbuh, bukan dibuang, dan (c) segmen basi yang dijatuhkan.
 *
 * `nowTs` disuntik (bukan Date.now() internal) supaya fungsi ini deterministik
 * dan bisa diuji.
 */
// C-33: `carryMaxAgeMs` memisahkan dua pertanyaan yang dulu disatukan di `gapMs`:
// "kapan jeda tidak boleh diukur" (30 dtk) dan "berapa lama bukti yang belum cukup
// boleh ditunggu". Dengan penundaan vonis sampai bukti cukup, ekor yang belum cukup
// harus terus DIKUMPULKAN walau pengguna berhenti 30 dtk — kompresi C-28 sudah
// menangani jedanya. Default = gapMs (perilaku lama persis).
function splitForAssessment(segments, minEvents, nowTs, gapMs=GAP_MS_DEFAULT, carryMaxAgeMs=gapMs){
  const assess=[], dropped=[];
  let carry=null;
  segments.forEach((s,i)=>{
    if(s.events.length >= minEvents){ assess.push(s); return; }
    const isLast = i===segments.length-1;
    // ekor masih "hidup" bila event terakhirnya belum melewati ambang jeda
    if(isLast && (nowTs - s.endTs) < carryMaxAgeMs) carry=s;
    else dropped.push(s);
  });
  return { assess, carry, dropped };
}
return {GAP_MS_DEFAULT: GAP_MS_DEFAULT, AWAY_MS_DEFAULT: AWAY_MS_DEFAULT, groupByStream: groupByStream, dropExactDuplicates: dropExactDuplicates, segmentByIdle: segmentByIdle, compressIdle: compressIdle, idleAccounting: idleAccounting, classifyGap: classifyGap, splitForAssessment: splitForAssessment};
})();

/* ---- core/challenge.js ---- */
__M["core/challenge.js"] = (function(){
/**
 * challenge.js - step-up kata kunci + ritme ketik per-posisi.
 *
 * KONTRAK KEAMANAN (v2): fungsi ini GAGAL-TERTUTUP.
 * Sample yang tidak lengkap, tidak finit, atau panjangnya tidak sama dengan
 * template = DITOLAK. Versi v1 mengiterasi panjang TEMPLATE dan membaca
 * `sample.dwell[i]` yang `undefined` -> `NaN` -> `NaN > x` selalu false ->
 * nol pelanggaran -> LOLOS. Akibatnya menempel frasa (nol event ketik)
 * melewati seluruh lapisan ritme. Lihat core/DRIFT.md C-1.
 *
 * Di luar cakupan core/SPEC.md (§1: challenge bukan bagian jalur numerik),
 * jadi berkas ini tidak terikat core/golden.json.
 */

// Ambang bentuk template. Frasa terlalu pendek = terlalu sedikit titik ukur
// untuk membedakan orang; tolak daripada memberi rasa aman palsu.
const MIN_DWELL_POINTS = 8;      // ~8 karakter tampak
const MAD_FLOOR_MS = 3;                 // di bawah ini = derau timer, bukan sinyal
// C-20: 8% terlalu ketat. Pendaftaran 3-ronde yang konsisten bikin MAD kecil ->
// toleransi 2.5*8%*median. Variasi ritme pemilik ANTAR-SESI (capek, mood, keyboard
// lain) gampang tembus itu -> pemilik asli ditolak ~64% (terukur). 12% = jitter
// manusia antar-sesi yang wajar; FRR turun drastis, FAR tetap ~0 (lihat C-20 DRIFT.md).
const MAD_FLOOR_REL = 0.12;             // jitter manusia antar-sesi yang wajar
const MAD_CEIL_REL = 0.50;              // pendaftaran kacau tak boleh bikin toleransi tak terbatas
const MISS_BUDGET_REL = 0.12;           // porsi posisi yang boleh meleset
const K_DEFAULT = 2.5;
// C-20: tempo GLOBAL pemilik geser tiap hari (semua tombol serentak lebih lambat/cepat).
// Yang membedakan ORANG adalah pola RELATIF antar-posisi, bukan kecepatan absolut.
// Sebelum banding per-posisi, skala sampel ke tempo template (rasio median). Rasio
// dijepit [0.5,2.0]: drift pemilik (±20%) terkoreksi penuh, tapi sampel ekstrem
// (robot/tempel-datar 300ms) tidak bisa "diskalakan pas" jadi tetap ketolak.
const TEMPO_RATIO_LO = 0.5, TEMPO_RATIO_HI = 2.0;

function isFiniteArray(a, n) {
  if (!Array.isArray(a) || a.length !== n) return false;
  for (let i = 0; i < n; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

function medianOf(sorted) {
  const n = sorted.length;
  if (!n) return 0;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// MAD dijepit: lantai (absolut + relatif) supaya pemilik yang konsisten tidak
// ditolak oleh derau; langit-langit supaya pendaftaran yang berantakan tidak
// melebarkan toleransi sampai menerima siapa pun.
function clampedMad(vals, med) {
  const raw = vals.reduce((a, v) => a + Math.abs(v - med), 0) / vals.length;
  const floor = Math.max(MAD_FLOOR_MS, MAD_FLOOR_REL * med);
  const ceil = Math.max(floor, MAD_CEIL_REL * med);
  return Math.min(Math.max(raw, floor), ceil);
}

function axis(samples, key) {
  const n = samples[0][key].length;
  const med = [], mad = [];
  for (let i = 0; i < n; i++) {
    const vals = samples.map(s => s[key][i]).sort((a, b) => a - b);
    const m = medianOf(vals);
    med.push(m);
    mad.push(clampedMad(vals, m));
  }
  return { med, mad };
}

/**
 * Bangun template dari beberapa sampel pendaftaran.
 * Menolak (mengembalikan null) bila sampel tidak konsisten bentuknya atau
 * frasanya terlalu pendek — lebih baik tanpa template daripada template lemah.
 */
// C-45: keyboard layar sentuh (Android/iOS) menembakkan keydown `Unidentified` / 229 tanpa
// waktu tahan yang bermakna, jadi dwell tidak bisa diukur di sana. Sampel dari keyboard
// seperti itu bermode 'soft': hanya jeda antar-karakter (flight) yang dinilai. Template
// menyimpan modenya; sampel dengan mode berbeda DITOLAK (gagal-tertutup), bukan
// diterjemahkan - ritme keyboard fisik dan layar sentuh bukan besaran yang sama.
const modeOf = s => (s && s.mode === 'soft') ? 'soft' : 'hard';

function buildTemplate(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const nD = samples[0] && Array.isArray(samples[0].dwell) ? samples[0].dwell.length : 0;
  const nF = samples[0] && Array.isArray(samples[0].flight) ? samples[0].flight.length : 0;
  if (nD < MIN_DWELL_POINTS) return null;
  const mode = modeOf(samples[0]);
  // setiap sampel harus berbentuk sama & finit — kalau tidak, pendaftarannya cacat
  for (const s of samples) {
    if (!s || !isFiniteArray(s.dwell, nD) || !isFiniteArray(s.flight, nF)) return null;
    if (modeOf(s) !== mode) return null;
  }
  const d = axis(samples, 'dwell');
  const f = axis(samples, 'flight');
  return {
    v: 2,
    mode,
    dwell: d.med, dwellMad: d.mad,
    flight: f.med, flightMad: f.mad,
    k: K_DEFAULT,
    rounds: samples.length,
  };
}

/**
 * Verifikasi satu sampel terhadap template.
 * @returns {{ok:boolean, reasons:string[], checks:number, misses:number, budget:number}}
 */
function verify(sample, tmpl) {
  if (!tmpl || !Array.isArray(tmpl.dwell) || !Array.isArray(tmpl.flight)) {
    return { ok: false, reasons: ['no template'], checks: 0, misses: 0, budget: 0 };
  }
  const nD = tmpl.dwell.length, nF = tmpl.flight.length;

  // GERBANG BENTUK — inilah tambalan intinya. Sample harus lengkap dan finit.
  // Tempel / autofill / isi sebagian menghasilkan array pendek dan berhenti DI SINI,
  // bukan lolos diam-diam lewat perbandingan NaN.
  if (!sample || !isFiniteArray(sample.dwell, nD) || !isFiniteArray(sample.flight, nF)) {
    const gotD = sample && Array.isArray(sample.dwell) ? sample.dwell.length : 0;
    const gotF = sample && Array.isArray(sample.flight) ? sample.flight.length : 0;
    return {
      ok: false,
      reasons: [`ritme tidak lengkap: dwell ${gotD}/${nD}, flight ${gotF}/${nF} (tempel/autofill tidak diterima)`],
      checks: nD + nF, misses: nD + nF, budget: 0,
    };
  }

  if (modeOf(sample) !== modeOf(tmpl)) {
    return {
      ok: false, modeMismatch: true,
      reasons: [`jenis keyboard berbeda dari saat pendaftaran (${modeOf(tmpl)} vs ${modeOf(sample)})`],
      checks: nD + nF, misses: nD + nF, budget: 0,
    };
  }
  const soft = modeOf(tmpl) === 'soft';
  const k = Number.isFinite(tmpl.k) ? tmpl.k : K_DEFAULT;
  const reasons = [];
  const push = (label, i, d, lim) =>
    reasons.push(`${label} ${i} ${d.toFixed(1)}>${lim.toFixed(1)}`);

  // C-20: koreksi tempo global sebelum banding per-posisi. Rasio = median template
  // / median sampel, dijepit [0.5,2.0]. Ini membuang geseran kecepatan antar-sesi
  // pemilik (penyebab utama FRR tinggi) tanpa menghapus pola relatif yang membedakan
  // orang. Dijepit supaya sampel bertempo ekstrem tidak bisa diskalakan agar cocok.
  const clampRatio = (num, den) => {
    if (!(den > 0) || !Number.isFinite(num)) return 1;
    return Math.min(Math.max(num / den, TEMPO_RATIO_LO), TEMPO_RATIO_HI);
  };
  const rD = clampRatio(medianOf([...tmpl.dwell].sort((a, b) => a - b)),
                        medianOf([...sample.dwell].sort((a, b) => a - b)));
  const rF = clampRatio(medianOf([...tmpl.flight].sort((a, b) => a - b)),
                        medianOf([...sample.flight].sort((a, b) => a - b)));

  // Mode soft: dwell tidak terukur, jadi tidak dinilai SAMA SEKALI - kalau dihitung sebagai
  // "lolos", anggaran meleset di bawah ikut membengkak dan melonggarkan cek flight.
  if (!soft) for (let i = 0; i < nD; i++) {
    const lim = k * tmpl.dwellMad[i];
    const d = Math.abs(sample.dwell[i] * rD - tmpl.dwell[i]);
    if (d > lim) push('dwell', i, d, lim);
  }
  for (let i = 0; i < nF; i++) {
    const lim = k * tmpl.flightMad[i];
    const d = Math.abs(sample.flight[i] * rF - tmpl.flight[i]);
    if (d > lim) push('flight', i, d, lim);
  }

  // Anggaran meleset PROPORSIONAL, bukan angka tetap 2. Pada frasa pendek
  // "2 posisi bebas" adalah celah besar; pada frasa panjang justru terlalu galak.
  const checks = soft ? nF : nD + nF;
  const budget = Math.max(1, Math.floor(MISS_BUDGET_REL * checks));
  return { ok: reasons.length <= budget, reasons, checks, misses: reasons.length, budget };
}
return {MIN_DWELL_POINTS: MIN_DWELL_POINTS, buildTemplate: buildTemplate, verify: verify};
})();

/* ---- core/mfa.js ---- */
__M["core/mfa.js"] = (function(){
/**
 * mfa.js - verifikasi step-up BAWAAN (dialog dari pustaka).
 *
 * Dipicu saat vonis MEDIUM/HIGH, atau dipanggil integrator lewat BehaviorGuard.stepUp().
 * Pengguna MENGETIK ULANG frasa yang tampil di layar; frasanya bukan rahasia - identitas
 * dibuktikan dari RITME ketik (dwell/flight per posisi) lewat challenge.js.
 * Nol dependensi, nol backend, murni di perangkat.
 *
 * CATATAN KEJUJURAN: verifikasi sisi-klien = re-autentikasi step-up yang nyaman, BUKAN
 * faktor kedua kelas-keamanan. Penyerang yang menguasai browser bisa melewati cek yang
 * seluruhnya di klien (THREAT-MODEL.md). Untuk aksi bernilai tinggi, sediakan jalur
 * `mfa.onFallback` (OTP/WebAuthn milik integrator yang diverifikasi di server).
 *
 * C-45 - dialog versi produksi. Yang berubah dari versi lama dan KENAPA:
 *  - Shadow DOM + stylesheet sendiri. Dulu gaya inline di dalam halaman integrator: CSS
 *    situs (`input{...}`, `button{...}`, reset framework) ikut mengubah tampilan dialog,
 *    dan id tetap (#bg-inp) bisa bertabrakan dengan id milik halaman. innerHTML dengan
 *    atribut style juga diblokir oleh CSP `style-src` yang ketat - justru kebijakan yang
 *    dipakai situs bank. Kini: adoptedStyleSheets (tak terkena CSP inline), nol atribut
 *    style di markup, teks dari integrator selalu lewat textContent (tak ada injeksi HTML).
 *  - Aksesibilitas: role=dialog, aria-modal, fokus terkunci di dalam dialog (Tab berputar),
 *    Esc = batal, pesan lewat aria-live, fokus dikembalikan ke elemen semula saat tutup.
 *  - Keyboard layar sentuh: keydown di Android/iOS memberi `Unidentified`/229 tanpa waktu
 *    tahan. Versi lama tak pernah bisa merekam sampel utuh di ponsel ("ritme tidak terekam
 *    utuh" selamanya) - pemilik yang memakai ponsel terkunci tanpa jalan keluar. Kini jeda
 *    antar-karakter diukur dari event `input` dan sampelnya bermode 'soft'.
 *  - Backspace dulu hanya mengosongkan rekaman tapi tidak isi kolom, jadi ketikan
 *    berikutnya pasti ditolak tanpa pengguna tahu kenapa. Kini kolom ikut dikosongkan dan
 *    alasannya ditulis.
 *  - Frasa tampil per huruf dan menyala sesuai ketikan; salah huruf langsung terlihat.
 *    Frasa lengkap dikirim otomatis (tanpa harus menekan Enter).
 *  - "Gunakan cara lain": jalur keluar untuk pemilik yang tidak bisa mengetik frasa
 *    (ponsel lain, cedera tangan, keyboard berbeda). Tanpa jalur ini pemilik yang gagal
 *    ritme tidak punya pilihan selain diblokir.
 *  - Ketikan di dialog tidak bocor ke pintasan keyboard halaman (propagasi dihentikan di
 *    host); penangkap perilaku sudah mengabaikannya lewat [data-bg-mfa].
 *
 * API: runMfaChallenge(opsi) -> Promise<{ passed, verified, enrolled?, template?, reasons?,
 *        cancelled?, timedOut?, attemptsExhausted?, fallback?, modeMismatch?, reason? }>
 *   - template null -> mode DAFTAR: ketik `rounds`x -> {enrolled:true, template}
 *   - template ada  -> mode VERIFIKASI: ketik 1x (maks 3 percobaan) -> {verified}
 */

const TEXT = {
  id: {
    verifyTitleMedium: 'Konfirmasi bahwa ini kamu',
    verifyTitleHigh: 'Kami perlu memastikan ini kamu',
    verifySubMedium: 'Cara kamu memakai akun ini sedikit berbeda dari biasanya.',
    verifySubHigh: 'Aktivitas di sesi ini sangat berbeda dari kebiasaanmu.',
    verifyPrompt: 'Ketik frasa di bawah dengan irama biasamu.',
    verifySubAction: r => `Sebelum ${r}, pastikan ini memang kamu.`,
    verifySubGeneric: 'Pastikan ini memang kamu sebelum melanjutkan.',
    enrollTitle: 'Atur verifikasi irama ketik',
    enrollSub: 'Saat aktivitasmu terlihat tidak biasa, kami akan memintamu mengetik frasa ini. Yang dicocokkan adalah irama ketikanmu, bukan hurufnya.',
    enrollPrompt: n => `Ketik frasa di bawah ${n} kali seperti biasa.`,
    enrollRound: (i, n) => `Putaran ${i} dari ${n}`,
    placeholder: 'Ketik frasa di atas',
    phraseLabel: 'Frasa yang harus diketik',
    inputLabel: 'Ketik frasa',
    cancel: 'Batal',
    later: 'Nanti saja',
    submit: 'Lanjut',
    fallback: 'Gunakan cara lain',
    close: 'Tutup',
    wrongChar: 'Ada huruf yang tidak cocok. Tekan Backspace untuk mengulang.',
    restarted: 'Diulang dari awal. Irama dihitung dari ketikan utuh.',
    pasteBlocked: 'Menempel tidak bisa dipakai. Ketik frasanya.',
    suggestion: 'Saran kata dari keyboard terdeteksi. Ketik per huruf.',
    incomplete: 'Irama tidak terekam utuh. Ketik ulang dari awal tanpa menempel.',
    synthetic: 'Ketikan tidak berasal dari keyboard perangkat ini. Ketik langsung dengan tanganmu.',
    mismatchText: 'Teks belum sama dengan frasa.',
    again: 'Bagus. Sekali lagi.',
    tryAgain: (i, n) => `Iramanya belum cocok. Coba lagi (${i} dari ${n}).`,
    otherKeyboard: 'Keyboard ini berbeda dari saat kamu mengatur verifikasi.',
    capsLock: 'Caps Lock menyala.',
    verified: 'Terverifikasi',
    verifiedSub: 'Terima kasih. Kamu bisa melanjutkan.',
    enrolled: 'Verifikasi siap dipakai',
    enrolledSub: 'Irama ketikmu tersimpan di perangkat ini.',
    failed: 'Verifikasi tidak berhasil',
    failedSub: 'Irama ketikan tidak cocok dengan pemilik akun.',
    enrollFailed: 'Irama belum konsisten',
    enrollFailedSub: 'Coba lagi lain kali di tempat yang nyaman.',
    timeLeft: s => `Sisa waktu ${s} detik`,
    footer: 'Irama ketik dicocokkan di perangkat ini dan tidak dikirim ke mana pun.',
  },
  en: {
    verifyTitleMedium: 'Confirm it’s you',
    verifyTitleHigh: 'We need to make sure it’s you',
    verifySubMedium: 'The way this account is being used looks a little different from usual.',
    verifySubHigh: 'Activity in this session is very different from your usual pattern.',
    verifyPrompt: 'Type the phrase below at your normal pace.',
    verifySubAction: r => `Before you ${r}, confirm it’s really you.`,
    verifySubGeneric: 'Confirm it’s really you before continuing.',
    enrollTitle: 'Set up typing-rhythm verification',
    enrollSub: 'When your activity looks unusual we will ask you to type this phrase. What is matched is your typing rhythm, not the letters.',
    enrollPrompt: n => `Type the phrase below ${n} times as you normally would.`,
    enrollRound: (i, n) => `Round ${i} of ${n}`,
    placeholder: 'Type the phrase above',
    phraseLabel: 'Phrase to type',
    inputLabel: 'Type the phrase',
    cancel: 'Cancel',
    later: 'Not now',
    submit: 'Continue',
    fallback: 'Use another method',
    close: 'Close',
    wrongChar: 'A character does not match. Press Backspace to start over.',
    restarted: 'Started over. Rhythm is measured on a complete entry.',
    pasteBlocked: 'Pasting is not accepted. Please type the phrase.',
    suggestion: 'Keyboard word suggestion detected. Type one letter at a time.',
    incomplete: 'Rhythm was not fully recorded. Type it again without pasting.',
    synthetic: 'The input did not come from this device’s keyboard. Please type it yourself.',
    mismatchText: 'The text does not match the phrase yet.',
    again: 'Good. Once more.',
    tryAgain: (i, n) => `The rhythm did not match. Try again (${i} of ${n}).`,
    otherKeyboard: 'This keyboard differs from the one used during setup.',
    capsLock: 'Caps Lock is on.',
    verified: 'Verified',
    verifiedSub: 'Thanks. You can continue.',
    enrolled: 'Verification is ready',
    enrolledSub: 'Your typing rhythm is stored on this device.',
    failed: 'Verification failed',
    failedSub: 'The typing rhythm does not match the account owner.',
    enrollFailed: 'Rhythm was not consistent',
    enrollFailedSub: 'Try again later somewhere comfortable.',
    timeLeft: s => `${s} seconds left`,
    footer: 'Typing rhythm is matched on this device and never sent anywhere.',
  },
};

function pickLang(lang) {
  if (lang && TEXT[lang]) return lang;
  try {
    const l = (document.documentElement.getAttribute('lang') || navigator.language || 'id').toLowerCase();
    return l.startsWith('en') ? 'en' : 'id';
  } catch { return 'id'; }
}

const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.bd{position:fixed;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(12,16,24,.52);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  color:var(--fg);-webkit-font-smoothing:antialiased;
  letter-spacing:normal;word-spacing:normal;text-transform:none;text-indent:0;text-align:left;text-shadow:none;
  font-style:normal;font-variant:normal;white-space:normal;direction:ltr;visibility:visible;cursor:auto;
  pointer-events:auto;user-select:auto;-webkit-user-select:auto;
  --bg:#ffffff;--fg:#141a24;--mut:#5b6573;--line:#e3e6eb;--soft:#f4f6f8;--ok:#1a7f4b;--bad:#c4312b;--warn:#b35c00;--accent:#1f5fd6;--on-accent:#fff}
@media (prefers-color-scheme:dark){.bd.auto{--bg:#171b22;--fg:#e8ebf0;--mut:#9aa3af;--line:#2c323c;--soft:#1f242d;--ok:#4cc38a;--bad:#ff7b72;--warn:#e3a14a}}
.bd.dark{--bg:#171b22;--fg:#e8ebf0;--mut:#9aa3af;--line:#2c323c;--soft:#1f242d;--ok:#4cc38a;--bad:#ff7b72;--warn:#e3a14a}
.card{position:relative;width:100%;max-width:400px;background:var(--bg);border:1px solid var(--line);border-radius:14px;
  box-shadow:0 24px 64px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.08);padding:22px 22px 0;outline:none}
.hd{display:flex;gap:12px;align-items:flex-start;margin-bottom:14px}
.ic{flex:none;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--soft);color:var(--accent)}
.ic.high{color:var(--warn)}
.ic svg{width:20px;height:20px}
.tt{margin:0;font-size:16px;font-weight:650;line-height:1.3;letter-spacing:-.005em}
.st{margin:3px 0 0;color:var(--mut);font-size:13.5px}
.x{position:absolute;top:12px;right:12px;width:30px;height:30px;border-radius:8px;border:0;background:transparent;color:var(--mut);cursor:pointer;display:grid;place-items:center}
.x:hover{background:var(--soft);color:var(--fg)}
.pr{margin:0 0 8px;font-size:13px;color:var(--mut);display:flex;justify-content:space-between;gap:8px}
.ph{font:600 17px/1.35 ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;letter-spacing:.02em;padding:11px 12px;border-radius:10px;
  background:var(--soft);border:1px solid var(--line);margin-bottom:10px;user-select:none;-webkit-user-select:none;word-break:break-word}
.ph span{color:var(--mut);transition:color .08s}
.ph span.ok{color:var(--fg)}
.ph span.bad{color:var(--bad);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}
.ph span.cur{box-shadow:inset 0 -2px 0 var(--accent)}
input{width:100%;font:inherit;font-size:15px;color:var(--fg);background:var(--bg);border:1.5px solid var(--line);border-radius:10px;padding:10px 12px;outline:none}
input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(31,95,214,.2);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.msg{min-height:20px;margin:7px 1px 0;font-size:13px;color:var(--mut)}
.msg.err{color:var(--bad)}.msg.good{color:var(--ok)}
.dots{display:flex;gap:6px;align-items:center}
.dots i{width:22px;height:4px;border-radius:4px;background:var(--line)}
.dots i.on{background:var(--accent)}
.ft{display:flex;align-items:center;gap:8px;margin:16px 0 0;padding:0 0 18px}
.sp{flex:1}
button.b{font:inherit;font-size:14px;font-weight:600;border-radius:9px;padding:8px 15px;cursor:pointer;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
button.b:hover{background:var(--soft)}
button.pri{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
button.pri:hover{filter:brightness(1.07);background:var(--accent)}
button.lnk{border:0;background:none;padding:8px 2px;color:var(--accent);font-weight:600;cursor:pointer;font:inherit;font-size:13.5px}
button:focus-visible,.x:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.foot{margin:0 -22px;padding:10px 22px 12px;border-top:1px solid var(--line);color:var(--mut);font-size:12px;display:flex;gap:6px;align-items:center}
.foot svg{width:13px;height:13px;flex:none}
.res{text-align:center;padding:10px 0 24px}
.res .big{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;margin:4px auto 12px}
.res .big svg{width:26px;height:26px}
.res.ok .big{background:var(--soft);background:color-mix(in srgb,var(--ok) 14%,transparent);color:var(--ok)}
.res.bad .big{background:var(--soft);background:color-mix(in srgb,var(--bad) 14%,transparent);color:var(--bad)}
.res h2{margin:0;font-size:16px;font-weight:650}
.res p{margin:4px 0 0;color:var(--mut);font-size:13.5px}
.tl{font-size:12px;color:var(--mut)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:420px){.card{padding:18px 16px 0}.foot{margin:0 -16px;padding:10px 16px 12px}}
`;

const ICON = {
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.3-2.9 8.1-7 9.5-4.1-1.4-7-5.2-7-9.5V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.3-2.9 8.1-7 9.5-4.1-1.4-7-5.2-7-9.5V6l7-3z"/><path d="M12 8v4.5M12 16h.01"/></svg>',
  keys: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
};

let sheetCache = null;
function applyStyles(root) {
  try {
    if (root.adoptedStyleSheets !== undefined && typeof CSSStyleSheet === 'function') {
      if (!sheetCache) { sheetCache = new CSSStyleSheet(); sheetCache.replaceSync(CSS); }
      root.adoptedStyleSheets = [sheetCache];
      return;
    }
  } catch {}
  const st = document.createElement('style'); st.textContent = CSS; root.appendChild(st);
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;      // hanya dipakai untuk ikon SVG konstan di atas
  return e;
}

/**
 * Perekam ritme untuk satu kolom input. Merekam DUA jalur sekaligus:
 *  - hard: keydown->keyup (dwell) dan keyup->keydown berikut (flight) - keyboard fisik;
 *  - soft: waktu tiap karakter bertambah di event `input` - keyboard layar sentuh.
 * Mode dipilih di akhir: soft hanya bila keyboard memang melaporkan tombol `Unidentified`.
 */
function createRecorder(input, hooks) {
  // Per tombol, bukan "tombol terakhir": pengetik cepat menekan huruf berikut SEBELUM
  // melepas huruf sebelumnya (rollover). Versi lama menyimpan satu `downAt`, sehingga
  // rollover mengacaukan pasangan tekan/lepas dan sampel sering tidak utuh.
  // C-46: `synth` = ada event ketik yang DIBUAT SKRIP (isTrusted false). Ini bukan soal
  // kenyamanan melainkan pintu belakang: template irama tersimpan di perangkat, jadi skrip
  // yang bisa membacanya (XSS, ekstensi jahat) dulu tinggal menembakkan keydown/keyup dengan
  // jeda persis median template itu untuk LOLOS verifikasi tanpa satu pun jari menyentuh
  // keyboard. Sampel yang tersentuh event tiruan ditolak seluruhnya - gagal-tertutup.
  let tainted = false, sawSoft = false, prevLen = 0, synth = false;
  const downs = [], ups = [], open = new Map(), softT = [];
  const reset = () => { tainted = false; synth = false; prevLen = 0; downs.length = 0; ups.length = 0; open.clear(); softT.length = 0; };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const isSoftKey = e => e.isComposing || e.keyCode === 229 || e.key === 'Unidentified' || e.key === 'Process';

  const clearAll = why => { input.value = ''; reset(); hooks.onRestart(why); };

  for (const t of ['paste', 'drop']) {
    input.addEventListener(t, e => { e.preventDefault(); clearAll('paste'); });
  }
  input.addEventListener('beforeinput', e => {
    const it = e.inputType || '';
    if (it === 'insertFromPaste' || it === 'insertFromDrop' || it === 'insertFromYank' || it === 'insertReplacementText') {
      e.preventDefault(); clearAll(it === 'insertReplacementText' ? 'suggestion' : 'paste');
    }
  });
  input.addEventListener('keydown', e => {
    if (e.isTrusted === false) { synth = true; return; }
    if (e.key === 'CapsLock' || (e.getModifierState && e.getModifierState('CapsLock'))) hooks.onCaps(!!(e.getModifierState && e.getModifierState('CapsLock')));
    if (isSoftKey(e)) { sawSoft = true; return; }
    if (e.key === 'Enter') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); if (input.value) clearAll('backspace'); return; }
    if (e.key.length !== 1 || e.repeat) return;
    // spasi ganda/di depan tidak mengubah teks (dinormalisasi) tapi menambah satu posisi
    // ritme -> sampel tak sebentuk dengan template. Dicegah di sumbernya.
    if (e.key === ' ' && (!input.value || input.value.endsWith(' '))) { e.preventDefault(); return; }
    open.set(e.code || e.key, downs.length);
    downs.push(now());
  });
  input.addEventListener('keyup', e => {
    if (e.isTrusted === false) { synth = true; return; }
    if (isSoftKey(e)) return;
    const id = e.code || e.key;
    const i = open.get(id);
    if (i == null) return;
    open.delete(id);
    ups[i] = now();
    hooks.onKeyup();
  });
  input.addEventListener('input', e => {
    const len = input.value.length;
    const it = e.inputType || '';
    if (it.startsWith('delete') || len < prevLen) {
      // Backspace di keyboard layar sentuh tidak lewat keydown yang bisa dicegah
      if (input.value) { clearAll('backspace'); return; }
      reset(); hooks.onChange(); return;
    }
    if (len === prevLen + 1) softT.push(now());
    else if (len > prevLen + 1) tainted = true;         // saran kata / isi otomatis beberapa huruf
    prevLen = len;
    hooks.onChange();
  });

  return {
    reset,
    sample() {
      const n = input.value.length;
      if (synth) return { error: 'synthetic' };
      if (tainted) return { error: 'suggestion' };
      if (sawSoft) {
        if (softT.length !== n || n < 2) return { error: 'incomplete' };
        const fl = []; for (let i = 1; i < n; i++) fl.push(softT[i] - softT[i - 1]);
        return { mode: 'soft', dwell: new Array(n).fill(0), flight: fl };
      }
      if (n === 0 || downs.length !== n || open.size) return { error: 'incomplete' };
      const dwell = [], flight = [];
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(ups[i])) return { error: 'incomplete' };
        dwell.push(ups[i] - downs[i]);
        if (i > 0) flight.push(downs[i] - ups[i - 1]);   // negatif = rollover, itu juga ciri orang
      }
      return { mode: 'hard', dwell, flight };
    },
    pendingKey: () => open.size > 0,
  };
}

/**
 * @param {object} o
 *   phrase, template|null, rounds, buildTemplate, verify
 *   level: 'MEDIUM'|'HIGH' (verifikasi) - menentukan nada teks
 *   timeoutMs, lang ('id'|'en'), texts (timpa sebagian teks), accent (warna CSS), brand (nama situs)
 *   allowFallback: tampilkan "Gunakan cara lain" (hanya mode verifikasi)
 *   title/subtitle: timpa judul/subjudul (kompatibel dengan versi lama)
 */
function runMfaChallenge(o) {
  const {
    phrase: rawPhrase, template = null, rounds = 3, buildTemplate, verify,
    level = 'MEDIUM', timeoutMs = 120000, lang, texts, accent, brand,
    allowFallback = false, title, subtitle, theme = 'auto', trigger = 'verdict', reason = null,
  } = o || {};
  if (typeof document === 'undefined' || !document.documentElement) {
    return Promise.resolve({ passed: false, verified: false, cancelled: true, reason: 'no-dom' });
  }
  const L = { ...TEXT[pickLang(lang)], ...(texts || {}) };
  const phrase = String(rawPhrase || '').replace(/\s+/g, ' ').trim();
  const enrollMode = !template;
  const need = enrollMode ? Math.max(2, rounds | 0) : 1;
  const MAX_ATTEMPTS = 3;
  const samples = [];
  const prevFocus = document.activeElement;

  return new Promise(resolve => {
    // Host = elemen khusus (bukan <div>) supaya aturan `div{...}` situs tidak mengenainya, dan
    // gaya inline-nya !important supaya aturan `*{...}` situs yang !important pun kalah. Yang
    // masih bisa merembes dari host hanyalah properti WARISAN; semuanya diset ulang di .bd.
    const host = document.createElement('bg-guard-dialog');
    host.setAttribute('data-bg-mfa', '');
    host.style.cssText = ['position:fixed', 'top:0', 'right:0', 'bottom:0', 'left:0', 'z-index:2147483647', 'display:block',
      'margin:0', 'padding:0', 'border:0', 'background:transparent', 'opacity:1', 'visibility:visible', 'transform:none',
      'filter:none', 'pointer-events:auto', 'width:auto', 'height:auto', 'clip-path:none', 'contain:none']
      .map(d => d + ' !important').join(';');
    const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    applyStyles(root);

    // tema: 'auto' mengikuti OS; situs yang selalu terang/gelap memaksanya supaya dialog
    // tidak tampil gelap di atas halaman terang (atau sebaliknya)
    const bd = el('div', 'bd ' + (theme === 'light' || theme === 'dark' ? theme : 'auto'));
    if (accent) { bd.style.setProperty('--accent', accent); }
    const card = el('div', 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'bg-t');
    card.setAttribute('aria-describedby', 'bg-s');
    card.tabIndex = -1;
    bd.appendChild(card);
    root.appendChild(bd);

    // ---------- kerangka ----------
    const hd = el('div', 'hd');
    const ic = el('div', 'ic' + (level === 'HIGH' && !enrollMode ? ' high' : ''), enrollMode ? ICON.keys : (level === 'HIGH' ? ICON.alert : ICON.shield));
    const hx = el('div');
    const tt = el('h2', 'tt'); tt.id = 'bg-t';
    tt.textContent = title || (enrollMode ? L.enrollTitle : (level === 'HIGH' ? L.verifyTitleHigh : L.verifyTitleMedium));
    const st = el('p', 'st'); st.id = 'bg-s';
    // Vonis otomatis menjelaskan PENYIMPANGAN; step-up dari integrator (sebelum transfer,
    // ganti sandi) belum tentu karena penyimpangan - jangan menuduh "perilakumu berbeda".
    st.textContent = subtitle || (enrollMode ? L.enrollSub
      : trigger === 'integrator' ? (reason ? L.verifySubAction(reason) : L.verifySubGeneric)
      : (level === 'HIGH' ? L.verifySubHigh : L.verifySubMedium));
    if (brand && !subtitle) st.textContent = `${brand} · ${st.textContent}`;
    hx.append(tt, st); hd.append(ic, hx);
    const x = el('button', 'x', ICON.x); x.type = 'button'; x.setAttribute('aria-label', L.close);

    const body = el('div');
    const pr = el('div', 'pr');
    const prL = el('span'); prL.textContent = enrollMode ? L.enrollPrompt(need) : L.verifyPrompt;
    const prR = el('span', 'dots');
    if (enrollMode) for (let i = 0; i < need; i++) prR.appendChild(el('i'));
    pr.append(prL, prR);

    const ph = el('div', 'ph'); ph.setAttribute('aria-hidden', 'true');
    const chars = [...phrase];
    const spans = chars.map(c => { const s = el('span'); s.textContent = c; ph.appendChild(s); return s; });
    const phSr = el('span', 'sr'); phSr.textContent = `${L.phraseLabel}: ${phrase}`;

    const inp = document.createElement('input');
    inp.type = 'text';
    for (const [k, v] of Object.entries({ autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
      inputmode: 'text', enterkeyhint: 'done', 'aria-label': L.inputLabel, 'data-lpignore': 'true', 'data-1p-ignore': '', 'data-form-type': 'other' })) inp.setAttribute(k, v);
    inp.placeholder = L.placeholder;

    const msg = el('div', 'msg'); msg.setAttribute('role', 'status'); msg.setAttribute('aria-live', 'polite');
    body.append(pr, phSr, ph, inp, msg);

    const ft = el('div', 'ft');
    const fb = el('button', 'lnk'); fb.type = 'button'; fb.textContent = L.fallback;
    const tl = el('span', 'tl');
    const sp = el('span', 'sp');
    const cancel = el('button', 'b'); cancel.type = 'button'; cancel.textContent = enrollMode ? L.later : L.cancel;
    const ok = el('button', 'b pri'); ok.type = 'button'; ok.textContent = L.submit;
    if (allowFallback && !enrollMode) ft.append(fb);
    ft.append(tl, sp, cancel, ok);

    const foot = el('div', 'foot', ICON.lock);
    const footT = el('span'); footT.textContent = L.footer; foot.appendChild(footT);

    card.append(hd, x, body, ft, foot);

    // ---------- keadaan ----------
    let done = false, failed = 0, capsOn = false, autoT = null, killT = null, tickT = null;
    let deadline = Date.now() + timeoutMs;
    const say = (text, kind) => { msg.textContent = text || ''; msg.className = 'msg' + (kind ? ' ' + kind : ''); };
    const paintDots = () => { [...prR.children].forEach((d, i) => d.classList.toggle('on', i < samples.length)); };

    const paint = () => {
      const v = inp.value.toLowerCase(), p = phrase.toLowerCase();
      let bad = -1;
      for (let i = 0; i < chars.length; i++) {
        const s = spans[i];
        s.className = '';
        if (i < v.length) {
          if (bad < 0 && v[i] === p[i]) s.className = 'ok';
          else { if (bad < 0) bad = i; s.className = 'bad'; }
        } else if (i === v.length) s.className = 'cur';
      }
      if (v.length > p.length && bad < 0) bad = p.length;
      return bad;
    };

    const rec = createRecorder(inp, {
      onRestart(why) {
        paint();
        say(why === 'paste' ? L.pasteBlocked : why === 'suggestion' ? L.suggestion : L.restarted, why === 'backspace' ? '' : 'err');
      },
      onCaps(on) { capsOn = on; },
      onKeyup() { scheduleAuto(); },
      onChange() {
        const bad = paint();
        if (bad >= 0) say(L.wrongChar, 'err');
        else if (capsOn) say(L.capsLock, '');
        else if (msg.classList.contains('err')) say('');
        scheduleAuto();
      },
    });

    function scheduleAuto() {
      if (autoT) { clearTimeout(autoT); autoT = null; }
      if (norm(inp.value) !== norm(phrase)) return;
      // tunggu keyup huruf terakhir, lalu beri jeda singkat supaya terasa disengaja
      autoT = setTimeout(() => { autoT = null; if (!rec.pendingKey()) submit(); }, 220);
    }

    function cleanup() {
      done = true;
      [autoT, killT].forEach(t => t && clearTimeout(t));
      if (tickT) clearInterval(tickT);
      document.removeEventListener('focusin', keepFocus, true);
      host.remove();
      try { if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); } catch {}
    }
    function finish(result, screen) {
      if (done) return;
      if (!screen) { cleanup(); resolve(result); return; }
      // layar hasil singkat: pengguna melihat apa yang terjadi sebelum dialog hilang
      done = true;
      [autoT, killT].forEach(t => t && clearTimeout(t));
      if (tickT) clearInterval(tickT);
      const r = el('div', 'res ' + screen.kind, `<div class="big">${screen.kind === 'ok' ? ICON.check : ICON.cross}</div>`);
      const h = el('h2'); h.textContent = screen.title;
      const p = el('p'); p.textContent = screen.sub;
      r.append(h, p);
      body.replaceWith(r); ft.remove(); x.remove();
      r.setAttribute('role', 'status'); r.setAttribute('aria-live', 'assertive');
      setTimeout(() => { done = false; cleanup(); resolve(result); }, screen.kind === 'ok' ? 900 : 1600);
    }

    // C-46: mengosongkan kolom dari KODE (sesudah sampel ditolak / satu putaran selesai) tidak
    // menerbitkan event `input`, jadi timer kirim-otomatis yang sudah dijadwalkan tetap hidup
    // dan menembak ~200 ms kemudian pada kolom yang sudah kosong. Akibatnya pesan yang baru
    // saja menjelaskan KENAPA ketikan ditolak langsung tertimpa "Teks belum sama dengan
    // frasa." - pengguna melihat keluhan yang salah dan tidak tahu harus berbuat apa.
    const clearInput = () => {
      if (autoT) { clearTimeout(autoT); autoT = null; }
      inp.value = ''; rec.reset(); paint();
    };
    function submit() {
      if (done) return;
      if (norm(inp.value) !== norm(phrase)) { say(L.mismatchText, 'err'); inp.focus(); return; }
      const s = rec.sample();
      if (s.error) {
        clearInput();
        say(s.error === 'suggestion' ? L.suggestion : s.error === 'synthetic' ? L.synthetic : L.incomplete, 'err');
        inp.focus(); return;
      }
      clearInput();
      if (enrollMode) {
        samples.push(s); paintDots();
        if (samples.length < need) {
          say(`${L.again} ${L.enrollRound(samples.length + 1, need)}`, 'good'); inp.focus(); return;
        }
        const tmpl = buildTemplate(samples);
        if (!tmpl) {
          finish({ passed: false, enrolled: false, verified: false, reason: 'template-ditolak' },
                 { kind: 'bad', title: L.enrollFailed, sub: L.enrollFailedSub });
          return;
        }
        // PENDAFTARAN BUKAN BUKTI IDENTITAS: verified sengaja false.
        finish({ passed: true, enrolled: true, verified: false, template: tmpl },
               { kind: 'ok', title: L.enrolled, sub: L.enrolledSub });
        return;
      }
      const res = verify(s, template);
      if (res.ok) {
        finish({ passed: true, enrolled: false, verified: true, reasons: res.reasons || [] },
               { kind: 'ok', title: L.verified, sub: L.verifiedSub });
        return;
      }
      if (res.modeMismatch) {
        // keyboard lain dari saat pendaftaran: mencoba lagi tidak akan pernah cocok
        say(L.otherKeyboard, 'err');
        if (allowFallback) { fb.focus(); return; }
        finish({ passed: false, verified: false, modeMismatch: true, reasons: res.reasons || [] },
               { kind: 'bad', title: L.failed, sub: L.otherKeyboard });
        return;
      }
      failed++;
      if (failed >= MAX_ATTEMPTS) {
        finish({ passed: false, enrolled: false, verified: false, reasons: res.reasons || [], attemptsExhausted: true },
               { kind: 'bad', title: L.failed, sub: L.failedSub });
        return;
      }
      say(L.tryAgain(failed + 1, MAX_ATTEMPTS), 'err'); inp.focus();
    }

    const cancelNow = () => finish({ passed: false, enrolled: false, verified: false, cancelled: true });
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', cancelNow);
    x.addEventListener('click', cancelNow);
    fb.addEventListener('click', () => finish({ passed: false, enrolled: false, verified: false, fallback: true }));

    // fokus terkunci + Esc + Enter; propagasi dihentikan supaya pintasan halaman diam
    const focusables = () => [...card.querySelectorAll('button,input')].filter(e => !e.disabled && e.isConnected);
    card.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); cancelNow(); return; }
      if (e.key === 'Enter' && e.target === inp) { e.preventDefault(); submit(); return; }
      if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return;
        const cur = root.activeElement || document.activeElement;
        const i = f.indexOf(cur);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
      }
    });
    for (const t of ['keydown', 'keyup', 'keypress', 'input', 'paste', 'beforeinput']) host.addEventListener(t, e => e.stopPropagation());
    function keepFocus(e) { if (!done && e.target !== host && !host.contains(e.target)) { try { inp.focus(); } catch {} } }
    document.addEventListener('focusin', keepFocus, true);

    if (timeoutMs > 0) {
      // C-18: popup yang diabaikan menutup sendiri - kalau tidak, Promise tak pernah
      // selesai dan seluruh lapisan step-up macet untuk sisa hidup halaman.
      // Batas waktu dihitung dari KETIDAKAKTIFAN, bukan sejak dialog dibuka: pendaftaran
      // 3 putaran plus membaca petunjuk bisa melewati 60 detik bagi orang yang mengetik
      // pelan, dan menutup dialog di tengah ketikan adalah hukuman untuk orang yang patuh.
      const arm = () => {
        if (killT) clearTimeout(killT);
        deadline = Date.now() + timeoutMs;
        killT = setTimeout(() => finish({ passed: false, enrolled: false, verified: false, cancelled: true, timedOut: true }), timeoutMs);
      };
      arm();
      inp.addEventListener('keydown', () => { if (!done) arm(); });
      inp.addEventListener('input', () => { if (!done) arm(); });
      tickT = setInterval(() => {
        const left = Math.ceil((deadline - Date.now()) / 1000);
        tl.textContent = left <= 30 && left > 0 ? L.timeLeft(left) : '';
      }, 1000);
    }

    (document.body || document.documentElement).appendChild(host);
    paint();
    if (enrollMode) say(L.enrollRound(1, need));
    setTimeout(() => { try { inp.focus({ preventScroll: true }); } catch { inp.focus(); } }, 30);
  });
}
return {createRecorder: createRecorder, runMfaChallenge: runMfaChallenge};
})();

/* ---- core/integrity.js ---- */
__M["core/integrity.js"] = (function(){
/**
 * integrity.js - bot/replay guard (copy server/integrity.py logic)
 * Cek: interval konstan (std<3ms), hold identik (std<1.5ms), velocity konstan, rate>80/s, timestamp non-monoton
 * Return {suspected: bool, reasons: string[]}
 */
function checkIntegrity(events, opts={}){
  // T5: hitung hanya dari event non-throttled (KEYSTROKE/CLICK) agar throttle 50ms tidak flag bot
  const filtered = opts.throttled ? events.filter(e=> e.event_type==='KEYSTROKE' || e.event_type==='MOUSE_CLICK') : events;
  // A1: fallback `: events` DULU MEMBATALKAN seluruh maksud T5. Saat keystroke+klik
  // < 10 — yaitu sesi yang isinya menelusuri/membaca — ia jatuh ke SELURUH event,
  // yang isinya hampir semua MOUSE_MOVE hasil throttle 50 ms kita sendiri. Interval
  // hasil throttle itu bukan cuma mirip-mirip, tapi PERSIS konstan:
  //   mousemove  60Hz -> 50,0 ms std 0,00    100Hz -> 50,0 ms std 0,00
  //   mousemove 125Hz -> 56,0 ms std 0,00    144Hz -> 55,6 ms std 0,50
  // Semuanya < 3 ms -> "interval konstan" -> BLOCK_SESSION untuk manusia yang cuma
  // membaca artikel sambil menggerakkan mouse. Rapuh pula: satu klik nyasar di ujung
  // sesi menaikkan std di atas ambang dan membuatnya lolos, sehingga gejalanya
  // muncul "kadang-kadang" dan nyaris mustahil dilacak dari laporan pengguna.
  // Kerabat langsung C-16, dihidupkan lagi oleh fallback-nya sendiri.
  //
  // Aturan yang benar: JANGAN PERNAH menilai keteraturan interval pada aliran yang
  // kita throttle sendiri. Kalau buktinya kurang, lewati cek itu — bukan ganti sumber.
  const throttledStream = opts.throttled && filtered.length < 10;
  const evs = filtered.length>=10 ? filtered : events;
  if(evs.length < 20) return {suspected:false, reasons:[]};
  const reasons=[];
  const ts = evs.map(e=>e.timestamp||0);
  // non-monoton. C-45: SATU langkah mundur adalah jam sistem yang disetel (sinkron NTP,
  // ganti zona waktu, laptop bangun dari tidur) - Date.now() memang bisa mundur, dan dulu
  // satu kejadian itu langsung BLOCK_SESSION untuk manusia. Urutan yang diacak/disuntik
  // mundur berkali-kali; ambangnya >= 3 langkah DAN > 1% event.
  let back=0;
  for(let i=1;i<ts.length;i++) if(ts[i] < ts[i-1]-5) back++;
  if(back>=3 && back > 0.01*ts.length) reasons.push(`timestamp non-monoton (${back}x)`);
  const intervals=[];
  for(let i=1;i<ts.length;i++) intervals.push(ts[i]-ts[i-1]);
  const mean = intervals.reduce((a,b)=>a+b,0)/intervals.length;
  const std = Math.sqrt(intervals.reduce((a,b)=>a+(b-mean)**2,0)/intervals.length);
  // A1: cek interval hanya sahih pada aliran yang TIDAK kita throttle.
  if(!throttledStream && std < 3) reasons.push(`interval konstan std=${std.toFixed(2)}ms`);
  // C-45: tombol dari keyboard layar sentuh (`soft`) tidak punya waktu tahan yang bermakna -
  // Android menembakkan keydown/keyup berdempetan untuk tiap huruf, jadi tahannya ~0 ms
  // SERAGAM. Dulu itu terbaca "hold identik" -> pengguna ponsel diblokir sebagai bot.
  const holds = evs.filter(e=>e.hold_time!=null && !e.soft).map(e=>e.hold_time);
  if(holds.length>=10){
    const hm = holds.reduce((a,b)=>a+b,0)/holds.length;
    const hs = Math.sqrt(holds.reduce((a,b)=>a+(b-hm)**2,0)/holds.length);
    if(hs < 1.5) reasons.push(`hold identik std=${hs.toFixed(2)}ms`);
  }
  // C-16: hanya nilai event yang BENAR-BENAR membawa velocity. Memakai
  // `e.velocity||0` pada event tanpa field itu menghasilkan deret nol -> std 0 ->
  // "velocity konstan" untuk sesi manusia yang sah.
  const vels = evs.filter(e=>e.x!=null && Number.isFinite(e.velocity)).map(e=>e.velocity);
  if(vels.length>=10){
    const vs = Math.sqrt(vels.reduce((a,b)=>a+(b-vels.reduce((x,y)=>x+y,0)/vels.length)**2,0)/vels.length);
    if(vs < 0.01) reasons.push('velocity konstan');
  }
  const dur = (ts[ts.length-1]-ts[0])/1000;
  const rate = dur>0 ? evs.length/dur : 0;
  // Aman dari artefak throttle: 50 ms -> maksimum 20/s, jauh di bawah 80.
  if(rate > 80) reasons.push(`rate ${rate.toFixed(1)}/s > human`);
  // replay: selisih timestamp duplikat persis
  const seen=new Set(); let dup=0;
  for(const t of ts){ if(seen.has(t)) dup++; seen.add(t); }
  // C-29: ambang dulu mutlak (>5). Sesudah kembaran identik dibuang, manusia mencapai
  // maksimum 4 ketikan/klik BERBEDA di milidetik yang sama per sesi riset (~230 event).
  // Ambang mutlak itu menyempit seiring panjang batch (pending bisa 800 event), jadi
  // dibuat relatif: > 5 DAN > 5% event yang diperiksa. Bot yang menyuntik event sintetis
  // bertumpuk di milidetik yang sama jauh di atas keduanya.
  if(dup>Math.max(5, 0.05*evs.length)) reasons.push(`timestamp duplikat ${dup}`);
  return {suspected: reasons.length>0, reasons};
}
return {checkIntegrity: checkIntegrity};
})();

/* ---- core/fingerprint.js ---- */
__M["core/fingerprint.js"] = (function(){
/**
 * fingerprint.js - device fingerprint ringan (canvas +UA +screen +tz)
 * Tanpa backend, untuk anti ganti-profile
 */
const FP_VERSION=2;
function normalizeUA(ua){
  return String(ua||'').replace(/\d+([._]\d+)*/g,'').replace(/\s+/g,' ').trim();
}
async function getFingerprint(){
  // B2: `screen.width x screen.height` DULU ikut jadi sidik. Colok monitor eksternal
  // -> sidik berubah -> behaviorguard.js memaksa lastRisk='MEDIUM', dan lantai lengket
  // menahannya sampai tiga sesi LOW berturut. Colok monitor bukan ganti perangkat.
  // Resolusi adalah KONTEKS (ia menggeser skala kecepatan, lihat A2), bukan identitas
  // mesin — jadi ia keluar dari sini dan ditangani sebagai konteks.
  // C-36: `userAgent` DULU ikut utuh, lengkap dengan nomor versi. Chrome/Edge/Firefox
  // naik versi mayor ~tiap 4 minggu lewat pembaruan otomatis -> sidik berubah -> pemilik
  // dipaksa MEDIUM + lantai lengket sebulan sekali, padahal perangkatnya sama persis.
  // Versi bukan identitas mesin; keluarga browser + OS-nya yang identitas. Angka dibuang.
  const parts=[
    normalizeUA(navigator.userAgent),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    String(screen.colorDepth)
  ];
  // canvas
  try{
    const c=document.createElement('canvas');
    c.width=200; c.height=50;
    const ctx=c.getContext('2d');
    ctx.textBaseline='top'; ctx.font='14px Arial';
    ctx.fillStyle='#f60'; ctx.fillRect(0,0,200,50);
    ctx.fillStyle='#069'; ctx.fillText(parts.join('|').slice(0,120), 2,2);
    parts.push(c.toDataURL().slice(-64));
  }catch{}
  const raw=parts.join('||');
  // C-45: di http (bukan konteks aman) crypto.subtle tidak ada. Dulu sidiknya jadi
  // 'unknown' untuk semua orang -> ganti perangkat tak pernah terdeteksi. Sidik bukan
  // rahasia, jadi hash non-kriptografis (FNV-1a 2x32 bit) cukup untuk membedakan perangkat.
  if(!(globalThis.crypto && globalThis.crypto.subtle)){
    let h1=0x811c9dc5, h2=0x01000193 ^ raw.length;
    for(let i=0;i<raw.length;i++){ const c=raw.charCodeAt(i); h1=Math.imul(h1^c, 16777619)>>>0; h2=Math.imul(h2^c, 2246822507)>>>0; }
    return (h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0')).repeat(2);
  }
  const buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
}
return {FP_VERSION: FP_VERSION, normalizeUA: normalizeUA, getFingerprint: getFingerprint};
})();

/* ---- core/lifecycle.js ---- */
__M["core/lifecycle.js"] = (function(){
/**
 * lifecycle.js - enrollment base10 + retrain/6 + penjaga kohort dua-sisi (prequential)
 * Prequential: sesi ke-N dinilai model yang belum pernah lihat sesi ke-N
 * Semua fungsi menerima cfg instance (bukan DEFAULTS global) - fix #9
 */
function shouldRetrain(sessionCount, retrainEvery, cfg){
  const base=cfg ? cfg.baseline : 10;
  if(sessionCount < base) return false;
  return (sessionCount - base) % retrainEvery === 0;
}
// cek konvergensi dua-sisi: window LOW beruntun + kohortLowRate ≤ threshold
// window 6 = definisi tervalidasi; freeze juga pakai 6 (konsisten)
function isConverged(recentRisks, cohortLowRate, cfg){
  const win=cfg ? cfg.window : 6;
  const thr=cfg ? cfg.cohortLowRate : 0.35;
  if(recentRisks.length < win) return false;
  const last=recentRisks.slice(-win);
  if(!last.every(r=>r==='LOW')) return false;
  if(cohortLowRate > thr) return false;
  return true;
}
// hitung cohortLowRate: porsi skor kohort yang LOW
function cohortLowRate(cohortScores, thresholds){
  if(!cohortScores || !cohortScores.length) return 0;
  const thr=thresholds ? thresholds.low : -0.4;
  const low=cohortScores.filter(s=> s > thr).length;
  return low/cohortScores.length;
}
return {shouldRetrain: shouldRetrain, isConverged: isConverged, cohortLowRate: cohortLowRate};
})();

/* ---- core/ratelimit.js ---- */
__M["core/ratelimit.js"] = (function(){
/**
 * ratelimit.js - token bucket per-user (120/min collect, 60/min score) - copy server RATE_LIMIT
 */
const buckets=new Map();
function allow(key, perMin){
  const now=Date.now();
  const b=buckets.get(key) || {tokens: perMin, last: now};
  const elapsed=(now-b.last)/60000;
  b.tokens=Math.min(perMin, b.tokens + elapsed*perMin);
  b.last=now;
  if(b.tokens < 1) { buckets.set(key,b); return false; }
  b.tokens-=1; buckets.set(key,b); return true;
}
function checkCollect(userId){
  if(!allow(`collect:${userId}`, 120)) return {allowed:false, reason:'rate limit collect 120/min'};
  if(!allow(`score:${userId}`, 60)) return {allowed:false, reason:'rate limit score 60/min'};
  return {allowed:true};
}
return {allow: allow, checkCollect: checkCollect};
})();

/* ---- core/token.js ---- */
__M["core/token.js"] = (function(){
/**
 * token.js - HMAC session token (anti-forgery, BlackHat ARSITEKTUR_PERTAHANAN)
 * Token = base64( HMAC_SHA256(secret, tid|uid|exp|nonce) ) + "." + payload
 * Secret per-user disimpan terenkripsi di storage, TTL 30m, nonce sekali pakai
 */
const enc = new TextEncoder();
async function hmac(secret, data){
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/,'');
}
async function generateToken({secret, userId, ttlSec=1800}){
  const exp = Date.now() + ttlSec*1000;
  const nonce = crypto.randomUUID();
  const payload = `${userId}|${exp}|${nonce}`;
  const sig = await hmac(secret, payload);
  return `${btoa(payload)}.${sig}`;
}
async function verifyToken(token, secret){
  const [b64, sig] = token.split('.');
  if(!b64||!sig) return false;
  let payload;
  try{ payload = atob(b64); }catch{ return false; }
  const [uid, exp, nonce] = payload.split('|');
  if(Date.now() > Number(exp)) return false;
  const expected = await hmac(secret, payload);
  // constant-time compare
  if(expected.length !== sig.length) return false;
  let diff=0; for(let i=0;i<expected.length;i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff===0;
}
// C-41: `storage` DIOPER pemanggil. Dulu `await import('../storage.js')` — di bundle satu
// berkas (dist/) jalur relatif itu menunjuk ke /storage.js milik SITUS: 404 di tiap muat
// halaman (terlihat di tab Network integrator), lalu jatuh ke catch dan rahasia dibuat acak
// ulang tiap kunjungan.
async function getOrCreateSecret(userId, storage){
  const key = `bg:secret:${userId}`;
  // S1 fix: secret disimpan via storage seal (HMAC), bukan plaintext localStorage
  try{ if(!storage) throw new Error('storage wajib'); const v=await storage.get(key); if(v) return v; const raw=crypto.getRandomValues(new Uint8Array(32)); const s=btoa(String.fromCharCode(...raw)); await storage.set(key,s); return s; }catch{ return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))); }
}
return {generateToken: generateToken, verifyToken: verifyToken, getOrCreateSecret: getOrCreateSecret};
})();

/* ---- storage.js ---- */
__M["storage.js"] = (function(){
/**
 * storage.js - on-device IndexedDB -> localStorage -> memory, deterministik, tidak pernah crash
 * Caps: tidak simpan seluruh vector+feat mentah ke localStorage bila >2MB
 */
const DB_NAME='bg_store', STORE='kv';
const MAX_LOCAL_BYTES=1.8*1024*1024; // cap 1.8MB untuk hindari quota
function idbAvailable(){ try{ return typeof indexedDB!=='undefined'; }catch{ return false; } }

function idbGet(key){
  return new Promise(res=>{
    try{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=e=>{ if(!e.target.result.objectStoreNames.contains(STORE)) e.target.result.createObjectStore(STORE); };
      req.onsuccess=e=>{
        const db=e.target.result;
        if(!db.objectStoreNames.contains(STORE)) return res(null);
        const tx=db.transaction(STORE,'readonly');
        const g=tx.objectStore(STORE).get(key);
        g.onsuccess=()=> res(g.result ?? null);
        g.onerror=()=> res(null);
      };
      req.onerror=()=> res(null);
    }catch{ res(null); }
  });
}
function idbSet(key,val){
  return new Promise(res=>{
    try{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=e=>{ if(!e.target.result.objectStoreNames.contains(STORE)) e.target.result.createObjectStore(STORE); };
      req.onsuccess=e=>{
        const db=e.target.result;
        if(!db.objectStoreNames.contains(STORE)) return res(false);
        const tx=db.transaction(STORE,'readwrite');
        tx.objectStore(STORE).put(val,key);
        tx.oncomplete=()=> res(true);
        tx.onerror=()=> res(false);
      };
      req.onerror=()=> res(false);
    }catch{ res(false); }
  });
}

function idbDel(key){
  // C-10: versi lama memanggil db.transaction() langsung di dalam onsuccess tanpa
  // onupgradeneeded dan tanpa cek objectStoreNames. try/catch di luar bersifat
  // SINKRON sehingga tidak bisa menangkap lemparan di callback async itu -> muncul
  // "NotFoundError: object stores was not found" yang tak tertangkap, melanggar
  // janji "tidak pernah crash" di kepala berkas ini. Kini sebentuk dengan idbGet/idbSet.
  return new Promise(res=>{
    try{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=e=>{ if(!e.target.result.objectStoreNames.contains(STORE)) e.target.result.createObjectStore(STORE); };
      req.onsuccess=e=>{
        try{
          const db=e.target.result;
          if(!db.objectStoreNames.contains(STORE)) return res(false);
          const tx=db.transaction(STORE,'readwrite');
          tx.objectStore(STORE).delete(key);
          tx.oncomplete=()=> res(true);
          tx.onerror=()=> res(false);
        }catch{ res(false); }
      };
      req.onerror=()=> res(false);
    }catch{ res(false); }
  });
}

const mem=new Map();
// C-45: `crypto.subtle` HANYA ada di konteks aman (https / localhost). Di situs http biasa -
// masih umum untuk intranet dan situs kecil - seal() dulu melempar, jadi SETIAP _persist()
// gagal, jalur vonis ikut melempar, dan endSession() (yang dipanggil jam dengan .catch
// kosong) diam: pustaka terpasang tapi tidak pernah memberi satu vonis pun, tanpa pesan.
// HMAC di sini hanya penanda-rusak (kuncinya berasal dari nama kunci penyimpanan, bukan
// rahasia), jadi tanpa crypto data disimpan tanpa tanda tangan ('nosig:') - dan format itu
// hanya DITERIMA di konteks yang memang tidak punya crypto, supaya di https tidak melemah.
const hasSubtle=()=>{ try{ return !!(globalThis.crypto && globalThis.crypto.subtle); }catch{ return false; } };
let warnedInsecure=false;
function warnInsecure(){ if(warnedInsecure) return; warnedInsecure=true; try{ console.warn('[BG] konteks tidak aman (bukan https/localhost): profil disimpan tanpa tanda tangan anti-rusak. Pasang situs di https.'); }catch{} }
// enkripsi ringan: XOR + base64 + HMAC (anti-tamper)
async function hmacKey(k){ const hk=await crypto.subtle.importKey('raw', new TextEncoder().encode(k.slice(0,16).padEnd(16,'0')), {name:'HMAC',hash:'SHA-256'}, false, ['sign']); return hk; }
async function seal(obj, keyHint='bg-key'){
  const json=JSON.stringify(obj);
  const b64=btoa(unescape(encodeURIComponent(json)));
  if(!hasSubtle()){ warnInsecure(); return `nosig:${b64}`; }
  const hk=await hmacKey(keyHint);
  const sig=await crypto.subtle.sign('HMAC', hk, new TextEncoder().encode(b64));
  const hex=Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
  return `${hex}:${b64}`;
}
async function open(sealed, keyHint='bg-key'){
  try{
    const [hex,b64]=sealed.split(':');
    if(hex==='nosig') return hasSubtle() ? null : JSON.parse(decodeURIComponent(escape(atob(b64))));
    if(!hasSubtle()) return null;
    const hk=await hmacKey(keyHint);
    const exp=await crypto.subtle.sign('HMAC', hk, new TextEncoder().encode(b64));
    const eh=Array.from(new Uint8Array(exp)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
    if(eh!==hex) return null; // tamper
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  }catch{ return null; }
}
const storage={
  async get(k){
    if(idbAvailable()){ const v=await idbGet(k); if(v!==null){
      if(typeof v==='string' && v.includes(':')){ const o=await open(v,k); if(o) return o; }
      else return v;
    }}
    try{ const v=localStorage.getItem(k); if(v){
      if(v.includes(':')){ const o=await open(v,k); if(o) return o; }
      else return JSON.parse(v);
    }}catch{}
    return mem.get(k) ?? null;
  },
  async set(k,v){
    mem.set(k,v);
    const sealed=await seal(v,k);
    if(idbAvailable()){ await idbSet(k,sealed); }
    try{
      let toSave=v;
      if(v && v.sessions && v.sessions.length>30){
        // B7: DULU dipotong ke 30 sesi terakhir. IndexedDB menerima yang utuh, jadi
        // biasanya tak terasa — tapi di mode penyamaran atau browser yang memblokir
        // IDB, kolam terkunci di 30 padahal progressiveMaxPool = 90. C-22 sudah
        // menunjukkan apa akibat kolam terlalu kecil dibanding d=28: kovarians goyah,
        // deteksi melemah. Dan karena hanya menimpa SEBAGIAN pengguna, gejalanya
        // gampang disalahartikan sebagai perbedaan orang.
        // Yang dibutuhkan model cuma `vector`; `feat` (28 pasangan nama-nilai) murni
        // untuk penjelasan. Membuangnya membuat jauh lebih banyak sesi muat.
        const slim=v.sessions.map(x=> x && x.feat ? {...x, feat:null} : x);
        // C-31: DULU `slim.slice(-90)` — memotong 90 TERAKHIR, jadi blok pendaftaran di
        // DEPAN ikut terbuang. Sesudah reload, 10 sesi apa pun yang kebetulan ada di
        // depan (bisa sesi MEDIUM/HIGH, bisa sesi penyusup) diperlakukan sebagai
        // pendaftaran tanpa syarat: peracunan baseline lewat pemotongan. Blok
        // pendaftaran (`enrollPrefix`, dikirim orkestrator) selalu dipertahankan.
        const pre=Math.min(slim.length, Number.isFinite(v.enrollPrefix) ? v.enrollPrefix : 10);
        const tail=slim.slice(pre);
        toSave={...v, sessions: tail.length>90 ? [...slim.slice(0,pre), ...tail.slice(-90)] : slim,
                enrollPrefix: pre};
      }
      const sealedLocal=await seal(toSave,k);
      if(sealedLocal.length < MAX_LOCAL_BYTES) localStorage.setItem(k, sealedLocal);
      else try{ localStorage.removeItem(k); }catch{}
    }catch{}
  },
  async del(k){
    mem.delete(k);
    if(idbAvailable()){ await idbDel(k); }
    try{ localStorage.removeItem(k); }catch{}
  }
};
return {storage: storage};
})();

/* ---- behaviorguard.js ---- */
__M["behaviorguard.js"] = (function(){
/**
 * behaviorguard.js - SDK inti BehaviorGuard (plug-and-play, on-device, deterministik)
 * Cara pakai (≤3 baris):
 *   <script src="behaviorguard.js"></script>
 *   <script>BehaviorGuard.init({userId: "andi@example.com", onRisk: e=>console.log(e)})</script>
 * Selesai. Tanpa ubah kode aplikasi.
 */
const { DEFAULTS, normalizeWeights } = __M["core/config.js"];
const { extractF4, featuresToVector, F4 } = __M["core/features.js"];
const RHYTHM_C44=new Set(['keystroke_flight_median','keystroke_flight_iqr','keystroke_backspace_ratio',
  'keystroke_cross_hand_ratio','keystroke_dwell_median','keystroke_shift_ratio']);
const { computeStats, standardize, standardizeBatch } = __M["core/standardize.js"];
const { IsolationForest } = __M["core/isolation_forest.js"];
const { OCSVM } = __M["core/ocsvm.js"];
const { Mahalanobis } = __M["core/mahalanobis.js"];
const { Ensemble } = __M["core/ensemble.js"];
const { toRisk, toAction, topFeatures, reasonsFrom, calibrateThresholds, calibrateThresholdsParametric } = __M["core/risk.js"];
const { createCapture } = __M["core/capture.js"];
const { segmentByIdle, idleAccounting, splitForAssessment, classifyGap, groupByStream, compressIdle, dropExactDuplicates } = __M["core/idle.js"];
const { storage } = __M["storage.js"];
const { isConverged, cohortLowRate } = __M["core/lifecycle.js"];
const { getOrCreateSecret, generateToken } = __M["core/token.js"];
const { checkIntegrity } = __M["core/integrity.js"];
const { getFingerprint, FP_VERSION } = __M["core/fingerprint.js"];
const { checkCollect } = __M["core/ratelimit.js"];
const { buildTemplate, verify: verifyChallenge } = __M["core/challenge.js"];
const { runMfaChallenge } = __M["core/mfa.js"];

const VERSION = '2.2.0';
// C-45: structuredClone baru ada sejak Chrome 98 / Safari 15.4; di browser lebih tua pustaka
// dulu melempar saat dimuat. DEFAULTS murni data (tanpa fungsi), jadi JSON sudah cukup.
const clone = o => (typeof structuredClone==='function') ? structuredClone(o) : JSON.parse(JSON.stringify(o));
const ns = id => `bg:${id}`;
// A4: `bg:pending` DULU kunci GLOBAL, tidak seperti sesi yang sudah ber-ruang-nama.
// Akibatnya di browser bersama: pengguna A menutup halaman -> ekornya tersimpan ->
// pengguna B login -> init() membaca pending itu tanpa memeriksa pemiliknya ->
// perilaku A dinilai, dan bisa ikut MELATIH, sebagai B. Itu peracunan baseline
// lintas-akun, bukan sekadar derau. Kunci lama ikut dibersihkan sekali saat init.
const nsPending = id => `bg:pending:${id}`;
const LEGACY_PENDING = 'bg:pending';

class BehaviorGuard {
  constructor(){ this.cfg=clone(DEFAULTS); this.userId=null; this.onRisk=null; this.capture=null; this.model=null; this.stats=null; this.sessions=[]; this.inited=false; this.lastRisk='LOW'; this.fingerprint=null; this.secret=null; this.challengeTemplate=null; }
  // C-45: init() yang dipanggil dua kali tanpa saling menunggu (auto-boot data-user DAN
  // init manual, atau SPA yang memanggilnya di dua efek) dulu berjalan BERSAMAAN: yang
  // pertama masih menunggu sidik perangkat saat yang kedua sudah memasang capture, lalu yang
  // pertama memasang capture KEDUA -> tiap event tercatat dua kali (dan dua kembaran itu
  // dibuang sebagai duplikat, jadi bukti menyusut). Kini diantrekan: satu per satu.
  init(opts={}){
    if(!opts || !opts.userId) return Promise.reject(new Error('BehaviorGuard.init: userId wajib'));
    const run=()=> this._init(opts);
    this._initChain=(this._initChain||Promise.resolve()).then(run, run);
    return this._initChain;
  }
  async _init({userId, onRisk, storage: storageOpt, weights, baseline, retrainEvery, features, thresholds, pk, endpoint, userToken, mfa, session, idle, aggregateWindows, calibrationHoldout, calibration}={}){
    if(!userId) throw new Error('BehaviorGuard.init: userId wajib');
    this.inited=false;
    // C-38: init() ULANG (SPA ganti rute, atau logout A -> login B di tab yang sama) DULU
    // mewarisi seluruh state di memori: kalau B belum punya data tersimpan, blok
    // `if(saved)` di bawah tidak jalan, sehingga B dinilai dengan MODEL A, sesinya melatih
    // kolam A lalu tersimpan sebagai milik B, dan verifikasinya dicocokkan dengan TEMPLATE
    // RITME A. Kerabat C-7 (clear()), lewat pintu yang berbeda. State per-pengguna selalu
    // dimulai dari nol; capture lama dilepas supaya pendengar tidak menumpuk.
    this._resetUserState();
    if(this.capture){ try{ this.capture.detach(); }catch{} this.capture=null; }
    // opsi init() sebelumnya (mis. mfa.enabled:false milik integrasi lain) juga tidak
    // boleh terbawa ke init() berikutnya
    this.cfg=clone(DEFAULTS);
    this.userId=userId; this.onRisk=onRisk||(()=>{});
    // HYBRID cloud mode: baseline per tenant+userId hidup di VPS (lintas-device),
    // event mentah TETAP di device. Aktif kalau pk+endpoint diisi.
    // C-39: pk SENDIRIAN tidak lagi membuka baseline/log. Server menuntut token pengguna
    // HMAC(sk, pk|userId|exp) yang dicetak server integrator sesudah login; tanpa token,
    // mode cloud MATI (gagal-tertutup) dan pustaka berjalan murni on-device.
    this.pk=pk||null; this.endpoint=endpoint?endpoint.replace(/\/+$/,''):null; this.userToken=userToken||null;
    this.cloud=!!(this.pk&&this.endpoint&&this.userToken);
    if(this.pk && this.endpoint && !this.userToken){
      try{ console.warn('[BG] mode cloud butuh userToken dari server Anda (lihat server/README.md) - berjalan on-device saja'); }catch{}
    }
    if(weights) this.cfg.weights=normalizeWeights(weights);
    if(baseline) this.cfg.baseline=baseline;
    if(retrainEvery) this.cfg.retrainEvery=retrainEvery;
    if(features) this.cfg.features=features;
    if(thresholds) this.cfg.thresholds=thresholds;
    // C-11: `mfa` dulu tidak ada di daftar opsi init() MAUPUN di daftar kunci yang
    // diteruskan auto-boot, sehingga `{ mfa:{enabled:false} }` diam-diam diabaikan —
    // knob yang didokumentasikan tapi tidak pernah ada. Digabung, bukan ditimpa,
    // supaya konfigurasi parsial ({enabled:false}) tetap mewarisi default lainnya.
    if(mfa && typeof mfa==='object') this.cfg.mfa={...this.cfg.mfa, ...mfa};
    // C-45: frasa < 8 karakter tidak pernah bisa jadi template (challenge.js MIN_DWELL_POINTS)
    // -> pendaftaran selalu gagal dan MFA bawaan tak pernah tersedia, tanpa pesan apa pun.
    if(this.cfg.mfa && this.cfg.mfa.enabled && String(this.cfg.mfa.phrase||'').replace(/\s+/g,' ').trim().length < 8){
      try{ console.warn('[BG] mfa.phrase terlalu pendek (minimal 8 karakter) - verifikasi irama ketik tidak akan bisa didaftarkan'); }catch{}
    }
    // C-46: KUNCI MATI. `lockAfterFailures` mengunci jalur irama sesudah N dialog gagal
    // beruntun, dan satu-satunya yang membuka kunci itu adalah verifikasi yang BERHASIL.
    // Tanpa `onFallback`, tidak ada jalur lain untuk berhasil: pemiliknya - yang mungkin cuma
    // sedang memakai keyboard lain - terkunci dari verifikasi secara permanen, dan integrator
    // tidak akan tahu kenapa. Ini fail-closed yang benar secara keamanan tapi salah secara
    // produk, jadi diperingatkan di awal, bukan ditemukan pengguna saat sudah terkunci.
    if(this.cfg.mfa && this.cfg.mfa.enabled && (this.cfg.mfa.lockAfterFailures ?? 3) > 0
       && typeof this.cfg.mfa.onFallback!=='function'){
      try{ console.warn('[BG] mfa.onFallback kosong sedangkan mfa.lockAfterFailures aktif - sesudah '
        + (this.cfg.mfa.lockAfterFailures ?? 3) + ' kegagalan beruntun, pemilik tidak punya jalan verifikasi lain. '
        + 'Isi mfa.onFallback (OTP/WebAuthn yang dicek server), atau set mfa.lockAfterFailures: 0.'); }catch{}
    }
    // C-23: sama pola dengan `mfa` — digabung, bukan ditimpa, supaya konfigurasi
    // parsial ({idleGapSec:60}) tetap mewarisi sisa default.
    if(session && typeof session==='object') this.cfg.session={...this.cfg.session, ...session};
    if(idle && typeof idle==='object') this.cfg.idle={...this.cfg.idle, ...idle};
    // C-24: ketiga knob invariansi panjang sesi. Default 0/1 = perilaku lama persis.
    if(Number.isFinite(aggregateWindows)) this.cfg.aggregateWindows=aggregateWindows;
    if(Number.isFinite(calibrationHoldout)) this.cfg.calibrationHoldout=calibrationHoldout;
    // C-33: titik operasi (ketat vs longgar) dulu TIDAK bisa diatur integrator — k_low
    // tidak ada di daftar opsi init(), jadi satu-satunya cara adalah menyunting config.js.
    // Lebih kecil = lebih ketat (penyusup lebih jarang lolos, pemilik lebih sering
    // diminta verifikasi). Tabel pertukarannya di README "Choosing an operating point".
    if(calibration && typeof calibration==='object'){
      if(Number.isFinite(calibration.k_low)) this.cfg.k_low=calibration.k_low;
      if(Number.isFinite(calibration.k_med_extra)) this.cfg.k_med_extra=calibration.k_med_extra;
    }
    // fingerprint + secret + token (HMAC)
    try{ this.fingerprint=await getFingerprint(); }catch{ this.fingerprint='unknown'; }
    try{ this.secret=await getOrCreateSecret(userId, storage); this.token=await generateToken({secret:this.secret, userId}); }catch{}
    const saved=await storage.get(ns(userId));
    // C-44: jumlah fitur berubah (28 -> 34). Vektor lama tidak bisa dibandingkan dengan
    // vektor baru, dan menambal kolom kosong dengan nol akan meracuni model. Profil lama
    // dibuang sekali; pengguna mendaftar ulang (10 langkah) dengan fitur yang baru.
    if(saved && Array.isArray(saved.sessions) && saved.sessions.some(s=> s && Array.isArray(s.vector) && s.vector.length!==this.cfg.features.length)){
      console.warn('[BG] profil tersimpan memakai jumlah fitur lama - pendaftaran diulang');
      saved.sessions=[]; saved.stats=null;
    }
    if(saved){ this.sessions=saved.sessions||[]; this.stats=saved.stats||null; this.lastRisk=saved.lastRisk||'LOW'; this._highRun=saved.highRun||0; this.challengeTemplate=saved.challengeTemplate||null;
      // C-32: streak LOW dulu TIDAK disimpan. Lantai lengket turun hanya setelah 3 LOW
      // berturut dalam SATU muat-halaman, jadi pengguna yang kunjungannya pendek (1-2
      // vonis) dan tak punya MFA bawaan tidak pernah turun dari MEDIUM, selamanya.
      this._lowStreak=saved.lowStreak||0;
      this._mfaEnrollSnoozeUntil=saved.mfaEnrollSnoozeUntil||0;
      this._mfaFailStreak=saved.mfaFailStreak||0;
      // C-43: masa berlaku step-up melintasi muat-halaman (situs multi-halaman memuat
      // ulang tiap klik) tapi TIDAK melintasi absen: jeda >= awaySec sejak vonis terakhir
      // yang tersimpan mencabutnya.
      const awayMs=((this.cfg.idle && this.cfg.idle.awaySec) || 300)*1000;
      this._mfaPassedAt=(saved.mfaPassedAt && saved.lastActiveAt && Date.now()-saved.lastActiveAt < awayMs) ? saved.mfaPassedAt : null;
      // cek ganti device. C-36: sidik versi lama (dengan nomor versi UA) tidak dibandingkan
      // — kalau dibandingkan, SEMUA pengguna lama dicurigai sekali sesudah pembaruan ini.
      if(saved.fingerprint && saved.fpv===FP_VERSION && saved.fingerprint!==this.fingerprint){
        console.warn('[BG] device fingerprint berubah - sesi dianggap berisiko');
        this.lastRisk='MEDIUM'; this._mfaPassedAt=null;
      }
    }
    // R4: jika ada ekor yang kesimpen pas beforeunload sebelumnya, pulihkan ke buffer
    try{
      // A4: buang sisa kunci global lama — pemiliknya tak bisa dipastikan, jadi
      // satu-satunya perlakuan yang aman adalah membuangnya, bukan menebak.
      try{ localStorage.removeItem(LEGACY_PENDING); }catch{}
      let pending=JSON.parse(localStorage.getItem(nsPending(userId))||'null');
      // C-33: ekor pending dulu tidak punya umur maksimum. Ia dimaksudkan untuk pindah
      // HALAMAN (detik), tapi ikut terbawa ke kunjungan BESOKNYA: ekor kemarin + ketikan
      // hari ini jadi satu vektor campuran dua hari, dan jeda semalam di dalamnya
      // terbaca sebagai "kembali dari absen" -> MEDIUM di awal tiap kunjungan.
      // Terukur (eval_sdk --live): 149 dari ~500 gesekan pemilik berasal dari sini.
      if(pending && pending.length){
        const maxAge=(this.cfg.session.carryMaxAgeSec||this.cfg.idle.awaySec||300)*1000;
        const last=pending.reduce((m,e)=> Math.max(m, (e&&e.timestamp)||0), 0);
        if(Date.now()-last > maxAge){ pending=null; localStorage.removeItem(nsPending(userId)); }
      }
      if(pending && pending.length){
        localStorage.removeItem(nsPending(userId));
        // pending adalah event mentah - simpan dulu, akan di-score di endSession berikutnya
        // untuk init yang baru, taruh di capture buffer sementara
        this._pendingEvents=pending;
      }
    }catch{}
    // capture auto — C-23: callback dipakai melacak kehadiran (kapan input terakhir
    // masuk), bukan lagi no-op. Dari situ absen terdeteksi tanpa timer tambahan.
    this._lastEventAt=Date.now();
    // B1: penanda aliran per instance/tab, dicap ke tiap event supaya pengukuran
    // tidak pernah menyeberangi dua tab.
    this.tabId=Math.random().toString(36).slice(2,10);
    this.capture=createCapture(e=>{ e.tabId=this.tabId; this._onCaptureEvent(e); });
    try{ this.capture.attach(); }catch{}
    // S6: pending skor sebagai sesi terpisah, jangan gabung (bikin durasi ngembung)
    // C-21: pending adalah AKUMULATOR ekor lintas-halaman. Versi lama meng-null-kan
    // pending TANPA SYARAT walau belum sempat di-skor (chunk < minEventsAssess), jadi
    // ekor halaman-halaman pendek terbuang tiap init dan tak pernah berakumulasi jadi
    // sesi utuh -> "pindah halaman terus, sesi tak keambil". Kini: kalau belum cukup,
    // KEMBALIKAN ke pending; kalau cukup, skor satu chunk lalu simpan SISANYA.
    try{
      if(this._pendingEvents && this._pendingEvents.length){
        const pending=this._pendingEvents; delete this._pendingEvents;
        if(pending.length >= this.cfg.session.minEventsAssess){
          // C-33: chunk minimal sebesar ambang bukti, kalau tidak ia tak pernah dinilai
          const CH=Math.max(200, this.cfg.session.minEventsAssess);
          const chunk=pending.slice(0,CH);
          const sisa=pending.slice(CH);
          // B1 fix: jangan require di ESM, pakai scoreExternalEvents langsung (extractF4 sudah diimpor)
          setTimeout(()=> this.scoreExternalEvents(chunk).catch(()=>{}), 100);
          try{ if(sisa.length) localStorage.setItem(nsPending(userId), JSON.stringify(sisa));
               else localStorage.removeItem(nsPending(userId)); }catch{}
        } else {
          // belum cukup jadi sesi -> tunggu ekor halaman berikut menambah (JANGAN buang)
          try{ localStorage.setItem(nsPending(userId), JSON.stringify(pending)); }catch{}
        }
      }
    }catch{}
    // HYBRID: tarik baseline akun dari VPS (source of truth lintas-device) SEBELUM rebuild.
    // Device penyerang yg fresh -> dapat baseline Andi -> perilaku penyerang di-skor HIGH.
    if(this.cloud){ try{ await this._cloudPull(); }catch{} }
    // coba rebuild model dari sessions
    if(this.sessions.filter(s=>s.eligible!==false).length >= this.cfg.baseline) this._rebuildModel();
    // auto-skor plug-and-play: segmentasi sesi otomatis (tanpa panggil manual)
    // - interval 30s + visibilitychange + SPA pushState + beforeunload
    this._wireAuto();
    this.inited=true;
    return this;
  }
  // C-45: SATU pintu keluar vonis. Dulu event DOM `behaviorguard:risk` hanya disiarkan oleh
  // auto-boot bundel (data-user), jadi integrator yang memanggil init() sendiri - cara yang
  // didokumentasikan untuk SPA - tidak pernah menerimanya, dan status() tidak punya "vonis
  // terakhir" untuk ditampilkan.
  _emit(evt){
    if(!evt) return;
    this._lastEvt={...evt, at: evt.at || Date.now()};
    try{ this.onRisk(evt); }catch(e){ try{ console.error('[BG] onRisk melempar', e); }catch{} }
    try{ if(typeof window!=='undefined' && typeof CustomEvent==='function') window.dispatchEvent(new CustomEvent('behaviorguard:risk', {detail: evt})); }catch{}
  }
  // C-23: satu-satunya sumber kebenaran "kapan pengguna terakhir memberi input".
  // Jeda antar-input yang melewati `idle.awaySec` dicatat sebagai ABSEN; input
  // berikutnya sesudah itu adalah KEMBALI dari absen — dan orang yang kembali
  // belum tentu orang yang pergi.
  _onCaptureEvent(e){
    const ts=e&&e.timestamp || Date.now();
    const prev=this._lastEventAt;
    this._lastEventAt=ts;
    if(e && e.event_type==='KEYSTROKE') this._lastKeyAt=ts;
    if(!prev) return;
    const gap=ts-prev;
    if(gap >= this.cfg.idle.awaySec*1000) this._markAwayReturn(gap, 'tanpa-input', ts);
  }
  // Ambil absen TERPANJANG yang belum ditindaklanjuti: tab tersembunyi 20 menit lalu
  // kembali tidak boleh tertimpa oleh jeda-tanpa-input 6 menit yang menyusul.
  _markAwayReturn(awayMs, reason, atTs){
    const cur=this._awayReturn;
    if(cur && cur.awayMs >= awayMs) return;
    this._awayReturn={ awayMs, reason, at: atTs||Date.now() };
  }
  // B1: hanya SATU tab yang boleh menilai dan menulis penyimpanan. Tanpa ini, dua
  // tab memegang array `sessions` sendiri di memori lalu `storage.set` bergantian —
  // penulis terakhir menang dan sesi yang dikumpulkan tab lain hilang diam-diam.
  // Denyut sederhana lewat localStorage: pemimpin memperbarui capnya; tab lain
  // mengambil alih hanya kalau capnya sudah basi (pemimpin ditutup/crash).
  _isLeader(){
    const K=`bg:leader:${this.userId}`, TTL=25000;
    try{
      const now=Date.now();
      // C-45: pemimpin dulu = siapa pun yang pertama, walau tabnya di LATAR. Dialog step-up
      // hanya muncul di tab pemimpin, jadi pengguna yang sedang bekerja di tab lain tidak
      // pernah melihatnya; dialog kedaluwarsa dan vonisnya jadi MFA_FAILED. Tab yang
      // TERLIHAT kini merebut kepemimpinan dari pemimpin yang tersembunyi.
      const vis=typeof document==='undefined' || document.visibilityState!=='hidden';
      const cur=JSON.parse(localStorage.getItem(K)||'null');
      if(!cur || !cur.ts || now-cur.ts > TTL || cur.id===this.tabId || (vis && cur.vis===false)){
        localStorage.setItem(K, JSON.stringify({id:this.tabId, ts:now, vis}));
        return true;
      }
      return false;
    }catch{ return true; }   // tanpa localStorage, anggap tab tunggal
  }
  // C-45: jam penilaian dipisah dari pemasangan pendengar. pagehide menghentikannya, tapi
  // halaman yang dipulihkan dari back/forward cache (tombol Kembali) TIDAK memuat ulang
  // skrip - dulu jamnya mati selamanya di halaman itu dan tak ada vonis lagi. stop() juga
  // memakainya.
  _startTimer(){
    if(this._autoTimer) return;
    this._autoTimer=setInterval(()=>{
      if(!this.inited) return;
      // Tab pengikut tetap MENANGKAP (ekornya dibank dan diambil nanti), hanya tidak
      // menilai — jadi datanya tidak hilang, cuma tidak ada dua penulis bersamaan.
      if(!this._isLeader()){ this._bankTail(); return; }
      this.endSession().catch(()=>{});
    }, this.cfg.session.windowSec*1000);
  }
  _stopTimer(){ if(this._autoTimer){ clearInterval(this._autoTimer); this._autoTimer=null; } }
  _wireAuto(){
    this._startTimer();
    if(this._wired) return; this._wired=true;
    try{
      const self=this;
      window.addEventListener('pageshow', e=>{ if(e && e.persisted && self.inited && self.capture) self._startTimer(); });
      document.addEventListener('visibilitychange', ()=>{
        if(!self.inited) return;
        if(document.visibilityState!=='hidden'){
          try{ self._isLeader(); }catch{}
          // C-23: kembali terlihat. Tab tersembunyi lama = kursi mungkin kosong,
          // dan ini sinyal yang TIDAK terlihat dari jeda antar-event (tab latar
          // memang tidak mengirim event apa pun, jadi keduanya perlu dicek).
          if(self._hiddenAt){
            const hid=Date.now()-self._hiddenAt;
            self._hiddenAt=null;
            if(hid >= self.cfg.idle.awaySec*1000) self._markAwayReturn(hid, 'tab-tersembunyi');
          }
          return;
        }
        self._hiddenAt=Date.now();
        // C-21: JANGAN drain-buang. `endSession()` membuang buffer <30 event, dan saat
        // pindah halaman ia jalan SEBELUM `beforeunload` -> ekor halaman hilang sebelum
        // sempat disimpan. Kalau cukup jadi sesi -> skor; kalau belum -> BANK ke pending.
        const evs=self.capture ? self.capture.peek() : [];
        if(evs.length >= self.cfg.session.minEventsAssess) self.endSession().catch(()=>{});
        else self._bankTail();
      });
      const origPush=history.pushState.bind(history);
      const origReplace=history.replaceState.bind(history);
      history.pushState=function(...a){ const r=origPush(...a); self.capture && self.capture.buffer.push({event_type:'NAVIGATION', page_url: location.href, timestamp: Date.now()}); return r; };
      history.replaceState=function(...a){ const r=origReplace(...a); self.capture && self.capture.buffer.push({event_type:'NAVIGATION', page_url: location.href, timestamp: Date.now()}); return r; };
      window.addEventListener('popstate', ()=>{ self.capture && self.capture.buffer.push({event_type:'NAVIGATION', page_url: location.href, timestamp: Date.now()}); });
      // R4/C-21: pada leave terminal, bank ekor ke pending SECARA SINKRON (skor async
      // tak sempat flush saat halaman mati). pagehide + beforeunload dua-duanya bank;
      // `_bankTail` idempoten (drain setelah simpan) jadi aman dipanggil berkali-kali.
      // beforeunload bisa DIBATALKAN (dialog "tinggalkan situs?"), jadi ia hanya membank;
      // jam penilaian dihentikan di pagehide saja, dan pageshow menghidupkannya lagi.
      window.addEventListener('pagehide', ()=>{ try{ self._bankTail(); self._stopTimer(); }catch{} });
      window.addEventListener('beforeunload', ()=>{ try{ self._bankTail(); }catch{} });
    }catch{}
  }
  // C-21: simpan ekor buffer yang belum jadi sesi ke akumulator lintas-halaman
  // (`bg:pending`, raw localStorage). Idempoten: drain setelah simpan supaya handler
  // leave lain (pagehide+beforeunload) tak menyimpan ganda.
  _bankTail(){
    if(!this.capture) return;
    const evs=this.capture.peek();
    if(evs.length < 10) return;               // terlalu sedikit untuk disimpan
    try{
      const pending=JSON.parse(localStorage.getItem(nsPending(this.userId))||'[]');
      pending.push(...evs.slice(-200));
      if(pending.length>800) pending.splice(0, pending.length-800);
      localStorage.setItem(nsPending(this.userId), JSON.stringify(pending));
      this.capture.drain();
    }catch{}
  }
  // C-31: indeks tepat SESUDAH sesi layak ke-`baseline`, yaitu ujung blok pendaftaran.
  // Dulu blok ini diandaikan = sessions.slice(0, baseline). Salah begitu ada satu sesi
  // tak-layak di masa pendaftaran: sesi pendaftaran ke-10 jatuh ke bagian "LOW
  // progresif", dan begitu kolam itu bergulir (maks 90) sesi pendaftaran asli ikut
  // terbuang. Blok pendaftaran adalah jangkar model — ia tidak boleh bergulir.
  _enrollPrefix(){
    let c=0;
    for(let i=0;i<this.sessions.length;i++){
      if(this.sessions[i].eligible!==false && ++c===this.cfg.baseline) return i+1;
    }
    return this.sessions.length;
  }
  // C-31: riwayat sesi dulu tumbuh TANPA BATAS — satu entri tiap jendela 30 dtk, jadi
  // ribuan per minggu — dan SELURUHNYA diserialisasi + di-HMAC ulang pada tiap vonis.
  // Yang dibutuhkan model hanya blok pendaftaran + 90 LOW terakhir + 6 vonis terakhir
  // (konvergensi). Disimpan: blok pendaftaran UTUH + `historyMax` entri terakhir;
  // `feat` (murni penjelasan) dibuang dari entri yang lebih tua dari 20 terakhir.
  _compactHistory(){
    const keep=this.cfg.historyMax||240;
    const pre=this._enrollPrefix();
    if(this.sessions.length > pre+keep) this.sessions=[...this.sessions.slice(0,pre), ...this.sessions.slice(-keep)];
    const cut=this.sessions.length-20;
    for(let i=pre;i<cut;i++){ if(this.sessions[i].feat) this.sessions[i]={...this.sessions[i], feat:null}; }
  }
  // Satu-satunya penulis state ke storage (C-31: dulu 7 salinan, dua di antaranya lupa
  // menulis challengeTemplate & highRun).
  async _persist(){
    this._compactHistory();
    await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, fpv:FP_VERSION,
      lastRisk:this.lastRisk, highRun:this._highRun, challengeTemplate:this.challengeTemplate,
      lowStreak:this._lowStreak||0, enrollPrefix:this._enrollPrefix(),
      mfaEnrollSnoozeUntil:this._mfaEnrollSnoozeUntil||0, mfaPassedAt:this._mfaPassedAt||null, lastActiveAt:Date.now(),
      mfaFailStreak:this._mfaFailStreak||0});
  }
  // C-35: sesi tersimpan terdekat dalam ruang terstandar, tanpa fitur temporal.
  // C-44: juga tanpa 6 fitur ritme ketik baru. Median & IQR jeda adalah statistik urutan
  // yang peka jitter milidetik: rekaman yang diputar dengan jitter +-2 ms menggeser
  // mediannya penuh 1-2 ms, dan pada pemilik yang ritmenya sangat rata (std median ~8 ms)
  // itu cukup untuk mendorong jaraknya melewati replayEps -> rekaman lolos. Ambang
  // replayEps dikalibrasi (C-35) pada 28 fitur lama, jadi deteksinya tetap di ruang itu.
  _nearestPastSession(xstd){
    if(!this.stats || !this.sessions.length) return null;
    const idx=this._behIdx || (this._behIdx=F4.map((_,i)=>i).filter(i=>!F4[i].startsWith('temporal_') && !RHYTHM_C44.has(F4[i])));
    let best=null;
    for(const s of this.sessions){
      if(!s || !s.vector) continue;
      const z=standardize(s.vector, this.stats);
      let acc=0; for(const i of idx){ const d=xstd[i]-z[i]; acc+=d*d; }
      const dist=Math.sqrt(acc/idx.length);
      if(!best || dist<best.dist) best={dist, ts:s.ts};
    }
    return best;
  }
  _trainingVectors(){
    // K6 + T1: hanya sesi eligible yang masuk kolam (gagal gate tidak latih)
    const isEligible=s=> s.eligible!==false;
    const pre=this._enrollPrefix();
    if(this.sessions.length <= pre) return this.sessions.filter(isEligible).map(s=>s.vector);
    const base=this.sessions.slice(0, pre).filter(isEligible).map(s=>s.vector);
    // TRUST-LOOP: sesi LOW normal ATAU sesi non-LOW yang LOLOS MFA (mfaVerified) boleh
    // masuk kolam. Sesi menyimpang yang belum terbukti pemilik -> TIDAK pernah melatih
    // (anti-peracunan baseline + adaptasi drift pemilik yang aman).
    let lows=this.sessions.slice(pre).filter(s=>(s.risk==='LOW' || s.mfaVerified) && isEligible(s)).map(s=>s.vector);
    if(lows.length > this.cfg.progressiveMaxPool) lows=lows.slice(-this.cfg.progressiveMaxPool);
    const temporalIdx=new Set();
    F4.forEach((name,i)=>{ if(name.startsWith('temporal_')) temporalIdx.add(i); });
    const behavioralIndices=F4.map((_,i)=>i).filter(i=>!temporalIdx.has(i));
    const deduped=[];
    const eps=this.cfg.progressiveDupEps;
    for(const v of lows){
      let isDup=false;
      for(const u of deduped){
        let sum=0;
        for(const idx of behavioralIndices){ const d=v[idx]-u[idx]; sum+=d*d; }
        const dist=Math.sqrt(sum / behavioralIndices.length);
        if(dist < eps){ isDup=true; break; }
      }
      if(!isDup) deduped.push(v);
    }
    return [...base, ...deduped];
  }
  _rebuildModel(){
    const vecs=this._trainingVectors();
    if(!vecs.length) return;
    this._newSinceRebuild=0;
    // C-24 (opt-in): sisihkan EKOR kolam khusus untuk mengkalibrasi ambang.
    // Versi lama mengkalibrasi dari skor vektor yang PERSIS dipakai memfit detektor.
    // Skor in-sample selalu optimistik — model memang dipas-paskan ke titik-titik itu —
    // sehingga ambangnya terlalu rapat dan sesi PEMILIK berikutnya, yang di luar
    // sampel, jatuh di luar ambang. Bukan teori: itu persis mekanisme C-22.
    // calibrationHoldout=0 (default) -> cut=vecs.length -> jalur lama, tak tersentuh.
    const hold=this.cfg.calibrationHoldout||0;
    let cut=vecs.length;
    if(hold>0){ const c=Math.floor(vecs.length*(1-hold)); if(c>=8 && vecs.length-c>=4) cut=c; }
    const fitVecs=vecs.slice(0,cut);
    const calibVecs=cut<vecs.length ? vecs.slice(cut) : null;
    this.stats=computeStats(fitVecs);
    const Xstd=standardizeBatch(fitVecs, this.stats);
    const iff=new IsolationForest(this.cfg.iforest);
    iff.fit(Xstd);
    // detektor-2: Mahalanobis (default) atau centroid lama (cfg.model2)
    // C-22: shrinkage ADAPTIF terhadap rasio sampel/dimensi. Kovarians d×d butuh
    // n >> d untuk stabil; live gerbang buka di n=20 padahal d=28 (n<d!) → kovarians
    // OVERFIT: jarak in-sample kecil palsu, ambang dikalibrasi optimistik, lalu sesi
    // PEMILIK baru (out-of-sample) meledak jadi anomali → "sesi ke-20 dst selalu
    // MEDIUM" (FRR 98%). Regularisasi lebih berat saat sampel sedikit menariknya ke
    // Euclidean-terstandardisasi (aman): FRR 98%→~7% di n=20, FAR ~0 utk penyusup
    // jelas-beda. Meluruh ke shrink dasar (0.3) saat n≥~3d → korelasi penuh kelas
    // riset kembali. Hanya jalur LIVE — conformance/golden pakai shrink tetap
    // `cfg.mahalanobis.shrink` langsung, jadi tak tersentuh. Lihat core/DRIFT.md C-22.
    const baseShrink=this.cfg.mahalanobis.shrink;
    const nfe=this.cfg.features.length;
    const adaptShrink=Math.min(0.9, Math.max(baseShrink, nfe/Math.max(1,fitVecs.length)));
    const det2=(this.cfg.model2||'mahalanobis')==='mahalanobis'
      ? new Mahalanobis({ shrink: adaptShrink, n_features: nfe })
      : new OCSVM({...this.cfg.ocsvm, n_features: nfe});
    det2.fit(Xstd);
    const ens=new Ensemble(iff, det2, this.cfg.weights, fitVecs.length);
    ens.calibrate(Xstd, fitVecs.length);
    this.model=ens;
    this._aggThresholds=null;
    if(this.cfg.calibrateThresholds){
      const src = calibVecs ? standardizeBatch(calibVecs, this.stats) : Xstd;
      const baseScores=src.map(x=> ens.scoreOne(x));
      const parametric=(this.cfg.calibrationMode||'parametric')==='parametric';
      const calib = arr => parametric
        ? calibrateThresholdsParametric(arr, this.cfg.k_low, this.cfg.k_med_extra)
        : calibrateThresholds(arr, this.cfg.q_low, this.cfg.q_med);
      this.cfg.thresholds=calib(baseScores);
      // C-24 (opt-in): ambang untuk vonis AGREGAT dikalibrasi dari skor baseline yang
      // diagregasi dengan cara yang PERSIS sama. Jalan pintas analitik — rapatkan
      // ambang sebesar std/sqrt(M) — salah, dan salahnya searah: jendela berurutan
      // berkorelasi, jadi sebaran nyatanya lebih lebar dari yang diandaikan, ambang
      // jadi terlalu rapat, dan pemilik yang ditolak. Mengagregasi data latihnya
      // sendiri membawa korelasi itu ikut serta tanpa perlu diasumsikan.
      const AGG=this.cfg.aggregateWindows|0;
      if(AGG>1 && baseScores.length>=AGG){
        const agg=[];
        for(let i=0;i+AGG<=baseScores.length;i++)
          agg.push(baseScores.slice(i,i+AGG).reduce((x,y)=>x+y,0)/AGG);
        this._aggThresholds=calib(agg);
      }
    }
  }
  // ===== HYBRID cloud (baseline per tenant+userId di VPS; event mentah tak keluar) =====
  async _http(method, path, body){
    if(!this.endpoint) return null;
    try{
      const r=await fetch(this.endpoint+path, {method, headers:{'Content-Type':'application/json','Authorization':'Bearer '+this.pk,'X-BG-User-Token':this.userToken||''}, body: body?JSON.stringify(body):undefined, keepalive:true});
      if(!r.ok) return null;
      return await r.json().catch(()=>null);
    }catch{ return null; }
  }
  async _cloudPull(){
    if(!this.cloud) return;
    const res=await this._http('GET','/baseline');
    if(res && Array.isArray(res.vectors) && res.vectors.length){
      const localEligible=this.sessions.filter(s=>s.eligible!==false).length;
      // C-39: DULU diadopsi bila jumlah server >= lokal — siapa pun yang bisa menulis ke
      // server (dulu: cukup pk) menimpa baseline yang SUDAH ada di perangkat pemilik.
      // Kini hanya perangkat BARU (belum punya pendaftaran sendiri) yang mengadopsi;
      // baseline lokal yang sudah ada tidak pernah diganti dari jarak jauh.
      const vecsOk=res.vectors.every(v=> Array.isArray(v) && v.length===this.cfg.features.length && v.every(Number.isFinite));
      if(vecsOk && localEligible < this.cfg.baseline && res.vectors.length >= this.cfg.baseline){
        this.sessions=res.vectors.map(v=>({vector:v, feat:null, ts:Date.now(), risk:'LOW', score:0, eligible:true}));
      }
    }
  }
  _cloudPush(){
    // kirim VEKTOR FITUR teragregasi (bukan event mentah) sebagai baseline akun
    if(!this.cloud) return;
    const vectors=this._trainingVectors();
    if(!vectors.length) return;
    this._http('POST','/baseline',{vectors});
  }
  _cloudLog(evt){
    if(!this.cloud || !evt) return;
    this._http('POST','/log',{level:evt.level, score:evt.score, action:evt.action, reasons:evt.reasons,
      topFeatures:evt.topFeatures, convergence:evt.convergence, eligible:evt.eligible,
      sessions:(this.sessions?this.sessions.length:0), fp:this.fingerprint, ts:Date.now()});
  }
  // R3 + hardening: gate, integrity, ratelimit, fingerprint, monotonic, challenge
  async _ingestVector(vec, feat, eligible=true, events=null, meta=null){
    const M=meta||{};                 // C-23: telemetri idle ikut ke SEMUA jalur vonis
    // ratelimit
    const rl=checkCollect(this.userId);
    if(!rl.allowed){
      // C-4: dulu di-return diam-diam tanpa onRisk, jadi integrator tak pernah
      // tahu sesi diblokir rate-limit (jalur integrity di bawah memanggilnya).
      const rlEvt={...M, level:'HIGH', score:-2, action:'BLOCK_SESSION', blocked:true, reasons:[rl.reason], topFeatures:[], features: feat, thresholds: {...this.cfg.thresholds}, eligible:false, rateLimited:true};
      this._cloudLog(rlEvt);
      this._emit(rlEvt);
      return rlEvt;
    }
    // C-46: MASUKAN SINTETIS. capture.js sudah MENOLAK event yang dibuat skrip (isTrusted
    // false) sehingga ia tak pernah jadi perilaku; yang tersisa di sini adalah keputusan atas
    // FAKTA bahwa seseorang mencoba. Dua hal yang dilakukan, dan dua yang sengaja tidak:
    //  - jendelanya TIDAK boleh melatih (eligible:false). Inilah pertahanan inti: tanpa ini,
    //    penyerang cukup menyiarkan event manusiawi sampai profil pemilik tergeser ke arahnya.
    //  - alasannya diumumkan ke integrator, supaya terlihat di log keamanan.
    //  - TIDAK memblokir, dan TIDAK menaikkan level. Beberapa pustaka UI (polyfill geser,
    //    carousel) menerbitkan event tiruan yang sah; memblokir karenanya akan mengunci
    //    pemilik yang tidak berbuat apa-apa. Kebijakan itu milik integrator.
    const synthTotal=this.capture ? (this.capture.synthetic||0) : 0;
    const synthNew=Math.max(0, synthTotal-(this._synthSeen||0));
    this._synthSeen=synthTotal;
    // ambang: jendela bukti 150 event; belasan event tiruan masih bisa datang dari pustaka UI,
    // ratusan tidak. Dijaga relatif terhadap bukti supaya jendela kecil tidak gampang tertuduh.
    const synthetic = synthNew >= 20 && synthNew >= 0.1*Math.max(1,(events?events.length:0));
    if(synthetic) eligible=false;
    // integrity (bot/replay) - jika events tersedia
    if(events){
      const integ=checkIntegrity(events, {throttled:true});
      if(integ.suspected){
        const evt={...M, level:'HIGH', score:-1.5, action:'BLOCK_SESSION', reasons:integ.reasons, topFeatures:[], features: feat, thresholds: {...this.cfg.thresholds}, eligible:false, integrity:true};
        this.sessions.push({vector: vec, feat, ts: Date.now(), risk:'HIGH', score:-1.5, eligible:false});
        // C-31: dulu HANYA storage yang diberi lastRisk HIGH (memori tidak), dan
        // challengeTemplate tidak ikut tertulis -> satu tuduhan bot menghapus template
        // MFA pemilik dari penyimpanan. Kini memori & storage sama, dan state utuh.
        this.lastRisk='HIGH'; this._lowStreak=0;
        await this._persist();
        this._cloudLog(evt);
        this._emit(evt);
        return evt;
      }
    }
    const eligibleCount=this.sessions.filter(s=>s.eligible!==false).length;
    if(eligibleCount < this.cfg.baseline){
      // C-23: selama pendaftaran belum ada model pembanding, jadi absen tidak bisa
      // ditindaklanjuti. Dibuang di sini supaya tidak menggantung dan meletus di
      // vonis pertama sesudah pendaftaran selesai (bisa berhari-hari kemudian).
      this._awayReturn=null;
      this.sessions.push({vector: vec, feat, ts: Date.now(), risk:'LOW', score:0, eligible});
      await this._persist();
      let doneEnroll=false;
      if(this.sessions.filter(s=>s.eligible!==false).length >= this.cfg.baseline){ this._rebuildModel(); doneEnroll=true; }
      const enrollEvt={...M, level:'LOW', score:0, reasons:[eligible?'enrollment '+this.sessions.filter(s=>s.eligible!==false).length+'/'+this.cfg.baseline:'sesi tidak layak - tidak masuk kolam'], topFeatures:[], features: feat, thresholds: {...this.cfg.thresholds}, convergence: 'enrollment', eligible};
      this._cloudLog(enrollEvt);
      if(doneEnroll) this._cloudPush(); // enrollment selesai -> unggah baseline akun ke VPS
      // C-19: jalur pendaftaran DULU tidak pernah memanggil onRisk, jadi selama 10
      // sesi pertama pustaka ini DIAM TOTAL ke integrator — tak ada callback, tak ada
      // event `behaviorguard:risk`, dan panel bawaan mandek di "MENGENALI..." tanpa
      // pernah bergerak. Justru fase inilah yang paling perlu diperlihatkan: pengguna
      // baru mendaftar dan ingin tahu sistemnya sedang belajar, bukan menggantung.
      // Hanya `endSession()` yang mengembalikan nilainya, sehingga integrasi berbasis
      // event (cara yang didokumentasikan) tidak melihat apa pun.
      enrollEvt.enrollment = { selesai: this.sessions.filter(s=>s.eligible!==false).length,
                               perlu: this.cfg.baseline, siap: doneEnroll };
      enrollEvt.action = 'ALLOW_SESSION';
      this._emit(enrollEvt);
      return enrollEvt;
    }
    if(!this.model) this._rebuildModel();
    const xstd=standardize(vec, this.stats);
    let score=this.model.scoreOne(xstd);
    // C-35: REKAM-ULANG. Perilaku korban yang terekam (XSS, ekstensi jahat, malware
    // perekam) lalu diputar dengan waktu digeser menghasilkan vektor yang IDENTIK dengan
    // sesi lama — model menilainya LOW, karena memang itu perilaku pemiliknya. Manusia
    // tidak pernah mengulang dirinya sampai sedekat itu: di 637 pasangan sesi riset,
    // jarak RMS terstandar ke sesi pemilik terdekat minimum 0,289 (p1 0,365). Ambang
    // `replayEps` 0,05 memberi margin ~6x. Fitur temporal dikecualikan (putar ulang di
    // jam lain). Vonis HIGH (step-up, bukan blokir) dan tak pernah melatih.
    const replay=this._nearestPastSession(xstd);
    if(replay && replay.dist < (this.cfg.replayEps ?? 0.05)){
      M.replay={ distance: replay.dist, matchedTs: replay.ts };
      eligible=false;
    }
    // C-5: toRisk() memakai `score <= thr`; untuk NaN itu SELALU false -> 'LOW'.
    // Skor rusak karena itu gagal-TERBUKA. Perlakukan sebagai anomali, bukan aman.
    if(!Number.isFinite(score)){
      const badEvt={...M, level:'HIGH', score:null, action:'REQUIRE_STEPUP', blocked:false,
        reasons:['skor tidak finit - model/statistik rusak'], topFeatures:[], features: feat,
        thresholds: {...this.cfg.thresholds}, eligible:false, degraded:true};
      this.sessions.push({vector: vec, feat, ts: Date.now(), risk:'HIGH', score:null, eligible:false});
      await this._persist();
      this._cloudLog(badEvt);
      this._emit(badEvt);
      return badEvt;
    }
    // C-24 (opt-in): AGREGASI BUKTI. Jendela kanonik lebih pendek dari sesi utuh,
    // jadi tiap vonis berdiri di atas bukti yang lebih sedikit dan lebih berisik.
    // Jawabannya bukan melonggarkan ambang — itu cuma memindahkan kesalahan ke sisi
    // FAR — melainkan menunda vonis sampai M jendela terkumpul, lalu memvonis
    // rata-ratanya. Yang ditukar LATENSI dengan KEYAKINAN, bukan FRR dengan FAR:
    // terukur AUC 0,770 (M=1) -> 0,829 (M=5) pada harness ablasi.
    // Selama bukti belum cukup, sistem menerbitkan 'PENDING' — bukan diam, karena
    // diam selalu dibaca aman (alasan yang sama dengan ABSTAIN di C-23).
    const AGG=this.cfg.aggregateWindows|0;
    let aggMembers=null;
    if(AGG>1){
      (this._aggBuf=this._aggBuf||[]).push({score, vec, feat});
      if(this._aggBuf.length < AGG){
        const pend={...M, level:'UNKNOWN', score, action:'PENDING', blocked:false,
          reasons:[`mengumpulkan bukti ${this._aggBuf.length}/${AGG} jendela`],
          topFeatures:[], features:feat, thresholds:{...this.cfg.thresholds},
          eligible, aggregating:{have:this._aggBuf.length, need:AGG}};
        this._cloudLog(pend);
        this._emit(pend);
        return pend;
      }
      aggMembers=this._aggBuf; this._aggBuf=[];
      score=aggMembers.reduce((a,b)=>a+b.score,0)/aggMembers.length;
    }
    // Ambang agregat dipakai HANYA kalau vonisnya memang agregat.
    const usedThresholds = (aggMembers && this._aggThresholds) ? this._aggThresholds : this.cfg.thresholds;
    let level=toRisk(score, usedThresholds);
    if(M.replay) level='HIGH';
    // C-23 (sisi KEAMANAN dari idle). Segmentasi sudah menangani sisi PENGUKURAN;
    // yang ini menangani akibat yang berbeda: selama kursi kosong, orang lain bisa
    // duduk di sesi yang SUDAH terautentikasi ("serangan jam makan siang"). Karena
    // penyusupnya mewarisi sesi yang sah, satu-satunya sinyal yang tersedia adalah
    // adanya absen panjang di tengah — jadi absen itu harus dicatat, bukan dilewati.
    // Jalur pending/eksternal tidak lewat `_onCaptureEvent`, jadi jeda antar-segmen
    // dibaca langsung dari datanya di sini.
    const segGapMs=(M.idle && M.idle.gapBeforeMs) || 0;
    if(segGapMs >= this.cfg.idle.awaySec*1000) this._markAwayReturn(segGapMs, 'jeda-antar-segmen');
    let awayInfo=null;
    if(this._awayReturn){
      awayInfo={...this._awayReturn};
      this._awayReturn=null;
      this._lowStreak=0;   // streak LOW TIDAK menyeberangi absen: itu bukti tentang
                           // orang sebelum absen, bukan tentang orang sesudahnya
    }
    // T3: monotonic dengan decay - turun 1 tingkat tiap 3 LOW berturut
    const order={LOW:0,MEDIUM:1,HIGH:2};
    const modelLevel=level, modelScore=score;   // vonis mentah model, sebelum lantai lengket
    let stickyFloor=false;
    this._lowStreak = (level==='LOW') ? (this._lowStreak||0)+1 : 0;
    // C-6: dulu `score=Math.min(score,-0.9)` MEMALSUKAN skor supaya cocok dengan
    // level yang dipaksa. Karena ambang dikalibrasi per-pengguna (low bisa -3.5),
    // -0.9 sering justru masuk pita LOW -> level dan score saling bertentangan,
    // dan angka palsu itu ikut tersimpan + terkirim ke log cloud. Sekarang skor
    // asli dipertahankan; kenaikan level ditandai eksplisit lewat stickyFloor.
    if(this._lowStreak>=3 && order[this.lastRisk]>order[level]){
      const rev={2:'MEDIUM',1:'LOW',0:'LOW'};
      this.lastRisk=rev[order[this.lastRisk]] || 'LOW';
      if(order[level] < order[this.lastRisk]){ level=this.lastRisk; stickyFloor=true; }
    } else if(order[level] < order[this.lastRisk]){ level=this.lastRisk; stickyFloor=true; }
    if(order[level] > order[this.lastRisk]){ this.lastRisk=level; this._lowStreak=0; }
    // C-23: absen melewati `reverifyAfterSec` -> naikkan LOW jadi MEDIUM supaya
    // step-up jalan sekali, walau perilaku sesudahnya terlihat normal. Sengaja
    // dipisah dari `awaySec`: absen 5 menit cukup untuk berhenti mengukur melintas,
    // 15 menit (sejajar batas idle-timeout PCI DSS 8.2.8) baru cukup untuk
    // mengganggu pengguna. Hanya menaikkan LOW — MEDIUM/HIGH sudah step-up sendiri.
    let reverifyAfterAway=false;
    if(awayInfo && awayInfo.awayMs >= this.cfg.idle.reverifyAfterSec*1000 && level==='LOW'){
      level='MEDIUM'; reverifyAfterAway=true;
      if(order[level]>order[this.lastRisk]){ this.lastRisk=level; this._lowStreak=0; }
    }
    // C-43: MASA BERLAKU STEP-UP ("sudo mode"). Gesekan pemilik tidak tersebar acak: ia
    // menumpuk di hari-hari ketika perilakunya memang berbeda, dan pada hari itu SEMUA
    // jendela berbeda (model != LOW 14-15% di jendela ke-1, ke-2, ke-3... kunjungan).
    // Dulu pemilik yang baru lolos OTP ditanya LAGI 30 detik kemudian, dan lagi. Kini,
    // selama graceSec sesudah verifikasi TERBUKTI (MFA bawaan terverifikasi atau
    // reportStepUp({passed:true})), MEDIUM tidak meminta verifikasi ulang.
    // Batasnya, supaya penyusup tidak ikut menikmati:
    //  - hanya hasil verifikasi sungguhan yang membukanya; penyusup berkredensial curian
    //    tak punya faktor kedua, jadi tak pernah mendapatkannya;
    //  - HIGH tetap meminta verifikasi (orangnya jelas berbeda), rekam-ulang tak pernah;
    //  - absen >= idle.awaySec mencabutnya (kursi mungkin berganti orang), begitu juga
    //    muat-halaman sesudah jeda sepanjang itu (lihat init);
    //  - jendela yang diredam TIDAK melatih model (bukan LOW model, bukan terverifikasi).
    const graceMs=((this.cfg.mfa && this.cfg.mfa.graceSec) || 0)*1000;
    if(awayInfo) this._mfaPassedAt=null;
    let stepUpGrace=null;
    if(graceMs>0 && level==='MEDIUM' && !M.replay && !reverifyAfterAway && this._mfaPassedAt
       && Date.now()-this._mfaPassedAt < graceMs){
      stepUpGrace={ verifiedAgoSec: Math.round((Date.now()-this._mfaPassedAt)/1000), wasLevel: level };
      level='LOW'; this.lastRisk='LOW';
      eligible=false;
    }
    // A3: bukti sebagian tidak boleh jadi DASAR KEPERCAYAAN. Vonisnya tidak dinaikkan
    // — memaksa step-up tiap kali orang memakai password manager itu hukuman untuk
    // kebiasaan yang justru aman. Yang dicabut adalah kemampuannya MEMBANGUN
    // kepercayaan: ia tidak menghitung sebagai LOW berturut, jadi ia tak bisa
    // meluruhkan lantai lengket, dan integrator diberi tahu lewat `partialEvidence`
    // supaya aksi bernilai tinggi bisa menuntut bukti yang utuh.
    if(M.keystrokeBypassed && level==='LOW') this._lowStreak=Math.max(0, (this._lowStreak||1)-1);
    const top=topFeatures(xstd, F4, 3);
    let action=toAction(level);   // HIGH -> REQUIRE_STEPUP (bukan block langsung)
    // challenge step-up
    let reasons=reasonsFrom(top);
    if(M.keystrokeBypassed) reasons=['bukti keystroke dialihkan (autofill/tempel) - blok ritme ketik tidak dinilai', ...reasons];
    if(synthetic) reasons=[`${synthNew} masukan dibuat skrip (bukan dari keyboard/mouse) - tidak dihitung sebagai perilaku, jendela ini tidak melatih model`, ...reasons];
    if(M.replay) reasons=[`perilaku identik dengan sesi lama (jarak ${M.replay.distance.toFixed(4)}) - kemungkinan rekam-ulang`, ...reasons];
    if(reverifyAfterAway) reasons=[`kembali setelah absen ${Math.round(awayInfo.awayMs/60000)} menit (${awayInfo.reason}) - verifikasi ulang`, ...reasons];
    if(stepUpGrace) reasons=[`model: MEDIUM, tidak ditanya ulang - terverifikasi ${Math.round(stepUpGrace.verifiedAgoSec/60)} menit lalu`, ...reasons];
    if(level==='HIGH' && this.challengeTemplate){
      action='REQUIRE_CHALLENGE'; reasons=[...reasons, 'challenge: ketik kata kunci + ritme'];
    }
    // --- aturan-run: HIGH tunggal = step-up; HIGH BERUNTUN >= N = block keras ---
    // Pemilik off-day bikin HIGH terpencar (-> step-up, lolos verifikasi); ATO nyata
    // bikin HIGH berturut (-> block). Held-out: block owner 9.7%->2.4%, FAR tetap.
    this._highRun = (level==='HIGH') ? (this._highRun||0)+1 : 0;
    const blockAfter=this.cfg.blockAfterConsecutiveHigh || 2;
    let blocked=false;
    if(level==='HIGH' && this._highRun>=blockAfter){ action='BLOCK_SESSION'; blocked=true; }
    const evt={...M, level, score, action, blocked, consecutiveHigh: this._highRun, reasons, topFeatures: top, features: feat, thresholds: {...usedThresholds}, eligible, modelLevel, modelScore, stickyFloor,
      resumedAfterAway: awayInfo, reverifyAfterAway, stepUpGrace,
      // topFeatures/features berasal dari jendela TERAKHIR; skornya dari rata-rata M.
      aggregated: aggMembers ? {windows: aggMembers.length} : null,
      partialEvidence: M.keystrokeBypassed ? 'keystroke' : null,
      automation: synthetic ? { syntheticInputs: synthNew } : null};
    // R3: push dengan flag eligible - sesi gagal gate tetap log tapi tidak latih
    // C-24: kalau vonisnya agregat, SEMUA jendela penyusunnya masuk dengan vonis itu —
    // kalau hanya yang terakhir yang disimpan, kolam latih tumbuh M kali lebih lambat.
    for(const m of (aggMembers || [{vec, feat}]))
      this.sessions.push({vector: m.vec, feat: m.feat, ts: Date.now(), risk: level, score, eligible});
    // R2: cohort guard jujur - bg:cohort HANYA dari seed penyusup, bukan dari diri sendiri
    // Jika kosong, fallback window-only dan JANGAN klaim cohort-guarded
    const trainVecs=this._trainingVectors();
    // C-15: gerbang ensemble WAJIB dibuka walau model sudah dinyatakan konvergen.
    // `ensembleMinSamples.svm = 20` sementara `baseline = 10`, dan bobot gerbang
    // dibekukan pada `model.n` saat rebuild terakhir. Pengguna yang 6 sesi pertamanya
    // konsisten akan konvergen di n=10 -> `_rebuildModel()` tidak pernah dipanggil lagi
    // -> detektor-2 (Mahalanobis, bobot 0.70) TETAP TERGERBANG MATI SELAMANYA, dan
    // sistem berjalan dengan Isolation Forest sendirian — persis konfigurasi yang
    // terukur jauh lebih lemah. Terlihat empiris: kolam 24 vektor, model.n masih 10,
    // sesi penyusup dengan skor Mahalanobis -1811 tetap divonis LOW.
    // Menyeberangi ambang gerbang adalah perubahan STRUKTUR model, bukan adaptasi
    // ke data baru, jadi konvergensi tidak boleh memblokirnya.
    const minGate=this.cfg.ensembleMinSamples;
    if(this.model && this.model.n < minGate.svm && trainVecs.length >= minGate.svm){
      this._rebuildModel();
      evt.gateReopened=true;
    }
    // C-31: jadwal latih ulang dulu `ukuran kolam % 6 === 0`. Kolam dibatasi 90 LOW, jadi
    // begitu penuh (~90 jendela x 30 dtk = 45 menit pemakaian) ukurannya BERHENTI
    // bergerak: di 90 (kelipatan 6) model dilatih ulang TIAP jendela, di 88/89 (sisa
    // dedup) TIDAK PERNAH LAGI — adaptasi drift pemilik mati diam-diam. Yang benar
    // menghitung sesi layak-latih BARU sejak latih ulang terakhir.
    const joinsPool = eligible && (level==='LOW');
    if(joinsPool) this._newSinceRebuild=(this._newSinceRebuild||0)+1;
    const shouldRetrain = (this._newSinceRebuild||0) >= this.cfg.retrainEvery;
    if(shouldRetrain){
      const recent=this.sessions.slice(-this.cfg.convergence.window).map(s=>s.risk);
      let cohortRate=0; let hasCohort=false; let cohort=null;
      try{ cohort=await storage.get('bg:cohort'); if(cohort && cohort.length>=10) hasCohort=true; }catch{}
      if(hasCohort){
        const sample=cohort.slice(0,60);
        const scores=sample.map(v=> { const xs=standardize(v, this.stats); return this.model.scoreOne(xs); });
        cohortRate=cohortLowRate(scores, this.cfg.thresholds);
        const converged=isConverged(recent, cohortRate, this.cfg.convergence);
        evt.convergence= converged ? 'cohort-guarded' : 'not-converged';
        evt.cohortLowRate=cohortRate; evt.hasCohort=true;
        if(!converged) this._rebuildModel();
      } else {
        const converged=recent.length>=this.cfg.convergence.window && recent.every(r=>r==='LOW');
        evt.convergence='window-only'; evt.hasCohort=false; evt.cohortLowRate=cohortRate;
        if(!converged) this._rebuildModel();
      }
    } else {
      evt.convergence='no-retrain'; evt.hasCohort=false;
      if(this.sessions.filter(s=>s.eligible!==false).length===this.cfg.baseline) this._rebuildModel();
    }
    await this._persist();
    // R2: HAPUS push own non-LOW ke bg:cohort - cohort harus seed dari luar (reproduce_db), bukan diri sendiri
    this._cloudLog(evt);                    // verdict -> VPS (dashboard per akun)
    if(shouldRetrain && level==='LOW') this._cloudPush(); // baseline tumbuh (hanya LOW) -> sinkron ke VPS
    // C-45: nomor vonis, supaya event awal & event akhir satu vonis bisa dipasangkan.
    evt.id=(this._verdictSeq=(this._verdictSeq||0)+1);
    // C-45: dulu onRisk baru terpanggil SESUDAH dialog ditutup - bisa 2 menit lebih. Selama
    // itu integrator buta: log keamanan kosong, status di layar masih "aman", dasbor diam.
    // Kini, bila dialog memang akan tampil, vonisnya diumumkan SEKETIKA dengan
    // mfa.awaiting=true (aksi belum final), lalu diumumkan lagi dengan hasil verifikasinya.
    if(this._mfaWillShow(evt)) this._emit({...evt, mfa:{ awaiting:true }, stage:'awaiting-mfa'});
    // MFA behavioral BAWAAN: popup step-up sebelum kabari integrator (evt diperbarui hasil MFA)
    await this._maybeMfa(evt);          // verifikasi: vonis bergantung hasilnya, jadi ditunggu
    // C-18: pendaftaran template TIDAK ditunggu. Ini prompt penyiapan di sesi
    // LOW yang tenang, bukan bagian dari vonis; menunggunya berarti `endSession()`
    // baru selesai setelah pengguna mengetik frasa 3x — dan tidak pernah selesai
    // kalau popupnya diabaikan.
    this._maybeEnrollMfa(evt).catch(()=>{});
    evt.stage='final';
    this._emit(evt);
    return evt;
  }
  // Apakah vonis ini akan memunculkan dialog verifikasi (bawaan atau cadangan integrator)?
  // Harus sejalan dengan syarat-syarat awal _maybeMfa.
  _mfaWillShow(evt){
    const m=this.cfg.mfa;
    if(!m || !m.enabled || typeof document==='undefined') return false;
    if(!m.triggerOn.includes(evt.level) || this._mfaBusy) return false;
    if(m.cooldownMs && this._mfaPassedAt && Date.now()-this._mfaPassedAt < m.cooldownMs) return false;
    return !!(this.challengeTemplate || typeof m.onFallback==='function');
  }

  // Opsi tampilan dialog yang sama untuk semua jalur (vonis otomatis, stepUp(), daftar).
  _mfaUi(extra){
    const m=this.cfg.mfa||{};
    return { phrase: m.phrase, rounds: m.rounds, buildTemplate, verify: verifyChallenge,
             lang: m.lang, texts: m.texts, accent: m.accent, brand: m.brand, theme: m.theme, ...extra };
  }
  // C-45: dialog di tab TERSEMBUNYI tidak dilihat siapa pun; batas waktunya habis dan
  // pemilik tercatat gagal verifikasi. Tunggu tab terlihat (maks timeoutMs) dulu.
  _whenVisible(maxMs){
    if(typeof document==='undefined' || document.visibilityState!=='hidden') return Promise.resolve(true);
    return new Promise(res=>{
      let t=null;
      const on=()=>{ if(document.visibilityState!=='hidden'){ document.removeEventListener('visibilitychange', on); clearTimeout(t); res(true); } };
      document.addEventListener('visibilitychange', on);
      t=setTimeout(()=>{ document.removeEventListener('visibilitychange', on); res(false); }, maxMs||120000);
    });
  }
  /**
   * C-45: jalur verifikasi CADANGAN milik integrator (`mfa.onFallback`), mis. OTP SMS/email
   * atau WebAuthn yang DIVERIFIKASI DI SERVER. Dipakai bila pengguna memilih "Gunakan cara
   * lain", bila template irama belum ada, atau bila keyboardnya berbeda dari saat daftar.
   * Tanpanya, pemilik yang tidak bisa mengetik frasa tidak punya jalan keluar selain diblokir.
   * Kontrak: onFallback({level, reasons, trigger, why}) -> Promise<boolean>. true HANYA bila
   * server integrator sudah memverifikasi faktornya (batas kepercayaan = reportStepUp).
   */
  async _runFallback(ctx){
    const m=this.cfg.mfa||{};
    const f=m.onFallback;
    if(typeof f!=='function') return null;
    // C-46: BATAS WAKTU. `onFallback` adalah kode MILIK INTEGRATOR. Kalau Promise-nya tidak
    // pernah selesai - dialog OTP yang tombol batalnya lupa me-resolve, panggilan jaringan
    // tanpa timeout, tab yang ditinggal - maka `_mfaBusy` tersangkut SELAMANYA. Akibatnya
    // bukan satu verifikasi yang gagal, melainkan seluruh lapisan step-up mati untuk sisa
    // umur halaman: tiap vonis berikutnya pulang dengan mfa:{busy:true} dan integrator yang
    // (benar) menunggu hasil dialog tidak pernah bertindak. Habis waktu = TIDAK terverifikasi.
    const ms=Number.isFinite(m.fallbackTimeoutMs) ? m.fallbackTimeoutMs : 300000;
    let timer=null;
    try{
      const p=Promise.resolve(f(ctx)).then(v=> v===true);
      if(!(ms>0)) return await p;
      const race=new Promise(res=>{ timer=setTimeout(()=>{
        try{ console.warn(`[BG] mfa.onFallback tidak selesai dalam ${ms>=1000? Math.round(ms/1000)+' dtk' : ms+' ms'} - dianggap tidak terverifikasi`); }catch{}
        res(false);
      }, ms); });
      return await Promise.race([p, race]);
    }catch(e){ try{ console.error('[BG] mfa.onFallback melempar', e); }catch{} return false; }
    finally{ if(timer) clearTimeout(timer); }
  }
  // Popup MFA otomatis saat vonis MEDIUM/HIGH (bila cfg.mfa.enabled & ada DOM).
  // Verifikasi memakai template irama; tanpa template -> jalur cadangan integrator.
  async _maybeMfa(evt){
    const m=this.cfg.mfa;
    if(!m || !m.enabled || typeof document==='undefined') return;
    if(!m.triggerOn.includes(evt.level)) return;
    // C-45: vonis yang jatuh saat dialog lain masih terbuka dulu pergi TANPA keterangan
    // apa pun - integrator tidak bisa membedakan "tidak ada MFA" dari "MFA sedang berjalan".
    // busy: hasil verifikasi yang sedang berjalan yang menentukan; jangan bertindak sendiri.
    if(this._mfaBusy){ evt.mfa={ busy:true }; return; }
    const now=Date.now();
    if(m.cooldownMs && this._mfaPassedAt && now-this._mfaPassedAt < m.cooldownMs){ evt.mfa={skipped:'cooldown'}; return; }
    const r=await this._stepUpFlow({ level: evt.level, reasons: evt.reasons||[], trigger:'verdict' });
    evt.mfa=r.mfa;
    if(r.verified) this._applyMfaVerified(evt, now);
    else if(!r.unavailable) evt.action = evt.blocked ? 'BLOCK_SESSION' : 'MFA_FAILED';
    // unavailable: tak ada template DAN tak ada cadangan -> aksi vonis tetap berlaku
    // (gagal-tertutup), integrator yang memutuskan lewat onRisk.
    if(!r.unavailable) await this._persist();
  }
  /**
   * Inti step-up, dipakai vonis otomatis DAN BehaviorGuard.stepUp(). Tidak menyentuh state
   * vonis; pemanggil yang menerapkan hasilnya.
   * -> { verified, method:'rhythm'|'fallback'|null, mfa:{...}, unavailable? }
   */
  async _stepUpFlow({ level='MEDIUM', reasons=[], trigger='verdict' }={}){
    const m=this.cfg.mfa||{};
    // C-2: TIDAK PERNAH mendaftarkan template saat sesi sedang dicurigai. Versi lama
    // memanggil runMfaChallenge dengan template=null -> mode DAFTAR, sehingga penyusup di
    // perangkat baru cukup mengetik frasa 3x untuk MEMBUAT template miliknya sendiri lalu
    // dinyatakan "MFA_PASSED". Pendaftaran hanya di sesi TEPERCAYA (_maybeEnrollMfa).
    const hasFallback=typeof m.onFallback==='function';
    if(!this.challengeTemplate){
      if(!hasFallback) return { verified:false, method:null, unavailable:true,
        mfa:{ shown:false, unavailable:'belum ada template irama (pendaftaran hanya di sesi LOW tepercaya) dan mfa.onFallback tidak diisi' } };
      this._mfaBusy=true;
      try{
        const ok=await this._runFallback({ level, reasons, trigger, why:'no-template' });
        return { verified:ok, method:'fallback', mfa:{ shown:false, fallback:true, verified:ok } };
      } finally { this._mfaBusy=false; }
    }
    // C-45: batas gagal BERUNTUN lintas kunjungan. Tiap dialog memberi 3 percobaan, dan tiap
    // vonis baru membuka dialog baru - tanpa batas, penyusup yang terus kembali mendapat
    // percobaan tak terhingga untuk menebak irama pemilik. Sesudah `lockAfterFailures` dialog
    // gagal berturut, jalur irama dikunci sampai verifikasi lewat jalur cadangan berhasil.
    const lockN=(m.lockAfterFailures ?? 3);
    if(lockN>0 && (this._mfaFailStreak||0) >= lockN){
      if(!hasFallback) return { verified:false, method:null, unavailable:true,
        mfa:{ shown:false, locked:true, unavailable:'verifikasi irama dikunci sesudah gagal berturut - perlu jalur cadangan (mfa.onFallback)' } };
      this._mfaBusy=true;
      try{
        const ok=await this._runFallback({ level, reasons, trigger, why:'rhythm-locked' });
        return { verified:ok, method:'fallback', mfa:{ shown:false, fallback:true, locked:true, verified:ok } };
      } finally { this._mfaBusy=false; }
    }
    this._mfaBusy=true;
    try{
      const visible=await this._whenVisible(m.timeoutMs);
      if(!visible) return { verified:false, method:null, mfa:{ shown:false, timedOut:true, hidden:true } };
      const res=await runMfaChallenge(this._mfaUi({ template:this.challengeTemplate, level,
        timeoutMs:m.timeoutMs, allowFallback:hasFallback, trigger,
        reason: trigger==='integrator' && reasons.length ? reasons[0] : null }));
      const mfa={ shown:true, passed:!!res.passed, verified:!!res.verified, cancelled:!!res.cancelled,
                  timedOut:!!res.timedOut, attemptsExhausted:!!res.attemptsExhausted,
                  modeMismatch:!!res.modeMismatch, reasons:res.reasons||[] };
      // Hanya VERIFIKASI sungguhan (res.verified) yang membuktikan identitas.
      // res.passed sendirian bisa berasal dari mode daftar -> tidak cukup.
      if(res.verified) return { verified:true, method:'rhythm', mfa };
      if(res.attemptsExhausted){ this._mfaFailStreak=(this._mfaFailStreak||0)+1; mfa.failStreak=this._mfaFailStreak; }
      if(res.fallback && hasFallback){
        const ok=await this._runFallback({ level, reasons, trigger, why:'user-choice' });
        return { verified:ok, method:'fallback', mfa:{ ...mfa, fallback:true, verified:ok } };
      }
      return { verified:false, method:null, mfa };
    }catch(e){ return { verified:false, method:null, mfa:{ shown:true, error:String(e&&e.message||e) } }; }
    finally{ this._mfaBusy=false; }
  }
  /**
   * C-45: step-up SESUAI PERMINTAAN integrator - sebelum transfer, ganti email/sandi, atau
   * saat pengguna menekan "verifikasi sekarang" sesudah membatalkan dialog. Dulu dialog
   * bawaan hanya bisa muncul dari vonis otomatis; integrator yang ingin memverifikasi di
   * momen sensitif harus membangun UI sendiri.
   * -> { verified, method, cancelled?, unavailable? }. Lolos = efek yang sama dengan MFA
   *    bawaan (lantai lengket dibersihkan, masa berlaku graceSec dimulai).
   */
  async stepUp({ level='MEDIUM', reason }={}){
    if(!this.inited || !this.userId) return { verified:false, method:null, unavailable:true, reason:'belum init' };
    if(this._mfaBusy) return { verified:false, method:null, busy:true };
    const r=await this._stepUpFlow({ level, reasons: reason?[reason]:[], trigger:'integrator' });
    if(r.verified){ const evt={}; this._applyMfaVerified(evt); await this._persist(); }
    return { verified:!!r.verified, method:r.method, unavailable:!!r.unavailable,
             cancelled:!!(r.mfa && r.mfa.cancelled), timedOut:!!(r.mfa && r.mfa.timedOut),
             attemptsExhausted:!!(r.mfa && r.mfa.attemptsExhausted) };
  }

  // Akibat MFA yang TERVERIFIKASI. Dipisah dari popup-nya supaya tools/eval_sdk.mjs
  // bisa mensimulasikan "pemilik lolos verifikasi" dengan kode yang PERSIS ini — bukan
  // tiruan tangan yang lama-lama menyimpang (C-29).
  _applyMfaVerified(evt={}, now=Date.now()){
    // `now` = saat vonis dinilai (kesegaran jendela di bawah); masa berlaku dihitung dari saat
    // verifikasi LOLOS, yang bisa semenit lebih kemudian kalau pengguna lama di dialog.
    this._mfaPassedAt=Math.max(now, Date.now()); this._highRun=0;
    this.lastRisk='LOW'; this._lowStreak=0;   // C-3: bersihkan lantai lengket,
                                              // kalau tidak sesi berikutnya dipaksa HIGH terus
    this._awayReturn=null;                    // absen yang tertunda sudah dijawab verifikasi ini
    this._mfaFailStreak=0;
    evt.action='MFA_PASSED'; evt.blocked=false; evt.mfaVerified=true;
    // TRUST-LOOP: hanya sesi terverifikasi yang boleh mengajari model.
    // C-45: dan hanya sesi yang BARU SAJA dinilai. Verifikasi membuktikan siapa yang duduk
    // SEKARANG; jendela berumur 10 menit (stepUp() dari halaman transfer) bisa milik orang
    // lain yang duduk di kursi yang sama sebelumnya. Ia tidak ikut dilatihkan.
    const last=this.sessions[this.sessions.length-1];
    const fresh= last && Number.isFinite(last.ts) && Math.abs(now-last.ts) <= 2*this.cfg.session.windowSec*1000;
    if(last && fresh && !last.mfaVerified && last.vector){ last.mfaVerified=true; this._rebuildModel(); }
  }
  /**
   * C-32: laporan hasil step-up MILIK INTEGRATOR (OTP, WebAuthn, email, telepon).
   * Vonis MEDIUM/HIGH menyuruh integrator "minta verifikasi", tapi dulu tidak ada jalan
   * untuk memberi tahu hasilnya ke pustaka. Akibatnya bagi integrator yang tidak memakai
   * popup ritme bawaan: lantai lengket tak pernah dibersihkan, sesi pemilik yang lolos
   * verifikasi tak pernah mengajari model, dan HIGH beruntun berakhir BLOCK untuk
   * pemilik sendiri. Terukur (tools/eval_sdk.mjs, pemilik tanpa jalur verifikasi):
   * gesekan 40,5%, DIBLOKIR 13,3%.
   *   passed:true  -> efeknya sama persis dengan MFA bawaan yang terverifikasi.
   *   passed:false -> tidak mengubah apa pun selain tercatat; hukuman tetap milik
   *                   aturan vonis (HIGH beruntun), bukan milik laporan ini.
   * HANYA panggil dari hasil verifikasi SISI SERVER yang sudah dicek. Skrip di halaman
   * yang sama bisa memanggilnya juga — itu batas kepercayaan sisi-klien yang sama
   * dengan seluruh pustaka ini (THREAT-MODEL.md).
   */
  // C-39: token pengguna berumur pendek; server integrator memperbaruinya.
  setUserToken(token){ this.userToken=token||null; this.cloud=!!(this.pk&&this.endpoint&&this.userToken); }
  async reportStepUp({ passed } = {}){
    if(!this.userId) return { applied:false, lastRisk:this.lastRisk, reason:'belum init' };
    const evt={};
    if(passed===true){ this._applyMfaVerified(evt); await this._persist(); }
    else { this._stepUpFailures=(this._stepUpFailures||0)+1; }
    return { applied: passed===true, lastRisk: this.lastRisk };
  }
  /**
   * C-33: vonis SEKETIKA untuk aksi sensitif (ganti email/sandi, transfer, tambah
   * perangkat). Vonis rutin kini menunggu bukti cukup (minEventsAssess), jadi penyusup
   * yang masuk lalu langsung mengganti email pemulihan dalam 20 detik bisa selesai
   * sebelum vonis pertama. Aksi seperti itu harus memanggil ini dan memperlakukan
   * UNKNOWN sebagai "minta verifikasi" (gagal-TERTUTUP), bukan "aman".
   *
   * TANPA efek samping: tidak menguras buffer, tidak masuk kolam latih, tidak menggeser
   * lantai lengket, tidak menaikkan hitungan HIGH. Bukti parsial (< minEventsAssess)
   * lebih berisik, jadi ia lebih mudah salah-curiga — biaya yang wajar di momen yang
   * memang pantas diverifikasi. Lantai lengket & absen yang belum terselesaikan ikut
   * menaikkan vonisnya.
   */
  assessNow({ minEvents=30 }={}){
    const S=this.cfg.session;
    // C-45: integrator perlu tahu apakah pengguna BARU SAJA lolos verifikasi (masa berlaku
    // graceSec), supaya dua transfer berturut tidak meminta verifikasi dua kali - tapi
    // keputusannya milik integrator, jadi level tetap jujur dan tidak diredam di sini.
    const graceMs=((this.cfg.mfa && this.cfg.mfa.graceSec) || 0)*1000;
    const vr= !!(this._mfaPassedAt && Date.now()-this._mfaPassedAt < graceMs);
    const base={ at: Date.now(), sensitive:true, verifiedRecently: vr,
      verifiedAgoSec: this._mfaPassedAt ? Math.round((Date.now()-this._mfaPassedAt)/1000) : null };
    const eligibleCount=this.sessions.filter(s=>s.eligible!==false).length;
    if(!this.model || eligibleCount < this.cfg.baseline){
      return {...base, level:'UNKNOWN', action:'REQUIRE_STEPUP', enrollment:true,
        reasons:['pendaftaran belum selesai - belum ada pembanding, verifikasi dengan cara lain']};
    }
    let events=dropExactDuplicates(this.capture ? this.capture.peek() : []);
    if(S.idleCompressSec>0) events=compressIdle(events, S.idleCompressSec*1000);
    const order={LOW:0,MEDIUM:1,HIGH:2};
    const away=this._awayReturn && this._awayReturn.awayMs >= this.cfg.idle.reverifyAfterSec*1000;
    if(events.length < minEvents){
      return {...base, level:'UNKNOWN', action:'REQUIRE_STEPUP', evidence:{events:events.length, partial:true},
        reasons:[`bukti belum cukup (${events.length} event) - perlakukan sebagai belum terverifikasi`]};
    }
    const feat=extractF4(events), vec=featuresToVector(feat);
    const xstd=standardize(vec, this.stats);
    const score=this.model.scoreOne(xstd);
    let level=Number.isFinite(score) ? toRisk(score, this.cfg.thresholds) : 'HIGH';
    const floor=this.lastRisk||'LOW';
    if(order[floor] > order[level]) level=floor;
    if(away && level==='LOW') level='MEDIUM';
    const top=topFeatures(xstd, F4, 3);
    return {...base, level, score, action: toAction(level), modelLevel: Number.isFinite(score)? toRisk(score, this.cfg.thresholds):'HIGH',
      evidence:{ events:events.length, partial: events.length < S.minEventsAssess },
      reasons:[...(away?['kembali setelah absen - verifikasi ulang']:[]), ...reasonsFrom(top)], topFeatures: top};
  }
  // Pendaftaran template ritme HANYA di sesi tepercaya: vonis LOW, model sudah
  // terbentuk, dan belum pernah punya template. Ini pasangan dari C-2 — kalau
  // pendaftaran tidak pernah terjadi di sini, MFA tidak akan pernah tersedia.
  async _maybeEnrollMfa(evt){
    const m=this.cfg.mfa;
    if(!m || !m.enabled || typeof document==='undefined') return;
    // C-45: integrator boleh menaruh pendaftaran di halaman pengaturannya sendiri
    // (enrollMfa()) alih-alih dialog yang muncul tanpa diminta.
    if(m.autoEnroll===false) return;
    if(this.challengeTemplate || this._mfaBusy) return;
    if(evt.level!=='LOW' || evt.eligible===false || !this.model) return;
    // C-37: popup pendaftaran DULU muncul di SETIAP vonis LOW selama template belum ada.
    // Pengguna yang menutupnya sekali ditanya lagi di vonis berikutnya, lagi, dan lagi —
    // cara tercepat membuat orang mencopot pustaka keamanan. Kini ditunda
    // `mfa.enrollSnoozeMs` (default 24 jam) sesudah ditutup/diabaikan, dan tersimpan
    // lintas muat-halaman.
    if(this._mfaEnrollSnoozeUntil && Date.now() < this._mfaEnrollSnoozeUntil) return;
    // C-45: jangan merebut fokus dari orang yang SEDANG mengetik (mengisi formulir, menulis
    // pesan) atau dari tab yang tidak dilihat. Ini tawaran opsional: ditunda ke vonis LOW
    // berikutnya, bukan di-snooze - pengguna belum menolak apa pun.
    if(document.visibilityState==='hidden') return;
    if(this._lastKeyAt && Date.now()-this._lastKeyAt < 4000) return;
    const res=await this._enrollFlow();
    evt.mfa=res.enrolled ? { enrolled:true, verified:false } : { enrolled:false, reason:res.reason };
    if(!res.enrolled && !res.busy){
      this._mfaEnrollSnoozeUntil=Date.now()+(m.enrollSnoozeMs ?? 86_400_000);
      await this._persist();
    }
  }
  async _enrollFlow(){
    const m=this.cfg.mfa||{};
    if(this._mfaBusy) return { enrolled:false, busy:true, reason:'dialog lain sedang terbuka' };
    this._mfaBusy=true;
    try{
      const res=await runMfaChallenge(this._mfaUi({ template:null, timeoutMs:m.enrollTimeoutMs }));
      if(res.enrolled && res.template){
        this.challengeTemplate=res.template;
        await this._persist();
        return { enrolled:true, mode: res.template.mode||'hard' };
      }
      return { enrolled:false, reason: res.reason || (res.timedOut ? 'waktu habis' : 'dibatalkan') };
    }catch(e){ return { enrolled:false, reason:String(e&&e.message||e) }; }
    finally{ this._mfaBusy=false; }
  }
  /**
   * C-45: pendaftaran verifikasi irama ketik atas permintaan (tombol di halaman keamanan).
   * Tetap hanya di keadaan TEPERCAYA (C-2): vonis terakhir LOW, tidak ada absen yang belum
   * dijawab, dan tidak sedang dicurigai. Selama pendaftaran perilaku awal (belum ada model)
   * kepercayaannya sama dengan baseline itu sendiri - trust-on-first-use perangkat ini.
   * Template yang sudah ada TIDAK bisa ditimpa dari sini: menggantinya lewat forgetMfa()
   * yang menuntut verifikasi lebih dulu.
   */
  async enrollMfa(){
    if(!this.inited || !this.userId) return { enrolled:false, reason:'belum init' };
    if(typeof document==='undefined') return { enrolled:false, reason:'tanpa DOM' };
    if(this.challengeTemplate) return { enrolled:false, already:true, reason:'sudah terdaftar' };
    const last=this._lastEvt;
    const suspicious= this.lastRisk!=='LOW' || (this._awayReturn && this._awayReturn.awayMs >= this.cfg.idle.reverifyAfterSec*1000)
      || (last && !last.enrollment && !last.abstain && last.level && last.level!=='LOW' && last.level!=='UNKNOWN');
    if(suspicious) return { enrolled:false, reason:'sesi sedang dicurigai - verifikasi dulu (stepUp)' };
    const r=await this._enrollFlow();
    if(r.enrolled){ this._mfaEnrollSnoozeUntil=0; await this._persist(); }
    return r;
  }
  /**
   * C-45: hapus template irama (ganti keyboard, pindah ke ponsel). Menuntut step-up LOLOS
   * lebih dulu - kalau tidak, penyusup yang duduk di sesi pemilik bisa menghapusnya lalu
   * mendaftarkan iramanya sendiri.
   */
  async forgetMfa(){
    if(!this.inited || !this.challengeTemplate) return { removed:false, reason: this.challengeTemplate ? 'belum init' : 'belum terdaftar' };
    const v=await this.stepUp({ level:'MEDIUM', reason:'hapus verifikasi irama ketik' });
    if(!v.verified) return { removed:false, reason:'verifikasi tidak lolos' };
    this.challengeTemplate=null; await this._persist();
    return { removed:true };
  }
  async endSession(){
    if(!this.capture) return null;
    return this._assessEvents(this.capture.drain(), true);
  }
  async scoreExternalEvents(events){
    return this._assessEvents(events||[], false);
  }
  /**
   * C-23: satu jalur penilaian untuk buffer live MAUPUN akumulator `bg:pending`.
   * Aliran event dipecah pada tiap jeda idle lebih dulu, lalu TIAP segmen kontigu
   * dinilai sendiri-sendiri. Yang berubah hanya apa yang disuapkan ke `extractF4`;
   * rumus fiturnya (core/SPEC.md) tidak disentuh, jadi golden tetap hijau.
   *
   * Versi lama: `drain()` dulu MEMBUANG buffer < minEventsAssess tanpa jejak. Dua
   * akibatnya sekaligus diperbaiki di sini — ekor yang masih hidup dikembalikan ke
   * buffer supaya bisa tumbuh (bukan dibuang tiap 30 detik), dan jendela yang tak
   * menghasilkan vonis tidak lagi diam-diam berlalu (lihat `_maybeAbstain`).
   */
  async _assessEvents(events, carryBack){
    // C-29: kembaran identik adalah artefak pencatatan, bukan perilaku (lihat
    // idle.js:dropExactDuplicates). Dibuang sebelum apa pun diukur atau diperiksa.
    events=dropExactDuplicates(events||[]);
    // B1: pisahkan per tab DULU. Dua tab aktif bersamaan tidak punya jeda untuk
    // dipotong segmentasi idle, jadi tanpa langkah ini keduanya menyatu jadi satu
    // "sesi" yang tidak mewakili perilaku siapa pun.
    const streams=groupByStream(events);
    if(streams.length > 1){
      let last=null;
      for(const st of streams) last=await this._assessStream(st, carryBack && st===streams[streams.length-1]);
      return last;
    }
    return this._assessStream(events, carryBack);
  }
  async _assessStream(events, carryBack){
    const S=this.cfg.session;
    const gapMs=(S.idleGapSec ?? 30)*1000;
    const acct=idleAccounting(events, gapMs);
    const segs=(S.idleCompressSec>0) ? this._compressedUnit(events, acct) : segmentByIdle(events, gapMs);
    // C-33: dengan kompresi nyala, ekor yang belum mencapai minEventsAssess terus
    // dikumpulkan sampai carryMaxAgeSec (bukan dibuang begitu diam 30 dtk).
    const carryMs=(S.idleCompressSec>0 && S.carryMaxAgeSec>0) ? S.carryMaxAgeSec*1000 : gapMs;
    const {assess, carry, dropped}=splitForAssessment(segs, S.minEventsAssess, Date.now(), gapMs, carryMs);
    if(carryBack && carry && this.capture){
      // ekor masih "hidup" (event terakhir belum melewati ambang jeda) -> kembalikan
      // ke depan buffer supaya terus tumbuh. Panjangnya < minEventsAssess, jadi
      // spread di sini aman dari stack overflow.
      try{ this.capture.buffer.unshift(...(carry.rawEvents||carry.events)); }catch{}
    }
    if(!assess.length) return this._maybeAbstain(events, acct, dropped);
    this._noAssessRuns=0; this._abstainEmitted=false;
    let last=null;
    // C-24 (opt-in): pecah tiap segmen jadi jendela KANONIK berukuran tetap K event.
    // Cacahan mentah (9 dari 28 fitur) membesar bersama panjang sesi, jadi panjang
    // yang berubah-ubah terbaca sebagai identitas yang berubah. Menyamakan panjangnya
    // memperbaiki itu tanpa menyentuh satu baris pun rumus fitur di core/SPEC.md.
    for(const seg0 of assess){
      const seg=this._withContext(seg0);
      // acct.segments = jumlah rentetan AKTIF di batch. Di jalur segmen sama dengan
      // segs.length; di jalur kompresi C-28 segs selalu 1, tapi telemetri tetap harus
      // bilang ada berapa rentetan yang dinilai jadi satu.
      for(const win of this._canonicalize(seg)) last=await this._assessSegment(win, acct, acct.segments);
    }
    return last;
  }
  /**
   * C-42: JENDELA GESER. Vonis pertama sebuah kunjungan tetap jatuh begitu 150 event
   * BARU terkumpul — penyusup diperiksa secepat sebelumnya. Vonis berikutnya menilai
   * event baru DITAMBAH event yang baru saja dinilai, sampai `contextEvents` total, jadi
   * pemilik yang terus bekerja dinilai dengan bukti ~2x lebih banyak (EER per pemilik
   * turun tajam dengan ukuran bukti, tabel C-29) tanpa menunda vonis pertama.
   *
   * Konteks HANYA dari kunjungan ini (memori, tidak disimpan) dan DIBUANG bila ada jeda
   * >= idle.awaySec antara konteks dan event baru: orang yang duduk di kursi pemilik
   * yang pergi tidak boleh meminjam perilaku pemilik untuk mengencerkan vonisnya.
   * Syarat 150 event baru tetap diperiksa pada event BARU saja (splitForAssessment).
   */
  _withContext(seg){
    const CE=this.cfg.session.contextEvents|0;
    const raw=seg.rawEvents;
    if(CE<=0 || !raw || !raw.length || !(this.cfg.session.idleCompressSec>0)) return seg;
    const prev=this._ctx||[];
    const awayMs=(this.cfg.idle && this.cfg.idle.awaySec ? this.cfg.idle.awaySec : 300)*1000;
    const fresh=prev.length && ((raw[0].timestamp||0)-(prev[prev.length-1].timestamp||0)) < awayMs;
    const room=Math.max(0, CE-raw.length);
    const combined= (fresh && room>0) ? prev.slice(-room).concat(raw) : raw;
    this._ctx=combined.slice(-CE);
    if(combined===raw) return seg;
    const u=this._compressedUnit(combined, {longestGapMs: seg.gapBeforeMs||0});
    return {...u[0], gapBeforeMs: seg.gapBeforeMs||0, context: combined.length-raw.length};
  }
  /**
   * C-28: seluruh aliran jadi SATU unit penilaian, jeda ≥ idleCompressSec
   * dipendekkan (bukan dipotong). Held-out 5 belahan, AFK 2-20 mnt disuntik:
   * FRR 18,4% -> 9,7% pada FAR 9,2% -> 9,3%, AUC 0,952 -> 0,968 — sedangkan
   * segmentasi C-23 memberi 18,8% / AUC 0,927. Memecah di jeda "away" ikut diuji dan
   * membatalkan manfaatnya (FRR 18,5%): yang merusak adalah MEMENDEKKAN SESI, bukan
   * jedanya. Lihat core/DRIFT.md C-28.
   *
   * Sisi KEAMANAN tidak hilang. Jeda terpanjang diukur dari timestamp ASLI sebelum
   * dikompresi dan dibawa sebagai `gapBeforeMs`, jadi `_ingestVector` tetap menandai
   * `resumedAfterAway`, mereset streak LOW, dan menaikkan LOW->MEDIUM bila absennya
   * ≥ reverifyAfterSec — persis seperti jalur segmen. Yang berubah: satu batch yang
   * melintasi absen menghasilkan SATU vonis, bukan dua.
   *
   * Bentuk keluarannya sama dengan segmentByIdle (array segmen) supaya
   * splitForAssessment, carry-back ekor, dan ABSTAIN berjalan tanpa diubah.
   */
  _compressedUnit(events, acct){
    if(!events || !events.length) return [];
    const ev=compressIdle(events, this.cfg.session.idleCompressSec*1000);
    const startTs=ev[0].timestamp||0, endTs=ev[ev.length-1].timestamp||startTs;
    // endTs dipakai splitForAssessment untuk memutuskan ekor masih "hidup"; ukur dari
    // waktu ASLI, bukan waktu hasil kompresi yang sudah digeser mundur.
    const realEnd=events.reduce((m,e)=> Math.max(m, e.timestamp||0), 0);
    // rawEvents: kalau unit ini ternyata ekor yang dikembalikan ke buffer, yang
    // dikembalikan harus event ASLI — timestamp hasil kompresi akan merusak jendela
    // berikutnya (jeda antara ekor dan event baru jadi terukur salah).
    return [{ events:ev, rawEvents:events, startTs, endTs:realEnd, durationMs:endTs-startTs,
              gapBeforeMs: acct.longestGapMs||0 }];
  }
  // C-24: [segmen] -> [jendela K event]. K=0 (default) mengembalikan segmen apa
  // adanya, jadi jalur lama tidak tersentuh. Sisa < K di ekor DIBUANG di sini —
  // ia tetap aman karena `splitForAssessment` sudah lebih dulu mengembalikan ekor
  // yang masih hidup ke buffer, jadi yang dibuang hanya sisa yang memang mati.
  _canonicalize(seg){
    const K=this.cfg.session.canonicalWindow|0;
    if(K<=0 || seg.events.length<K) return [seg];
    const out=[];
    for(let i=0;i+K<=seg.events.length;i+=K){
      const evs=seg.events.slice(i,i+K);
      out.push({ events:evs, startTs:evs[0].timestamp, endTs:evs[evs.length-1].timestamp,
                 durationMs:(evs[evs.length-1].timestamp||0)-(evs[0].timestamp||0),
                 gapBeforeMs: i===0 ? seg.gapBeforeMs : 0 });
    }
    return out;
  }
  async _assessSegment(seg, acct, totalSegments){
    const S=this.cfg.session;
    const gapMs=(S.idleGapSec ?? 30)*1000;
    const events=seg.events;
    const feat=extractF4(events);
    const vec=featuresToVector(feat);
    const durationSec=seg.durationMs/1000;     // durasi AKTIF, bukan rentang jam dinding
    const nonZero=Object.values(feat).filter(v=> Math.abs(v)>1e-9).length;
    // A3: bukti keystroke DIALIHKAN, bukan sekadar tidak ada. Dibedakan dengan hati-hati
    // dari sesi menelusuri biasa: sesi baca-baca juga nol keystroke, tapi ia nol pada
    // baseline-nya juga, jadi tidak menyesatkan. Yang menyesatkan adalah form yang
    // TERSENTUH tapi tidak diketik — autofill, password manager, atau tempel.
    // C-42: hanya event BARU yang diperiksa. Dengan jendela geser, satu tempel di konteks
    // dulu mencemari 2-3 vonis berikutnya (pengguna password manager tak pernah selesai
    // mendaftar); konteks sudah dinilai di vonis sebelumnya.
    const fresh=seg.context ? events.slice(seg.context) : events;
    const nKey=fresh.reduce((n,e)=> n+(e.event_type==='KEYSTROKE'?1:0), 0);
    const nPaste=fresh.reduce((n,e)=> n+(e.event_type==='PASTE'?1:0), 0);
    // C-45: hanya fokus ke kolom KETIK yang dihitung (txt:false = select/centang/radio).
    // Event tanpa penanda (data riset, versi lama) diperlakukan seperti dulu.
    const nFocus=fresh.reduce((n,e)=> n+(e.event_type==='FORM_FOCUS' && e.txt!==false ?1:0), 0);
    const keystrokeBypassed = nPaste>0 || (nFocus>0 && nKey===0);
    // Sesi yang blok keystroke-nya dialihkan TIDAK PERNAH melatih: kedelapan fiturnya
    // nol secara STRUKTURAL — karena memang tidak ada yang diketik — bukan karena
    // begitulah cara orang ini mengetik. Melatihkannya menarik baseline ke arah
    // "tidak pernah mengetik", dan itu justru MELEBARKAN jalan bagi penyusup yang
    // memakai autofill untuk menghapus jejak ritmenya.
    const passesGate = !keystrokeBypassed && events.length>=S.minEventsTrain && durationSec>=S.minDurationSec && nonZero>=S.minNonZeroFeatures;
    const meta={ keystrokeBypassed, contextEvents: seg.context||0, idle: {
      activeSec: durationSec,
      gapBeforeMs: seg.gapBeforeMs,
      gapClass: classifyGap(seg.gapBeforeMs, gapMs, this.cfg.idle.awaySec*1000),
      batchIdleMs: acct.idleMs, batchActiveRatio: acct.activeRatio,
      batchSegments: totalSegments,
    }};
    return this._ingestVector(vec, feat, passesGate, events, meta);
  }
  /**
   * C-23: jendela tanpa vonis TIDAK sama dengan jendela aman. Versi lama
   * mengembalikan `null` diam-diam, sehingga integrator yang menunggu callback
   * tidak bisa membedakan "sudah diperiksa, aman" dari "tak ada bukti sama sekali"
   * — dan default diam itu selalu jatuh ke sisi mempercayai. Sekarang diterbitkan
   * vonis 'UNKNOWN' / action 'ABSTAIN' SEKALI per rentetan idle (bukan tiap
   * jendela, supaya tab yang ditinggal semalaman tidak membanjiri log).
   */
  _maybeAbstain(events, acct, dropped){
    const I=this.cfg.idle;
    this._noAssessRuns=(this._noAssessRuns||0)+1;
    if(!I || !I.emitAbstain || this._abstainEmitted) return null;
    if(this._noAssessRuns < (I.abstainAfterWindows||4)) return null;
    this._abstainEmitted=true;
    const n=events ? events.length : 0;
    const evt={
      level:'UNKNOWN', score:null, action:'ABSTAIN', blocked:false, abstain:true,
      reasons:[ n===0
        ? 'tidak ada input — halaman kemungkinan ditinggal'
        : `bukti tidak cukup untuk menilai (${n} event, ambang ${this.cfg.session.minEventsAssess})` ],
      topFeatures:[], features:null, thresholds:{...this.cfg.thresholds}, eligible:false,
      idle:{ activeMs:acct.activeMs, idleMs:acct.idleMs, activeRatio:acct.activeRatio,
             segments:acct.segments, droppedSegments:dropped.length, events:n,
             windowsWithoutVerdict:this._noAssessRuns }
    };
    this._emit(evt);
    return evt;   // sengaja TIDAK di-_cloudLog: ini keadaan lokal, bukan vonis akun
  }
  // A5: `features.js` menghitung navEv = NAVIGATION | PAGE_STEP, dan basis data riset
  // berisi 2.672 PAGE_STEP — SEMUANYA dari alur checkout bertahap. Tapi `capture.js`
  // tidak pernah menerbitkannya, jadi `nav_step_transition_count` dan
  // `nav_page_transition_pattern` dihitung dari populasi event yang BERBEDA saat
  // dilatih dan saat dipakai (kerabat C-17).
  // Semantiknya tidak bisa ditebak otomatis — "langkah" itu urusan aplikasi, bukan
  // DOM — jadi jalan yang jujur adalah menyediakan API eksplisit, bukan menebak dari
  // submit/pushState dan diam-diam salah.
  markStep(name){
    if(!this.capture) return;
    try{
      this.capture.buffer.push({event_type:'PAGE_STEP', page_url: (typeof location!=='undefined'?location.href:'')+(name?('#'+name):''), timestamp: Date.now()});
    }catch{}
  }
  // challenge API
  async setChallenge(samples){ // samples: [{dwell, flight}]
    this.challengeTemplate=buildTemplate(samples);
    await this._persist();
  }
  async verifyChallenge(sample){
    if(!this.challengeTemplate) return {ok:false, reason:'no template'};
    return verifyChallenge(sample, this.challengeTemplate);
  }
  // untuk evaluasi / reproduce: skor tanpa side-effect
  scoreVector(vec){
    if(!this.model || !this.stats) return {score:0, level:'LOW'};
    const xstd=standardize(vec, this.stats);
    const score=this.model.scoreOne(xstd);
    return {score, level: toRisk(score, this.cfg.thresholds)};
  }
  // mode collector: ambil vektor 34-fitur dari perilaku yang tertangkap SEKARANG,
  // tanpa skor lokal & tanpa mengosongkan buffer. Dipakai untuk dikirim ke backend.
  getVector(){
    if(!this.capture) return null;
    let events=dropExactDuplicates(this.capture.peek());
    if(!events.length) return null;
    // C-28: vektor untuk backend harus melewati praproses yang SAMA dengan penilaian
    // lokal, kalau tidak backend menerima besaran yang berbeda dari yang dinilai di sini.
    const cs=this.cfg.session.idleCompressSec;
    if(cs>0) events=compressIdle(events, cs*1000);
    const feat=extractF4(events);
    return { vector: featuresToVector(feat), features: feat, n: events.length };
  }
  /**
   * C-45: keadaan yang boleh ditampilkan integrator (halaman keamanan, lencana status).
   * Dulu satu-satunya jalan adalah getState(), yang membeberkan seluruh riwayat vektor dan
   * konfigurasi internal - bukan antarmuka, melainkan isi perut.
   */
  status(){
    const B=this.cfg.baseline;
    const eligible=this.sessions.filter(s=>s.eligible!==false).length;
    const graceMs=((this.cfg.mfa && this.cfg.mfa.graceSec) || 0)*1000;
    const graceLeft=this._mfaPassedAt ? Math.max(0, graceMs-(Date.now()-this._mfaPassedAt)) : 0;
    const e=this._lastEvt;
    return {
      version: VERSION,
      ready: !!this.inited, userId: this.userId,
      phase: !this.inited ? 'off' : (eligible < B ? 'learning' : 'protecting'),
      enrollment: { done: Math.min(eligible, B), need: B },
      risk: this.lastRisk,
      lastVerdict: e ? { level:e.level, action:e.action, score:e.score, blocked:!!e.blocked, at:e.at,
                         reasons:(e.reasons||[]).slice(0,3), mfa:e.mfa||null } : null,
      evidence: { buffered: this.capture ? this.capture.buffer.length : 0, need: this.cfg.session.minEventsAssess },
      // C-46: `enrollment` berhenti di baseline (10) dan tidak pernah bergerak lagi, padahal
      // mesinnya BELUM utuh di sana: gerbang ensemble membungkam detektor-2 (Mahalanobis,
      // bobot 0,70) sampai kolam latih mencapai `ensembleMinSamples.svm` = 20 vektor (C-15).
      // Antara 10 dan 20 jendela, sistem berjalan dengan Isolation Forest SENDIRIAN - dan
      // tidak ada satu pun keadaan yang bisa dilihat integrator untuk tahu itu. Sekarang ada.
      model: { trained: !!this.model, pool: this.model ? (this.model.n||0) : 0,
               mainDetector: !!(this.model && (this.model.n||0) >= this.cfg.ensembleMinSamples.svm),
               mainDetectorNeeds: this.cfg.ensembleMinSamples.svm },
      // C-46: `canEnroll` supaya halaman pengaturan tahu apakah tombol "atur verifikasi irama"
      // layak ditampilkan SEKARANG. Tanpa ini integrator hanya bisa menebak, lalu menampilkan
      // tombol yang setiap kali ditekan menjawab "sesi sedang dicurigai" - syarat C-2 yang
      // benar, tapi disampaikan di saat yang paling membingungkan bagi pengguna.
      mfa: { enabled: !!(this.cfg.mfa && this.cfg.mfa.enabled), enrolled: !!this.challengeTemplate,
             canEnroll: !!(this.inited && this.userId && typeof document!=='undefined' && !this.challengeTemplate
               && !this._mfaBusy && this.lastRisk==='LOW'
               && !(this._awayReturn && this._awayReturn.awayMs >= this.cfg.idle.reverifyAfterSec*1000)),
             mode: this.challengeTemplate ? (this.challengeTemplate.mode||'hard') : null,
             fallback: !!(this.cfg.mfa && typeof this.cfg.mfa.onFallback==='function'),
             verifiedAt: this._mfaPassedAt||null, graceLeftSec: Math.round(graceLeft/1000), busy: !!this._mfaBusy,
             failStreak: this._mfaFailStreak||0,
             locked: ((this.cfg.mfa && (this.cfg.mfa.lockAfterFailures ?? 3)) || 0) > 0 && (this._mfaFailStreak||0) >= ((this.cfg.mfa && (this.cfg.mfa.lockAfterFailures ?? 3)) || 0) },
      cloud: !!this.cloud,
    };
  }
  /**
   * C-45: LOGOUT. Dulu tidak ada cara berhenti selain menutup tab: sesudah pengguna keluar,
   * pustaka terus menangkap perilaku di halaman login dan terus menilai atas nama akun yang
   * sudah keluar. stop() membank ekor bukti milik pengguna ini, melepas semua penangkap,
   * menghentikan jam, dan MENCABUT masa berlaku step-up (login berikutnya adalah
   * autentikasi baru). Profil perilakunya tetap tersimpan - itu gunanya forget().
   */
  async stop(){
    if(!this.userId) return;
    const uid=this.userId;
    try{ this._bankTail(); }catch{}
    this._stopTimer();
    if(this.capture){ try{ this.capture.detach(); }catch{} this.capture=null; }
    this.inited=false;
    this._mfaPassedAt=null;
    try{ await this._persist(); }catch{}
    try{ const K=`bg:leader:${uid}`; const cur=JSON.parse(localStorage.getItem(K)||'null'); if(cur && cur.id===this.tabId) localStorage.removeItem(K); }catch{}
    this._resetUserState(); this.userId=null;
  }
  /**
   * Hak pengguna atas datanya (UU PDP / GDPR): hapus SEMUA yang disimpan pustaka ini
   * tentang pengguna di perangkat ini - profil perilaku, template irama, ekor bukti,
   * rahasia token. Pendaftaran mulai dari nol di kunjungan berikutnya.
   */
  async forget(){
    const uid=this.userId;
    if(!uid) return { removed:false };
    await this.clear();
    try{ await storage.del(`bg:secret:${uid}`); }catch{}
    try{ localStorage.removeItem(`bg:leader:${uid}`); }catch{}
    if(this.cloud) this._http('DELETE','/baseline');
    return { removed:true };
  }
  // untuk demo pemantau: expose
  getState(){ return {userId:this.userId, sessions:this.sessions, cfg:this.cfg, hasModel:!!this.model, thresholds: this.cfg.thresholds}; }
  // Satu daftar state per-pengguna, dipakai clear() (C-7) DAN init() (C-38) supaya
  // keduanya tidak bisa lagi menyimpang satu sama lain.
  _resetUserState(){
    this.sessions=[]; this.stats=null; this.model=null; this.lastRisk='LOW'; this._lowStreak=0;
    this._highRun=0; this.challengeTemplate=null; this._mfaPassedAt=null; this._mfaBusy=false;
    // C-23: keadaan idle/absen juga milik pengguna lama - jangan diwariskan.
    this._awayReturn=null; this._hiddenAt=null; this._lastEventAt=Date.now();
    this._noAssessRuns=0; this._abstainEmitted=false;
    this._aggBuf=[]; this._aggThresholds=null;   // C-24: bukti separuh terkumpul milik pengguna lama
    this._newSinceRebuild=0; this._mfaEnrollSnoozeUntil=0; this._stepUpFailures=0;
    this._pendingEvents=null; this._ctx=[];
    this._lastEvt=null; this._lastKeyAt=0; this._mfaFailStreak=0;
    // C-46: hitungan masukan sintetis KUMULATIF milik capture, dan init() memasang capture
    // BARU yang mulai dari nol. Kalau penanda ini tidak ikut direset, sesudah logout->login
    // `synthNew = max(0, 0 - nilai_lama)` = 0 sampai kunjungan baru melewati angka lama:
    // deteksi mati diam-diam persis di sesi yang paling mungkin diserang.
    this._synthSeen=0;
  }
  async clear(){
    // C-7: dulu challengeTemplate/_highRun/_mfaPassedAt tetap hidup di memori
    // setelah clear(), jadi template pengguna lama masih dipakai untuk memverifikasi
    // pengguna berikutnya di tab yang sama.
    this._resetUserState();
    await storage.del(ns(this.userId));
    try{ localStorage.removeItem(nsPending(this.userId)); localStorage.removeItem(LEGACY_PENDING); }catch{}
  }
}

// singleton global untuk loader 3-baris
const singleton=new BehaviorGuard();
// C-45: skrip yang dimuat DUA kali (tag manager + tag manual, atau dua bundel) dulu menimpa
// window.BehaviorGuard dengan singleton kedua - dua penangkap jalan bersamaan, dan init() yang
// dipanggil integrator mengenai instance yang berbeda dari yang memegang profil. Yang pertama
// dimuat yang dipakai; yang kedua diam.
if(typeof window!=='undefined' && window.BehaviorGuard && window.BehaviorGuard._instance){
  try{ console.warn('[BG] behaviorguard.js dimuat lebih dari sekali - salinan kedua diabaikan'); }catch{}
} else if(typeof window!=='undefined'){
  window.BehaviorGuard={
    version: VERSION,
    init: (opts)=> singleton.init(opts),
    endSession: ()=> singleton.endSession(),
    markStep: (name)=> singleton.markStep(name),
    reportStepUp: (r)=> singleton.reportStepUp(r),
    assessNow: (o)=> singleton.assessNow(o),
    stepUp: (o)=> singleton.stepUp(o),
    enrollMfa: ()=> singleton.enrollMfa(),
    forgetMfa: ()=> singleton.forgetMfa(),
    status: ()=> singleton.status(),
    stop: ()=> singleton.stop(),
    forget: ()=> singleton.forget(),
    setUserToken: (t)=> singleton.setUserToken(t),
    getVector: ()=> singleton.getVector(),
    // berlangganan vonis tanpa menimpa onRisk: BehaviorGuard.on('risk', fn) -> fungsi berhenti
    on: (name, fn)=>{
      if(name!=='risk' || typeof fn!=='function') return ()=>{};
      const h=e=>{ try{ fn(e.detail); }catch(err){ try{ console.error(err); }catch{} } };
      window.addEventListener('behaviorguard:risk', h);
      return ()=> window.removeEventListener('behaviorguard:risk', h);
    },
    _instance: singleton,
    // untuk reproduce/tools
    _core: { extractF4, IsolationForest, OCSVM, Ensemble, computeStats, standardize }
  };
}
return {BehaviorGuard: BehaviorGuard, singleton: singleton};
})();


/* ---- panel status bawaan (opsional, aktif via cfg.panel:true / data-panel) ----
   C-45: Shadow DOM (CSS situs tidak bisa merusaknya, CSP style-src aman), tanpa emoji,
   teks lewat textContent, progres pendaftaran dari evt.enrollment (bukan regex alasan). */
function __bgMountPanel(){
  if(document.querySelector('[data-bg-panel]')) return function(){};
  var host=document.createElement('div');
  host.setAttribute('data-bg-panel','');
  host.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483000';
  var root=host.attachShadow?host.attachShadow({mode:'open'}):host;
  var css=':host{all:initial}*{box-sizing:border-box}'+
    '.p{width:236px;font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fff;color:#141a24;'+
    'border:1px solid #e3e6eb;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,41,.14);overflow:hidden}'+
    '.h{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #eef0f3;font-weight:650;font-size:12.5px}'+
    '.h svg{width:15px;height:15px;color:#1f5fd6}.h b{flex:1;font-weight:650}'+
    '.d{width:8px;height:8px;border-radius:50%;background:#9aa3af}'+
    '.b{padding:11px 12px 12px}.l{font-size:17px;font-weight:700;letter-spacing:-.01em}'+
    '.s{color:#5b6573;font-size:12px;margin-top:2px}.r{color:#8a93a0;font-size:11.5px;margin-top:7px}'+
    '.bar{height:5px;border-radius:9px;background:#eef0f3;margin-top:9px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:#1f5fd6;transition:width .3s}'+
    '@media (prefers-color-scheme:dark){.p{background:#171b22;color:#e8ebf0;border-color:#2c323c}.h{border-color:#2c323c}.s{color:#9aa3af}.bar{background:#2c323c}}';
  try{ if(root.adoptedStyleSheets!==undefined && typeof CSSStyleSheet==='function'){ var sh=new CSSStyleSheet(); sh.replaceSync(css); root.adoptedStyleSheets=[sh]; } else throw 0; }
  catch(_){ var st=document.createElement('style'); st.textContent=css; root.appendChild(st); }
  var p=document.createElement('div'); p.className='p';
  p.innerHTML='<div class="h"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.3-2.9 8.1-7 9.5-4.1-1.4-7-5.2-7-9.5V6l7-3z"/></svg><b>BehaviorGuard</b><span class="d"></span></div>'+
    '<div class="b"><div class="l"></div><div class="s"></div><div class="bar" hidden><i></i></div><div class="r"></div></div>';
  root.appendChild(p);
  (document.body||document.documentElement).appendChild(host);
  var q=function(c){ return p.querySelector(c); };
  var L=q('.l'), S=q('.s'), R=q('.r'), D=q('.d'), BAR=q('.bar'), FILL=q('.bar i');
  L.textContent='Mengenali...'; S.textContent='menunggu aktivitas';
  var C={LOW:['#1a7f4b','Aman'],MEDIUM:['#b35c00','Perlu verifikasi'],HIGH:['#c4312b','Berisiko'],UNKNOWN:['#6b7380','Belum cukup bukti']};
  return function(e){
    if(e.enrollment){
      var k=e.enrollment.selesai, n=e.enrollment.perlu;
      D.style.background='#1f5fd6'; L.style.color='#1f5fd6';
      L.textContent='Mengenali '+k+'/'+n; S.textContent='membangun profil pemilik';
      BAR.hidden=false; FILL.style.width=Math.round(k/n*100)+'%';
      R.textContent= k>=n ? 'Profil siap. Jendela berikutnya dinilai.' : 'Butuh '+(n-k)+' jendela aktivitas lagi.';
      return;
    }
    var c=C[e.level]||C.UNKNOWN;
    BAR.hidden=true; D.style.background=c[0]; L.style.color=c[0];
    L.textContent=c[1];
    S.textContent=(e.action||'')+(e.score!=null&&isFinite(e.score)?' · skor '+e.score.toFixed(2):'');
    R.textContent=(e.reasons&&e.reasons.length)?e.reasons.slice(0,2).join(' · '):'';
  };
}

/* ---- auto-boot plug-and-play ---- */
try{
  var BG = window.BehaviorGuard;
  var S  = __CURRENT;
  var cfg = (window.BehaviorGuardConfig && typeof window.BehaviorGuardConfig==='object') ? window.BehaviorGuardConfig : {};
  var userId = cfg.userId || (S && (S.getAttribute('data-user') || S.getAttribute('data-user-id')));
  if(BG && userId){
    var cbName = cfg.callback || (S && S.getAttribute('data-callback'));
    var userOnRisk = (cbName && typeof window[cbName]==='function') ? window[cbName] : cfg.onRisk;
    var wantPanel = cfg.panel===true || (S && S.getAttribute('data-panel')!=null);
    var panelUpdate = null;
    var mount = function(){ if(wantPanel && !panelUpdate) panelUpdate=__bgMountPanel(); };
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', mount); else mount();
    var onRisk = function(e){
      try{ if(panelUpdate) panelUpdate(e); }catch(_){}
      if(typeof userOnRisk==='function'){ try{ userOnRisk(e); }catch(_){}}
      // C-45: event DOM `behaviorguard:risk` kini disiarkan oleh inti untuk SEMUA integrasi;
      // menyiarkannya lagi di sini membuat pendengar auto-boot menerima tiap vonis dua kali.
    };
    var opts = {userId:userId, onRisk:onRisk};
    // HYBRID cloud: pk (kunci tenant) + endpoint (VPS) -> baseline lintas-device + log verdict
    opts.pk       = cfg.pk       || (S && S.getAttribute('data-pk'))       || null;
    opts.endpoint = cfg.endpoint || (S && S.getAttribute('data-endpoint')) || null;
    // C-39: token pengguna berumur pendek dari server integrator; tanpa ini mode cloud mati
    opts.userToken = cfg.userToken || (S && S.getAttribute('data-user-token')) || null;
    // C-33: session/idle/calibration dulu TIDAK diteruskan -> integrator auto-boot tak bisa
    // mengatur titik operasi maupun ukuran bukti.
    ['weights','baseline','retrainEvery','features','thresholds','mfa','session','idle','calibration',
     'aggregateWindows','calibrationHoldout'].forEach(function(k){ if(cfg[k]!=null) opts[k]=cfg[k]; });
    BG.init(opts);
    // C-40: DULU di sini ada pagehide -> BG.endSession(). Pendengar ini terpasang SEBELUM
    // milik SDK (init() menunggu fingerprint dulu), jadi ia menguras buffer lebih dulu:
    // penilaian async-nya tak sempat selesai karena halaman mati, dan _bankTail milik SDK
    // mendapati buffer kosong -> bukti terakhir hilang (C-21 lewat pintu lain). SDK sudah
    // menangani pagehide sendiri secara sinkron.
  }
}catch(e){ try{ console.error('[BehaviorGuard boot]', e); }catch(_){} }
})();
