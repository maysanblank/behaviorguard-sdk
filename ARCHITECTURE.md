# Architecture

One script tag sits on top of a 17-module engine, a normative specification, and five
independently verified runtime implementations. This document shows what is underneath the
one-liner, and - more usefully - *why* each piece is shaped the way it is.

For the exact numeric contract, read [`core/SPEC.md`](core/SPEC.md). Where this document
and the spec disagree, the spec wins.

---

## 1. The pipeline

```
  ┌────────────┐   ┌────────────┐   ┌──────────────┐   ┌──────────────────┐
  │  capture   │──▶│  features  │──▶│ standardize  │──▶│    ensemble      │
  │ DOM events │   │ 34 floats  │   │ z vs owner   │   │ IF .30 + Maha .70│
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

The **34-float feature vector is the system's exchange point.** Everything to its left is
platform-specific (DOM, touch, native). Everything to its right is pure arithmetic, and is
what the specification and the five ports cover. That boundary is why a browser can capture
while a JVM or a WASM host scores.

---

## 2. Module map

`sdk/` is the single source of truth. `dist/behaviorguard.js` is generated from it by
`tools/bundle.py`; never edit the bundle by hand.

| Module | Responsibility | In spec? |
| --- | --- | --- |
| `behaviorguard.js` | Orchestrator: session lifecycle, storage, verdict assembly, step-up policy | No |
| `core/capture.js` | Auto-attach DOM listeners, throttle, buffer cap; keys become per-page tokens (typed characters are never kept) | No |
| `core/idle.js` | Duplicate removal, idle-gap compression, evidence gating and tail carry | No |
| `core/features.js` | 34 features from raw events | Yes (§8) |
| `core/standardize.js` | Per-feature z-score against the owner baseline | Yes |
| `core/isolation_forest.js` | Isolation Forest, 100 trees, seed 42 | Yes |
| `core/mahalanobis.js` | Mahalanobis distance + diagonal shrinkage | Yes |
| `core/ocsvm.js` | Legacy centroid-RBF detector (superseded, kept for comparison) | Yes |
| `core/ensemble.js` | Weighted blend, per-detector score standardization, sample gating | Yes |
| `core/risk.js` | Threshold calibration, banding, top-feature reasons | Yes |
| `core/lifecycle.js` | Retrain cadence, two-sided convergence rule | No |
| `core/challenge.js` | Rhythm template construction and verification (physical and touch-screen keyboards) | No |
| `core/mfa.js` | The step-up dialog: Shadow DOM, accessible, per-key rhythm capture, fallback button | No |
| `core/integrity.js` | Bot heuristics (constant timing, duplicate events, impossible speed) | No |
| `core/ratelimit.js` | Per-user token bucket | No |
| `core/token.js` | HMAC session token | No |
| `core/fingerprint.js` | Lightweight device fingerprint | No |
| `core/config.js` | Defaults and validated constants | Yes (constants) |
| `storage.js` | IndexedDB -> localStorage -> memory, HMAC-sealed (unsigned on insecure origins) | No |

"In spec" means the module's numeric behavior is pinned by `core/golden.json` and must be
identical across all five runtimes to within 1e-9.

---

## 3. Why these design decisions

### Browser-trainable was a hard constraint, not a preference

The single most consequential decision. Every detector must be able to **fit** in a browser,
not merely evaluate. That immediately excluded scikit-learn's `OneClassSVM`, which looked
strongest in the offline research harness but requires libsvm's QP solver.

The first attempt at a browser-trainable substitute - a centroid-RBF approximation - was
much worse than expected: it collapses the entire baseline pool to a single mean point,
throwing away the shape of the distribution, and produced **FAR 36.2%** in that harness.

Mahalanobis distance with diagonal shrinkage keeps the covariance structure, is trainable
with a Gauss-Jordan inverse in a few hundred lines, and brought the same harness to
**FAR 5.4%** at a comparable FRR. (Those harness figures scored whole ~700-event research
sessions; the numbers for the library as shipped, scored in 30-second windows, are in the
README - see `core/DRIFT.md` C-29.) The decision boundary becomes an ellipse instead of a sphere, so an impostor
sitting near the owner's mean but off-axis is still caught.

Shrinkage toward the scaled identity is required, not decoration: with 10-30 baseline
sessions and 34 features, the sample covariance is near-singular. It is adaptive -
`min(0.9, max(0.3, d/n))` - heavy while the pool is small, decaying to 0.3 as it grows
(C-22).

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
`low = mean − k_low·std`, `medium = low − k_med_extra·std`, with `k_low = 1.75` and
`k_med_extra = 2.0`. `k_low` was re-selected on the shipped library (8 subjects tuned, 8
reported, 5 splits) and is the one knob an integrator moves: `init({calibration:{k_low}})`.

The earlier quantile approach (`low` at the 10th percentile) depends on a single order
statistic of a 10-30 point sample, which is fragile. The parametric form uses the whole
distribution.

`k_med_extra = 2.0` deliberately widens the `MEDIUM` band, because `MEDIUM` means "ask" and
`HIGH` means "ask more firmly" - neither blocks on its own.

### Only verified sessions may teach

Any adaptive system invites the attacker to become the new normal, gradually. The training
pool therefore admits a session only if it scored `LOW`, **or** it passed a genuine step-up
verification.

The second clause is what makes safe adaptation possible: a legitimate owner whose behavior
has genuinely drifted (new laptop, injury, different desk) will trip a `MEDIUM`, prove
identity through the rhythm challenge, and *then* be allowed to update the model. Adaptation
is gated on proof rather than on time.

Enrollment of the rhythm template happens **only during trusted `LOW` sessions**. Enrolling
at the moment of suspicion is precisely backwards, and an earlier version did exactly that -
see `core/DRIFT.md` §C-2.

### Verdicts are sticky; blocks require a run

A single anomalous session triggers **verification**, not a block. Only consecutive `HIGH`
verdicts (`blockAfterConsecutiveHigh = 2`) escalate to `BLOCK_SESSION`.

The rationale is asymmetric cost: owners produce isolated outliers routinely, while a real
takeover produces sustained ones. Held-out, the run rule cut the owner block rate from 9.7%
to 2.4% without moving FAR.

Risk level also has a **sticky floor** - it will not drop below the previous level until
three consecutive `LOW` sessions decay it. The raw model verdict is still reported alongside
(`modelLevel`, `modelScore`, `stickyFloor`) so the smoothing is always visible and never
silently rewrites the score.

### A verdict needs evidence

The window ticks every 30 seconds, but a verdict waits for **150 events** (`minEventsAssess`).
Evidence that has not reached 150 is carried forward for up to 15 minutes instead of being
thrown away. Measured on the shipped library, per-owner EER is 23.8% at 30 events and 12.3%
at 150 (C-33). A window with nothing to judge emits `UNKNOWN` / `ABSTAIN` - never silence,
because silence is always read as safe. Sensitive actions call `assessNow()`, which judges
immediately, has no side effects, and returns `UNKNOWN` (fail closed) when evidence is short.

### Idle is compressed, absence is a security event

Gaps of 15 s or more are shortened to 15 s before features are computed, so an owner who
steps away for coffee is not measured as a different person (AFK-injected held-out: FRR
18.4% -> 9.7% at unchanged FAR, C-28). Absence is still recorded from the original
timestamps: 5 minutes away resets accumulated trust, 15 minutes forces a re-verification
even if behavior afterwards looks normal - the lunch-break attack.

### Step-up grace

After a **proven** step-up (the built-in rhythm challenge verified, or
`reportStepUp({passed:true})`), `MEDIUM` verdicts do not ask again for `mfa.graceSec` (900 s).
Owner friction clusters by day, not by window - an owner flagged once in a visit is usually
flagged in every window of it - so without this an owner who just passed an OTP was asked
again 30 seconds later. `HIGH` still asks, absence revokes it, and graced windows never
train. Owner friction 16.4% -> 14.5% with no security metric worse (C-43); with the C-44
features and time-ordered sessions the shipped default asks the owner 11.4% of verdicts.

### Replay is not behavior

A recorded session replayed with shifted timestamps produces a feature vector identical to
a stored one, which the model would happily call `LOW`. No human repeats themself that
closely (nearest real owner pair: 0.289 standardized RMS), so anything under 0.05 is `HIGH`
and never trains (C-35).

### A verification the user can always complete

The built-in step-up is only useful if the real owner can always finish it. So the dialog
has a way out (`mfa.onFallback`, the integrator's server-verified OTP or WebAuthn), used on
request, when no rhythm template exists yet, when the keyboard differs from enrollment, and
after three failed dialogs in a row (which also closes the brute-force path). A verdict that
opens the dialog is announced at once (`mfa.awaiting`) and again with the outcome, so the
integrator is never blind while the user is typing. Integrators call `stepUp()` for their own
sensitive moments and read `status()` for their own UI; neither exposes the model (C-45).

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
 windows 1 .. 10     ENROLLMENT       vectors pooled, no verdicts emitted
 window 11           first verdict    model built from the 10 baseline vectors
 every 6 new LOW     RETRAIN CHECK    convergence test; rebuild if not converged
 any window          QUALITY GATE     >=100 events, >=5 s, >=6 non-zero features, typed
                                      (not pasted/autofilled); failing windows never train
```

