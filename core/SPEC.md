# BehaviorGuard Core - Engine Specification v1.4.0

This document is the **normative reference** for the BehaviorGuard scoring engine. If the
code and this document disagree, **this document is right and the code is the bug.**

It has one purpose: anyone, in any language, can reimplement this engine and **prove** the
result is identical - not merely "looks about the same".

> Indonesian original: [SPEC.id.md](SPEC.id.md). If the two ever diverge, this English
> version is authoritative; the Indonesian one is kept as the historical source.

---

## 1. Scope

The spec covers the **entire computation path** - from raw events to verdict:

```
raw events  --[ §8 feature extraction ]-->  34-float vector  --[ §5 engine ]-->  verdict
    (v1.1)                                   (exchange format)         (v1.0)
```

- **§8 Feature extraction** (v1.1) - raw events -> 34-float vector. Deterministic, pure
  arithmetic, no DOM. Reference: `sdk/core/features.js` = `bg_core.py:extract_features`.
- **§2-§7 Scoring engine** (v1.0) - 34-float vector -> verdict.

**Explicitly out of scope** (platform-specific, not pure arithmetic):

- Event capture (DOM/touch/native) - it only *populates* the event structure in §8.1
- Storage, networking, session lifecycle, rate limiting, integrity checks, the challenge

**The 34-float vector is this system's primary exchange point**: it is what the server
stores in `baselines.vectors_json` and what `reproduce_db.py` reads from the research
database. §8 now closes the path *before* that exchange point, so a port in another
language can **read behavior**, not just score an already-computed vector.

---

## 2. Feature vector

34 names (28 + 6 keystroke-rhythm features added in v1.4.0), in a **fixed and binding order** - index *i* means the same thing in every
language. The exact list is in `core/golden.json` under `features`, and in `bg_core.py:F4`.

Every element is a double-precision float (IEEE-754 binary64), and is always finite.

---

## 3. Normative constants

| Key | Value | Purpose |
|---|---|---|
| `iforest.n_estimators` | 100 | number of trees |
| `iforest.max_samples` | 256 | subsample size |
| `iforest.seed` | 42 | PRNG seed |
| `weights` | IF 0.30 / SVM 0.70 / LSTM 0.00 | blend weights (detector-2 = Mahalanobis, given the majority) |
| `model2` / `mahalanobis.shrink` | `mahalanobis` / 0.3 | detector-2 and diagonal shrinkage (v1.2) |
| `ensembleMinSamples` | IF 8 / SVM 20 / LSTM 24 | gate: below this the weight is zeroed |
| `calibrationMode` | `parametric` | threshold calibration mode (v1.2) |
| `k_low` / `k_med_extra` | 1.75 / 2.0 | parametric calibration: `low = mean − k·std` (v1.3.0; was 3.3) |
| `q_low` / `q_med` | 0.10 / 0.033 | threshold quantiles (legacy `quantile` mode) |
| `blockAfterConsecutiveHigh` | 2 | run rule: hard block only after N consecutive HIGH (SDK layer) |
| `baseline` / `retrainEvery` | 10 / 6 | enrollment and retraining cadence |
| `stdFloorEps` / `stdFloorValue` | 1e-9 / 1.0 | **S-1** per-feature standard-deviation floor |
| `scoreStdMin` / `scoreStdMax` | 1e-3 / 10.0 | **S-2** score standard-deviation clamp |
| `zClamp` | 6.0 | **S-2** z-value clamp |

**S-1 and S-2 are proven divergence points** between the two copies of the engine in this
repository (`sdk/core/*.js` and `tools/reproduce_db.py`). The values above are the
behavior of the JS SDK that actually ships to users' sites. See `core/DRIFT.md`.

---

## 4. PRNG - `mulberry32`

All randomness comes from one generator, seeded by `seed`, called in a binding order.
Arithmetic is **unsigned, modulo 2³²**:

```
a := (a + 0x6D2B79F5) mod 2^32
t := a
t := ((t XOR (t >> 15)) * (t OR 1)) mod 2^32
t := (t XOR (t + ((t XOR (t >> 7)) * (t OR 61)) mod 2^32)) mod 2^32
output := ((t XOR (t >> 14)) mod 2^32) / 2^32
```

