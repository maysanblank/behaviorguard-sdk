/**
 * ocsvm.js - One-Class SVM RBF aproksimasi (arah, bukan rasio presisi)
 * Jujur di README: ini aproksimasi. Yang kokoh adalah ARAH +30% SVM membelah FAR.
 * Implementasi: centroid RBF di ruang terstandardisasi
 * score = exp(-gamma * ||x - mean||^2) - threshold ; positif=normal
 * Deterministik.
 */
export class OCSVM {
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
