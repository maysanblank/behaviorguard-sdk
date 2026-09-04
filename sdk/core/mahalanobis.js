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
export class Mahalanobis {
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