Languages with 64-bit integers **must** mask every multiplication with `0xFFFFFFFF`.
Missing this is the single most common cause of a failing port.

---

## 5. Computation flow

The order is binding. Each step must occur exactly at this position.

### 5.1 Baseline statistics
**Population** mean and standard deviation (divisor *n*, not *n−1*) per feature.
Then **S-1**: `std[i] := (sqrt(var[i]) < 1e-9) ? 1.0 : sqrt(var[i])`.

### 5.2 Standardization
`x_std[i] := (x[i] − mean[i]) / std[i]`. No clamping at this stage.

### 5.3 Isolation Forest
For each of the 100 trees, sequentially, sharing **one** PRNG stream:

1. Backward Fisher-Yates over indices `0..n−1`, `j := floor(rng() × (i+1))`
2. Take the first `n = min(256, |X|)` indices
3. Build the tree recursively, maximum depth `ceil(log2(n))`:
   - leaf if `depth >= maxDepth` or `|points| <= 1`
   - `feat := floor(rng() × n_features)`
   - leaf if `min == max` on that feature
   - `split := min + rng() × (max − min)`
   - left `< split`, right `>= split`; leaf if either side is empty

Path length: `depth + c(leaf_size)`, where
`c(n) = 2(ln(n−1) + 0.5772156649) − 2(n−1)/n`, `c(0)=c(1)=0`, `c(2)=1`.

Score: `0.5 − 2^(−avg_h / c(n))`. **More negative = more anomalous.**

### 5.4 Detector-2: Mahalanobis + diagonal shrinkage (v1.2)

Replaces the legacy centroid-RBF (§5.4 in v1.1). One formula, portable, zero
dependencies - equivalent to `sdk/core/mahalanobis.js`. From the standardized baseline
pool `X` (n×d):

1. `μ` = per-feature mean; `S` = covariance `(Σ (x−μ)(x−μ)ᵀ)/(n−1)`.
2. Diagonal shrinkage: `Σ := (1−a)·S + a·μ̄·I` where `a = shrink (0.3)` and `μ̄` is the
   mean of the diagonal of `S`; then `Σ_ii += 1e-6`.
3. `Σ⁻¹` by Gauss-Jordan with **partial pivoting** (pivot = the row with the maximum
   |value| in the column, using a strict `>` so the first maximum wins; if
   `|pivot| < 1e-12`, set it to `1e-12`).
4. `score(x) = −√( (x−μ)ᵀ Σ⁻¹ (x−μ) )` (clamped to 0 if negative). Higher = more normal.

The float operation order (outer-i / inner-j loops, full row normalization, elimination)
**must be identical** across languages to stay bit-exact within 1e-9. The legacy formula
remains in `ocsvm.js` for `model2='centroid'`. Background: the centroid collapses the pool
to a single point -> FAR 36%; Mahalanobis accounts for covariance -> held-out FAR **5.4%**,
FRR **16.1%**, AUC **0.942**, EER **11.9%** in the offline research harness, which scored
whole ~700-event sessions. The shipped library, measured in the 30-second windows it
actually scores (`tools/eval_sdk.mjs --live`), is reported in the README. See `DRIFT.md`
C-29.

### 5.5 Calibration and blending
For each sub-model: mean and standard deviation of its baseline scores, then **S-2**
`std := clamp(std, 1e-3, 10.0)`. The z-value is `z := clamp((s − mean)/std, −6, +6)`.

Weights are gated: if `n < 20` then `svm := 0`; if `n < 24` then `lstm := 0`; then they
are renormalized to sum to 1. If `svm == 0`, the output is `z_IF` alone. Otherwise:
`score := w_IF · z_IF + w_SVM · z_SVM`.

> **Implementation note (not part of the numeric contract).** The gate decision is frozen
> into the model when it is built, so a model built below a threshold keeps that detector
> disabled until it is rebuilt. A host that stops retraining on convergence must still
> force a rebuild when the pool crosses a gate threshold, or the detector never activates.
> See `DRIFT.md` §C-15.

