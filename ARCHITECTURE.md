# Architecture

One script tag sits on top of an 18-module engine, a normative specification, and five
independently verified runtime implementations. This document shows what is underneath the
one-liner, and — more usefully — *why* each piece is shaped the way it is.

For the exact numeric contract, read [`core/SPEC.md`](core/SPEC.md). Where this document
and the spec disagree, the spec wins.

---

## 1. The pipeline

```
  ┌────────────┐   ┌────────────┐   ┌──────────────┐   ┌──────────────────┐
  │  capture   │──▶│  features  │──▶│ standardize  │──▶│    ensemble      │
  │ DOM events │   │ 28 floats  │   │ z vs owner   │   │ IF .30 + Maha .70│
  └────────────┘   └────────────┘   └──────────────┘   └────────┬─────────┘
   pointer, key,    per session,     mean/std of the            │
   scroll, focus,   deterministic,   owner's baseline           ▼
   nav, form        no DOM                              ┌──────────────────┐
                                                        │  risk banding    │
                                                        │ mean − k·std     │
                                                        └────────┬─────────┘
                                                                 │
                        ┌────────────────────────────────────────┤
                        ▼                                        ▼
              ┌──────────────────┐                    ┌──────────────────────┐
              │   lifecycle      │                    │  step-up challenge   │
              │ enroll, retrain, │◀───────────────────│  typing rhythm       │
              │ convergence      │  only verified     │  (dwell + flight)    │
              └──────────────────┘  sessions teach    └──────────────────────┘
```

The **28-float feature vector is the system's exchange point.** Everything to its left is
platform-specific (DOM, touch, native). Everything to its right is pure arithmetic, and is
what the specification and the five ports cover. That boundary is why a browser can capture
while a JVM or a WASM host scores.

---

## 2. Module map

`sdk/` is the single source of truth. `extension/` is a synchronized copy, and CI fails the
build if the two diverge.

| Module | Responsibility | In spec? |
| --- | --- | --- |
| `behaviorguard.js` | Orchestrator: session lifecycle, storage, verdict assembly, step-up policy | No |
| `core/capture.js` | Auto-attach DOM listeners, throttle, buffer cap | No |
| `core/features.js` | 28 features from raw events | Yes (§8) |
| `core/standardize.js` | Per-feature z-score against the owner baseline | Yes |
| `core/isolation_forest.js` | Isolation Forest, 100 trees, seed 42 | Yes |
| `core/mahalanobis.js` | Mahalanobis distance + diagonal shrinkage | Yes |
| `core/ocsvm.js` | Legacy centroid-RBF detector (superseded, kept for comparison) | Yes |
| `core/ensemble.js` | Weighted blend, per-detector score standardization, sample gating | Yes |
| `core/risk.js` | Threshold calibration, banding, top-feature reasons | Yes |
| `core/lifecycle.js` | Retrain cadence, two-sided convergence rule | No |
| `core/challenge.js` | Rhythm template construction and verification | No |
| `core/mfa.js` | The step-up prompt UI and capture integrity | No |
| `core/integrity.js` | Bot and replay heuristics | No |
| `core/ratelimit.js` | Per-user token bucket | No |
| `core/token.js` | HMAC session token | No |
| `core/fingerprint.js` | Lightweight device fingerprint | No |
| `core/config.js` | Defaults and validated constants | Yes (constants) |
| `storage.js` | IndexedDB → localStorage → memory, HMAC-sealed | No |

"In spec" means the module's numeric behavior is pinned by `core/golden.json` and must be
identical across all five runtimes to within 1e-9.

---

## 3. Why these design decisions

### Browser-trainable was a hard constraint, not a preference

The single most consequential decision. Every detector must be able to **fit** in a browser,
not merely evaluate. That immediately excluded scikit-learn's `OneClassSVM`, which is the
better-performing model in offline evaluation (FAR 0.9%) but requires libsvm's QP solver.

The first attempt at a browser-trainable substitute — a centroid-RBF approximation — was
much worse than expected: it collapses the entire baseline pool to a single mean point,
throwing away the shape of the distribution, and produced **FAR 36.2%**.

Mahalanobis distance with diagonal shrinkage keeps the covariance structure, is trainable
with a Gauss-Jordan inverse in a few hundred lines, and brought FAR to **5.4%** at a
comparable FRR. The decision boundary becomes an ellipse instead of a sphere, so an impostor
sitting near the owner's mean but off-axis is still caught.

Shrinkage (α = 0.3 toward the scaled identity) is required, not decoration: with 10–30
baseline sessions and 28 features, the sample covariance is near-singular.

### The ensemble weights are inverted from what you might expect

`IF 0.30 / Mahalanobis 0.70`. The distance-based detector carries the majority because it is
the one that models the owner's distribution shape; Isolation Forest contributes a
complementary, partition-based view of outlierness. Held-out sweeps put this split ahead of
both 0.70/0.30 and 0.50/0.50.

Detectors are **gated by sample count** (`ensembleMinSamples`): below 20 baseline sessions
the Mahalanobis weight is zeroed and re-normalized away, because an ill-conditioned
covariance from too few samples is worse than not using it.

Both detectors' raw scores are z-scored against the baseline before blending, so they are
combined on a common scale rather than in their native, incomparable units.

### Parametric thresholds instead of quantiles

Risk bands are calibrated per user from that user's own baseline score distribution:
`low = mean − 3.3·std`, `medium = mean − 5.3·std`.

