/**
 * risk.js - pita risiko + reasons (top fitur menyimpang)
 */
import { DEFAULTS } from './config.js';

export function toRisk(score, thresholds=DEFAULTS.thresholds){
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
export function calibrateThresholds(baselineScores, q_low=null, q_med=null){
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
export function calibrateThresholdsParametric(baselineScores, k_low=DEFAULTS.k_low, k_med_extra=DEFAULTS.k_med_extra){
  const n=baselineScores.length;
  if(n===0) return {low:-0.4, medium:-0.8};
  let m=0; for(const x of baselineScores) m+=x; m/=n;
  let v=0; for(const x of baselineScores) v+=(x-m)*(x-m); v/=n;
  const sd = v>1e-12 ? Math.sqrt(v) : 1.0;
  return {low: m - k_low*sd, medium: m - (k_low + k_med_extra)*sd};
}
export function toAction(level){
  // Aksi PER-SESI (stateless). HIGH tidak langsung memblokir: satu sesi menyimpang
  // -> minta verifikasi STEP-UP (pemilik lolos, penyusup gagal). Pemblokiran keras
  // dipicu RENTETAN HIGH -> lapisan stateful di behaviorguard.js.
  if(level==='HIGH') return 'REQUIRE_STEPUP';
  if(level==='MEDIUM') return 'REQUIRE_MFA';
  return 'ALLOW_SESSION';
}
// top fitur paling menyimpang (abs z-score terbesar)
export function topFeatures(vec_std, featureNames, k=3){
  const arr=featureNames.map((name,i)=>({name, z: vec_std[i], abs: Math.abs(vec_std[i])}));
  arr.sort((a,b)=>b.abs-a.abs);
  return arr.slice(0,k);
}
export function reasonsFrom(top){
  return top.map(t=> `${t.name} z=${t.z.toFixed(2)}`);
}