### 5.6 Thresholds
**`parametric`** mode (default in v1.2): from the baseline scores' `mean` and `std`
(population; `std := 1` if the variance is ≤ 1e-12): `low := mean − k_low·std`,
`med := mean − (k_low + k_med_extra)·std`. No clamping - the bands follow the owner's
score distribution rather than a single order statistic of a 10-sample quantile.

**`quantile`** mode (legacy, `calibrationMode='quantile'`): linearly interpolated
quantiles over the sorted scores, `low := Q(q_low)`, `med := Q(q_med)`; if
`low − med < 0.15` then `med := low − 0.25`; then `low := clamp(low, −3, 1)` and
`med := clamp(med, −3, low − 0.05)`.

### 5.7 Verdict and action
`score <= med` -> **HIGH**; `score <= low` -> **MEDIUM**; otherwise -> **LOW**.
`topFeatures` = the 3 features with the largest |z|, sorted descending.

Per-session action (`to_action`, stateless): **HIGH -> `REQUIRE_STEPUP`**, MEDIUM ->
`REQUIRE_MFA`, LOW -> `ALLOW_SESSION`. HIGH does **not** block on its own: a single
anomalous session asks for step-up verification (the owner passes, an impostor fails).
**A hard block (`BLOCK_SESSION`) is raised by the stateful SDK layer**
(`BehaviorGuard.assess`) only after `blockAfterConsecutiveHigh` consecutive HIGH verdicts -
an owner having a bad day produces scattered HIGHs (step-up), while a real takeover
produces consecutive ones (block). Held-out: owner block rate 9.7% -> 2.4%, FAR unchanged.
That layer is **outside** the golden file (which tests the stateless `to_action`).

---

## 6. Conformance - how to prove your port is correct

An implementation is **conformant** only if it passes `core/golden.json` at a relative
tolerance of **1e-9**:

- **§8 feature extraction** - 6 feature cases × 34 elements = **204 vector checks**, from
  the explicit raw events in `feature_cases` (the fifth, `_fc_atan2_pi4_edges`, holds real
  mouse moves that turn exactly on `pi/4`, v1.3.0; the sixth, `fc06_keystroke_rhythm`,
  covers key classes from `kc` and from ASCII characters, v1.4.0).
- **§2-§7 engine** - 3 cases, 16 probes = **115 verdict checks**, from `cases`.
- **319 checks** in total.

The golden file stores **explicit inputs** (not generators), so a port never has to
reproduce any generator. Intermediate values are stored too (`stats_*`, `if_stats`,
`svm_stats`, `gated_weights`) so a failure can be localized rather than just reported as
"the result differs".

