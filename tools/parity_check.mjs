/**
 * parity_check.mjs - the JavaScript half of the engine parity test.
 *
 * Feeds one deterministic sequence of 30-second windows through the SDK's own decision code
 * (BehaviorGuard._ingestVector in sdk/behaviorguard.js) and prints every verdict as JSON.
 * server/test_parity.py runs the same sequence through server/engine.py and requires the
 * same level, action, score and model state on every window.
 *
 * The sequence covers: enrollment (with an ineligible window inside it), owner windows, the
 * ensemble gate opening at 20, retraining and convergence, an impostor run (MEDIUM, HIGH,
 * consecutive-HIGH block), an owner verification that clears the floor and trains the
 * window, the step-up grace period, a return after a long absence, autofilled windows,
 * script-made input, and an exact replay of an earlier window.
 *
 * Run: node tools/parity_check.mjs > parity.json   (or let test_parity.py run it)
 */
globalThis.window = new EventTarget();
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
const { BehaviorGuard } = await import('../sdk/behaviorguard.js');

let NOW = Date.UTC(2026, 9, 1, 2, 0, 0);
Date.now = () => NOW;
console.warn = () => {};

// deterministic generator (same LCG in the Python half is not needed: inputs are printed)
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
const N = 34;
const ownerBase = Array.from({ length: N }, (_, i) => (i % 7 === 6 ? 0 : 0.5 + rnd() * 3 * (1 + (i % 5))));
const otherBase = ownerBase.map((v, i) => (v === 0 ? 0 : v * (0.35 + rnd() * 1.6)));
const around = (base, spread) => base.map(v => (v === 0 ? 0 : Math.max(0, v * (1 + (rnd() - 0.5) * 2 * spread))));

const plan = [];
const add = (kind, opts = {}) => plan.push({ kind, ...opts });
for (let i = 0; i < 4; i++) add('owner');
add('owner', { events: 60 });                   // too little evidence to train: ineligible
for (let i = 0; i < 7; i++) add('owner');
for (let i = 0; i < 24; i++) add('owner');      // gate opens at 20, retrain every 6 LOW
add('owner', { keystrokeBypassed: true });
add('owner', { synthetic: 40 });
for (let i = 0; i < 3; i++) add('other');       // impostor: floor rises, consecutive HIGH blocks
add('verify');                                  // the owner verifies: floor cleared, window trains
add('owner'); add('other', { spread: 0.05 }); add('owner');
add('owner', { away: 20 * 60 * 1000 });          // back after 20 minutes: verify again
add('verify');
for (let i = 0; i < 8; i++) add('owner');
add('replay', { of: 14 });                      // an exact copy of window 14
for (let i = 0; i < 6; i++) add('owner');
add('owner', { away: 25 * 60 * 1000 });          // a LOW after 25 minutes away: raised to MEDIUM
for (let i = 0; i < 4; i++) add('owner');

const g = new BehaviorGuard();
await g.init({ userId: 'parity@example.com', mfa: { enabled: false } });
g._stopTimer();
try { g.capture.detach(); } catch {}
const cap = { buffer: [], synthetic: 0, drain() { return []; }, peek() { return []; }, detach() {} };
g.capture = cap;
let synthTotal = 0;
const out = [];
const vectors = [];
for (const step of plan) {
  NOW += 31000;
  if (step.kind === 'verify') {
    const evt = {};
    g._applyMfaVerified(evt, NOW);
    out.push({ step, verified: true, risk: g.lastRisk, model: g.model ? g.model.n : 0 });
    continue;
  }
  let vec;
  if (step.kind === 'replay') vec = vectors[step.of].slice();
  else vec = around(step.kind === 'owner' ? ownerBase : otherBase, step.spread || 0.18);
  vectors.push(vec);
  const events = step.events || 200;
  if (step.away) g._markAwayReturn(step.away, 'no-input', NOW);
  synthTotal += step.synthetic || 0;
  cap.synthetic = synthTotal;
  const eligible = !step.keystrokeBypassed && events >= 100;
  const evt = await g._ingestVector(vec, null, eligible, null,
    { keystrokeBypassed: !!step.keystrokeBypassed, idle: { activeSec: 30, gapBeforeMs: 0 } });
  out.push({
    step, now: NOW, vector: vec, events, synthetic: step.synthetic || 0,
    level: evt.level, action: evt.action, score: evt.score, eligible: evt.eligible,
    convergence: evt.convergence || null, gateReopened: !!evt.gateReopened,
    blocked: !!evt.blocked, replay: !!evt.replay, stepUpGrace: !!evt.stepUpGrace,
    reverify: !!evt.reverifyAfterAway, enrollment: evt.enrollment ? evt.enrollment.done : null,
    lastRisk: g.lastRisk, model: g.model ? g.model.n : 0,
    thresholds: evt.thresholds || null,
  });
}
process.stdout.write(JSON.stringify(out));
