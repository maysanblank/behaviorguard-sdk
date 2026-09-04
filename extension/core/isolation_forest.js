/**
 * isolation_forest.js - implementasi tepat, deterministik, tanpa dependensi
 * anomalyScore makin negatif = makin anomali (konsisten dengan risk mapping)
 * Deterministik via mulberry32 seed 42
 */
function mulberry32(a){ return function(){ let t=a+=0x6D2B79F5; t=Math.imul(t^t>>>15,t|1); t^=t+Math.imul(t^t>>>7,t|61); return ((t^t>>>14)>>>0)/4294967296; }; }
function cFactor(n){ if(n<=1) return 0; if(n===2) return 1; return 2*(Math.log(n-1)+0.5772156649) - 2*(n-1)/n; }

export class IsolationForest {
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