| Implementation | How to test | Status |
|---|---|---|
| Python `core/bg_core.py` | `python core/conformance.py` | **CONFORMANT** 319/319 |
| JS `sdk/core/*.js` (browser) | open `core/conformance.html` over a local server | **CONFORMANT** 319/319 |
| JS `sdk/core/*.js` (Node/CI) | `node core/conformance.node.mjs` | **CONFORMANT** 319/319 |
| Rust `ports/rust` | `cd ports/rust && cargo run --release` | **CONFORMANT** 319/319 |
| Java `ports/java` (JVM/Android) | `java ports/java/BgConformance.java core/golden.json` | **CONFORMANT** 319/319 |
| **WASM** `ports/wasm/bg_core.wasm` | `node ports/wasm/run.mjs` (or `ports/wasm/index.html`) | **CONFORMANT** 319/319 |
| A new port (Go/Swift/C#) | mirror the logic of `conformance.py`; see `ports/README.md` | - |

All ports are **dependency-free** (standard library only, including a small hand-written
JSON reader in the compiled ports). CI runs all of them on every push -
`.github/workflows/conformance.yml`.

Regenerate the golden file **only** when the spec changes, and record why in `DRIFT.md`:

```bash
python core/gen_golden.py
```

---

## 7. Versioning

Semantics: **major** = numbers change; **minor** = surface added, existing numbers
unchanged; **patch** = documentation clarification only. `golden.json` records the
`spec_version` it complies with.

- **v1.4.0** (2026-09-11) - **MAJOR**: six keystroke-rhythm features appended to F4
  (28 -> 34, §8.10): in-burst flight median and IQR, backspace ratio, cross-hand/same-hand
  flight ratio, dwell median, shift ratio. Every golden number changes (the engine cases
  are generated with d = |F4|). Measured with the shipped SDK on time-ordered sessions:
  owner asked to verify 12.2% -> 11.4%, impostor passes first verdict 12.6% -> 10.5%,
  per-owner AUC 0.942 -> 0.953 (DRIFT C-44).
- **v1.3.0** (2026-09-11) - **MAJOR** (numbers change in two places):
  (1) §8 `direction_changes` compares against `π/4 + 1e-9`. Without the tolerance, `atan2`
  differences of 1-2 ulp between libm implementations flipped the comparison in one
  language only, on 5 of 192 real sessions, although all 227 golden checks passed. A golden
  case built from those real move pairs (`fc05_atan2_pi4_edges`) now locks it.
  (2) Default `k_low` 3.3 -> **1.75** (recorded explicitly in `golden.json` `config`).
  The v1.2.0 held-out figures below were measured by a Python imitation of the engine on
  whole research sessions, and **do not describe the shipped SDK**. The SDK is now measured
  by itself: `tools/eval_sdk.mjs --live` (DRIFT C-29, C-33).
- **v1.2.0** (2026-09-04) - **MAJOR**: detector-2 centroid-RBF -> **Mahalanobis +
  shrinkage** (§5.4), threshold calibration -> **parametric** (§5.6), IF/SVM weights
  0.70/0.30 -> **0.30/0.70**, HIGH action `BLOCK_SESSION` -> **`REQUIRE_STEPUP`** plus the
  run-rule block (§5.7). `golden.json` regenerated; engine numbers changed throughout.
  Held-out: FAR 36.2% -> **5.4%**, EER 21.0% -> **11.9%**; owner block rate 9.7% -> **2.4%**.
  Feature extraction (§8) unchanged. See `DRIFT.md`.
- **v1.1.0** (2026-09-03) - adds §8, feature extraction. The v1.0 engine numbers are
  **unchanged** (the golden `cases` are identical). The only numeric change:
  `temporal_time_of_day_score` is now computed in UTC rather than local time - a
  portability fix, not an accuracy adjustment. See §9 and `DRIFT.md` (F-1).
- **v1.0.0** (2026-09-03) - the scoring engine (vector -> verdict).

---

## 8. Feature extraction (raw events -> 34-float vector)

This section is **normative**. Code reference: `sdk/core/features.js:extractF4` and its
exact counterpart `bg_core.py:extract_features`. Both pass the same `feature_cases`.

### 8.1 Event structure

The input is an **ordered list of events**. Each event has:

| Field | Type | Required | Read by |
|---|---|---|---|
| `event_type` | string | yes | type dispatch |
| `timestamp` | epoch **milliseconds** | yes | nearly every temporal feature |
| `x`, `y` | pixel numbers | for movement | velocity / direction / curvature |
| `key` | string | for keystrokes | transition entropy, key class (§8.10) |
| `kc` | string | optional, keystrokes | key class (§8.10); written by capture from the physical key position |
| `hold_time` | milliseconds | for keystrokes | dwell mean and std |
| `velocity` | number | optional | `cursor_idle_ratio` (see 8.4) |
| `page_url` | string | for navigation | page and transition counts |
| `scroll_delta` | number | for scrolling | scroll depth |

Missing or `None` field values are treated as **0** (equivalent to `x || 0` in JS), except
`hold_time`, which is *filtered* (only non-`None` values enter the average), and `key`,
which becomes an empty string.

Recognized `event_type` values: `MOUSE_MOVE`, `MOUSE_CLICK`, `MOUSE_SCROLL`, `KEYSTROKE`,
`FORM_FOCUS`, `FORM_BLUR`, `NAVIGATION`, `PAGE_STEP`, `CART_ACTION`.

### 8.2 General rules

- **`mean`** = arithmetic mean; an empty array gives `0`.
- **`std`** = **population** standard deviation (divisor *n*); an empty array gives `0`.
- **`safe(v)`** = `v` if it is a finite number, otherwise `0`. The output is **always** 34
  finite values.
- **The combined mouse ordering** `mouse_ev` = `[...MOUSE_MOVE, ...MOUSE_CLICK, ...MOUSE_SCROLL]`
  (concatenated by type, **not** sorted by time). The kinematics loop runs over this order.
- Events stay in their input order for `flight_time`, entropy and burst computations.

### 8.3 Mouse kinematics (loop over `mouse_ev`, i=1..)

For each pair `(p=mouse_ev[i-1], c=mouse_ev[i])` with `dt = c.ts − p.ts`:

- `dt ≤ 0` -> **skip** that pair.
- `dist = hypot(c.x−p.x, c.y−p.y)`, `v = dist/dt` -> append to `velocities`.
- **direction**: if `dist > 0`, `dir = atan2(dy,dx)`; if `last_dir` exists and
  `|dir − last_dir| > π/4 + 1e-9` then `direction_changes += 1`; set `last_dir = dir`.
  (v1.3: the `1e-9` is normative. Integer-pixel moves hit a direction change of exactly
  π/4 very often, and `atan2` differs by 1-2 ulp across libm implementations there, so
  a bare `> π/4` flips in one language only - measured: 5 of 192 real sessions.)
- **acceleration**: if `|velocities| > 1`, `a = (v − velocities[−2])/dt` -> `accelerations`.
- **curvature** (needs 3 points, `i ≥ 2`, `p2 = mouse_ev[i-2]`):
  `area = x0(y1−y2) + x1(y2−y0) + x2(y0−y1)`; `sa,sb,sc` are the side lengths;
  if `sa·sb·sc > 0` then append `|4·area/(sa·sb·sc)|` to `curvatures`.
- **pause**: if `dt > 100` then `pauses += 1`.

`click_intervals` = timestamp differences between consecutive `MOUSE_CLICK` events.

### 8.4 `cursor_idle_ratio`

Only if `MOUSE_MOVE` events exist:
`idle = |{e ∈ MOUSE_MOVE : (e.velocity || 0) < 0.5}|`, `ratio = idle / |MOUSE_MOVE|`.
If the result is **exactly 0** and `velocities` is non-empty, use the fallback:
`ratio = |{v ∈ velocities : v < 0.05}| / |velocities|`.
With no `MOUSE_MOVE` events -> `0`.

### 8.5 Mouse-keyboard coordination

Concatenate `mouse_ev + key_ev` and **sort stably by timestamp**. Count `alternations` =
how many times the type (`mouse`/`keyboard`) changes between adjacent events.
`cross_mouse_keyboard_coordination = alternations / |combined|` (0 if empty).
The type is decided by whether `event_type` contains the substring `"MOUSE"`.

### 8.6 Keystrokes

- `hold_times` = the non-`None` `hold_time` values -> dwell mean and std.
- `flight_times` = timestamp differences between consecutive KEYSTROKE events (input order).
- **transition entropy**: with fewer than 2 keystrokes -> `0`. Otherwise count the bigram
  frequencies `key[i-1]->key[i]` (`n−1` transitions); `H = −Σ p·ln(p + 1e-9)` where
  `p = count/(n−1)`.
- **burst**: walk consecutive KEYSTROKE events; `dt < 333` starts a new burst (increment
  `burst_count` on *entering* a burst), `dt ≥ 333` ends it.
- `typing_speed = |key_ev| / duration` if `duration > 0`, otherwise `0`.
- **cross-field cadence**: for each `FORM_FOCUS` (in timestamp order), take the last
  KEYSTROKE *before* it and the first *at or after* it; their difference goes into
  `cross_gaps`. The feature is `mean(cross_gaps)`.

### 8.7 Temporal

- `first_ts = events[0].ts || session_start_ts || 0`; `last_ts = events[−1].ts || first_ts`.
- `duration = (last_ts − first_ts)/1000` seconds.
- **`temporal_time_of_day_score` = `(UTChours + UTCminutes/60)/24`** from `first_ts`.
  **UTC is mandatory** (not local time) - see §9.
- **activity bursts**: group events per second (`floor(ts/1000)`), take the array of
  per-second counts; `bursts = |{c : c > mean + 2·std}|`.

### 8.8 Navigation and forms

- `nav_ev` = events of type `NAVIGATION` or `PAGE_STEP`.
- `nav_page_transition_pattern = |unique(page_url in nav_ev)| / |page_url in nav_ev|`
  (0 if there are none).
- `nav_scroll_depth_mean = mean(|scroll_delta|)` over `MOUSE_SCROLL`.
- `nav_page_count = |unique(page_url over ALL events)|`.
- `nav_step_transition_count = |nav_ev|`.
- `form_focus_count`, `form_blur_count` = counts of the corresponding events.
- `form_field_switch_rate = mean(positive differences between time-ordered FORM_FOCUS)`.
- `cart_action_count = |CART_ACTION|`.

### 8.9 Output assembly

Arrange all 34 values **in F4 order** (§2). Each value is wrapped as `safe(value || 0)`.
The result is a dict/array of 34 elements, all finite - ready to enter §5 as the feature
vector.

### 8.10 Keystroke rhythm (v1.4.0)

`key_ev` = KEYSTROKE events in input order.

**Key class** `cls(e)`:
1. if `e.kc` is a non-empty string -> that string;
2. else if `e.key` is not a string -> `O`;
3. else if `e.key` is a single character with code < 128: fold `A`-`Z` to lower case, then
   `qwertasdfgzxcvb` -> `L`, `yuiophjklnm` -> `R`, `0`-`9` -> `D`, space -> `S`, anything
   else -> `P`;
4. else `Backspace` or `Delete` -> `E`, `Shift` -> `H`, anything else -> `O`.

Capture writes `kc` (`L`/`R`/`D`/`S`) from the **physical** key (`KeyboardEvent.code`), so
the class does not depend on the layout and the typed character is never needed. It is
**not** written in password fields; there these two class features read `0`.

One pass over `key_ev` (i = 0..):
- `dw` ← `hold_time` when it is present and `0 < hold_time < 1000`.
- counts: `back` (class `E`), `shift` (class `H`), `letters` (class `L` or `R`).
- for i ≥ 1, `dt = key_ev[i].ts − key_ev[i−1].ts`; if `0 < dt < 1000`: `dt` -> `fl`, and
  when both classes are `L`/`R`, `dt` -> `same` (equal classes) or `cross` (different).

`median` sorts ascending; odd length -> middle element, even -> mean of the two middle
elements, empty -> 0. `iqr` = `b[floor(0.75·n)] − b[floor(0.25·n)]` over sorted `fl` when
`n > 3`, else 0.

| Feature | Value |
|---|---|
| `keystroke_flight_median` | `median(fl)` |
| `keystroke_flight_iqr` | `iqr` |
| `keystroke_backspace_ratio` | `back / |key_ev|` (0 if empty) |
| `keystroke_cross_hand_ratio` | `median(cross) / median(same)` when both > 0, else 0 |
| `keystroke_dwell_median` | `median(dw)` |
| `keystroke_shift_ratio` | `shift / letters` (0 if no letters) |

---

## 9. Determinism and portability (F-1: UTC time)

Feature extraction must produce an **identical vector for identical events, on any machine
and in any time zone**. The only violation in the original code was
`temporal_time_of_day_score`, which used `Date.getHours()` - **local time**. Two computers
in different time zones would produce a different 18th feature from the same input, and
therefore different standardization and different scores.

**v1.1 decision:** that feature is computed in **UTC** (`getUTCHours` / `getUTCMinutes`),
in both `features.js` and `bg_core.py`. This is a **portability** fix, not an accuracy
adjustment - the value still means "what time of day the session started", just on a
timeline that is the same for everyone. Recorded as **F-1** in `DRIFT.md`.

Other sources of non-determinism are already safe: no `Date.now()` is used as long as
event `timestamp` values are populated; all sorts are **stable**; and the transcendental
functions (`atan2`, `log`, `hypot`, `sqrt`) are applied to inputs kept away from fragile
thresholds in `feature_cases`, so cross-runtime ULP differences stay below the 1e-9
tolerance.
