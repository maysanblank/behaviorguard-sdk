/**
 * lifecycle.js - enrollment base10 + retrain/6 + penjaga kohort dua-sisi (prequential)
 * Prequential: sesi ke-N dinilai model yang belum pernah lihat sesi ke-N
 * Semua fungsi menerima cfg instance (bukan DEFAULTS global) - fix #9
 */
export function shouldRetrain(sessionCount, retrainEvery, cfg){
  const base=cfg ? cfg.baseline : 10;
  if(sessionCount < base) return false;
  return (sessionCount - base) % retrainEvery === 0;
}
// cek konvergensi dua-sisi: window LOW beruntun + kohortLowRate ≤ threshold
// window 6 = definisi tervalidasi; freeze juga pakai 6 (konsisten)
export function isConverged(recentRisks, cohortLowRate, cfg){
  const win=cfg ? cfg.window : 6;
  const thr=cfg ? cfg.cohortLowRate : 0.35;
  if(recentRisks.length < win) return false;
  const last=recentRisks.slice(-win);
  if(!last.every(r=>r==='LOW')) return false;
  if(cohortLowRate > thr) return false;
  return true;
}
// hitung cohortLowRate: porsi skor kohort yang LOW
export function cohortLowRate(cohortScores, thresholds){
  if(!cohortScores || !cohortScores.length) return 0;
  const thr=thresholds ? thresholds.low : -0.4;
  const low=cohortScores.filter(s=> s > thr).length;
  return low/cohortScores.length;
}
