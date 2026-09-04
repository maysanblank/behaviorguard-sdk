// conformance.node.mjs - uji kesesuaian mesin JS TANPA browser (buat CI).
//
// Logika identik dengan core/conformance.html, cuma baca golden.json lewat fs
// alih-alih fetch, dan tanpa DOM. Jalankan: `node core/conformance.node.mjs`.
//
// Mesin dev lokal boleh tetap pakai conformance.html (kalau nol Node); CI pakai ini.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { DEFAULTS } from '../sdk/core/config.js';
import { computeStats, standardize, standardizeBatch } from '../sdk/core/standardize.js';
import { IsolationForest } from '../sdk/core/isolation_forest.js';
import { OCSVM } from '../sdk/core/ocsvm.js';
import { Mahalanobis } from '../sdk/core/mahalanobis.js';
import { Ensemble } from '../sdk/core/ensemble.js';
import { toRisk, toAction, topFeatures, calibrateThresholds, calibrateThresholdsParametric } from '../sdk/core/risk.js';
import { extractF4, featuresToVector } from '../sdk/core/features.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function buildModel(vectors, cfg) {
  const stats = computeStats(vectors);
  const Xstd = standardizeBatch(vectors, stats);
  const iff = new IsolationForest(cfg.iforest);
  iff.fit(Xstd);
  const det2 = (cfg.model2 || 'mahalanobis') === 'mahalanobis'
    ? new Mahalanobis({ shrink: cfg.mahalanobis.shrink, n_features: cfg.features.length })
    : new OCSVM({ ...cfg.ocsvm, n_features: cfg.features.length });
  det2.fit(Xstd);
  const ens = new Ensemble(iff, det2, cfg.weights, vectors.length);
  ens.calibrate(Xstd, vectors.length);
  const baseScores = Xstd.map(x => ens.scoreOne(x));
  const thresholds = (cfg.calibrationMode || 'parametric') === 'parametric'
    ? calibrateThresholdsParametric(baseScores, cfg.k_low, cfg.k_med_extra)
    : calibrateThresholds(baseScores, cfg.q_low, cfg.q_med);
  return { stats, ens, thresholds };
}

function scoreVector(model, vec, cfg) {
  const xstd = standardize(vec, model.stats);
  const score = model.ens.scoreOne(xstd);
  const level = toRisk(score, model.thresholds);
  return { score, level, action: toAction(level),
           topFeature: topFeatures(xstd, cfg.features, 3)[0].name };
}

const close = (a, b, tol) =>
  a === b || Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));

const g = JSON.parse(readFileSync(join(HERE, 'golden.json'), 'utf8'));
const tol = g.tolerance;
const cfg = { ...DEFAULTS, features: g.features };
let passed = 0, failed = 0;
const problems = [];
const check = (label, got, want) => {
  const ok = typeof want === 'number' ? close(got, want, tol) : got === want;
  if (ok) passed++; else { failed++; problems.push(`${label}: dapat ${got}, harus ${want}`); }
};

// --- SPEC v1.1: ekstraksi fitur ---
for (const fc of (g.feature_cases || [])) {
  const gotVec = featuresToVector(extractF4(fc.events, fc.session_start_ts));
  fc.expect_vector.forEach((want, i) =>
    check(`${fc.id} / vector[${i}] (${g.features[i]})`, gotVec[i], want));
}

// --- SPEC v1.0: mesin ---
for (const cs of g.cases) {
  const model = buildModel(cs.baseline, cfg);
  const exp = cs.expect;
  check(`${cs.id} / thresholds.low`, model.thresholds.low, exp.thresholds.low);
  check(`${cs.id} / thresholds.medium`, model.thresholds.medium, exp.thresholds.medium);
  exp.stats_mean_head.forEach((w, i) => check(`${cs.id} / stats.mean[${i}]`, model.stats.mean[i], w));
  exp.stats_std_head.forEach((w, i) => check(`${cs.id} / stats.std[${i}]`, model.stats.std[i], w));
  for (const k of ['mean', 'std']) {
    check(`${cs.id} / if_stats.${k}`, model.ens.ifStats[k], exp.if_stats[k]);
    check(`${cs.id} / svm_stats.${k}`, model.ens.svmStats[k], exp.svm_stats[k]);
  }
  for (const k of Object.keys(exp.gated_weights))
    check(`${cs.id} / gated_weights.${k}`, model.ens.gatedWeights[k], exp.gated_weights[k]);
  cs.probes.forEach((p, i) => {
    const v = scoreVector(model, p, cfg);
    const w = exp.verdicts[i];
    check(`${cs.id} / probe[${i}].score`, v.score, w.score);
    check(`${cs.id} / probe[${i}].level`, v.level, w.level);
    check(`${cs.id} / probe[${i}].action`, v.action, w.action);
    check(`${cs.id} / probe[${i}].topFeature`, v.topFeature, w.topFeature);
  });
}

console.log();
console.log(`KESESUAIAN  spec ${g.spec_version}  toleransi ${tol}`);
console.log(`  lulus ${passed} / ${passed + failed}`);
if (problems.length) {
  console.log('  GAGAL:');
  problems.slice(0, 25).forEach(p => console.log('    - ' + p));
}
console.log(`  HASIL: ${failed === 0 ? 'SESUAI' : 'TIDAK SESUAI'}`);
process.exit(failed === 0 ? 0 : 1);
