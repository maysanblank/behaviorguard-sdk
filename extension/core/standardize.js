/**
 * standardize.js - z-score terhadap sebaran baseline pemilik (deterministik)
 */
export function computeStats(vectors){
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
export function standardize(vec, stats){
  return vec.map((v,i)=> (v-stats.mean[i])/stats.std[i]);
}
export function standardizeBatch(X, stats){ return X.map(v=> standardize(v, stats)); }

// untuk skor ensemble: z-score skor terhadap baseline
export function scoreStats(scores){
  const m=scores.reduce((s,v)=>s+v,0)/scores.length;
  let s=Math.sqrt(scores.reduce((a,val)=>a+(val-m)**2,0)/scores.length);
  // guard: jangan biarkan std < 1e-6 membesarkan noise (OCSVM saturasi)
  if(!Number.isFinite(s) || s < 1e-3) s = 1e-3;
  // juga jangan std raksasa >10 mengecilkan sinyal
  if(s > 10) s = 10;
  return {mean:m, std:s};
}
export function zScore(val, st){
  // clamp z ke [-6,6] agar tidak overflow
  const z=(val - st.mean)/st.std;
  return Math.max(-6, Math.min(6, z));
}
