/* BehaviorGuard bundle - AUTO-GENERATED oleh tools/bundle.py. Jangan edit tangan. */
(function(){
'use strict';
var __CURRENT = document.currentScript;
var __M = {};

/* ---- core/config.js ---- */
__M["core/config.js"] = (function(){
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
  session: { minEventsAssess: 30, minEventsTrain: 100, minDurationSec: 5.0, minNonZeroFeatures: 6, windowSec: 30, idleGapSec: 30, idleCompressSec: 15, canonicalWindow: 0 },
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
 * features.js - ekstraksi 28 fitur F4 dari event mentah (on-device, deterministik)
 * Input: event[] {event_type, timestamp, x,y, key, hold_time, page_url, scroll_delta, ...}
 * Output: {featureName: float} lengkap 28, selalu finite
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
      if(lastDir!==null && Math.abs(dir-lastDir)>Math.PI/4) directionChanges++;
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
    cart_action_count: safe(events.filter(e=>e.event_type==='CART_ACTION').length)
  };
  // pastikan semua 28 ada & finite, urutan deterministik
  const res={}; F4.forEach(k=>res[k]=safe(out[k]||0));
  return res;
}

function featuresToVector(featObj){
  return F4.map(k=> featObj[k]||0);
}
return {F4: F4, extractF4: extractF4, featuresToVector: featuresToVector};
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
function calibrateThresholdsParametric(baselineScores, k_low=3.3, k_med_extra=0.6){
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
      click: e=> push({event_type:'MOUSE_CLICK', x:e.clientX, y:e.clientY, page_url: location.href}),
      scroll: e=> { const cur=window.scrollY; const delta=Math.abs(cur-lastScrollY); lastScrollY=cur; if(delta===0) return; push({event_type:'MOUSE_SCROLL', scroll_delta: delta, scroll_velocity: 0, page_url: location.href}); },
      kd: e=> downAt.set(e.code, Date.now()),
      ku: e=> { const t0=downAt.get(e.code); const hold=t0? Date.now()-t0 : 80; push({event_type:'KEYSTROKE', key:e.key, hold_time: hold, page_url: location.href}); },
      focus: e=> { try{ if(e.target && e.target.matches && e.target.matches('input,textarea,select,[contenteditable]')) push({event_type:'FORM_FOCUS', page_url: location.href}); }catch{} },
      blur: e=> { try{ if(e.target && e.target.matches && e.target.matches('input,textarea,select,[contenteditable]')) push({event_type:'FORM_BLUR', page_url: location.href}); }catch{} },
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
      paste: e=>{ try{
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
      cart: e=>{ try{ const t=e.target && e.target.closest && e.target.closest('[data-bg-cart], .add-to-cart, [data-cart]'); if(t) push({event_type:'CART_ACTION', page_url: location.href}); }catch{} }
    };
    // mousemove throttled: 1 per 50ms untuk cap volume
    let lastMove=0;
    const throttledMove=e=>{
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
    handlers.throttledTouch=e=>{ const now=Date.now(); if(now-lastMove < 50) return; lastMove=now; handlers.touch(e); };
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
  function drain(){ const c=[...buf]; buf.length=0; dropped=0; return c; }
  function peek(){ return [...buf]; }
  return { attach, detach, drain, peek, get buffer(){ return buf; }, get dropped(){ return dropped; } };
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
 * tetap 227/227 tanpa disentuh.
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
function splitForAssessment(segments, minEvents, nowTs, gapMs=GAP_MS_DEFAULT){
  const assess=[], dropped=[];
  let carry=null;
  segments.forEach((s,i)=>{
    if(s.events.length >= minEvents){ assess.push(s); return; }
    const isLast = i===segments.length-1;
    // ekor masih "hidup" bila event terakhirnya belum melewati ambang jeda
    if(isLast && (nowTs - s.endTs) < gapMs) carry=s;
    else dropped.push(s);
  });
  return { assess, carry, dropped };
}
return {GAP_MS_DEFAULT: GAP_MS_DEFAULT, AWAY_MS_DEFAULT: AWAY_MS_DEFAULT, groupByStream: groupByStream, segmentByIdle: segmentByIdle, compressIdle: compressIdle, idleAccounting: idleAccounting, classifyGap: classifyGap, splitForAssessment: splitForAssessment};
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
function buildTemplate(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const nD = samples[0] && Array.isArray(samples[0].dwell) ? samples[0].dwell.length : 0;
  const nF = samples[0] && Array.isArray(samples[0].flight) ? samples[0].flight.length : 0;
  if (nD < MIN_DWELL_POINTS) return null;
  // setiap sampel harus berbentuk sama & finit — kalau tidak, pendaftarannya cacat
  for (const s of samples) {
    if (!s || !isFiniteArray(s.dwell, nD) || !isFiniteArray(s.flight, nF)) return null;
  }
  const d = axis(samples, 'dwell');
  const f = axis(samples, 'flight');
  return {
    v: 2,
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

  for (let i = 0; i < nD; i++) {
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
  const checks = nD + nF;
  const budget = Math.max(1, Math.floor(MISS_BUDGET_REL * checks));
  return { ok: reasons.length <= budget, reasons, checks, misses: reasons.length, budget };
}
return {MIN_DWELL_POINTS: MIN_DWELL_POINTS, buildTemplate: buildTemplate, verify: verify};
})();

/* ---- core/mfa.js ---- */
__M["core/mfa.js"] = (function(){
/**
 * mfa.js - MFA behavioral BAWAAN (popup dari library).
 *
 * Dipicu otomatis saat vonis MEDIUM (REQUIRE_MFA) / HIGH (REQUIRE_STEPUP) bila
 * cfg.mfa.enabled. User diminta MENGETIK ULANG frasa-rahasianya; identitas
 * dibuktikan dari RITME ketik (dwell/flight per posisi) lewat challenge.js.
 * NOL dependensi, NOL backend, murni on-device.
 *
 * CATATAN KEJUJURAN: verifikasi client-side = re-autentikasi step-up yang nyaman,
 * BUKAN faktor kedua kelas-keamanan. Attacker yang menguasai browser bisa melewati
 * cek client-only. Untuk keamanan sungguhan, verifikasi ritme sebaiknya juga
 * diulang di server (kirim sample ke endpoint) atau gabung faktor eksternal.
 *
 * API: runMfaChallenge({ phrase, template, rounds, buildTemplate, verify, title })
 *  -> Promise<{ passed, enrolled?, template?, reasons?, cancelled? }>
 *   - template null  -> mode DAFTAR: ketik `rounds`x -> kembalikan {enrolled:true, template}
 *   - template ada   -> mode VERIFIKASI: ketik 1x -> {passed, reasons}
 */

function norm(s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

// Rekam dwell (keydown->keyup) & flight (keyup->keydown berikut) per karakter tampak.
function attachCapture(input, onDone, expectedLen) {
  let downAt = null, lastUp = null, tainted = false;
  const dwell = [], flight = [];
  function reset() { downAt = null; lastUp = null; dwell.length = 0; flight.length = 0; tainted = false; }

  // C-1: jalur masuk yang TIDAK menghasilkan ritme harus diblokir di sumbernya.
  // Tanpa ini, menempel frasa memberi teks yang benar dengan nol event ketik.
  for (const evt of ['paste', 'drop', 'cut']) {
    input.addEventListener(evt, (e) => {
      e.preventDefault();
      tainted = true;
      input.value = ''; reset();
      if (input._bgOnTaint) input._bgOnTaint(evt);
    });
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); return; }
    // Ctrl+V / Cmd+V: 'v' lolos filter panjang-1 dan tercatat sebagai satu dwell
    // palsu. Abaikan setiap penekanan bermodifier.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return;            // abaikan modifier/nav
    const t = performance.now();
    if (lastUp != null) flight.push(t - lastUp);
    downAt = t;
  });
  input.addEventListener('keyup', (e) => {
    if (e.key === 'Backspace' || e.key === 'Delete') { reset(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1 || downAt == null) return;
    const t = performance.now();
    dwell.push(t - downAt);
    lastUp = t;
  });
  input._bgSample = () => ({ dwell: dwell.slice(), flight: flight.slice() });
  input._bgReset = reset;
  // Sampel sah hanya bila SETIAP karakter di kolom berasal dari ketikan dan
  // tidak pernah ada tempel. Dibandingkan dengan isi kolom (bukan panjang frasa)
  // supaya beda spasi tidak salah-tolak. Dicek sebelum verify(), bukan
  // dipercayakan padanya.
  input._bgIntact = () => {
    const n = input.value.length;
    return !tainted && n > 0 && dwell.length === n && flight.length === n - 1;
  };
  input._bgCounts = () => ({ dwell: dwell.length, flight: flight.length, tainted });
}

function overlay() {
  const wrap = document.createElement('div');
  wrap.setAttribute('data-bg-mfa', '');
  wrap.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(15,18,26,.55);backdrop-filter:blur(3px);' +
    'font:14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0d1117';
  const card = document.createElement('div');
  card.style.cssText =
    'background:#fff;color:#0d1117;max-width:380px;width:calc(100% - 40px);' +
    'border-radius:14px;padding:22px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.35);' +
    'border:1px solid rgba(0,0,0,.08)';
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    card.style.background = '#161b22'; card.style.color = '#e6edf3';
    card.style.border = '1px solid #30363d';
  }
  wrap.appendChild(card);
  return { wrap, card };
}

function runMfaChallenge(opts) {
  const {
    phrase, template = null, rounds = 3, buildTemplate, verify,
    title = 'Verifikasi keamanan',
    // C-18: TANPA batas waktu, popup yang diabaikan membuat Promise ini tidak
    // pernah selesai -> `endSession()` menggantung selamanya, dan `_mfaBusy`
    // tidak pernah direset sehingga SELURUH lapisan step-up mati untuk sisa
    // hidup halaman. Terlihat di uji live: satu popup terlantar di sesi 11
    // mematikan MFA untuk semua sesi sesudahnya.
    timeoutMs = 120000,
  } = opts;
  if (typeof document === 'undefined') {
    return Promise.resolve({ passed: false, cancelled: true, reason: 'no-dom' });
  }
  const enrollMode = !template;
  const need = enrollMode ? rounds : 1;
  const samples = [];

  return new Promise((resolve) => {
    const { wrap, card } = overlay();
    const muted = card.style.color === '#e6edf3' ? '#8b949e' : '#57606a';
    const accent = '#2563eb';
    card.innerHTML =
      `<div style="font-weight:700;font-size:16px;margin-bottom:4px">${title}</div>` +
      `<div id="bg-sub" style="color:${muted};margin-bottom:14px;line-height:1.45"></div>` +
      `<div style="font-weight:600;letter-spacing:.3px;padding:9px 12px;border-radius:8px;` +
      `background:${muted}1a;margin-bottom:10px;user-select:none">${phrase}</div>` +
      `<input id="bg-inp" type="text" autocomplete="off" autocapitalize="off" ` +
      `spellcheck="false" style="width:100%;box-sizing:border-box;padding:10px 12px;` +
      `border-radius:8px;border:1.5px solid ${muted}55;background:transparent;color:inherit;` +
      `font:inherit;outline:none" placeholder="ketik frasa di atas..."/>` +
      `<div id="bg-msg" style="min-height:18px;font-size:12.5px;margin:8px 2px 12px"></div>` +
      `<div style="display:flex;gap:8px;justify-content:flex-end">` +
      `<button id="bg-cancel" style="padding:8px 14px;border-radius:8px;border:1px solid ${muted}55;` +
      `background:transparent;color:inherit;cursor:pointer">Batal</button>` +
      `<button id="bg-ok" style="padding:8px 16px;border-radius:8px;border:0;background:${accent};` +
      `color:#fff;font-weight:600;cursor:pointer">Lanjut</button></div>`;
    document.body.appendChild(wrap);

    const inp = card.querySelector('#bg-inp');
    const sub = card.querySelector('#bg-sub');
    const msg = card.querySelector('#bg-msg');
    const okBtn = card.querySelector('#bg-ok');
    attachCapture(inp, null, phrase.length);
    inp.focus();

    const setSub = () => {
      sub.textContent = enrollMode
        ? `Atur frasa keamananmu — ketik ${rounds}× dengan ritme alamimu (${samples.length + 1}/${rounds}).`
        : 'Sesi ini tak lazim. Ketik ulang frasa keamananmu untuk melanjutkan.';
    };
    setSub();

    let killTimer = null;
    function finish(result) {
      if (killTimer) { clearTimeout(killTimer); killTimer = null; }
      wrap.remove();
      resolve(result);
    }
    if (timeoutMs > 0) {
      killTimer = setTimeout(function () {
        finish({ passed: false, enrolled: false, verified: false,
                 cancelled: true, timedOut: true });
      }, timeoutMs);
    }
    let failedAttempts = 0;
    const MAX_ATTEMPTS = 3;

    function submit() {
      if (norm(inp.value) !== norm(phrase)) {
        msg.style.color = '#d1242f'; msg.textContent = 'Teks tidak cocok — ketik persis frasanya.';
        inp.value = ''; inp._bgReset(); inp.focus(); return;
      }
      // C-1: teks benar TIDAK cukup. Setiap karakter harus datang dari ketikan.
      // Tempel/autofill/isi sebagian berhenti di sini dan tidak pernah mencapai verify().
      if (!inp._bgIntact()) {
        const c = inp._bgCounts();
        msg.style.color = '#d1242f';
        msg.textContent = c.tainted
          ? 'Menempel tidak diterima — ketik frasanya secara manual.'
          : 'Ritme tidak terekam utuh — ketik ulang tanpa menempel.';
        inp.value = ''; inp._bgReset(); inp.focus();
        return;
      }
      const sample = inp._bgSample();
      if (enrollMode) {
        samples.push(sample);
        inp.value = ''; inp._bgReset();
        if (samples.length >= need) {
          const tmpl = buildTemplate(samples);
          if (!tmpl) {
            // frasa terlalu pendek / sampel tidak konsisten -> jangan simpan template lemah
            finish({ passed: false, enrolled: false, verified: false, reason: 'template-ditolak' });
            return;
          }
          // PENDAFTARAN BUKAN BUKTI IDENTITAS: verified sengaja false.
          finish({ passed: true, enrolled: true, verified: false, template: tmpl });
        } else { setSub(); msg.style.color = muted; msg.textContent = 'Bagus. Sekali lagi.'; inp.focus(); }
      } else {
        const res = verify(sample, template);
        if (res.ok) { finish({ passed: true, enrolled: false, verified: true, reasons: res.reasons || [] }); return; }
        failedAttempts++;
        if (failedAttempts >= MAX_ATTEMPTS) {
          finish({ passed: false, enrolled: false, verified: false, reasons: res.reasons || [], attemptsExhausted: true });
          return;
        }
        inp.value = ''; inp._bgReset();
        msg.style.color = '#d1242f';
        msg.textContent = `Ritme tidak cocok (percobaan ${failedAttempts}/${MAX_ATTEMPTS}).`;
        inp.focus();
      }
    }
    okBtn.onclick = submit;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    card.querySelector('#bg-cancel').onclick = () => finish({ passed: false, enrolled: false, verified: false, cancelled: true });
  });
}
return {runMfaChallenge: runMfaChallenge};
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
  // non-monoton
  for(let i=1;i<ts.length;i++) if(ts[i] < ts[i-1]-5){ reasons.push('timestamp non-monoton'); break; }
  const intervals=[];
  for(let i=1;i<ts.length;i++) intervals.push(ts[i]-ts[i-1]);
  const mean = intervals.reduce((a,b)=>a+b,0)/intervals.length;
  const std = Math.sqrt(intervals.reduce((a,b)=>a+(b-mean)**2,0)/intervals.length);
  // A1: cek interval hanya sahih pada aliran yang TIDAK kita throttle.
  if(!throttledStream && std < 3) reasons.push(`interval konstan std=${std.toFixed(2)}ms`);
  const holds = evs.filter(e=>e.hold_time!=null).map(e=>e.hold_time);
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
  if(dup>5) reasons.push(`timestamp duplikat ${dup}`);
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
async function getFingerprint(){
  // B2: `screen.width x screen.height` DULU ikut jadi sidik. Colok monitor eksternal
  // -> sidik berubah -> behaviorguard.js memaksa lastRisk='MEDIUM', dan lantai lengket
  // menahannya sampai tiga sesi LOW berturut. Colok monitor bukan ganti perangkat.
  // Resolusi adalah KONTEKS (ia menggeser skala kecepatan, lihat A2), bukan identitas
  // mesin — jadi ia keluar dari sini dan ditangani sebagai konteks.
  const parts=[
    navigator.userAgent,
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
  const buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
}
return {getFingerprint: getFingerprint};
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
async function getOrCreateSecret(userId){
  const key = `bg:secret:${userId}`;
  // S1 fix: secret disimpan via storage seal (HMAC), bukan plaintext localStorage
  try{ const {storage}=await import('../storage.js'); const v=await storage.get(key); if(v) return v; const raw=crypto.getRandomValues(new Uint8Array(32)); const s=btoa(String.fromCharCode(...raw)); await storage.set(key,s); return s; }catch{ return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))); }
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
// enkripsi ringan: XOR + base64 + HMAC (anti-tamper)
async function hmacKey(k){ const hk=await crypto.subtle.importKey('raw', new TextEncoder().encode(k.slice(0,16).padEnd(16,'0')), {name:'HMAC',hash:'SHA-256'}, false, ['sign']); return hk; }
async function seal(obj, keyHint='bg-key'){
  const json=JSON.stringify(obj);
  const b64=btoa(unescape(encodeURIComponent(json)));
  const hk=await hmacKey(keyHint);
  const sig=await crypto.subtle.sign('HMAC', hk, new TextEncoder().encode(b64));
  const hex=Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
  return `${hex}:${b64}`;
}
async function open(sealed, keyHint='bg-key'){
  try{
    const [hex,b64]=sealed.split(':');
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
        toSave={...v, sessions: slim.length>90 ? slim.slice(-90) : slim};
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
const { computeStats, standardize, standardizeBatch } = __M["core/standardize.js"];
const { IsolationForest } = __M["core/isolation_forest.js"];
const { OCSVM } = __M["core/ocsvm.js"];
const { Mahalanobis } = __M["core/mahalanobis.js"];
const { Ensemble } = __M["core/ensemble.js"];
const { toRisk, toAction, topFeatures, reasonsFrom, calibrateThresholds, calibrateThresholdsParametric } = __M["core/risk.js"];
const { createCapture } = __M["core/capture.js"];
const { segmentByIdle, idleAccounting, splitForAssessment, classifyGap, groupByStream, compressIdle } = __M["core/idle.js"];
const { storage } = __M["storage.js"];
const { isConverged, cohortLowRate } = __M["core/lifecycle.js"];
const { getOrCreateSecret, generateToken } = __M["core/token.js"];
const { checkIntegrity } = __M["core/integrity.js"];
const { getFingerprint } = __M["core/fingerprint.js"];
const { checkCollect } = __M["core/ratelimit.js"];
const { buildTemplate, verify: verifyChallenge } = __M["core/challenge.js"];
const { runMfaChallenge } = __M["core/mfa.js"];

const ns = id => `bg:${id}`;
// A4: `bg:pending` DULU kunci GLOBAL, tidak seperti sesi yang sudah ber-ruang-nama.
// Akibatnya di browser bersama: pengguna A menutup halaman -> ekornya tersimpan ->
// pengguna B login -> init() membaca pending itu tanpa memeriksa pemiliknya ->
// perilaku A dinilai, dan bisa ikut MELATIH, sebagai B. Itu peracunan baseline
// lintas-akun, bukan sekadar derau. Kunci lama ikut dibersihkan sekali saat init.
const nsPending = id => `bg:pending:${id}`;
const LEGACY_PENDING = 'bg:pending';

class BehaviorGuard {
  constructor(){ this.cfg=structuredClone(DEFAULTS); this.userId=null; this.onRisk=null; this.capture=null; this.model=null; this.stats=null; this.sessions=[]; this.inited=false; this.lastRisk='LOW'; this.fingerprint=null; this.secret=null; this.challengeTemplate=null; }
  async init({userId, onRisk, storage: storageOpt, weights, baseline, retrainEvery, features, thresholds, pk, endpoint, mfa, session, idle, aggregateWindows, calibrationHoldout}={}){
    if(!userId) throw new Error('BehaviorGuard.init: userId wajib');
    this.userId=userId; this.onRisk=onRisk||(()=>{});
    // HYBRID cloud mode: baseline per tenant+userId hidup di VPS (lintas-device),
    // event mentah TETAP di device. Aktif kalau pk+endpoint diisi.
    this.pk=pk||null; this.endpoint=endpoint?endpoint.replace(/\/+$/,''):null; this.cloud=!!(this.pk&&this.endpoint);
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
    // C-23: sama pola dengan `mfa` — digabung, bukan ditimpa, supaya konfigurasi
    // parsial ({idleGapSec:60}) tetap mewarisi sisa default.
    if(session && typeof session==='object') this.cfg.session={...this.cfg.session, ...session};
    if(idle && typeof idle==='object') this.cfg.idle={...this.cfg.idle, ...idle};
    // C-24: ketiga knob invariansi panjang sesi. Default 0/1 = perilaku lama persis.
    if(Number.isFinite(aggregateWindows)) this.cfg.aggregateWindows=aggregateWindows;
    if(Number.isFinite(calibrationHoldout)) this.cfg.calibrationHoldout=calibrationHoldout;
    // fingerprint + secret + token (HMAC)
    try{ this.fingerprint=await getFingerprint(); }catch{ this.fingerprint='unknown'; }
    try{ this.secret=await getOrCreateSecret(userId); this.token=await generateToken({secret:this.secret, userId}); }catch{}
    const saved=await storage.get(ns(userId));
    if(saved){ this.sessions=saved.sessions||[]; this.stats=saved.stats||null; this.lastRisk=saved.lastRisk||'LOW'; this._highRun=saved.highRun||0; this.challengeTemplate=saved.challengeTemplate||null;
      // cek ganti device
      if(saved.fingerprint && saved.fingerprint!==this.fingerprint){
        console.warn('[BG] device fingerprint berubah - sesi dianggap berisiko');
        this.lastRisk='MEDIUM';
      }
    }
    // R4: jika ada ekor yang kesimpen pas beforeunload sebelumnya, pulihkan ke buffer
    try{
      // A4: buang sisa kunci global lama — pemiliknya tak bisa dipastikan, jadi
      // satu-satunya perlakuan yang aman adalah membuangnya, bukan menebak.
      try{ localStorage.removeItem(LEGACY_PENDING); }catch{}
      const pending=JSON.parse(localStorage.getItem(nsPending(userId))||'null');
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
          const chunk=pending.slice(0,200);
          const sisa=pending.slice(200);
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
  // C-23: satu-satunya sumber kebenaran "kapan pengguna terakhir memberi input".
  // Jeda antar-input yang melewati `idle.awaySec` dicatat sebagai ABSEN; input
  // berikutnya sesudah itu adalah KEMBALI dari absen — dan orang yang kembali
  // belum tentu orang yang pergi.
  _onCaptureEvent(e){
    const ts=e&&e.timestamp || Date.now();
    const prev=this._lastEventAt;
    this._lastEventAt=ts;
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
      const cur=JSON.parse(localStorage.getItem(K)||'null');
      if(!cur || !cur.ts || now-cur.ts > TTL || cur.id===this.tabId){
        localStorage.setItem(K, JSON.stringify({id:this.tabId, ts:now}));
        return true;
      }
      return false;
    }catch{ return true; }   // tanpa localStorage, anggap tab tunggal
  }
  _wireAuto(){
    if(this._wired) return; this._wired=true;
    this._autoTimer=setInterval(()=>{
      // Tab pengikut tetap MENANGKAP (ekornya dibank dan diambil nanti), hanya tidak
      // menilai — jadi datanya tidak hilang, cuma tidak ada dua penulis bersamaan.
      if(!this._isLeader()){ this._bankTail(); return; }
      this.endSession().catch(()=>{});
    }, this.cfg.session.windowSec*1000);
    try{
      const self=this;
      document.addEventListener('visibilitychange', ()=>{
        if(document.visibilityState!=='hidden'){
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
      window.addEventListener('pagehide', ()=>{ try{ self._bankTail(); clearInterval(self._autoTimer); }catch{} });
      window.addEventListener('beforeunload', ()=>{ try{ self._bankTail(); clearInterval(self._autoTimer); }catch{} });
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
  _trainingVectors(){
    // K6 + T1: hanya sesi eligible yang masuk kolam (gagal gate tidak latih)
    const isEligible=s=> s.eligible!==false;
    if(this.sessions.length <= this.cfg.baseline) return this.sessions.filter(isEligible).map(s=>s.vector);
    const base=this.sessions.slice(0, this.cfg.baseline).filter(isEligible).map(s=>s.vector);
    // TRUST-LOOP: sesi LOW normal ATAU sesi non-LOW yang LOLOS MFA (mfaVerified) boleh
    // masuk kolam. Sesi menyimpang yang belum terbukti pemilik -> TIDAK pernah melatih
    // (anti-peracunan baseline + adaptasi drift pemilik yang aman).
    let lows=this.sessions.slice(this.cfg.baseline).filter(s=>(s.risk==='LOW' || s.mfaVerified) && isEligible(s)).map(s=>s.vector);
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
      const r=await fetch(this.endpoint+path, {method, headers:{'Content-Type':'application/json','Authorization':'Bearer '+this.pk}, body: body?JSON.stringify(body):undefined, keepalive:true});
      if(!r.ok) return null;
      return await r.json().catch(()=>null);
    }catch{ return null; }
  }
  async _cloudPull(){
    if(!this.cloud) return;
    const res=await this._http('GET','/baseline?u='+encodeURIComponent(this.userId));
    if(res && Array.isArray(res.vectors) && res.vectors.length){
      const localEligible=this.sessions.filter(s=>s.eligible!==false).length;
      // server = sumber kebenaran baseline lintas-device; adopsi bila >= lokal
      if(res.vectors.length >= localEligible){
        this.sessions=res.vectors.map(v=>({vector:v, feat:null, ts:Date.now(), risk:'LOW', score:0, eligible:true}));
      }
    }
  }
  _cloudPush(){
    // kirim VEKTOR FITUR teragregasi (bukan event mentah) sebagai baseline akun
    if(!this.cloud) return;
    const vectors=this._trainingVectors();
    if(!vectors.length) return;
    this._http('POST','/baseline',{userId:this.userId, vectors});
  }
  _cloudLog(evt){
    if(!this.cloud || !evt) return;
    this._http('POST','/log',{userId:this.userId, level:evt.level, score:evt.score, action:evt.action, reasons:evt.reasons,
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
      try{ this.onRisk(rlEvt); }catch{}
      return rlEvt;
    }
    // integrity (bot/replay) - jika events tersedia
    if(events){
      const integ=checkIntegrity(events, {throttled:true});
      if(integ.suspected){
        const evt={...M, level:'HIGH', score:-1.5, action:'BLOCK_SESSION', reasons:integ.reasons, topFeatures:[], features: feat, thresholds: {...this.cfg.thresholds}, eligible:false, integrity:true};
        this.sessions.push({vector: vec, feat, ts: Date.now(), risk:'HIGH', score:-1.5, eligible:false});
        await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:'HIGH'});
        this._cloudLog(evt);
        try{ this.onRisk(evt); }catch{}
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
      await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:'LOW'});
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
      try{ this.onRisk(enrollEvt); }catch{}
      return enrollEvt;
    }
    if(!this.model) this._rebuildModel();
    const xstd=standardize(vec, this.stats);
    let score=this.model.scoreOne(xstd);
    // C-5: toRisk() memakai `score <= thr`; untuk NaN itu SELALU false -> 'LOW'.
    // Skor rusak karena itu gagal-TERBUKA. Perlakukan sebagai anomali, bukan aman.
    if(!Number.isFinite(score)){
      const badEvt={...M, level:'HIGH', score:null, action:'REQUIRE_STEPUP', blocked:false,
        reasons:['skor tidak finit - model/statistik rusak'], topFeatures:[], features: feat,
        thresholds: {...this.cfg.thresholds}, eligible:false, degraded:true};
      this.sessions.push({vector: vec, feat, ts: Date.now(), risk:'HIGH', score:null, eligible:false});
      await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:this.lastRisk, highRun:this._highRun, challengeTemplate:this.challengeTemplate});
      this._cloudLog(badEvt);
      try{ this.onRisk(badEvt); }catch{}
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
        try{ this.onRisk(pend); }catch{}
        return pend;
      }
      aggMembers=this._aggBuf; this._aggBuf=[];
      score=aggMembers.reduce((a,b)=>a+b.score,0)/aggMembers.length;
    }
    // Ambang agregat dipakai HANYA kalau vonisnya memang agregat.
    const usedThresholds = (aggMembers && this._aggThresholds) ? this._aggThresholds : this.cfg.thresholds;
    let level=toRisk(score, usedThresholds);
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
    if(reverifyAfterAway) reasons=[`kembali setelah absen ${Math.round(awayInfo.awayMs/60000)} menit (${awayInfo.reason}) - verifikasi ulang`, ...reasons];
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
      resumedAfterAway: awayInfo, reverifyAfterAway,
      // topFeatures/features berasal dari jendela TERAKHIR; skornya dari rata-rata M.
      aggregated: aggMembers ? {windows: aggMembers.length} : null,
      partialEvidence: M.keystrokeBypassed ? 'keystroke' : null};
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
    const lowsCount=trainVecs.length - this.cfg.baseline;
    const shouldRetrain = lowsCount>0 && lowsCount % this.cfg.retrainEvery === 0;
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
    await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:this.lastRisk, highRun:this._highRun, challengeTemplate:this.challengeTemplate});
    // R2: HAPUS push own non-LOW ke bg:cohort - cohort harus seed dari luar (reproduce_db), bukan diri sendiri
    this._cloudLog(evt);                    // verdict -> VPS (dashboard per akun)
    if(shouldRetrain && level==='LOW') this._cloudPush(); // baseline tumbuh (hanya LOW) -> sinkron ke VPS
    // MFA behavioral BAWAAN: popup step-up sebelum kabari integrator (evt diperbarui hasil MFA)
    await this._maybeMfa(evt);          // verifikasi: vonis bergantung hasilnya, jadi ditunggu
    // C-18: pendaftaran template TIDAK ditunggu. Ini prompt penyiapan di sesi
    // LOW yang tenang, bukan bagian dari vonis; menunggunya berarti `endSession()`
    // baru selesai setelah pengguna mengetik frasa 3x — dan tidak pernah selesai
    // kalau popupnya diabaikan.
    this._maybeEnrollMfa(evt).catch(()=>{});
    try{ this.onRisk(evt); }catch{}
    return evt;
  }

  // Popup MFA otomatis saat vonis MEDIUM/HIGH (bila cfg.mfa.enabled & ada DOM).
  // Pertama kali -> DAFTAR frasa (ketik 3x). Selanjutnya -> VERIFIKASI ritme.
  async _maybeMfa(evt){
    const m=this.cfg.mfa;
    if(!m || !m.enabled || typeof document==='undefined') return;
    if(!m.triggerOn.includes(evt.level) || this._mfaBusy) return;
    // C-2: TIDAK PERNAH mendaftarkan template saat sesi sedang dicurigai.
    // Versi lama memanggil runMfaChallenge dengan template=null -> mode DAFTAR,
    // sehingga penyusup di perangkat baru (storage kosong) cukup mengetik frasa
    // 3x untuk MEMBUAT template miliknya sendiri, lalu dinyatakan "MFA_PASSED",
    // _highRun direset, dan sesinya masuk kolam latih. Itu jalur ATO utuh.
    // Pendaftaran kini hanya terjadi di sesi TEPERCAYA (lihat _maybeEnrollMfa).
    if(!this.challengeTemplate){
      evt.mfa={ shown:false, unavailable:'belum ada template ritme (pendaftaran hanya di sesi LOW tepercaya)' };
      return;                                   // gagal-tertutup: aksi risiko tetap berlaku
    }
    const now=Date.now();
    if(m.cooldownMs && this._mfaPassedAt && now-this._mfaPassedAt < m.cooldownMs){ evt.mfa={skipped:'cooldown'}; return; }
    this._mfaBusy=true;
    try{
      const res=await runMfaChallenge({
        phrase: m.phrase, rounds: m.rounds,
        template: this.challengeTemplate,
        buildTemplate, verify: verifyChallenge,
        title: evt.level==='HIGH' ? 'Verifikasi keamanan — sesi berisiko' : 'Verifikasi cepat',
        timeoutMs: m.timeoutMs,
      });
      evt.mfa={ shown:true, passed:!!res.passed, verified:!!res.verified, cancelled:!!res.cancelled,
                attemptsExhausted:!!res.attemptsExhausted, reasons:res.reasons||[] };
      // Hanya VERIFIKASI sungguhan (res.verified) yang membuktikan identitas.
      // res.passed sendirian bisa berasal dari mode daftar -> tidak cukup.
      if(res.verified){
        this._mfaPassedAt=now; this._highRun=0;
        this.lastRisk='LOW'; this._lowStreak=0;   // C-3: bersihkan lantai lengket,
                                                  // kalau tidak sesi berikutnya dipaksa HIGH terus
        evt.action='MFA_PASSED'; evt.blocked=false; evt.mfaVerified=true;
        // TRUST-LOOP: hanya sesi terverifikasi yang boleh mengajari model.
        const last=this.sessions[this.sessions.length-1];
        if(last){ last.mfaVerified=true; this._rebuildModel(); }
      } else {
        evt.action = evt.blocked ? 'BLOCK_SESSION' : 'MFA_FAILED';
      }
      await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:this.lastRisk, highRun:this._highRun, challengeTemplate:this.challengeTemplate});
    }catch(e){ evt.mfa={ shown:true, error:String(e&&e.message||e) }; }
    finally{ this._mfaBusy=false; }
  }

  // Pendaftaran template ritme HANYA di sesi tepercaya: vonis LOW, model sudah
  // terbentuk, dan belum pernah punya template. Ini pasangan dari C-2 — kalau
  // pendaftaran tidak pernah terjadi di sini, MFA tidak akan pernah tersedia.
  async _maybeEnrollMfa(evt){
    const m=this.cfg.mfa;
    if(!m || !m.enabled || typeof document==='undefined') return;
    if(this.challengeTemplate || this._mfaBusy) return;
    if(evt.level!=='LOW' || evt.eligible===false || !this.model) return;
    this._mfaBusy=true;
    try{
      const res=await runMfaChallenge({
        phrase: m.phrase, rounds: m.rounds,
        template: null,                          // mode DAFTAR, di saat yang aman
        buildTemplate, verify: verifyChallenge,
        title: 'Atur verifikasi keamanan',
        timeoutMs: m.enrollTimeoutMs,
      });
      if(res.enrolled && res.template){
        this.challengeTemplate=res.template;
        evt.mfa={ enrolled:true, verified:false };
        await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:this.lastRisk, highRun:this._highRun, challengeTemplate:this.challengeTemplate});
      } else {
        evt.mfa={ enrolled:false, reason:res.reason||'dibatalkan' };
      }
    }catch(e){ evt.mfa={ enrolled:false, error:String(e&&e.message||e) }; }
    finally{ this._mfaBusy=false; }
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
   * rumus fiturnya (core/SPEC.md) tidak disentuh, jadi golden tetap 227/227.
   *
   * Versi lama: `drain()` dulu MEMBUANG buffer < minEventsAssess tanpa jejak. Dua
   * akibatnya sekaligus diperbaiki di sini — ekor yang masih hidup dikembalikan ke
   * buffer supaya bisa tumbuh (bukan dibuang tiap 30 detik), dan jendela yang tak
   * menghasilkan vonis tidak lagi diam-diam berlalu (lihat `_maybeAbstain`).
   */
  async _assessEvents(events, carryBack){
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
    const {assess, carry, dropped}=splitForAssessment(segs, S.minEventsAssess, Date.now(), gapMs);
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
    for(const seg of assess){
      // acct.segments = jumlah rentetan AKTIF di batch. Di jalur segmen sama dengan
      // segs.length; di jalur kompresi C-28 segs selalu 1, tapi telemetri tetap harus
      // bilang ada berapa rentetan yang dinilai jadi satu.
      for(const win of this._canonicalize(seg)) last=await this._assessSegment(win, acct, acct.segments);
    }
    return last;
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
    const nKey=events.reduce((n,e)=> n+(e.event_type==='KEYSTROKE'?1:0), 0);
    const nPaste=events.reduce((n,e)=> n+(e.event_type==='PASTE'?1:0), 0);
    const nFocus=events.reduce((n,e)=> n+(e.event_type==='FORM_FOCUS'?1:0), 0);
    const keystrokeBypassed = nPaste>0 || (nFocus>0 && nKey===0);
    // Sesi yang blok keystroke-nya dialihkan TIDAK PERNAH melatih: kedelapan fiturnya
    // nol secara STRUKTURAL — karena memang tidak ada yang diketik — bukan karena
    // begitulah cara orang ini mengetik. Melatihkannya menarik baseline ke arah
    // "tidak pernah mengetik", dan itu justru MELEBARKAN jalan bagi penyusup yang
    // memakai autofill untuk menghapus jejak ritmenya.
    const passesGate = !keystrokeBypassed && events.length>=S.minEventsTrain && durationSec>=S.minDurationSec && nonZero>=S.minNonZeroFeatures;
    const meta={ keystrokeBypassed, idle: {
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
    try{ this.onRisk(evt); }catch{}
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
    await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:this.lastRisk, highRun:this._highRun, challengeTemplate:this.challengeTemplate});
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
  // mode collector: ambil vektor 28-fitur dari perilaku yang tertangkap SEKARANG,
  // tanpa skor lokal & tanpa mengosongkan buffer. Dipakai untuk dikirim ke backend.
  getVector(){
    if(!this.capture) return null;
    let events=this.capture.peek();
    if(!events.length) return null;
    // C-28: vektor untuk backend harus melewati praproses yang SAMA dengan penilaian
    // lokal, kalau tidak backend menerima besaran yang berbeda dari yang dinilai di sini.
    const cs=this.cfg.session.idleCompressSec;
    if(cs>0) events=compressIdle(events, cs*1000);
    const feat=extractF4(events);
    return { vector: featuresToVector(feat), features: feat, n: events.length };
  }
  // untuk demo pemantau: expose
  getState(){ return {userId:this.userId, sessions:this.sessions, cfg:this.cfg, hasModel:!!this.model, thresholds: this.cfg.thresholds}; }
  async clear(){
    // C-7: dulu challengeTemplate/_highRun/_mfaPassedAt tetap hidup di memori
    // setelah clear(), jadi template pengguna lama masih dipakai untuk memverifikasi
    // pengguna berikutnya di tab yang sama.
    this.sessions=[]; this.stats=null; this.model=null; this.lastRisk='LOW'; this._lowStreak=0;
    this._highRun=0; this.challengeTemplate=null; this._mfaPassedAt=null; this._mfaBusy=false;
    // C-23: keadaan idle/absen juga milik pengguna lama - jangan diwariskan.
    this._awayReturn=null; this._hiddenAt=null; this._lastEventAt=Date.now();
    this._noAssessRuns=0; this._abstainEmitted=false;
    this._aggBuf=[]; this._aggThresholds=null;   // C-24: bukti separuh terkumpul milik pengguna lama
    await storage.del(ns(this.userId));
    try{ localStorage.removeItem(nsPending(this.userId)); localStorage.removeItem(LEGACY_PENDING); }catch{}
  }
}

// singleton global untuk loader 3-baris
const singleton=new BehaviorGuard();
if(typeof window!=='undefined'){
  window.BehaviorGuard={
    init: (opts)=> singleton.init(opts),
    endSession: ()=> singleton.endSession(),
    markStep: (name)=> singleton.markStep(name),
    getVector: ()=> singleton.getVector(),
    _instance: singleton,
    // untuk reproduce/tools
    _core: { extractF4, IsolationForest, OCSVM, Ensemble, computeStats, standardize }
  };
}
return {BehaviorGuard: BehaviorGuard, singleton: singleton};
})();