The window ticks on a 30-second timer and on `visibilitychange`. On `pagehide` the unscored
tail is banked to storage and scored on the next page load, so multi-page navigation does
not lose evidence. Nothing else may call `endSession()` on unload - an earlier auto-boot did,
drained the buffer first, and lost every last page (C-40).

The enrollment block is an anchor: it never rolls out of the training pool, which keeps the
last 90 trusted windows on top of it (C-31). Stored history is bounded to the enrollment
block plus 240 entries.

Deduplication of the training pool ignores temporal features, so two genuinely similar
sessions at different times of day are correctly treated as one behavioral sample.

---

## 5. Cross-runtime conformance

The engine is defined once, in prose and numbers, and implemented five times.

```
core/SPEC.md      normative prose  ─┐
core/bg_core.py   readable reference │──▶ core/golden.json ──▶ every port must match
                                    ─┘     319 checks, 1e-9
```

`golden.json` contains **literal inputs and expected outputs** - 204 feature-extraction
checks (six event streams × 34 features) plus 115 engine checks. A new port never has to reproduce a generator; it reads the
file, computes, and compares.

Two portability traps are called out in the spec because both silently break ports:

1. **The `mulberry32` PRNG** must mask every multiply to 32 bits. This is the single most
   common cause of a failing port.
