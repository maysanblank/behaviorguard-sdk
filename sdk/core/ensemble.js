/**
 * ensemble.js - gabung IF + detektor-2 (bobot dari config), samakan skala via z-score baseline
 */
import { scoreStats, zScore } from './standardize.js';
import { normalizeWeights, DEFAULTS } from './config.js';

function gateWeights(weights, n){
  const minS=DEFAULTS.ensembleMinSamples;
  let w={...weights};
  if(n < minS.svm) w.svm=0;
  if(n < minS.lstm) w.lstm=0;
  // isolation_forest selalu ada (min 8) - jika n<8 fallback tetap IF
  return normalizeWeights(w);
}

export class Ensemble {
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
