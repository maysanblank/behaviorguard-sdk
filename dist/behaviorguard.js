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
  progressiveMaxPool: 30,
  progressiveDupEps: 1e-3,
  session: { minEventsAssess: 30, minEventsTrain: 100, minDurationSec: 5.0, minNonZeroFeatures: 6, windowSec: 30 }
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
    handlers=null;
  }
  function drain(){ const c=[...buf]; buf.length=0; dropped=0; return c; }
  function peek(){ return [...buf]; }
  return { attach, detach, drain, peek, get buffer(){ return buf; }, get dropped(){ return dropped; } };
}
return {createCapture: createCapture};
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
const MAD_FLOOR_REL = 0.08;             // jitter manusia wajar: 8% dari median
const MAD_CEIL_REL = 0.50;              // pendaftaran kacau tak boleh bikin toleransi tak terbatas
const MISS_BUDGET_REL = 0.12;           // porsi posisi yang boleh meleset
const K_DEFAULT = 2.5;

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

  for (let i = 0; i < nD; i++) {
    const lim = k * tmpl.dwellMad[i];
    const d = Math.abs(sample.dwell[i] - tmpl.dwell[i]);
    if (d > lim) push('dwell', i, d, lim);
  }
  for (let i = 0; i < nF; i++) {
    const lim = k * tmpl.flightMad[i];
    const d = Math.abs(sample.flight[i] - tmpl.flight[i]);
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
  if(std < 3) reasons.push(`interval konstan std=${std.toFixed(2)}ms`);
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
  const parts=[
    navigator.userAgent,
    screen.width+'x'+screen.height,
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
        toSave={...v, sessions: v.sessions.slice(-30)};
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
const { storage } = __M["storage.js"];
const { isConverged, cohortLowRate } = __M["core/lifecycle.js"];
const { getOrCreateSecret, generateToken } = __M["core/token.js"];
const { checkIntegrity } = __M["core/integrity.js"];
const { getFingerprint } = __M["core/fingerprint.js"];
const { checkCollect } = __M["core/ratelimit.js"];
const { buildTemplate, verify: verifyChallenge } = __M["core/challenge.js"];
const { runMfaChallenge } = __M["core/mfa.js"];

const ns = id => `bg:${id}`;

class BehaviorGuard {
  constructor(){ this.cfg=structuredClone(DEFAULTS); this.userId=null; this.onRisk=null; this.capture=null; this.model=null; this.stats=null; this.sessions=[]; this.inited=false; this.lastRisk='LOW'; this.fingerprint=null; this.secret=null; this.challengeTemplate=null; }
  async init({userId, onRisk, storage: storageOpt, weights, baseline, retrainEvery, features, thresholds, pk, endpoint, mfa}={}){
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
      const pending=JSON.parse(localStorage.getItem('bg:pending')||'null');
      if(pending && pending.length){
        localStorage.removeItem('bg:pending');
        // pending adalah event mentah - simpan dulu, akan di-score di endSession berikutnya
        // untuk init yang baru, taruh di capture buffer sementara
        this._pendingEvents=pending;
      }
    }catch{}
    // capture auto
    this.capture=createCapture(()=>{});
    try{ this.capture.attach(); }catch{}
    // S6: pending skor sebagai sesi terpisah, jangan gabung (bikin durasi ngembung)
    try{
      if(this._pendingEvents && this._pendingEvents.length){
        const pending=this._pendingEvents; delete this._pendingEvents;
        // skor pending sebagai sesi terpisah via _ingestVector, pakai seal storage
        const chunk=pending.slice(0,100);
        if(chunk.length>=this.cfg.session.minEventsAssess){
          // B1 fix: jangan require di ESM, pakai scoreExternalEvents langsung (extractF4 sudah diimpor)
          // async scoring deferred to next tick
          setTimeout(()=> this.scoreExternalEvents(chunk).catch(()=>{}), 100);
        }
        try{ await storage.set('bg:pending', null); }catch{}
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
  _wireAuto(){
    if(this._wired) return; this._wired=true;
    this._autoTimer=setInterval(()=>{ this.endSession().catch(()=>{}); }, this.cfg.session.windowSec*1000);
    try{
      document.addEventListener('visibilitychange', ()=>{
        if(document.visibilityState==='hidden') this.endSession().catch(()=>{});
      });
      const origPush=history.pushState.bind(history);
      const origReplace=history.replaceState.bind(history);
      const self=this;
      history.pushState=function(...a){ const r=origPush(...a); self.capture && self.capture.buffer.push({event_type:'NAVIGATION', page_url: location.href, timestamp: Date.now()}); return r; };
      history.replaceState=function(...a){ const r=origReplace(...a); self.capture && self.capture.buffer.push({event_type:'NAVIGATION', page_url: location.href, timestamp: Date.now()}); return r; };
      window.addEventListener('popstate', ()=>{ self.capture && self.capture.buffer.push({event_type:'NAVIGATION', page_url: location.href, timestamp: Date.now()}); });
      // R4: simpan ekor ke storage, bukan data: URL no-op; clear timer
      window.addEventListener('pagehide', ()=>{ try{ clearInterval(self._autoTimer); }catch{} });
      window.addEventListener('beforeunload', ()=>{
        try{
          const evs=self.capture.peek();
          if(evs.length>=10){
            // simpan untuk load berikutnya, bukan beacon ke data:
            const pending=JSON.parse(localStorage.getItem('bg:pending')||'[]');
            pending.push(...evs.slice(-100));
            if(pending.length>500) pending.splice(0, pending.length-500);
            localStorage.setItem('bg:pending', JSON.stringify(pending));
          }
          clearInterval(self._autoTimer);
        }catch{}
      });
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
    this.stats=computeStats(vecs);
    const Xstd=standardizeBatch(vecs, this.stats);
    const iff=new IsolationForest(this.cfg.iforest);
    iff.fit(Xstd);
    // detektor-2: Mahalanobis (default) atau centroid lama (cfg.model2)
    const det2=(this.cfg.model2||'mahalanobis')==='mahalanobis'
      ? new Mahalanobis({ shrink: this.cfg.mahalanobis.shrink, n_features: this.cfg.features.length })
      : new OCSVM({...this.cfg.ocsvm, n_features: this.cfg.features.length});
    det2.fit(Xstd);
    const ens=new Ensemble(iff, det2, this.cfg.weights, vecs.length);
    ens.calibrate(Xstd, vecs.length);
    this.model=ens;
    if(this.cfg.calibrateThresholds){
      const baseScores=Xstd.map(x=> ens.scoreOne(x));
      this.cfg.thresholds=(this.cfg.calibrationMode||'parametric')==='parametric'
        ? calibrateThresholdsParametric(baseScores, this.cfg.k_low, this.cfg.k_med_extra)
        : calibrateThresholds(baseScores, this.cfg.q_low, this.cfg.q_med);
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
  async _ingestVector(vec, feat, eligible=true, events=null){
    // ratelimit
    const rl=checkCollect(this.userId);
    if(!rl.allowed){
      // C-4: dulu di-return diam-diam tanpa onRisk, jadi integrator tak pernah
      // tahu sesi diblokir rate-limit (jalur integrity di bawah memanggilnya).
      const rlEvt={level:'HIGH', score:-2, action:'BLOCK_SESSION', blocked:true, reasons:[rl.reason], topFeatures:[], features: feat, thresholds: {...this.cfg.thresholds}, eligible:false, rateLimited:true};
      this._cloudLog(rlEvt);
      try{ this.onRisk(rlEvt); }catch{}
      return rlEvt;
    }
    // integrity (bot/replay) - jika events tersedia
    if(events){
      const integ=checkIntegrity(events, {throttled:true});
      if(integ.suspected){
        const evt={level:'HIGH', score:-1.5, action:'BLOCK_SESSION', reasons:integ.reasons, topFeatures:[], features: feat, thresholds: {...this.cfg.thresholds}, eligible:false, integrity:true};
        this.sessions.push({vector: vec, feat, ts: Date.now(), risk:'HIGH', score:-1.5, eligible:false});
        await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:'HIGH'});
        this._cloudLog(evt);
        try{ this.onRisk(evt); }catch{}
        return evt;
      }
    }
    const eligibleCount=this.sessions.filter(s=>s.eligible!==false).length;
    if(eligibleCount < this.cfg.baseline){
      this.sessions.push({vector: vec, feat, ts: Date.now(), risk:'LOW', score:0, eligible});
      await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:'LOW'});
      let doneEnroll=false;
      if(this.sessions.filter(s=>s.eligible!==false).length >= this.cfg.baseline){ this._rebuildModel(); doneEnroll=true; }
      const enrollEvt={level:'LOW', score:0, reasons:[eligible?'enrollment '+this.sessions.filter(s=>s.eligible!==false).length+'/'+this.cfg.baseline:'sesi tidak layak - tidak masuk kolam'], topFeatures:[], features: feat, thresholds: {...this.cfg.thresholds}, convergence: 'enrollment', eligible};
      this._cloudLog(enrollEvt);
      if(doneEnroll) this._cloudPush(); // enrollment selesai -> unggah baseline akun ke VPS
      return enrollEvt;
    }
    if(!this.model) this._rebuildModel();
    const xstd=standardize(vec, this.stats);
    let score=this.model.scoreOne(xstd);
    // C-5: toRisk() memakai `score <= thr`; untuk NaN itu SELALU false -> 'LOW'.
    // Skor rusak karena itu gagal-TERBUKA. Perlakukan sebagai anomali, bukan aman.
    if(!Number.isFinite(score)){
      const badEvt={level:'HIGH', score:null, action:'REQUIRE_STEPUP', blocked:false,
        reasons:['skor tidak finit - model/statistik rusak'], topFeatures:[], features: feat,
        thresholds: {...this.cfg.thresholds}, eligible:false, degraded:true};
      this.sessions.push({vector: vec, feat, ts: Date.now(), risk:'HIGH', score:null, eligible:false});
      await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:this.lastRisk, highRun:this._highRun, challengeTemplate:this.challengeTemplate});
      this._cloudLog(badEvt);
      try{ this.onRisk(badEvt); }catch{}
      return badEvt;
    }
    let level=toRisk(score, this.cfg.thresholds);
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
    const top=topFeatures(xstd, F4, 3);
    let action=toAction(level);   // HIGH -> REQUIRE_STEPUP (bukan block langsung)
    // challenge step-up
    let reasons=reasonsFrom(top);
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
    const evt={level, score, action, blocked, consecutiveHigh: this._highRun, reasons, topFeatures: top, features: feat, thresholds: {...this.cfg.thresholds}, eligible, modelLevel, modelScore, stickyFloor};
    // R3: push dengan flag eligible - sesi gagal gate tetap log tapi tidak latih
    this.sessions.push({vector: vec, feat, ts: Date.now(), risk: level, score, eligible});
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
    const events=this.capture.drain();
    if(events.length < this.cfg.session.minEventsAssess) return null;
    const feat=extractF4(events);
    const vec=featuresToVector(feat);
    const duration=(events[events.length-1]?.timestamp||0)-(events[0]?.timestamp||0);
    const durationSec=duration/1000;
    const nonZero=Object.values(feat).filter(v=> Math.abs(v)>1e-9).length;
    const passesGate = events.length>=this.cfg.session.minEventsTrain && durationSec>=this.cfg.session.minDurationSec && nonZero>=this.cfg.session.minNonZeroFeatures;
    return this._ingestVector(vec, feat, passesGate, events);
  }
  async scoreExternalEvents(events){
    if(!events || events.length < this.cfg.session.minEventsAssess) return null;
    const feat=extractF4(events);
    const vec=featuresToVector(feat);
    const duration=(events[events.length-1]?.timestamp||0)-(events[0]?.timestamp||0);
    const durationSec=duration/1000;
    const nonZero=Object.values(feat).filter(v=> Math.abs(v)>1e-9).length;
    const passesGate = events.length>=this.cfg.session.minEventsTrain && durationSec>=this.cfg.session.minDurationSec && nonZero>=this.cfg.session.minNonZeroFeatures;
    return this._ingestVector(vec, feat, passesGate, events);
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
    const events=this.capture.peek();
    if(!events.length) return null;
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
    await storage.del(ns(this.userId)); await storage.del('bg:pending');
  }
}

// singleton global untuk loader 3-baris
const singleton=new BehaviorGuard();
if(typeof window!=='undefined'){
  window.BehaviorGuard={
    init: (opts)=> singleton.init(opts),
    endSession: ()=> singleton.endSession(),
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
      '<div id="bg-p-reason" style="color:#94a3b8;font-size:11px;margin-top:8px;line-height:1.35"></div>'+
    '</div>';
  (document.body||document.documentElement).appendChild(wrap);
  var C={LOW:{c:'#059669',t:'AMAN'},MEDIUM:{c:'#d97706',t:'WASPADA'},HIGH:{c:'#dc2626',t:'BAHAYA'}};
  return function(e){
    var s=C[e.level]||C.LOW;
    wrap.style.borderLeftColor=s.c;
    document.getElementById('bg-p-dot').style.background=s.c;
    var lvl=document.getElementById('bg-p-lvl'); lvl.textContent=e.level+' · '+s.t; lvl.style.color=s.c;
    document.getElementById('bg-p-score').textContent='skor perilaku: '+(e.score!=null?e.score.toFixed(2):'-');
    var r=(e.reasons&&e.reasons.length)?('Sinyal: '+e.reasons.slice(0,2).join(', ')):'';
    document.getElementById('bg-p-reason').textContent=r;
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
