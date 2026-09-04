/**
 * ensemble.test.mjs — regression tests for the detector gate (C-15).
 *
 * `ensembleMinSamples.svm = 20` while `baseline = 10`. The gate is frozen into the
 * model at rebuild time (`Ensemble.n`), so a model built at n=10 has the second
 * detector — which carries 70% of the weight — switched OFF. If convergence then
 * stops retraining, that model never rebuilds and the strongest detector stays off
 * for the lifetime of that user.
 *
 * These tests pin the gate semantics. The orchestrator-level rule ("crossing a gate
 * threshold forces a rebuild even when converged") is exercised end-to-end by
 * demo/attack_sim.html, which requires a DOM.
 *
 * Run: node core/ensemble.test.mjs
 */
import { Ensemble } from '../sdk/core/ensemble.js';
import { DEFAULTS, normalizeWeights } from '../sdk/core/config.js';

const results = [];
const check = (name, cond) => results.push({ name, ok: !!cond });

// Deterministic stand-ins: the gate is about weights, not about scoring quality.
const mkDetector = (value) => ({
  fit() {},
  scoreOne() { return value; },
  predict(X) { return X.map(() => value); },
});

function gatedWeightsAt(n) {
  const ens = new Ensemble(mkDetector(-0.1), mkDetector(-5), DEFAULTS.weights, n);
  // two distinct baseline scores so score_stats has non-zero spread
  ens.iforest = { ...mkDetector(-0.1), predict: () => [-0.1, -0.2] };
  ens.ocsvm = { ...mkDetector(-5), predict: () => [-5, -6] };
  ens.calibrate([[0], [0]], n);
  return ens.gatedWeights;
}

// --- the gate itself ---------------------------------------------------------
const below = gatedWeightsAt(DEFAULTS.ensembleMinSamples.svm - 1);
const at = gatedWeightsAt(DEFAULTS.ensembleMinSamples.svm);
const above = gatedWeightsAt(DEFAULTS.ensembleMinSamples.svm + 10);

check('below the gate, detector-2 is silenced', below.svm === 0);
check('below the gate, IF is renormalized to 1', Math.abs(below.isolation_forest - 1) < 1e-12);
check('at the gate, detector-2 is active', at.svm > 0);
check('above the gate, detector-2 is active', above.svm > 0);
check('at the gate, weights match the configured split',
  Math.abs(at.svm - DEFAULTS.weights.svm) < 1e-12 &&
  Math.abs(at.isolation_forest - DEFAULTS.weights.isolation_forest) < 1e-12);
check('gate threshold sits above baseline (why C-15 was reachable)',
  DEFAULTS.ensembleMinSamples.svm > DEFAULTS.baseline);

// --- C-8: the constructor fallback must not resurrect the old W7 split --------
const fallback = new Ensemble(mkDetector(0), mkDetector(0), null, 50).weights;
check('constructor fallback uses DEFAULTS, not the legacy 0.7/0.3',
  Math.abs(fallback.isolation_forest - DEFAULTS.weights.isolation_forest) < 1e-12 &&
  Math.abs(fallback.svm - DEFAULTS.weights.svm) < 1e-12);
check('legacy split is genuinely different (guard is meaningful)',
  Math.abs(DEFAULTS.weights.isolation_forest - 0.7) > 1e-9);

// --- weight normalization ----------------------------------------------------
const norm = normalizeWeights({ isolation_forest: 3, svm: 7, lstm: 0 });
check('weights are normalized to sum 1',
  Math.abs(norm.isolation_forest + norm.svm + norm.lstm - 1) < 1e-12);
check('normalization preserves the ratio', Math.abs(norm.svm - 0.7) < 1e-12);
check('all-zero weights fall back to DEFAULTS',
  normalizeWeights({ isolation_forest: 0, svm: 0, lstm: 0 }).svm === DEFAULTS.weights.svm);

// --- report ------------------------------------------------------------------
const failed = results.filter(r => !r.ok);
const summary = `\nDETECTOR GATE (C-15 / C-8)\n` +
  results.map(r => `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}`).join('\n') +
  `\n\n  passed ${results.length - failed.length} / ${results.length}\n` +
  `  RESULT: ${failed.length ? 'FAILURES PRESENT' : 'MATCHES'}\n`;

if (typeof window !== 'undefined') {
  window.BG_GATE_TEST = { total: results.length, failed: failed.length, results };
  const pre = document.createElement('pre');
  pre.textContent = summary;
  document.body.appendChild(pre);
} else {
  console.log(summary);
  if (failed.length) process.exit(1);
}
export { results };