The earlier quantile approach (`low` at the 10th percentile) depends on a single order
statistic of a 10–30 point sample, which is fragile. The parametric form uses the whole
distribution. The operating point differs substantially — on the same model, quantile
calibration gives FRR 37.5% / FAR 0.1% while parametric gives FRR 16.1% / FAR 5.4%. Both
are on the same ROC curve; parametric sits at a point far more usable in production.

`k_med_extra = 2.0` deliberately widens the `MEDIUM` band, because `MEDIUM` means "ask" and
`HIGH` means "ask more firmly" — neither blocks on its own.

### Only verified sessions may teach

Any adaptive system invites the attacker to become the new normal, gradually. The training
pool therefore admits a session only if it scored `LOW`, **or** it passed a genuine step-up
verification.

The second clause is what makes safe adaptation possible: a legitimate owner whose behavior
has genuinely drifted (new laptop, injury, different desk) will trip a `MEDIUM`, prove
identity through the rhythm challenge, and *then* be allowed to update the model. Adaptation
is gated on proof rather than on time.

Enrollment of the rhythm template happens **only during trusted `LOW` sessions**. Enrolling
at the moment of suspicion is precisely backwards, and an earlier version did exactly that —
see `core/DRIFT.md` §C-2.

### Verdicts are sticky; blocks require a run

A single anomalous session triggers **verification**, not a block. Only consecutive `HIGH`
verdicts (`blockAfterConsecutiveHigh = 2`) escalate to `BLOCK_SESSION`.

The rationale is asymmetric cost: owners produce isolated outliers routinely, while a real
takeover produces sustained ones. Held-out, the run rule cut the owner block rate from 9.7%
to 2.4% without moving FAR.

Risk level also has a **sticky floor** — it will not drop below the previous level until
three consecutive `LOW` sessions decay it. The raw model verdict is still reported alongside
(`modelLevel`, `modelScore`, `stickyFloor`) so the smoothing is always visible and never
silently rewrites the score.

### Prequential evaluation

Session *N* is judged by a model that has not seen session *N*. Retraining happens *after*
scoring, never before. Without this, every reported number would be optimistic by
construction.

### Two-sided convergence

Retraining stops when the model has both (a) produced a window of 6 consecutive `LOW`
verdicts and (b) kept its cohort false-accept rate at or below 0.35 against a held-out
cohort of other users.

One-sided rules fail in opposite directions: "stop when the owner is consistently LOW" is
trivially satisfied by a model that accepts everyone, and a cohort rule alone never
stabilizes. Both together bound over- and under-fitting.

---

## 4. Session lifecycle

```
 session 1 .. 10     ENROLLMENT       vectors pooled, no verdicts emitted
 session 11          first verdict    model built from the 10 baseline sessions
 every 6 sessions    RETRAIN CHECK    convergence test; rebuild if not converged
 any session         QUALITY GATE     >=100 events, >=5 s, >=6 non-zero features
                                      failing sessions are scored but never train
```

A session closes on a 30-second timer, on `visibilitychange`, or on page unload; a tail
buffer is persisted across navigation so SPA route changes do not truncate it.

Deduplication of the training pool ignores temporal features, so two genuinely similar
sessions at different times of day are correctly treated as one behavioral sample.

---

## 5. Cross-runtime conformance

The engine is defined once, in prose and numbers, and implemented five times.

```
core/SPEC.md      normative prose  ─┐
core/bg_core.py   readable reference │──▶ core/golden.json ──▶ every port must match
                                    ─┘     227 checks, 1e-9
```

`golden.json` contains **literal inputs and expected outputs** — 112 feature-extraction
checks plus 115 engine checks. A new port never has to reproduce a generator; it reads the
file, computes, and compares.

Two portability traps are called out in the spec because both silently break ports:

1. **The `mulberry32` PRNG** must mask every multiply to 32 bits. This is the single most
   common cause of a failing port.
2. **Time-of-day is computed in UTC.** It was local time once, which made feature extraction
   non-deterministic across machines — fatal for a "one brain, every runtime" claim.

CI runs Python, JavaScript, Rust, Java and WASM on every push, and additionally verifies
that `golden.json` is still in sync with its generator, that the step-up regression suite
passes, and that `sdk/` and `extension/` have not diverged.

---

## 6. Deployment shapes

| Shape | Use when | Entry point |
| --- | --- | --- |
| One `<script>` tag | You control the page | `dist/behaviorguard.js` |
| ES module | You want explicit lifecycle control | `sdk/behaviorguard.js` |
| MV3 extension | You do **not** control the page | `extension/` |
| Hybrid (optional) | Baseline must follow the user across devices | `server/` |

Hybrid mode transmits only 28-float feature vectors, never raw events. It is off unless both
a key and an endpoint are supplied, and it carries real risks of its own — read
[THREAT-MODEL.md](THREAT-MODEL.md) §4.6 before enabling it.

---

## 7. Storage

Three tiers, tried in order, so the library never crashes in a private window or with site
data blocked: **IndexedDB → localStorage → in-memory**.

Values are HMAC-sealed for tamper detection. This is **integrity, not confidentiality** —
the payload is base64, not encrypted. localStorage writes are capped at 1.8 MB, and session
history is trimmed to the most recent 30 entries there.

---

## 8. Where to look next

- [`core/SPEC.md`](core/SPEC.md) — the normative contract
- [`core/DRIFT.md`](core/DRIFT.md) — measured gaps between engines, and the C-1..C-10 audit
- [`ports/README.md`](ports/README.md) — how to add a sixth runtime
- [`THREAT-MODEL.md`](THREAT-MODEL.md) — trust boundaries and known attacks