/* ---- panel status bawaan (opsional, aktif via cfg.panel:true / data-panel) ---- */
function __bgMountPanel(){
  if(document.getElementById('bg-panel')) return function(){};
  var wrap=document.createElement('div');
  wrap.id='bg-panel';
  wrap.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483000;width:230px;'+
    'font:13px/1.45 system-ui,Segoe UI,Roboto,sans-serif;background:#fff;color:#0f1729;'+
    'border:1px solid #e6e9ee;border-left:5px solid #94a3b8;border-radius:12px;'+
    'box-shadow:0 10px 30px rgba(15,23,41,.18);overflow:hidden;transition:border-color .2s';
  wrap.innerHTML=
    '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f8fafc;border-bottom:1px solid #eef2f7">'+
      '<span style="font-size:15px">🛡️</span>'+
      '<b style="flex:1;font-size:13px">BehaviorGuard</b>'+
      '<span id="bg-p-dot" style="width:10px;height:10px;border-radius:50%;background:#94a3b8"></span>'+
    '</div>'+
    '<div style="padding:12px">'+
      '<div style="display:flex;align-items:baseline;gap:8px">'+
        '<span id="bg-p-lvl" style="font-size:20px;font-weight:800;color:#64748b">MENGENALI…</span>'+
      '</div>'+
      '<div id="bg-p-score" style="color:#64748b;font-size:12px;margin-top:2px">menunggu aktivitas…</div>'+
      '<div id="bg-p-bar" style="display:none;height:6px;border-radius:99px;background:#e6e9ee;margin-top:9px;overflow:hidden">'+
        '<i id="bg-p-fill" style="display:block;height:100%;width:0%;background:#64748b;border-radius:99px;transition:width .3s"></i></div>'+
      '<div id="bg-p-reason" style="color:#94a3b8;font-size:11px;margin-top:8px;line-height:1.35"></div>'+
    '</div>';
  (document.body||document.documentElement).appendChild(wrap);
  var C={LOW:{c:'#059669',t:'AMAN'},MEDIUM:{c:'#d97706',t:'WASPADA'},HIGH:{c:'#dc2626',t:'BAHAYA'}};
  return function(e){
    var lvl=document.getElementById('bg-p-lvl');
    var skor=document.getElementById('bg-p-score');
    var bar=document.getElementById('bg-p-bar');
    var fill=document.getElementById('bg-p-fill');
    var alasan=document.getElementById('bg-p-reason');

    // Fase pendaftaran: tampilkan PROGRES, bukan cuma "MENGENALI...". Tanpa ini
    // penonton tidak punya cara tahu sistemnya sedang berjalan atau menggantung.
    var m=(e.reasons&&e.reasons[0]||'').match(/enrollment\s+(\d+)\s*\/\s*(\d+)/);
    if(m){
      var kini=+m[1], perlu=+m[2];
      wrap.style.borderLeftColor='#6366f1';
      document.getElementById('bg-p-dot').style.background='#6366f1';
      lvl.textContent='MENGENALI '+kini+'/'+perlu; lvl.style.color='#4f46e5'; lvl.style.fontSize='18px';
      skor.textContent='membangun profil pemilik…';
      bar.style.display='block'; fill.style.width=Math.round(kini/perlu*100)+'%'; fill.style.background='#6366f1';
      alasan.textContent = kini>=perlu ? 'profil siap — sesi berikutnya sudah dinilai'
                                       : 'butuh '+(perlu-kini)+' sesi lagi sebelum bisa menilai';
      return;
    }

    var s=C[e.level]||C.LOW;
    wrap.style.borderLeftColor=s.c;
    document.getElementById('bg-p-dot').style.background=s.c;
    lvl.textContent=e.level+' · '+s.t; lvl.style.color=s.c; lvl.style.fontSize='20px';
    bar.style.display='none';
    skor.textContent='skor perilaku: '+(e.score!=null?e.score.toFixed(2):'-');
    var r=(e.reasons&&e.reasons.length)?('Sinyal: '+e.reasons.slice(0,2).join(', ')):'';
    alasan.textContent=r;
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
      // event DOM tetap disiarkan untuk integrasi lanjutan
      try{ window.dispatchEvent(new CustomEvent('behaviorguard:risk',{detail:e})); }catch(_){}
    };
    var opts = {userId:userId, onRisk:onRisk};
    // HYBRID cloud: pk (kunci tenant) + endpoint (VPS) -> baseline lintas-device + log verdict
    opts.pk       = cfg.pk       || (S && S.getAttribute('data-pk'))       || null;
    opts.endpoint = cfg.endpoint || (S && S.getAttribute('data-endpoint')) || null;
    ['weights','baseline','retrainEvery','features','thresholds','mfa'].forEach(function(k){ if(cfg[k]!=null) opts[k]=cfg[k]; });
    BG.init(opts);
    window.addEventListener('pagehide', function(){ try{ BG.endSession(); }catch(_){}} );
  }
}catch(e){ try{ console.error('[BehaviorGuard boot]', e); }catch(_){} }
})();