2. **Time-of-day is computed in UTC.** It was local time once, which made feature extraction
   non-deterministic across machines - fatal for a "one brain, every runtime" claim.
3. **A mouse turn exactly on `pi/4`.** `atan2` differs by one ulp between math libraries
   there, which flipped `direction_changes` in one language on 5 of 192 real sessions while
   every golden check passed. The spec compares against `pi/4 + 1e-9` and the golden file
   now carries those real move pairs (SPEC 1.3, C-34).

CI runs Python, JavaScript, Rust, Java and WASM on every push, and additionally verifies
that `golden.json` is still in sync with its generator and that the step-up, detector-gate
and integrity regression suites pass.

---

## 6. Deployment shapes

| Shape | Use when | Entry point |
| --- | --- | --- |
| One `<script>` tag | You control the page | `dist/behaviorguard.js` |
| ES module | You want explicit lifecycle control | `sdk/behaviorguard.js` |
| Hybrid (optional) | Baseline must follow the user across devices | `server/` |

Hybrid mode transmits only 34-float feature vectors and verdicts, never raw events. It is
off unless a public key, an endpoint **and** a short-lived user token (HMAC, minted by your
backend with the tenant secret) are all supplied; the server takes the user id from the
token, never from the request. Read [THREAT-MODEL.md](THREAT-MODEL.md) §4.6 before enabling
it.

---

## 7. Storage

Three tiers, tried in order, so the library never crashes in a private window or with site
data blocked: **IndexedDB -> localStorage -> in-memory**.

Values are HMAC-sealed for tamper detection. This is **integrity, not confidentiality** -
the payload is base64, not encrypted - which is why typed characters are never captured in
the first place (C-30). localStorage writes are capped at 1.8 MB; when trimming, the
enrollment block is always kept and only the progressive history is shortened.

---

## 8. Where to look next

- [`core/SPEC.md`](core/SPEC.md) - the normative contract
- [`core/DRIFT.md`](core/DRIFT.md) - measured gaps between engines, and the C-1..C-45 audit
- [`ports/README.md`](ports/README.md) - how to add a sixth runtime
- [`THREAT-MODEL.md`](THREAT-MODEL.md) - trust boundaries and known attacks
