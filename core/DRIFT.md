# Engine Drift Report - 2026-09-03, updated 2026-09-04

> **STALENESS WARNING:** the D-2 numbers below ("0 of 16 probes change verdict",
> "maximum score difference 1.271") were measured BEFORE detector 2 was switched to
> Mahalanobis (2026-09-04). Re-measured today: **8 of 16 probes change verdict,
> maximum score difference 4.201**. See the section "Re-measurement 2026-09-04".

This repo has **two separately hand-written copies of the engine**:

| | File | Role |
|---|---|---|
| **A** | `sdk/core/*.js` | the engine that is **actually installed** on people's sites |
| **B** | `tools/reproduce_db.py` | the engine that **produces the headline numbers** in the README |

The two were never cross-tested. This file reports the results of doing so.
Reproduce: `python core/drift_check.py`.

---

## First result: good news

**`sdk/core/*.js` matches `core/bg_core.py` on 115/115 checks at tolerance 1e-9.** The
engine shipped to users now has a Python twin that is identical to the 9th digit, proven
through the same golden file.

Meaning: the foundation for "one brain, many languages" is solid. What remains is the
gap between the engine that is **shipped** and the engine that is **validated**.

---

## D-1 · Different per-feature standard deviation floor

| | Behaviour |
|---|---|
| A (shipped) | `sqrt(var) < 1e-9 ? 1.0 : sqrt(var)` |
| B (validation) | `sqrt(var) > 1e-6 ? sqrt(var) : 1.0`, then `max(std, 1e-3)` |

**Proven:** for a nearly constant feature (`std ≈ 1e-7`), A uses `4.08e-08` while B uses
`1.0` - a difference of **seven orders of magnitude**. A nearly constant feature blows up
into a huge z-value in A, but is damped to ~0 in B.

**When it bites:** accounts where one feature is constant - for example
`cart_action_count` is always 0 because the user never checks out. That is an ordinary
situation, not an odd one.

**Recommendation:** adopt behaviour B (`max(std, 1e-3)`) on both sides. It is safer and does
not change the numbers on data with normal variation. **Requires regenerating the golden
file** and re-running `reproduce_db.py` to see how the numbers shift.

---

## D-2 · A clamps extreme values, B does not

| | `score_stats` std | z-value |
|---|---|---|
| A (shipped) | clamped to `[1e-3, 10]` | clamped to `[−6, +6]` |
| B (validation) | floored at `1e-6`, **no upper bound** | **no clamp** |

**Proven:**

- for the same set of scores, `std` A = `10.000` vs B = `25.369`
- for an extreme score, z A = `6.000` vs B = `39.418`

**Measured impact:** on 3 golden cases with the OC-SVM engine made identical, the
**maximum score difference is 1.271**. For comparison, the thresholds in those cases sit
around −1.1 to −1.8 - so the difference is **as large as the gap between risk bands.**

What is interesting: **the thresholds themselves are identical (difference 0.000)** and
**0 of 16 probes change verdict**. The reason makes sense: thresholds are calibrated from
calm baseline scores, while the ±6 clamp only kicks in on outlier sessions. So this
difference is **invisible on ordinary data and only appears on the most suspicious
sessions** - exactly the sessions that matter most to judge correctly.

**Recommendation:** adopt behaviour A (the clamp) on both sides. The clamp is correct -
without it a single outlier feature can dominate the whole score.

---

## D-3 · Summary of the safeguards

All three safeguards behave differently; all of them only act in extreme cases, not on
ordinary data. That is why this kind of drift can go unnoticed for years.

---

## D-4 · The thesis numbers use a different SVM formula

The SVM part has two versions of the formula:

| | SVM formula version |
|---|---|
| A (shipped) | centroid-RBF approximation - `sdk/core/ocsvm.js`, 36 lines, runs in the browser |
| B (thesis measurement) | scikit-learn `OneClassSVM` - `tools/reproduce_db.py` |

**Proven:** of 16 golden probes, **3 change verdict** just by swapping the formula version.

This is **not a new finding** - the README already records it honestly (FAR 0.9% with the
scikit-learn version vs 36.2% with the light version). Only its status changed: from a
footnote to a measured, automatically tested difference.

**Decision 2026-09-03:** this library uses **the light version only**. The scikit-learn
version is not shipped, because training it needs scikit-learn, which does not run in a
browser. `core/` now has a single formula; there is no longer a confusing choice.

`tools/reproduce_db.py` is **deliberately left untouched** - that is where the thesis
numbers are reproduced, and it must keep running as is.

Still to do (deferred, not forgotten):

- **Label the numbers in the README** - every number names the formula version behind
  it, so `FAR 0.9%` is not read as a promise of this library.
- **Re-measure on the light version** - including re-checking the feature choice, because
  the README notes the order flips on the light version (F4 worst 36.2% vs F3 20.6%).
- **Fix the formula**, not just record its numbers. The current version flattens the whole
  baseline pool into one mean point. Alternatives that can be trained in the browser
  (e.g. distance to the nearest baseline session) keep that variation.

---

## F-1 · Feature extraction: local time -> UTC (ALREADY fixed)

This difference is not A-vs-B like D-1..D-4, but **A against itself on different
machines**. The `temporal_time_of_day_score` feature used `Date.getHours()` - **local
time** - so exactly the same events produced different vectors depending on the computer's
time zone. That made feature extraction **non-deterministic across machines**, poison for
the "universal" claim.

**Decision 2026-09-03 (v1.1.0):** compute that feature in **UTC** (`getUTCHours` /
`getUTCMinutes`) in `sdk/core/features.js`, `extension/core/features.js`, and
`bg_core.py:extract_features`. This is a portability fix, **not** accuracy tuning - it
still means "what time the session started", just on the same timeline for everyone.

**Status:** done and proven. Feature extraction is now part of `core/golden.json`
(`feature_cases`, 4 cases × 28 = 112 checks) and JS == Python **227/227** in both
`conformance.py` and `conformance.html`. See `SPEC.md` §8-§9.

---

## Recommended fix order

Items 1 and 2 are cheap and safe to do at any time. Items 3 and 4 wait until the library
is finished - as planned: put the house in order first, the contents later.
(F-1 above is already settled.)

1. **D-2 unify the clamp** to behaviour A - small, fixes outlier sessions
2. **D-1 unify the std floor** to behaviour B - needs a regenerated golden file and a
   re-run of `reproduce_db.py`, so do it when there is time to check how the numbers shift
3. **Formula-version labels in the README**
4. **Re-measure + fix the SVM formula**

After each change: `python core/conformance.py` and open `core/conformance.html`. Both
must still say **SESUAI** (conformant) before it counts as done.


---

# Re-measurement 2026-09-04 (after Mahalanobis)

`python core/drift_check.py`:

```
selisih skor maksimum: 4.201e+00   vonis berbeda: 8/16
KESIMPULAN: primitif BERBEDA
```

Up from **0/16 -> 8/16** since detector 2 was replaced. The direction of the error
matters: several cases are **validation=HIGH but SDK=LOW** - sessions the research
pipeline flags as an intruder are **let through** by the library that is actually
installed.

**Consequence for claims:** the headline FRR/FAR numbers come from `reproduce_db.py`
(engine B). They are **not** the numbers that apply to `sdk/core/*.js` (engine A). Until
D-1/D-2 are unified, every number quoted **must name its engine**.

Not yet changed: D-1 (std floor) and D-2 (clamp) still differ - both stay in the fix
queue, and their measured impact is now much larger than first estimated.

---

# C-1..C-19 · Logic gaps in the defence layers (audit 2026-09-04)

The D-* differences above are about **numbers**. This part is about **security control
logic** - found through adversarial tracing, all of it patched and locked by tests.

## C-1 · CRITICAL - rhythm verification fails OPEN (paste bypass)

`challenge.js:verify()` iterates over the length of the **template**, not of the **sample**:

```js
for(let i=0;i<tmpl.dwell.length;i++){
  const d=Math.abs(sample.dwell[i]-tmpl.dwell[i]);  // undefined -> NaN
  if(d > tmpl.k*tmpl.dwellMad[i]) reasons.push(...) // NaN > x === false -> PASSES
}
```

A sample shorter than the template ⇒ `undefined` ⇒ `NaN` ⇒ the comparison is always false
⇒ **zero violations** ⇒ `ok:true`. Two real paths:

- **right-click -> Paste**: zero key events -> `dwell=[]` -> passes completely.
- **Ctrl+V**: `'Control'` is filtered out, but `'v'` passes the `key.length===1` filter ->
  only 1 dwell is recorded, the rest are `undefined` -> still passes.

The text check (`norm(value)===norm(phrase)`) does not help: the attacker still has to know
the phrase, but once they do, **the whole rhythm layer evaporates**. This is far below the
limit already acknowledged in `mfa.js` ("an attacker who controls the browser") - it needs
no tooling at all.

**Patch:** `verify()` now fails CLOSED - the sample's length and finiteness must match the
template; a proportional miss budget (12% of the number of checks) replaces the fixed
`<=2`; MAD is clamped with a floor and a ceiling; phrases with < 8 measurement points are
rejected. `mfa.js` blocks `paste`/`drop`/`cut`, ignores modified key presses, and rejects
incomplete samples **before** calling `verify()`.
Locked by: `core/challenge.test.mjs` (20 tests).

## C-2 · CRITICAL - an intruder could ENROLL their own MFA template

`_maybeMfa()` calls `runMfaChallenge({template: this.challengeTemplate})`. On a new device
storage is empty ⇒ `challengeTemplate` is null ⇒ **ENROLL mode**. The flow:

1. The intruder opens the account on a new device -> behaviour deviates -> verdict HIGH.
2. The popup appears in enroll mode -> the intruder types the phrase 3× with **their own**
   rhythm.
3. `res.passed===true` -> `action='MFA_PASSED'`, `_highRun=0`, `mfaVerified=true`.
4. That session goes into the training pool -> the model learns the intruder's behaviour.

The default phrase (`'kunci rahasia saya'`) is in `config.js` - public. This is a complete
ATO chain that uses the defence layer itself as the way in.

**Patch:** enrollment never happens while the session is suspected. Without a template,
`_maybeMfa` fails closed (`mfa.unavailable`) and the risk action still applies.
Enrollment moved to `_maybeEnrollMfa()` - only on an eligible **LOW** verdict with a model
already built.

## C-3 · Enrollment counted as proof of identity + a sticky floor that never clears

`res.passed` was true for both enroll **and** verify mode. Now only `res.verified` (a real
verification) proves identity. In addition, a passed MFA used to reset `_highRun` but
**not** `lastRisk` - the sticky floor kept forcing HIGH verdicts in the next session,
raising the popup again and again. It is now reset too.

## C-4 · Rate-limit blocks never reached the integrator

The `checkCollect` path failed with a `return` without calling `onRisk`, while the
integrity path did call it. The integrator never learned the session was blocked. Now
consistent.

## C-5 · A non-finite score fails OPEN to LOW

`toRisk()` used `score <= thr`; for `NaN` that is **always false** ⇒ falls through to `LOW`.
A broken model or statistic was therefore read as "safe". Now `!Number.isFinite(score)`
is handled explicitly as an anomaly (`degraded:true`) and does not train the model.

## C-6 · Score faked to match the forced level

`score=Math.min(score,-0.9)` overwrote the real score while the sticky floor was active.
Because thresholds are calibrated per user (`low` can be −3.5), −0.9 often lands in the LOW
band ⇒ `level` and `score` **contradict each other**, and the fake number was stored in the
session and sent to the cloud log. Now the real score is kept; the raised level is marked
`stickyFloor:true` and the model's raw verdict is reported too
(`modelLevel`/`modelScore`).

## C-7 · `clear()` leaks the template between users

`clear()` did not reset `challengeTemplate`, `_highRun`, `_mfaPassedAt`. The previous user's
template was still used to verify the next user in the same tab.

## C-8 · The Ensemble weight fallback used the old configuration

`new Ensemble(...)` without `weights` used `{IF 0.7, SVM 0.3}` - the **reverse** of
`DEFAULTS` (`IF 0.30 / detector 2 0.70`), i.e. the old, worse W7 configuration.
It now takes `DEFAULTS.weights`.

## C-9 · The extension orchestrator was a stale hand copy

`tools/sync_core.ps1` synced `sdk/core/*` and `storage.js`, **but not**
`behaviorguard.js`. `extension/behaviorguard.js` was shown to be identical to the old
version - meaning none of the fixes C-1..C-8 would ever reach the extension. The sync
script now covers the orchestrator and verifies it.

## C-10 · `storage.del()` throws an uncaught error

Unlike `idbGet`/`idbSet`, `del()` called `db.transaction()` directly inside `onsuccess`
**without** `onupgradeneeded` and **without** an `objectStoreNames.contains` check. The
surrounding `try/catch` is synchronous, so it cannot catch a throw in that async callback.
As a result `NotFoundError: ... object stores was not found` surfaced as an uncaught error
when the store had never been created (e.g. `clear()` on a fresh profile) - breaking the
"never crashes" promise written at the top of that very file. Found in the browser console
while testing C-7, not by reading the code.

**Patch:** `idbDel()` now has the same shape as `idbGet`/`idbSet` (create the store when
needed, check it exists, resolve via `tx.oncomplete`/`onerror`, never throw).
Verified in the browser: `del` on an empty store does not throw, and zero
`unhandledrejection`.

## C-11 · The `mfa` knob was documented but never existed

`init()` did not accept an `mfa` option at all, and auto-boot only forwarded
`['weights','baseline','retrainEvery','features','thresholds']`. So
`window.BehaviorGuardConfig = { mfa:{ enabled:false } }` was **silently ignored** - an
integrator who wanted to handle step-up themselves still got the built-in popup, with no
error message at all. Now `mfa` is accepted and **merged** (not replaced) with the defaults,
so a partial configuration still inherits the rest. Verified in the browser.

## C-12 · The attack simulator was completely dead

`demo/attack_sim.html` used `bg._instance`, but the module's default export **already is**
the singleton (`_instance` only exists on `window.BehaviorGuard`). `init()` threw at module
level, so the `window.run` below it was never installed and all four attack buttons did
nothing, with no trace in the UI. The flagship Arsenal demo could not be clicked. Fixed to
`bg._instance || bg`, plus `mfa:{enabled:false}` so the automated simulator does not raise
the popup.

## C-13 · The owner seed data was rejected by its own integrity check

`seedOwner()` put `FORM_BLUR` (base+1500) as the **last** event while mouse moves ran up to
base+3570. Integrity computes duration as `ts[last]-ts[0]` = 1.5 s, so 130 events read as
**87/s** (above the 80/s threshold) and as non-monotonic. As a result **every** owner
session was flagged by integrity, `eligible=false`, the training pool never filled and the
model was never built - so the three HIGH verdicts in the simulator actually came from the
bot heuristics, **not from the behaviour model**, and mimicry fell into the enrollment path
and was reported LOW. A demo that never ran its own engine. Fixed: human time spans
(~24 s/session), per-event jitter, and mandatory timestamp ordering. Now 24/24 sessions are
eligible and the model is built.

## C-14 · The simulator seeded exactly at the number that disables the main detector

After C-13, the 10-session seed was still **below** `ensembleMinSamples.svm = 20`, so
detector 2 (weight 0.70) was gated off and mimicry was fought by Isolation Forest alone.
The seed was raised to 24 and the gate status is now printed in the demo log.

## C-15 · CRITICAL - convergence froze the model BEFORE the ensemble gate opened

The most important finding of this session, and found only because C-12/C-13 were fixed
first.

`ensembleMinSamples.svm = 20` while `baseline = 10`. The gate weights are frozen to
`model.n` at the last rebuild. The convergence rule stops retraining after 6 consecutive
LOW verdicts - which, for a user with 10 consistent initial sessions, happens **before**
the pool reaches 20. After that `_rebuildModel()` is never called again, so:

> **the Mahalanobis detector - which carries 70% of the weight - never switches on for that
> user's whole lifetime.** The system runs on Isolation Forest alone, exactly the
> configuration measured to be much weaker.

Seen empirically in the simulator after C-13/C-14:

```
ukuran kolam latih : 24        <- sudah >= 20
model.n            : 10        <- beku
bobot tergerbang   : { isolation_forest: 1, svm: 0 }
skor mentah detektor-2 : -1811   (z terjepit -6, "penyusup" sejelas mungkin)
skor ensemble akhir    : -2.999  (hanya zIF)
ambang low             : -3.300
vonis                  : LOW     <- penyusup lolos
```
(training pool size 24, already >= 20; `model.n` frozen at 10; gated weights IF 1 / svm 0;
detector 2 raw score -1811, z clamped at -6, an intruder as clear as it gets; final
ensemble score -2.999, IF only; low threshold -3.300; verdict LOW, the intruder passes.)

**Patch:** crossing the gate threshold is a **structural** change to the model, not
adaptation to new data, so convergence must not block it. `_ingestVector` now rebuilds when
`model.n < ensembleMinSamples.svm` while the pool is already `>=` the threshold, regardless
of convergence state, and marks `evt.gateReopened`.

**After:** `model.n = 20`, weights `{IF 0.30, svm 0.70}`, and all four attack vectors are
judged HIGH - mimicry through `[ensemble]`, no longer through the heuristics. The bar the
simulator set for itself ("the SDK must say HIGH for all of them") is finally met.

Locked by: `core/ensemble.test.mjs` (11 tests) pins the gate semantics; orchestrator
behaviour is tested end to end through `demo/attack_sim.html`.

**Note on published numbers:** the held-out evaluation in `tools/experiment.py` rebuilds the
model through its own path and does not go through `_ingestVector`, so FRR 16.1% / FAR 5.4%
are **not affected** by this bug. What is affected is the library actually running on the
device - exactly the kind of gap `DRIFT.md` exists for.

## C-16 · CRITICAL - human sessions blocked as bots ("constant velocity")

Found only through a **real live test**. Every earlier audit used `scoreExternalEvents` with
synthetic events, which **bypasses `capture.js` entirely** - so the whole path actually used
on people's sites had never been tested at all.

`capture.js` never filled the `velocity` field on `MOUSE_MOVE`, but `integrity.js` read it:

```js
const vels = evs.filter(e=>e.x!=null).map(e=>e.velocity||0);   // always 0
if(vs < 0.01) reasons.push('velocity konstan');                // always fires
```

Every value collapsed to 0 -> standard deviation 0 -> session flagged as a bot ->
`BLOCK_SESSION`. It fired on sessions with fewer than 10 keystrokes+clicks, i.e. sessions
made mostly of **mouse movement** - exactly how a visitor browses a page without much
typing. In the live test, **2 of the first 4 human sessions were blocked**.

## C-17 · One of the 28 features was dead in production

Same root cause. `features.js` §8.4 computes
`idle = |{e ∈ MOUSE_MOVE : (e.velocity || 0) < 0.5}|`. Without that field **every** movement
counted as idle, so `cursor_idle_ratio` was stuck at **1.0** forever. Measured in the
browser: 40 movements -> `cursor_idle_ratio = 1`, events carrying a velocity field = 0.

What makes it serious: in the research database this feature **varies** (the server computed
velocity), so the model was trained with a live feature and then used with a dead one - a
permanent train-vs-serve mismatch that no held-out number would ever show.

**Patch C-16+C-17:** `capture.js` computes `velocity` (pixels/millisecond) from consecutive
pairs of movements; `integrity.js` only judges events that actually carry a velocity.
After: velocity filled 40/40, `cursor_idle_ratio` 1.0 -> **0.875**, and "constant velocity"
no longer appears. Locked by: `core/integrity.test.mjs` (10 tests), in CI.

## C-18 · CRITICAL - an ignored step-up popup disabled the whole MFA layer

`runMfaChallenge` returned a Promise that **only** settled when the user pressed a button.
With no time limit:

1. `_ingestVector` awaited it -> **`endSession()` never finished**. An integrator who wrote
   `await bg.endSession()` hung forever.
2. `finally { this._mfaBusy = false }` never ran -> `_mfaBusy` stayed `true` -> **every
   later step-up on that page was silently skipped**. One abandoned popup disabled MFA for
   the rest of the page's life.

Seen in the live test: the enrollment popup appeared in session 11, the test call timed out
at 45 seconds, and afterwards `mfaBusy:true` with the popup still hanging in the DOM.

**Patch:**
- `runMfaChallenge` takes `timeoutMs` (default 120 s for verification / 60 s for
  enrollment); when it expires the overlay is removed and the Promise settles with
  `{cancelled:true, timedOut:true}`.
- **Template enrollment is no longer awaited** by the verdict path. It is a setup prompt on a
  calm LOW session, not part of the verdict. Verification is still awaited, because the
  verdict really depends on its result.

After: session 11 gives a real verdict and `endSession()` finishes in **3 ms** even with the
enrollment popup open; a test popup with `timeoutMs:1500` closes itself at 1,935 ms with
`{timedOut:true}`.

---

## Methodology note: why C-16..C-18 slipped past 15 earlier audits

All because of one wrong testing habit. C-1..C-15 were verified through
`scoreExternalEvents(events)` - which takes **made-up** events and **bypasses `capture.js`**.
So the entire production path (DOM -> capture -> features -> verdict -> popup) was never run
even once, and three bugs that only live on that path stayed invisible even though
conformance 227/227, step-up tests 20/20 and gate tests 11/11 were all green.

**New rule:** every change to `capture.js`, `mfa.js` or the orchestrator must be tested
through a real page with DOM events, not through `scoreExternalEvents`.

Two harness traps that produced false findings and are worth remembering:
- **The automated `type` action uses `insertText`** and emits no `keydown`/`keyup` - this was
  briefly read as "0 KEYSTROKE events" while capture was actually fine.
- **Hidden tabs throttle `setTimeout` to ~1/second**, so 12 seconds of interaction produced
  only 18 events and every session appeared to fail the eligibility gate. Use a busy-wait
  (`performance.now()`) for pacing when measuring.

## C-19 · The library was COMPLETELY SILENT during the whole enrollment phase

Found while preparing a full-flow demo: sign up -> the system learns -> recognised.

The enrollment branch in `_ingestVector` built `enrollEvt` and then returned immediately -
**without ever calling `this.onRisk(...)`**. So throughout the first 10 sessions: no
callback, no `behaviorguard:risk` event, and the built-in panel stuck at "MENGENALI..."
(recognising) without ever moving. Only `endSession()` returned its value, so event-based
integration - the very approach documented in the README and QUICKSTART - saw nothing.

This is the phase that most needs to be visible: a new user signs up and needs to know the
system is learning, not hanging. An integrator building a progress indicator had no data
source at all.

**Patch:** the enrollment branch now calls `onRisk` and includes
`enrollment: { selesai, perlu, siap }` (done, needed, ready) so progress can be shown
without parsing reason text. The built-in panel was updated: it shows "MENGENALI 3/10" with
a progress bar instead of static text.

Verified in the browser: three consecutive sessions produce panel 1/10 -> 2/10 -> 3/10
(bar 10% -> 20% -> 30%) and the integrator receives three events.

---

## C-20 · CRITICAL - the real owner locked out of their own MFA (FRR ~64%)

Reported from real use: "at the very start MFA worked, over time my own rhythm never passes,
and now EVERY session gets MFA." Triggered after someone else (slow tempo) set off MFA and
failed a few times.

Two defects that reinforce each other:

1. **The rhythm template was far too strict.** `challenge.js` compared ABSOLUTE dwell/flight
   per position with a `k·MAD` tolerance, MAD floored at `MAD_FLOOR_REL = 0.08` (8% of the
   median). A consistent 3-round enrollment yields a small MAD -> tolerance ~2.5·8%·median.
   But human typing tempo **shifts as a whole between sessions** (tiredness, mood, a
   different keyboard): 12-20% variation is normal and immediately exceeds the miss budget.
   Measured (realistic Gaussian jitter simulation, 18-character phrase): owner FRR **63.6%**
   - the owner is rejected on most attempts. FAR stays 0% (other people are indeed rejected
   - that part is right).

2. **Domino effect on the sticky floor (`lastRisk`).** The floor only clears to LOW when MFA
   is `verified`. Because the owner's verify almost never passed, the floor never dropped ->
   every later session was forced to MEDIUM/HIGH -> MFA kept appearing. One bad episode
   became permanent MFA. More failures -> a more annoyed owner -> a more deviant rhythm ->
   a spiral. That is "every session gets MFA".

**Patch** (`core/challenge.js`, copied to `extension/`, bundled into `dist/`):

- **Normalise global tempo before the per-position comparison.** What tells PEOPLE apart is
  the RELATIVE pattern between positions, not absolute speed. The sample is scaled by the
  ratio `median(template)/median(sample)`, clamped to `[0.5, 2.0]`. Owner drift (±20%) is
  fully corrected; samples with an extreme tempo (a robot / a flat 300 ms paste) cannot be
  scaled to fit and are still rejected - an intruder's relative pattern still looks
  different.
- **`MAD_FLOOR_REL` 0.08 -> 0.12** - 12% = normal between-session human jitter.

Measured after the patch (same harness): owner FRR **63.6% -> ~2%**, FAR (including an
intruder with a 1.6× slower tempo) stays **~0.2%**. The previously locked test vectors stay
green (legitimate owner passes, flat 300/600 intruder rejected, paste/NaN/Infinity
rejected).

Locked by: `core/challenge.test.mjs` +3 regression tests (owner with ±18-20% drift ->
passes; intruder with a different relative pattern -> rejected).

Note: `challenge.js` verify is pure and stateless - the template is NOT tainted by other
people's failures. This is purely a threshold issue, not poisoning; recovery is automatic
once this code is installed (no reset needed). If a user wants a completely clean slate after
the annoyed pattern has set in: `BehaviorGuard._instance.clear()` and enroll again.

---

## C-21 · Events lost on page navigation + sub-threshold pending data discarded on every init

Reported from real use: "moving between pages all the time, the session never gets
captured" and "the first 2 sessions never move up to MENGENALI 1/10". Two lifecycle leaks
in `behaviorguard.js` (not MFA / not the plug-and-play logic):

1. **`visibilitychange:hidden` drains and discards before `beforeunload` can save.** The
   `hidden` handler called `endSession()`, which runs `capture.drain()`; a session below
   `minEventsAssess` (30) returned `null` -> all its events were discarded. On a full PAGE
   navigation, `hidden` runs BEFORE `beforeunload`, so `beforeunload`, whose job is to save
   the tail to `bg:pending`, found an **empty** buffer. Measured in the browser: 25 events ->
   after `hidden`, buffer 0 and `bg:pending` empty = LOST.
2. **Init discarded pending data that was not yet enough.** The `bg:pending` recovery block
   called `storage.set('bg:pending', null)` **unconditionally** - even when `chunk` < 30 and
   not yet scored. So tails from short pages never accumulated into a full session; every
   init threw them away. (Bonus: `storage.set` writes to IndexedDB, a DIFFERENT store from
   `bg:pending` in localStorage - so that line never connected anyway.)

Combined effect: on a multi-page site (e.g. `demo/shop-multipage`), browsing page to page
discarded the tail on every transition -> sessions were never long enough for
`minEventsTrain` (100) -> enrollment stuck at 0/10.

**Patch** (`behaviorguard.js`, copied to `extension/`, bundled into `dist/`):

- `bg:pending` is now a cross-page tail ACCUMULATOR via raw localStorage. The
  `visibilitychange:hidden` handler **no longer discards**: if ≥30 -> `endSession()`
  (score); if < 30 -> `_bankTail()` saves the tail and then drains.
- New `_bankTail()`: saves the last ≤200 events to `bg:pending` (cap 800), then drains ->
  **idempotent**, so `pagehide` + `beforeunload` may call it repeatedly without duplicates.
  `beforeunload`/`pagehide` now bank SYNCHRONOUSLY (async scoring has no time to flush while
  the page is dying).
- Init: if pending < 30 -> **put it back** into `bg:pending` (wait for the next page to add
  more); if ≥30 -> score one `chunk` (≤200) and save THE REST. The unconditional
  `storage.set('bg:pending', null)` line was removed.

Verified in the browser (fresh ESM import): `_bankTail` saves 25 events (instead of
discarding them), is idempotent, and accumulates 22->44 across "pages"; init holds pending 20
(previously discarded) and consumes pending 150. A 6-page cycle: `bg:pending` rotates
22->44->flush->22 exactly right (zero events lost). Note: the final verdict with SYNTHETIC
events triggered the C-16 bot heuristic (timing too regular) - enrollment with REAL events
must be tested through a real DOM (rule below).

Related, a **misconfiguration in the `accuracy-lab` demo**: the "end session" button unlocked
at 30 events (`minEventsAssess`) while ELIGIBLE needs 100 (`minEventsTrain`) -> the first 2
short sessions were ended, judged "not eligible", and the panel stayed at 0/10. Fixed: the
button stays locked until `minEventsTrain`, and the counter text follows that threshold.

---

## C-22 · CRITICAL - the owner judged MEDIUM FOREVER from session ~20 on (FRR 98%)

Reported by a tester (Kepler) from real use: "1-10 baseline, 10-20 LOW, 20 onwards MEDIUM" -
the owner themselves, judged MEDIUM over and over -> MFA every session -> (C-20) MFA fails ->
stuck. "I varied it so the idle tolerance is bigger, still MFA." The number **20** is the
key: `ensembleMinSamples.svm = 20` = the gate of the Mahalanobis detector (weight 0.70,
dominant).

**Root cause (statistics, not idle time):** Mahalanobis fits a **d×d covariance with d=28
features**, but its gate opens at **n=20 samples**. **n < d** -> the covariance is
*under-determined* / overfit: the Mahalanobis distance of in-sample points (training data)
is falsely small, and `svm_stats` (score mean/std) and the thresholds are calibrated from
optimistic in-sample scores. A new OWNER session (out of sample) is much farther away ->
`zSVM` is very negative -> the ensemble score drops below the threshold -> MEDIUM. Because
`progressiveMaxPool=30` (max pool base 10+30 = 40 ≈ 1.4d), this **never recovers** - FRR
stays around 45% even with a full pool.

Measured (the real model code, `_rebuildModel`+`scoreVector`, a 28-dim Gaussian owner
distribution, simulation - not research data): out-of-sample owner FRR by pool size:

| pool | 15/19 (gate closed) | 20 | 25 | 30 | 40 | 60 | 90/100 |
|---|---|---|---|---|---|---|---|
| **before** | 0% | **98.6%** | 92% | 85% | 45% | 14% | 6% |
| **after** | 0% | **9.0%** | 4.8% | 6.5% | 5.0% | 5.5% | 2.3% |

FAR (a clearly different intruder, ≥1.5σ) stays ~0% in both cases.

Why "10-20 LOW" and then "20+ MEDIUM": below 20 the Maha gate is CLOSED -> Isolation Forest
alone (soft, generalises) -> LOW. At 20 the gate OPENS -> an overfit Maha dominates ->
MEDIUM. This is the reverse of C-15 (where the gate was frozen CLOSED forever); fixing C-15
is exactly what surfaced C-22, because the gate finally really opened - at a sample count
still below the dimension.

**Patch** (only the LIVE path `behaviorguard.js._rebuildModel` + `config.js`; **golden and
conformance are NOT touched**, because both fit Maha with a fixed `cfg.mahalanobis.shrink`
directly, not through the orchestrator - confirmed Python 227/227 and JS 227/227 still
SESUAI):

- **ADAPTIVE shrinkage** against the sample/dimension ratio: `shrink = clamp(0.3, 0.9, d/n)`.
  When n<d, heavy shrinkage pulls the covariance toward standardised Euclidean (safe, no
  overfit); it decays to the 0.3 base once n≥~3d -> research-grade full correlation returns.
- **`progressiveMaxPool` 30->90** so the pool can grow, the shrinkage decays, and detection
  of look-alike intruders improves with use.

**A limit that MUST be stated honestly (threat model):** with fewer than ~2d samples the
correlations between features cannot be estimated, so an intruder who is VERY similar to the
owner (< ~1σ) is not reliably caught until the owner pool is large enough. This is inherent
to few-shot on-device learning; the old baseline *pretended* it could (full covariance) and
that is exactly what locked the owner out. Detection strengthens as owner data grows.

**Three coupled bugs:** C-22 (the owner is no longer wrongly MEDIUM) + C-20 (the owner's MFA
finally passes) + the sticky-floor property (`lastRisk` only clears when MFA is `verified`)
- all three have to be right together; if one leaks, one bad episode becomes permanent MFA
(the spiral Kepler reported). C-21 makes sure sessions are collected from the start so the
pool grows healthily.

Verified 2026-09-07 in the browser: end to end `_rebuildModel`+`scoreVector` (table above),
plus 4 green suites (JS conformance 227/227, step-up 23/23, gate 11/11, integrity 10/10).

---

## C-23 · Idle time measured as if it were behaviour (+ a session takeover window)

**Reported by the thesis supervisor, 2026-09-09.** "With idle, someone can just open it and
then leave it to go do something else." Correct, and the consequences are **two**, not one.

**Consequence 1 - measurement (FRR).** The F4 features are computed from the gaps between
events and from `duration = ts_last − ts_first`. Dead pauses count as if they were
behaviour. Measured (`core/idle.test.mjs`, one run of 40 events, left alone for 12 minutes
in the middle):

| Feature | Across the gap (old) | Per segment (new) | Factor |
|---|---|---|---|
| `temporal_session_duration` | 731.2 s | 5.5 s | 133× |
| `mouse_click_interval_mean` | 48,708 ms | 710 ms | 69× |
| `keystroke_flight_time_mean` | 34,797 ms | 509 ms | 68× |
| `keystroke_typing_speed` | 0.030 | 1.998 | 67× |

Four of the 28 features miss by one or two orders of magnitude - and not as random noise but
as a one-directional bias. The research database contains DENSE task-based sessions, so this
is a systematic **train-vs-serve** mismatch: the same defect class as C-16/C-17, only the
source is time rather than an empty field. An owner who simply leaves the tab is judged as
deviating.

**Consequence 2 - security (FAR).** The opposite side, and actually the more dangerous one:
while the chair is empty the session is **already authenticated**. Whoever sits down next
inherits a legitimate session (the "lunch break attack"). Because the intruder never passes
a login, the only available signal is a long absence in the middle of the session - exactly
the signal that used to be thrown away. Removing idle time just for FRR's sake would
**widen** this hole.

**Consequence 3 - silence read as safe.** `endSession()` used to return `null` without a
trace for buffers < 30 events. An integrator waiting for a callback could not tell "checked,
safe" from "no evidence at all", and a silent default always falls on the trusting side.

**Patch (three layers, `sdk/core/idle.js` + orchestrator):**

1. **Segmentation.** The event stream is split at every pause ≥ `session.idleGapSec` (30 s =
   one assessment window). Each contiguous segment is judged ON ITS OWN. The feature
   formulas in `core/SPEC.md` are **not touched** - only what is fed into `extractF4`
   changes. That is why the golden file and all four ports stay at 227/227 unchanged.
2. **Two thresholds, two consequences.** `idle.awaySec` (5 min) = the "the chair may be
   empty" limit: the LOW streak is reset, trust from before the absence does not carry over.
   `idle.reverifyAfterSec` (15 min, aligned with the PCI DSS 8.2.8 idle-timeout limit) = LOW
   is raised to MEDIUM so step-up runs once. Deliberately separate: 5 minutes is enough to
   stop measuring across the gap, but not enough to bother the user.
3. **ABSTAIN.** A window without evidence issues an `UNKNOWN` verdict / `ABSTAIN` action
   **once** per idle run (not every window, so a tab left open overnight does not flood the
   log). The system may say "I don't know" instead of guessing.

**Bonus from layer 1:** the live tail of the buffer is now RETURNED to the buffer instead of
being thrown away every 30 seconds. A user browsing slowly eventually adds up to a session.

**A limit that must be stated honestly.** Segmentation removes pauses from the measurement,
but it cannot tell *left alone* from *reading without touching anything* - both are equally
silent at the DOM layer. That is why the answer is not to guess but to ABSTAIN + re-verify
after a long absence. The 30/300/900 s thresholds are engineering choices, not yet tuned
against field data; all three are exposed as knobs in `init({session, idle})`.

**Tests:** `core/idle.test.mjs` 33/33 (module + the evidence for the numbers in the table
above), `core/idle.live.test.mjs` 20/20 (full orchestrator path: two verdicts from one gapped
batch, `resumedAfterAway`, LOW->MEDIUM, ABSTAIN). Full proposal + similar cases:
`docs/CONTEXT-AND-IDLE-PROPOSAL.md`.

---

## C-24 · A change in session length read as a change in identity

**Found while measuring C-23, not reported.** The C-23 ablation used a CONTROL arm - clean
sessions cut at the same point, with no pause at all. That control is what exposed it: the
|z| of the count features rose **0.96 -> 2.02** just because the session was shorter.
Without the control arm, that rise would have been misread as the cost of C-23
segmentation.

**Root cause.** Nine of the 28 features are **raw counts** - `mouse_direction_changes`,
`mouse_pause_count`, `keystroke_burst_count`, `temporal_activity_bursts`, `nav_page_count`,
`nav_step_transition_count`, `form_focus_count`, `form_blur_count`, `cart_action_count` -
which grow with session length. As a result **every** change in session length is read as a
change in identity. This predates idle and affects almost every case in
`docs/CONTEXT-AND-IDLE-PROPOSAL.md` §4 that changes session length.

**Two routes, and why the second was chosen.**
(a) Turn the formulas into rates (`count / active_duration`) -> SPEC v1.3, regenerate the
golden file, sync four ports, and **every old number loses its reproducibility**.
(b) Make the length CONSTANT, so counts become comparable automatically -> **zero lines of
feature formula change**. (b) was chosen, for the same reason as C-23: the fix belongs in the
sessionisation layer, not the feature layer.

Under a canonical window, counts change meaning into **composition** ("out of K events, how
many were clicks") and `temporal_session_duration` becomes **speed** ("how long it took to
produce K events") - both are actually more biometric than "how long the session happened to
be". Hard requirement: used in **enrollment AND scoring**, otherwise we only trade one
train-vs-serve mismatch for another.

**Three knobs, ALL off by default** (`session.canonicalWindow: 0`, `aggregateWindows: 1`,
`calibrationHoldout: 0`) so the old path is untouched and the headline numbers stay valid.

**Measured** (`tools/idle_ablation.py --canonical 120`, 19 subjects, 482,203 raw events;
mean |z| against the owner baseline):

| Arm | TIME features | COUNT features | SHAPE features |
|---|---:|---:|---:|
| Clean, full session | 0.83 | 1.00 | 1.90 |
| Control: cut only | 0.84 | **1.01** | 1.90 |
| Gapped, no segmentation | 8.41 | 1.00 | 1.91 |
| Gapped + segmentation (C-23) | 0.84 | **1.00** | 1.89 |

Compare with the C-23 table (without canonicalisation): the COUNT column there was 0.95 vs
**2.02**. Here all four arms line up at 1.00 - **invariance fully restored**. The TIME column
proves both are needed: canonicalisation alone does not cure idle (8.41), and segmentation
alone does not cure session length.

**Evidence aggregation.** A shorter window means less evidence per verdict. The answer is not
to loosen the threshold - that moves the error to the FAR side - but to hold the verdict until
M windows have been collected and judge their average. What is traded is **latency for
confidence**, not FRR for FAR:

| M | AUC | FAR | note |
|---:|---:|---:|---|
| 1 | 0.770 | 25.0% | verdict per window |
| 2 | 0.789 | 16.9% | |
| 3 | 0.808 | 12.9% | |
| 5 | 0.829 | 9.4% | |

The tempting shortcut - tighten the threshold by `std/sqrt(M)` - is **wrong, and wrong in one
direction**: consecutive windows from the same session are correlated, so the real spread is
wider and the threshold ends up too tight. Tested: that analytic correction left FRR at
46.5%. The right way is to aggregate the TRAINING scores in exactly the same way and calibrate
on top of that, so the correlation is carried along without having to be assumed.

**Out-of-sample threshold calibration.** It turned out the remaining FRR was not about
correlation, but that `_rebuildModel` calibrated the thresholds from the scores of **exactly
the vectors used to fit** the detector. In-sample scores are always optimistic, the threshold
ends up too tight, and the owner's next session falls outside it - **exactly the same
mechanism as C-22**, one layer up. Setting aside 30% of the pool for calibration only:
**FRR 46.5% -> 27.8%, EER 32.9% -> 28.6%** (AUC unchanged, because calibration moves the
operating point, not the separating power).

**What MUST be stated honestly.** All three knobs are proven in **direction**, not in
**operating point**. On the ablation harness, the canonical EER (~28-33%) is still far from
the 11.9% EER of the full-session protocol reported in `config.js`. Partly because the
ablation harness is loose (see the limits note in its script), partly because a 120-event
window really carries less evidence than a ~600-event session. **That is why all three are
off by default.** Before quoting these numbers in the thesis, re-run them with the held-out
protocol of `reproduce_db.py`.

The real trade-off: canonicalisation trades **peak separating power** for **invariance**. Note
that the clean arm without canonicalisation has AUC 0.810, but as soon as its session length
changes it drops to 0.636; with canonicalisation it holds at 0.742-0.746 in ALL arms. And
because in production sessions really are 30-second windows - never full research sessions -
the invariant regime is the one that matches deployment.

**Tests:** `core/invariance.test.mjs` 26/26, with the first test locking that the defaults
change nothing. The invariance evidence there: the count-feature shift caused by 500 vs 260
events of input drops from **117.0 -> 1.0**.

---

## Held-out validation for C-23 and C-24 - FINAL VERDICT (5 splits)

> **Correction history.** The first version of this section claimed C-23 beat the control
> (AUC 0.907 -> 0.941). That claim is **withdrawn**: it flipped as soon as the `q` grid was
> widened, then flipped again once calibration moved out of sample - three protocol
> configurations, three answers, for exactly the same code change. The cause was traced to
> three protocol defects (below), all three are now fixed, and the results were repeated over
> **5 splits of 8/8** with the same `q` grid for every arm. This section reports those
> corrected results. **They are negative for C-23.**

### Protocol defects that were fixed

1. **`q` stuck at the edge of the grid.** In the initial runs ALL conditions chose 0.10 - the
   smallest value available. The tuner wanted to go looser but was given no option, so every
   arm was judged at an operating point that was not its own choice. **This is where the
   alarming 50-60% FRR came from - an artefact of threshold placement, not a system
   failure.** The grid was widened to [0.01 .. 0.15]; control FRR dropped 35.5% -> 23.0%.
2. **`q` also selects the training data.** The pool only grows from sessions judged LOW, so
   changing `q` changes the pool, and so changes the model. Two values of `q` are not two
   points on one curve; they are two models. So the grid must be **the same for every arm**.
3. **One split has no spread.** FOLD-REPORT is only 8 subjects. Now 5 splits
   (seeds 42/7/13/2026/99) and **[min..max] is reported**, not a single number.

### Results, 5 splits, shared `q` grid

| Condition | FRR | FAR | AUC | EER | FAR@FRR15 |
|---|---:|---:|---:|---:|---:|
| 1. full, no AFK (control) | 23.0% | 2.0% | **0.946** | **10.4%** | **4.1%** |
| 2. full, with AFK | **32.8%** | 1.3% | 0.938 | 10.7% | 5.7% |
| 3. + C-23 segmentation @30 s, with AFK | 35.3% | 2.8% | 0.905 | 16.1% | 17.4% |
| 4. + C-23 segmentation @120 s, with AFK | 39.9% | 2.0% | 0.903 | 15.9% | 17.7% |
| 5. + C-23 segmentation @300 s, with AFK | 42.3% | 2.4% | 0.907 | 13.9% | 12.2% |

EER ranges: control [9..12], AFK [8..13], C-23@30 **[14..19]**, @120 [14..19], @300 [12..16].

### Three findings

**(a) The idle damage is real, but it shows in FRR - NOT in AUC.** Row 2 vs 1: FRR
23.0% -> 32.8% (+9.8 points), while AUC barely moves (0.946 -> 0.938) and EER stays put
(~10.5%). The mechanism: AFK pauses are injected into the evaluation sessions of **both owner
and intruder**, so the distortion points the same way for both - **ranking is preserved,
calibration shifts.** AUC is a ranking metric, so it is **blind** to this failure mode. That
alone deserves a place in the thesis: reporting AUC only would completely hide the
supervisor's concern. Correction: the old claim "idle damage confirmed through AUC
0.907 -> 0.874" **does not hold**; what holds is the damage in FRR.

**(b) C-23 segmentation does not fix it, and it hurts separating power.** Row 3 vs 2: FRR does
not drop (35.3%), and EER goes 10.7% -> 16.1% with FAR@FRR15 5.7% -> 17.4%. The C-23 EER range
[14..19] **does not overlap** with the control [9..12] or the AFK arm [8..13] in any of the
five splits. This is a consistent negative, not noise.

**(c) The hypothesis "a 30-second threshold is too aggressive" is REJECTED.** The idea: cutting
at every 30-second pause also chops up ordinary thinking pauses, so C-23 pays the same
"shorter session" cost as C-24. If so, loosening the threshold should help. It **does not**:
30 -> 120 -> 300 seconds makes FRR monotonically worse (35.3% -> 39.9% -> 42.3%) while AUC sits
at ~0.905. EER improves slightly at 300 seconds (13.9%) but stays outside the control range.
So the loss is **not** about segment length, and loosening the threshold is not the way out.

### What may and may not be claimed

**MAY** (mechanical, independent of the protocol, `core/idle.test.mjs`): a 12-minute pause
must not enter `mouse_click_interval_mean`. Segmentation restores `temporal_session_duration`
731.2 -> 5.5 s, click interval 48,708 -> 710 ms, TIME-feature |z| 12.42 -> 1.14. That is a
**measurement-correctness fix** and it stands on its own.

**MAY**: the idle damage is real at a valid operating point, visible in FRR (+9.8 points).

**MAY NOT**: that C-23 segmentation improves FRR/FAR. The evidence now says the **opposite**,
consistently over 5 splits and 3 gap thresholds. This is a **negative result** and is reported
as such.

**NOT YET TESTED**: the second and third layers of C-23 - presence tracking (`awaySec`,
`reverifyAfterSec`) and ABSTAIN. Both are **security mechanisms**, not scoring changes, so this
benchmark structurally cannot measure them: the corpus has no unattended-session-takeover
scenario. The argument is policy (PCI DSS 8.2.8), not empirical, and must be presented that way.

**ALSO NOT YET CLAIMABLE**: that C-24 definitely loses. It lost in two configurations (0.820
and 0.802 against 0.907 and 0.924) but won in one (0.863 against 0.825). The reason to ship it
off by default still holds - **there is no evidence it helps** - but "proven harmful" goes too
far.

### Consequences for the defaults

The C-24 precedent applies just as firmly to C-23 segmentation: **a feature not proven to help
must not be on by default.** The evidence for C-23 is even stronger than for C-24 - not just
"no evidence it helps" but consistent evidence that it hurts separating power. What holds back
an automatic flip: the same `idleGapSec` also switches on `idleAccounting` and ABSTAIN, so
simply turning it off would also turn off two mechanisms that are not on trial. Splitting the
three into separate knobs is the next step, and until that is done the numbers in this table
apply - **not** the assumption that C-23 on is better.

### The methodological lesson

Worth a finding of its own in the thesis: **in a few-shot on-device protocol like this one, the
evaluation itself is the largest source of uncertainty.** A training pool that grows from its
own verdicts creates feedback between threshold and data; a `q` grid stuck at the edge can
create a 50-60% FRR out of nothing; and with 8 reporting subjects, a single split is not
enough to rank anything. Any number from this protocol - **including the old headline
numbers** - should be reported with a spread over several splits, not as a single number.

Reproduce:
`python tools/canonical_holdout.py --only 1 2 3 --idle-gap-sec 30 120 300 --seeds 42 7 13 2026 99 --q-grid 0.01 0.02 0.03 0.05 0.08 0.10 0.12 0.15`

---
## C-25 - Audit: "the instrument changed, not the person"

After C-23 and C-24, this defect class was traced through the whole code base. Twelve
findings, three of them proven by running the code. Details in
`docs/MEASUREMENT-VALIDITY-AUDIT.md`; what was patched:

**A1 - CRITICAL, "just browsing" sessions blocked as bots.** The fallback
`filtered.length>=10 ? filtered : events` in `integrity.js` DEFEATED the intent of T5: when
keystrokes+clicks < 10 it fell back to all events, which are mostly `MOUSE_MOVE` from our own
50 ms throttle. Their intervals are not merely similar but **exactly constant** - measured
60Hz std 0.00 ms; 100Hz 0.00; 125Hz 0.00; 144Hz 0.50. All < 3 ms -> `BLOCK_SESSION` for a
human reading an article while moving the mouse. Fragile too: one stray click raises the std
above the threshold, so the symptom is "sometimes" and almost impossible to trace from user
reports. **The new rule: never judge interval regularity on a stream we throttle
ourselves.** If evidence is short, skip the check - do not swap its source.

**A3 - Autofill kills 8 keystroke features at once.** Measured: dwell 80->0, flight 120->0,
speed 4.81->0, entropy 1.10->0; **8 of 8 features drop to zero**. Two directions: an owner
who uses a password manager looks deviant at every login, AND an intruder can weaponise it to
erase the entire block of typing evidence. `paste` is now captured, and "form touched but not
typed" is marked `partialEvidence:'keystroke'`. The verdict is **not** raised - punishing
password manager use would be aiming at the wrong target - but that session never trains the
model and cannot build a LOW streak. Partial evidence may be used to judge, not to **trust**.

**A4 - Behaviour tails leak between users.** `bg:pending` was a GLOBAL key, not namespaced
like sessions. User A closes the page -> their tail is saved -> B logs in on the same browser
-> A's tail is scored, and can even train, as B. Now `bg:pending:<userId>`; the old key is
discarded at init because its owner cannot be established.

**A5 - `PAGE_STEP` trained on but never captured.** `features.js` reads
`NAVIGATION | PAGE_STEP`, the research database has 2,672 PAGE_STEP events (all checkout
flows), and `capture.js` never emitted one - a relative of C-17. The meaning of a "step" is
the application's business, not the DOM's, so the honest route is an explicit
`markStep(name)` API, not guessing from submit/pushState and then being silently wrong.

**B1 - Two tabs measured as one.** Two tabs active at the same time have no pause for idle
segmentation to cut, so they merge into one "session" that represents nobody. The C-23
principle again: if two measurements come from different instruments, separate them. Events
are stamped with `tabId` and `groupByStream` separates them before anything is measured.
Plus leader election through a localStorage heartbeat so only one tab scores and writes;
before, the last writer won and the other tab's session silently disappeared.

**B2 - Screen resolution taken out of the device fingerprint.** Plugging in an external
monitor is not changing devices, yet it used to force `lastRisk='MEDIUM'` plus the sticky
floor. Resolution is context (it shifts the speed scale), not machine identity.

**B4 - Touch screens.** `touchmove` is now captured and mapped to `MOUSE_MOVE` (marked
`touch:true`). Without this, nine mouse features are zero and phone users can never be judged
at all. Changes nothing on desktop.

**B7 - Pool cut at 30 without IndexedDB.** localStorage used to truncate to 30 sessions while
`progressiveMaxPool` = 90; C-22 already showed what a pool that is too small relative to d=28
does. Now `feat` (only used for explanations) is dropped and 90 vectors are kept.

**Not patched, on purpose.** A2 (px/ms speed depends on screen size - measured 2.00x on a
monitor twice as large, curvature 0.50x) and B3 (raw pixel `scroll_delta`) are one scale
normalisation package that **makes old baselines incomparable**, so it needs baseline
versioning. B5 (time of day as a biometric) and B6 (constant features in the baseline -> large
z) touch the vector/SPEC. All four are proposed, not shipped.

**Tests:** `core/audit.test.mjs` 32/32, all older suites still green (conformance 227/227 in
Python and JS, idle 33/33, full path 20/20, invariance 26/26, step-up 23/23, gate 11/11,
integrity 10/10).

---

## C-26 - The 23% FRR and enrollment length (MEASURED ON THE WRONG ENGINE - see C-27)

> **Withdrawn 10 Sep 2026.** Every table in this section used `reproduce_db.py`, which turned
> out to use sklearn OCSVM with IF weight 0.70 - while what is SHIPPED is Mahalanobis with IF
> weight 0.30. On the right engine the FRR is 12.1% (not 28.4%) and the advantage of 16-session
> enrollment DISSOLVES into the spread. This section is kept as a record of the process; its
> conclusions only apply to the OCSVM engine. See C-27.

### Original notes (OCSVM engine)


A 23% FRR at 2% FAR is not shippable. This section takes apart where that number comes from.
The tool is `tools/frr_levers.py`, which **reproduces `reproduce_db.py` digit for digit** before
any lever is applied - its first version did not, because it dropped half of the convergence
condition, and that alone cost 0.11 AUC. A harness that has not first been matched against its
reference cannot be trusted.

### Two diagnoses that set the direction

**FRR is spread evenly**, 11% to 56% across all eight reporting subjects. So it is systemic,
not a handful of subjects with dirty data.

**An ORACLE threshold** (chosen after seeing the answers) at FAR<=2% still gives an FRR of
**20.6%**. So threshold placement accounts for ~13 points and that part is free, but the
remaining 20.6% is the ceiling of the SCORE itself. Also: a one-threshold-for-everyone oracle
(28.6%) trails the per-user oracle (20.6%) by 8 points, purely because one ruler is forced onto
score scales that differ.

### Four model levers - ALL FAILED

Tested over 5 splits of 8/8, shared q grid:

| Lever | FRR | FAR | AUC | EER | Verdict |
|---|---:|---:|---:|---:|---|
| (no lever) | 28.4% | 4.1% | 0.919 | 13.9% | reference |
| leave-one-out calibration | 18.3% | 7.8% | 0.923 | 14.0% | **only moves the operating point** |
| cohort z-norm | 18.5% | 20.7% | 0.826 | 22.2% | rejected |
| reduce dimensions 28->12 | 27.0% | 2.1% | 0.926 | 13.3% | neutral |
| aggregate 2-3 windows | 13.5% | 28.5% | 0.864 | 21.0% | rejected |

**LOO briefly looked like a win on one split** (AUC 0.922 -> 0.931) and was withdrawn after 5
splits: AUC 0.923 vs 0.919 and EER 14.0% vs 13.9% - a difference of zero. FRR went down, FAR
went up by the same amount. This is the SAME lesson as the C-23 correction above, and it
happened again anyway.

The LOO mechanism is still worth noting even though its effect is zero: a new session only
enters the training pool after being judged LOW, so a threshold that is too tight blocks the
owner's data from entering their OWN model - the pool starves and stays narrow. That feedback
is real; what was not proven is that fixing it moves separating power.

**The first two aggregation implementations were WRONG**, and wrong in the same class as
C-16/C-17: (a) the threshold was calibrated on single scores but the verdict was taken from a
k-mean - the spread of a mean is much narrower, and FAR exploded to 35%; (b) the scores of
several DIFFERENT intruders were averaged, which invents an "average person" who is closer to
the centre of the owner model than any real intruder. Both were fixed; after the fix,
aggregation still lost. If averaging hurts, the discriminating power does not lie in a shift of
the mean but in the EXTREME sessions - and averaging erases the extremes. (A hypothesis,
consistent with the data, not tested separately.)

**The "it only asks for re-verification" framing also falls.** FRR combines MEDIUM (step-up,
the owner continues) and HIGH (block). Split apart: of the 28.4% FRR, **24.0% is HIGH**. Most
of it is a hard block, so that framing is not valid and is not used.

### What worked: enrollment length

`baseline` = 10 enrollment sessions for d=28 features. Raised to 16, **with the test set MADE
IDENTICAL** through `--eval-from` (without that, raising the baseline moves sessions 10..15
from "tested" to "enrolling", and part of the "improvement" is just the effect of removing
questions from the exam):

| Tested on sessions >=16 | FRR | block | FAR | AUC | EER | FAR@FRR15 |
|---|---:|---:|---:|---:|---:|---:|
| 10-session enrollment | 32.1% | 27.6% | 4.1% | 0.904 | 16.0% | 16.4% |
| 16-session enrollment | **23.6%** | **21.6%** | **0.7%** | **0.930** | **12.9%** | **5.2%** |

EER range over 5 splits: [11..23] -> **[12..15]**.

This is the only change in this session that improved **FRR and FAR at the same time**, raised
the threshold-free metrics too, AND narrowed the spread. FAR@FRR15 improved 3x.

Note the direction of the confound: 10-session enrollment actually got WORSE when tested from
session 16 (28.4% -> 32.1%). A model enrolled too briefly falls further behind over time -
consistent with the pool feedback loop above.

**The benefit saturates after 16.** Tested on sessions >=22, 22 against 16: AUC 0.911 vs
0.910, EER 16.3% vs 15.6%, FAR@FRR15 20.9% vs 16.2% - zero, even slightly harmful. So the
claim is "10 is too short", NOT "longer is better".

The two comparisons use different test sets (>=16 and >=22), so their numbers must NOT be
chained. What is valid: on the >=16 test, 16 beats 10; on the >=22 test, 22 does not beat 16.

### Consequence for the defaults - NOT changed, on purpose

`config.js: baseline` is still 10. Raising it to 16 trades 6 unprotected sessions for a 3x
better FAR@FRR15 - that is a product decision, not a metric decision, and it makes ALL the
existing headline numbers incomparable. Proposed, not shipped.

Reproduce:
`python tools/frr_levers.py --levers none --seeds 42 7 13 2026 99 --baseline 16 --eval-from 16`

---

## C-27 - CRITICAL: what was MEASURED is not what is SHIPPED (ensemble engine)

The C-16/C-17 defect class - "what is trained and what is used are not the same quantity" -
turned out to exist in **the evaluation layer itself**, and it made this system look much
worse than it really is.

| | detector 2 | weights |
|---|---|---|
| `sdk/core/config.js` (**what ships**) | `model2:'mahalanobis'` | IF **0.30** / slot 2 **0.70** |
| `tools/reproduce_db.py` (**what measures**) | sklearn `RealOCSVM` | IF **0.70** / slot 2 **0.30** |

Not only is the engine different - **the weights are reversed.** So every number
`reproduce_db.py` ever produced, including all the C-23..C-26 tables above, measured a system
no user has ever run.

`core/bg_core.py:Mahalanobis` is a bit-for-bit twin of `sdk/core/mahalanobis.js`, so
`frr_levers.py --scorer maha` uses that class DIRECTLY, not an imitation. The C-22 adaptive
shrinkage is replicated from `behaviorguard._rebuildModel`: `min(0.9, max(0.3, d/n))`.

### The difference, 5 splits of 8/8, shared q grid

| Engine | FRR | block | FAR | AUC | EER | FAR@FRR15 |
|---|---:|---:|---:|---:|---:|---:|
| OCSVM, IF 0.70 (what was measured until now) | 28.4% | 24.0% | 4.1% | 0.919 | 13.9% | 11.9% |
| **Mahalanobis, IF 0.30 (what ships)** | **12.1%** | **10.7%** | 12.6% | **0.954** | **10.8%** | **6.9%** |

FRR range [22..35] -> **[9..15]**; EER range [10..20] -> [9..15].

**The 23-28% FRR that triggered this whole investigation was never real.** It belongs to an
engine that is not shipped. The threshold-free metrics all improve too, so this is not an
operating-point trade but an engine that really is better on this corpus.

What must still be said honestly: at the tuned operating point, FAR is 12.6% against 4.1%. The
tuner looks for the smallest |FRR-FAR|, so it lands near the EER. FAR@FRR15 = 6.9% is the
number to use if the operating point is moved to 15% FRR.

### Consequence for C-26 - THE ENROLLMENT CLAIM IS WITHDRAWN

C-26 concluded that 10-session enrollment is too short and 16 is much better. Repeated on the
right engine, with the test set kept identical (`--eval-from 16`):

| Mahalanobis, tested on sessions >=16 | FRR | FAR | AUC | EER | FAR@FRR15 |
|---|---:|---:|---:|---:|---:|
| 10-session enrollment | 12.4% | 12.9% | 0.948 | 11.6% | 8.4% |
| 16-session enrollment | 11.4% | 12.7% | 0.946 | 10.9% | 6.6% |

The difference is inside the between-split spread. **The benefit of longer enrollment was an
artefact of a weak engine.** It makes mechanical sense: OCSVM is sample-starved, while
Mahalanobis + the C-22 adaptive shrinkage is designed for small n - so adding samples adds
nothing. The C-26 tables are kept as a record, BUT their conclusions only apply to the OCSVM
engine and must not be quoted.

### The four C-26 levers are no longer valid either - re-tested, all lose

LOO, z-norm, dimension reduction and aggregation were all measured on the OCSVM engine.
Re-tested on the shipped engine, 5 splits:

| On top of Mahalanobis + IF 0.30 | FRR | FAR | AUC | EER | FAR@FRR15 |
|---|---:|---:|---:|---:|---:|
| no lever | 12.1% | 12.6% | **0.954** | **10.8%** | **6.9%** |
| + LOO calibration | 14.2% | 16.1% | 0.940 | 13.9% | 11.9% |
| + cohort discriminator | 10.7% | 18.3% | 0.897 | 15.1% | 15.1% |

**The best configuration is the one ALREADY shipped.** Not one lever adds anything on top of
it. LOO, which seemed to help on the OCSVM engine, actually HURTS here - the overly tight
in-sample threshold was an OCSVM problem, not a Mahalanobis problem. The two-class
discriminator also loses: with 10..30 positive examples against hundreds of negatives, it
learns the boundaries between subjects in this corpus, not the owner's identity.

The conclusion that holds: the problem was never in the model, the threshold, the number of
features, aggregation or enrollment length. The problem was the **measuring instrument**. The
diagnoses that STILL apply, because they are properties of the protocol and not of the engine:
FRR is spread evenly across subjects, and the training pool only grows from sessions judged
LOW, so a tight threshold starves the pool.

### What has to be done

`reproduce_db.py` MUST get a mode that uses Mahalanobis + the SDK weights, and the thesis
headline numbers must be recomputed there. Until that is done, every number from
`reproduce_db.py` must be labelled with the engine it used.

Reproduce:
`python tools/frr_levers.py --levers none --seeds 42 7 13 2026 99 --scorer maha --w-if 0.30`

---

### Numbers after `reproduce_db.py` was fixed

Three defects in the script were fixed together, and each stands on its own:

1. **Engine** - the default is now Mahalanobis + adaptive shrink, IF weight 0.30 / slot 2
   0.70, the same as `sdk/core/config.js`. `--legacy-ocsvm` reproduces the old numbers BUT
   prints a warning. If `bg_core.Mahalanobis` fails to import, the script STOPS - silently
   falling back to OCSVM is exactly the defect being fixed.
2. **q grid** - `[0.10..0.20]` always picked 0.10, the SMALLEST value available. The tuner was
   not choosing, it was being boxed in. Widened to `[0.01..0.20]`.
3. **Grid-edge alarm** - if the chosen q touches an edge, the script shouts. It went off again
   immediately on the new engine (q=0.01, the lower edge), so even single-split numbers are
   still a forced operating point.

**A single split with seed 42 decides NOTHING.** Mahalanobis wins on AUC (0.931 vs 0.922) and
FRR (14.5% vs 35.1%) but LOSES on EER (14.9% vs 12.6%) and FAR@FRR15 (13.8% vs 8.5%). Only over
5 splits does Mahalanobis win on every metric. This is the third confirmation in this document
that **one split of 8 subjects is not enough to rank anything.**

### Idle re-measured on the shipped engine (5 splits, shared q grid)

| Condition | FRR | FAR | AUC | EER | FAR@FRR15 |
|---|---:|---:|---:|---:|---:|
| 1. no AFK (control) | **11.0%** | 11.2% | **0.961** | **9.8%** | **5.0%** |
| 2. with AFK, no C-23 | 18.4% | 9.2% | 0.952 | 11.1% | 7.6% |
| 3. with AFK + C-23 segmentation | 18.8% | 13.9% | 0.927 | 14.3% | 13.6% |

**The idle damage is REAL on the right engine**: FRR 11.0% -> 18.4%, +7.4 points. The
supervisor's concern is valid, and this time it is measured on the system that actually ships.

**C-23 still does NOT fix it**: FRR does not drop (18.8%), and separating power actually
suffers (AUC 0.952 -> 0.927, EER 11.1% -> 14.3%). Unlike the C-26 enrollment finding, which
dissolved once the engine was corrected, the C-23 conclusion **holds across engines**. That
makes it a much stronger negative result.

**The honest numbers for the shipped system**, 5 splits, wide q grid, no AFK:
FRR 11.0% - FAR 11.2% - AUC 0.961 - EER 9.8% - FAR@FRR15 5.0%.

### What the engine fix does not touch

The C-25 audit findings (A1 browsing sessions blocked as bots, A3 autofill, A4 tails leaking
between users, B1 two tabs, B4 touch screens) **are not measured by this benchmark and cannot
be**: the corpus has no wrongly judged throttled streams, no autofill, no two tabs, no touch
sessions. They are all CORRECTNESS defects, proven by running the code
(`core/audit.test.mjs` 32/32), not defects that show up as FRR/FAR. A better engine fixes none
of them: a user blocked because of A1 stays blocked however good Mahalanobis is.

So the two answer different questions and do not replace each other - which is itself the
reason a report containing ONLY FRR/FAR is not enough for this system.

### What is STILL wrong with the protocol, not yet touched

- **Reporting from ONE split of 8 subjects.** The source of every reversal in this document.
- **The q selection criterion chases FRR ~ FAR**, so it always lands near the EER. For a
  security system FAR is usually fixed first and then FRR reported. That is why FAR in all the
  tables above is around 9-14%.

Both change the DEFINITION of the headline numbers, so they are not changed unilaterally.

---

## C-28 - AFK: shorten the pause, do not split the session

On the shipped engine, AFK raises FRR **11.0% -> 18.4%** and C-23 segmentation does not bring
it down (18.8%). There is one condition: FRR must drop **without** raising FAR. Moving the
threshold does not count as a fix.

### Eight levers that failed first

All on top of condition 2 (AFK, Mahalanobis + IF 0.30, 5 splits). Levers that move the
operating point are compared **at a matched FAR**. Without that, an FRR drop paid for with FAR
looks like an improvement.

| Lever | Result | Why it falls |
|---|---|---|
| q grid widened to 0.001 | FRR 18.0% at FAR 9.5% | only trades operating point |
| score z-norm | AUC 0.707 | destroys separating power |
| LOO calibration | neutral to worse | same as C-27 |
| aggregate 2 / 3 sessions | AUC 0.704 / 0.735 | destroys separating power |
| robust score (median/MAD) | AUC 0.821 | destroys separating power |
| cohort discriminator | AUC 0.715 | destroys separating power |
| k consecutive sessions, matched FAR | k=1 14.9% / k=2 15.8% / k=3 18.6% | k>1 does not help |
| parametric threshold, matched FAR | mean-z·sd 17.0%, med-z·MAD 16.3% (vs 14.9%) | worse than quantile |

The per-user threshold oracle is still 5.6 points lower, but that gap cannot be reached by any
rule that does not look at the answers.

**The pattern behind all five AUC failures:** intruder scores have a long extreme tail
(agg1: mean -22.5, sd 76.6), and the discriminating power lives in that tail. Every lever that
**smooths** the score (averaging, z-norm, median, cohort) cuts the tail off, so separating
power goes with it. This tests the C-26 hypothesis that had not been tested before, and the
result supports it.

### Diagnosis: only six features break, and all of them are divided by time

There are 493 session pairs (the same session, with vs without AFK). Shift is measured in units
of baseline sd:

| Feature | Shift |
|---|---:|
| `mouse_click_interval_mean` | 1.31 sd |
| `keystroke_typing_speed` | 1.24 sd |
| `form_field_switch_rate` | 1.20 sd |
| `keystroke_cross_field_cadence` | 0.79 sd |
| `keystroke_flight_time_mean` | 0.67 sd |
| `temporal_session_duration` | 0.58 sd |
| the other 22 features | ≤ 0.06 sd |

The behaviour does not change. What breaks is the **time denominator**. So the cure only needs
to touch time, and nothing else has to be done to the other features.

### Patch: compress idle time

`sdk/core/idle.js:compressIdle` shortens every pause ≥ `session.idleCompressSec` (15 s) to 15 s.
No event is discarded, and the session is still judged as a whole. This differs from C-23.
Segmentation shortens the **session**, so the nine count features shrink with it (C-24).
Compression only shortens the **empty time**. The feature formulas in `core/SPEC.md` are not
touched, so the result is still 227/227.

Measured over 5 splits of 8/8 with the same q grid `[0.01..0.20]` for every arm:

| Condition | FRR | FAR | AUC | EER | FAR@FRR15 |
|---|---:|---:|---:|---:|---:|
| 1. no AFK (control) | 11.0% | 11.2% | 0.961 | 9.8% | 5.0% |
| 2. AFK, no fix | 18.4% | 9.2% | 0.952 | 11.1% | 7.6% |
| 3. AFK + C-23 segmentation | 18.8% | 13.9% | 0.927 | 14.3% | 13.6% |
| **AFK + 15 s compression** | **9.7%** | **9.3%** | **0.968** | **8.9%** | **5.0%** |
| AFK + 30 s compression | 11.9% | 8.4% | 0.967 | 8.6% | 5.3% |
| AFK + 60 s compression | 12.7% | 8.9% | 0.963 | 9.6% | 6.4% |
| no AFK + 10 s compression | 9.8% | 10.9% | 0.964 | 9.6% | 5.0% |
| no AFK + 15 s compression | 10.1% | 11.7% | 0.964 | 10.0% | 5.8% |
| no AFK + 20 s compression | 10.5% | 10.7% | 0.964 | 10.1% | 5.1% |

FRR drops 8.7 points while FAR stays put (9.2% -> 9.3%). AUC and EER improve too, so this is
not an operating-point trade. On sessions without AFK, compression is neutral at every
threshold tested: the difference stays inside the between-split spread, and no threshold
hurts. So natural thinking pauses are not damaged.

### Two variants that were also tested and REJECTED

**Split at the "away" pause.** Merging before-and-after an absence into one verdict has a
security cost. If someone else comes back to the chair, their behaviour is mixed with the
owner's. A variant that still splits at long pauses and then compresses each piece wipes out
the benefit:

| | FRR | FAR | AUC | EER |
|---|---:|---:|---:|---:|
| compression, whole session | 9.7% | 9.3% | 0.968 | 8.9% |
| compression + split @ 5 min | 18.5% | 12.2% | 0.934 | 12.8% |
| compression + split @ 15 min | 19.3% | 10.8% | 0.933 | 14.4% |

So what does the damage is **shortening the session**, not the pause. This agrees with C-23
and C-24. The security side is still handled, but through a different path: the longest pause
is measured from the **original** timestamps before compression, so `resumedAfterAway`, the
LOW streak reset and the LOW->MEDIUM raise for absences ≥ `reverifyAfterSec` still work
(`core/idle.live.test.mjs` part E).

**A bigger training pool.** `reproduce_db.py` capped the pool at 30 vectors, while the SDK ships
`baseline + progressiveMaxPool` = 10 + 90. That is a "measured ≠ shipped" gap of the same class
as C-27, so it was measured. The effect is tiny: without AFK EER 9.8% -> 9.7%, AUC 0.961 ->
0.962. With AFK + compression the result is 8.6% / 9.0% / 0.972 / 7.9%, also inside the spread.
`run_fold(max_pool=...)` is now available. The default stays 30 so the old numbers can be
reproduced.

### Enrollment length curve: flat

The C-26 claim ("10-session enrollment is too short") was already withdrawn in C-27. It was
re-tested more widely on the shipped engine with a fixed test set (sessions ≥ 20,
`--eval-from 20`):

| Enrollment | FRR | FAR | AUC | EER | FAR@FRR15 |
|---:|---:|---:|---:|---:|---:|
| 5 | 13.6% | 10.7% | 0.940 | 12.5% | 9.2% |
| 10 | 14.1% | 13.0% | 0.941 | 12.8% | 9.9% |
| 15 | 14.0% | 12.7% | 0.933 | 12.6% | 9.3% |
| 20 | 14.0% | 13.1% | 0.935 | 13.4% | 10.7% |

Flat from 5 to 20. More enrollment sessions do **not** lower the base FRR of ~10-11%. This is
consistent with C-22/C-27: Mahalanobis + adaptive shrinkage is already designed for small n.

### What MUST be stated honestly

- **The AFK is synthetic.** Pauses of 2-20 minutes are injected into evaluation sessions at one
  point. Part of the recovery is guaranteed by construction, because what was injected is time,
  and time is exactly what gets compressed. Evidence that the benefit is not just an artefact:
  (a) on the original data without injection, compression is neutral to slightly better;
  (b) AUC/EER with AFK + compression **beat** the no-AFK control (0.968 vs 0.961). There is no
  field AFK data yet.
- **One batch that spans an absence produces one verdict.** For absences of 5-15 minutes, the
  only security handling is the streak reset. On the live path (30 s windows) this rarely
  happens because stale tails are not carried into the next window. In `scoreExternalEvents`
  with long batches, it can.
- **The base FRR of ~10-11% on normal sessions is NOT touched.** Threshold levers, aggregation
  levers and enrollment length are all exhausted. What remains has to be found in the
  representation (which features are used), not in the decision making.

**Tests:** `core/compress.test.mjs` 22/22 (basic properties, 5 time-denominated features
restored, shape features identical, count features do not shrink). `core/idle.live.test.mjs`
33/33: A-D lock the old C-23 path through `idleCompressSec:0`, and E locks the new path. Every
older suite stays green.

Reproduce:
`python tools/canonical_holdout.py --only 1 2 7 8 --seeds 42 7 13 2026 99 --q-grid 0.01 0.02 0.03 0.05 0.08 0.10 0.12 0.15 0.18 0.20`

> **Note after C-29.** The absolute C-28 numbers come from an imitation Python harness, with
> whole sessions as the unit and duplicated data. On the real SDK (live mode, C-29) the
> direction holds. On AFK data, compression raises per-owner AUC 0.910 -> 0.927 and lowers the
> share of intruder sessions never judged 10.9% -> 2.8%. Quote this direction, not
> 18.4% -> 9.7%.

---

## C-29 - CRITICAL: three harnesses, none of them measured the SDK. Now the SDK measures itself

C-27 fixed the engine in `reproduce_db.py`, but that harness still **imitated** the SDK in
Python. Once the imitation was compared against the real SDK, it still missed in seven places:

| | Python imitation | Shipped SDK |
|---|---|---|
| threshold | quantile, **tuned** per split | parametric `k_low`, **fixed** |
| per-detector z | not clamped | clamped [-6, 6] |
| Mahalanobis (`experiment.py`) | fixed shrink 0.3 | C-22 adaptive shrink |
| pool | 30 | 10 + 90 |
| MFA-passed sessions | never train | train (TRUST-LOOP) |
| sticky floor, consecutive blocks | absent | present |
| **verdict unit** | **whole research session (~700 events)** | **30 s window** |

**New tool: `tools/eval_sdk.mjs`.** Every session is fed into the real `BehaviorGuard`. The
`--live` mode calls `endSession()` every 30 seconds against a simulated buffer, so compression,
integrity, JS feature extraction, thresholds, the floor, tail carry-back, cross-visit
`bg:pending` and per-visit `init()` all run on the SDK's own code. Only two things are
simulated: the wall clock, and the answer to the verification popup (through the public
`reportStepUp` API). The data is exported by `tools/export_sessions.py` to an OS temp
directory, **never into the repo**.

**Seven measurement artefacts were found and removed before the numbers were trusted.** All of
them came from this harness itself, and all of them made the numbers look worse or better
without anything changing in the SDK:
1. the simulated clock was too dense, so the rate limit fired and produced fake BLOCKs;
2. one instance for many visits, so the gap between days was read as "away";
3. `k_low` was set after `init()`, when the thresholds had already been computed;
4. step-up was answered at the end of the visit, not immediately;
5. the wall clock was stuck on another date, so evidence tails never went stale;
6. the clock had not been moved to the start of the visit at `init()`, so old pending data
   looked fresh;
7. intruder sessions without a verdict were not counted.

Recorded because **all seven are of the same class as C-27**: a harness that is not checked
against the mechanism it measures produces numbers that look valid.

### Finding 1 - the research data is duplicated (25-42% identical events)

Every event type in the research database has identical twins down to the millisecond and
pixel: KEYSTROKE 36.5%, FORM_FOCUS 41.1%, MOUSE_MOVE 26.2%. The rate is uneven across sessions.
As a result `checkIntegrity` ("duplicate timestamps > 5") accused **458 of 653 human sessions**
of being bots. After removing the twins: **0**. The maximum number of different keystrokes that
happen to land on the same millisecond for a human is 4.

Patch: `idle.js:dropExactDuplicates` runs before anything is measured. Twins carry no
behavioural information, and their cause is always a logging artefact (double listeners,
resent batches, pending data read twice). The SDK is now robust to all of these. The impact on
the Python harness turned out to be small (AUC 0.961 -> 0.959), so the old numbers were not
inflated by the twins. What was affected is **integrity**.

### Finding 2 - pooled AUC misleads, per-owner AUC does not

The SDK's pooled AUC (0.928) is far below the imitation's (0.965). Per owner, the two are
almost the same (e.g. subject 7: 0.997 vs 1.000; subject 11: 1.000 vs 1.000). The z clamp
[-6,6] compresses the score scale across people, so **pooled** AUC drops without per-person
separating power changing. SDK thresholds are per owner, so what matters is **per-owner
AUC/EER** (macro). `eval_sdk` reports both. Removing the clamp only raises pooled AUC
0.928 -> 0.934, while FRR/FAR stay exactly the same. The clamp-as-cause hypothesis is
**rejected**.

### Finding 3 - the verdict unit (the biggest cause)

| evidence per verdict (live mode) | 30 | 100 | 150 | 200 | 300 |
|---|---:|---:|---:|---:|---:|
| per-owner EER | 23.8% | 14.2% | 12.3% | 10.7% | 9.0% |
| intruder sessions never judged | 0% | 0% | 0.6% | 4.5% | 25% |

The shipped SDK judges every 30-second window. A window that small often contains only mouse
movement, or only typing, so its EER is **twice** the whole-session number. Every number ever
reported (including C-27 and C-28) used whole sessions.

-> **C-33** (below).

### Finding 4 - `k_low` 3.3 is too loose

On the real SDK, `k_low` 3.3 lets 27.6% of intruders through on their first verdict (evidence
150) and 32.1% on the old configuration. That value was chosen on duplicated data with whole
sessions as the unit. -> C-33.

Reproduce:
```
python tools/export_sessions.py            # + --afk for AFK data
node tools/eval_sdk.mjs --live             # the shipped defaults
node tools/eval_sdk.mjs                    # whole-session unit (research comparison)
```

---

## C-30 - CRITICAL (privacy): passwords stored as plain text

`capture.js` stored `key: e.key`, i.e. the **actual character**, including in password fields.
The most dangerous moment is exactly the login: the password is typed, Enter is pressed, the
page navigates, and then `_bankTail()` saves the last 200 events as JSON **plain text in
localStorage**. The password stays behind in the browser, readable by any script on that
origin.

The only feature that uses key identity is `keystroke_transition_entropy`, and that feature only
needs to know "same or different". So every character is replaced by an order-of-appearance
token (`k1`, `k2`, ...) through a map that **only lives in the page's memory**. The mapping is
injective, so the entropy is identical down to the last bit (tested), and all 28 features are
identical. Special key names (Enter, Backspace, Shift) are not secret and are left as they are.
All that remains of a password is its repetition **pattern**, not its content.

Three more defects were found in the same file:
- Keystrokes, clicks, focus and paste inside **BG's own MFA popup** were recorded as behaviour.
  The fixed phrase typed again and again polluted the typing features of the next window. Now
  ignored through `[data-bg-mfa]`. Mouse movement is still recorded.
- **Auto-repeat** (a key held down) overwrote the press time, so hold time was measured from
  the last repeat.
- A lost `keydown` (e.g. focus moved) left a **stale t0** of several minutes for the next
  `keyup`.

Tests: `core/privacy.test.mjs` 10/10.

---

## C-31 - long-term lifecycle: a poisoned baseline, unbounded history, dead retraining

- **Storage truncation poisoned the baseline.** Without IndexedDB, `storage.js` kept
  `slice(-90)` of ALL sessions, so the enrollment block at the front was dropped. After a
  reload, whatever 10 sessions happened to be at the front (possibly intruder sessions) became
  the enrollment, unconditionally. Now the enrollment block (`enrollPrefix`) is always kept.
- **The enrollment block was assumed to be `slice(0, baseline)`.** That assumption breaks as
  soon as there is one ineligible session during enrollment: enrollment vectors then roll out
  of the pool. Now `_enrollPrefix()` ends at the 10th eligible session.
- **History grew without bound.** One entry was added per verdict, and the whole history was
  reserialised + HMAC'd on every verdict. Now: the enrollment block + `historyMax` (240).
- **Retraining died after ~45 minutes.** The schedule was `pool size % 6`. Once the pool was
  full (90), its size got stuck: at 90 the model retrained every window, at 88/89 **never
  again**, so adaptation to owner drift silently died. Now counted from new eligible sessions
  since the last retrain.
- **Seven copies of `storage.set`**, two of which did not write `challengeTemplate`: a single
  bot accusation **deleted the owner's MFA template** from storage. Now there is one writer,
  `_persist()`. The bot path also makes memory and storage agree on `lastRisk`.

Tests: `core/lifecycle.test.mjs` parts A, B, C, G.

---

## C-32 - the integrator could not report a step-up result

A MEDIUM/HIGH verdict tells the integrator to "ask for verification", but the result could not
be handed back to the library. For anyone using their own OTP/WebAuthn, the sticky floor never
cleared and a verified owner session never trained the model. The LOW streak was not stored
either, so short visits never came down from MEDIUM.

Measured (`eval_sdk --live`) on an owner without a verification path: **friction 61.3%,
BLOCKED 25.7%**. With a verification path: 16.4% and 0%.

Patch: `reportStepUp({passed})`, with exactly the same effect as a verified built-in MFA.
`lowStreak` is now stored.

**A consequence that must be documented:** BehaviorGuard **requires** a step-up path. Without
one, the sticky floor and consecutive blocks turn into a punishment for the owner.

---

## C-33 - verdicts wait for enough evidence; `k_low` re-selected; `assessNow()`

Default changes, all chosen with `eval_sdk --live`:

| knob | old | new | reason |
|---|---|---|---|
| `session.minEventsAssess` | 30 | **150** | per-owner EER 23.8% -> 12.3% (C-29 table) |
| `session.carryMaxAgeSec` | (= idleGapSec 30) | **900** | insufficient evidence keeps accumulating even if the user is quiet > 30 s |
| `k_low` | 3.3 | **1.75** | median of the tuner's choices, 5 splits (below) |

Windows still tick every 30 seconds. What changed: a verdict only falls once 150 events have
been collected.

**Choosing `k_low` (evidence 150, tuned on 8 subjects, reported on the other 8, 5 splits):** the
tuner picked 1.75 / 1.75 / 1.5 / 2.0 / 1.5. Reported averages: owner asked to verify **16.6%**
[12..19], intruder passes the first verdict **8.9%** [4..14], takeover undetected within 6
sessions 0.2%.

**Results with the shipped defaults (`node tools/eval_sdk.mjs --live`, 16 subjects):**

| | old (30 ev, k 3.3) | **new** |
|---|---:|---:|
| owner asked to verify | 18.6% | **16.4%** |
| owner blocked | 0% | **0%** |
| intruder passes first verdict | 32.1% | **13.5%** |
| whole intruder session passes without friction | 14.0% | **9.5%** |
| intruder sessions never judged | 0% | 0.6% |
| per-owner AUC / EER | 0.818 / 24.3% | **0.929 / 12.0%** |
| takeover detected in the first session | 80.8% | **88.8%** |
| takeover undetected within 6 sessions | 2.9% | **0.0%** |

**Pending tails now have a maximum age.** Yesterday's tail used to merge with today's typing:
the vector was a mix of two days, and the overnight gap was read as "back from an absence",
which triggered MEDIUM at the start of every visit. Before the fix, 149 of ~500 owner friction
events came from this.

**The price of waiting is latency**, and that price is paid in the right place through
`assessNow()`. An intruder who gets in and changes the recovery email within 20 seconds could
finish before the first routine verdict. Sensitive actions must call `assessNow()`: an
immediate verdict, **with no side effects**, and **UNKNOWN means ask for verification** (fail
closed).

`init({calibration:{k_low}})` is now available. Before, the operating point could only be moved
by editing `config.js`.

Conformance: the golden file was regenerated with `k_low` recorded explicitly. Result
**227/227 on all five runtimes** (Python, JS, Rust, Java, WASM).

Tests: `core/lifecycle.test.mjs` parts D, E, F (24/24 together with C-31).

---

## C-34 - SPEC 1.3: `direction_changes` differs across languages at exactly pi/4

At an angle of **exactly** pi/4, `atan2` differs by 1-2 ulp between libm implementations, and
that flips the turn count in ONE language only: 5 of 192 real sessions, even though every
golden passed (no golden case landed exactly on the edge). It is now compared against
`pi/4 + 1e-9` on all five runtimes, and a new golden case `_fc_atan2_pi4_edges` was built from
those real movement pairs. Golden 227 -> **255** checks. All 28 features identical JS vs Python
on 653 sessions.

## C-35 - replay

A victim's recorded behaviour (XSS, a malicious extension, recording malware) played back with
shifted timestamps produces a vector identical to the old session, and the model judges it LOW
because it really is the owner's behaviour. Humans never repeat themselves that closely: the
minimum standardised RMS distance to the nearest owner session in the research data is 0.289.
Sessions with a distance < `replayEps` 0.05 (excluding temporal features) are judged HIGH and
never train. Test: `core/lifecycle.test.mjs` H (including +-2 ms time jitter).

## C-36 - a browser update read as a device change

The device fingerprint included the UA version number, so Chrome's monthly auto-update raised
EVERY user to MEDIUM once. `normalizeUA` drops the version number; old-version fingerprints
(`fpv` < 2) are not compared, so an update of this library itself does not make everyone look
suspicious.

## C-37 - the MFA enrollment popup appeared on every LOW verdict

Closing the enrollment popup now snoozes it for 24 hours (`mfa.enrollSnoozeMs`, persisted across
page loads). The "duplicate events" integrity rule was made relative: `dup > max(5, 0.05 n)`.

## C-38 - re-init inherited the previous user

Logout A -> login B in the same tab (or an SPA route change that calls `init()` again): if B had
no stored data yet, B was judged with A's MODEL, B's sessions trained A's pool, and B's
verification was matched against A's RHYTHM TEMPLATE. Now `_resetUserState()` is used by `init`
and `clear`, the old capture is detached, and the previous init configuration does not carry
over.

## C-39 - server: the `pk` in the page opened everything

Before, anyone who read the `pk` from the page source could read any account's behaviour
template, **overwrite it** (poisoning: the attacker's vectors become the victim's baseline),
forge verdicts, and through the unauthenticated `/tenants` collect every tenant's `pk`. Now a
tenant has a `pk` (public) + an `sk` (secret). Baseline/log require a user token
`b64url(userId).exp.hex(HMAC-SHA256(sk, pk|userId|exp))` minted by the integrator's server;
`userId` is taken from the token. The dashboard API requires `sk`; `/tenants` is admin only
(`BG_ADMIN_TOKEN`). NaN/inf vectors are rejected. The client only adopts the server baseline on
a NEW device. Test: `server/test_app.py`.

## C-40 - auto-boot drained the buffer before the SDK could save the tail

`dist/behaviorguard.js` installed `pagehide -> endSession()` BEFORE the SDK's own listeners (init
waits for the fingerprint first). Its async scoring could not finish because the page was dying,
and then the SDK's `_bankTail` found an empty buffer: the last page's evidence was lost. That
listener was removed; auto-boot now forwards `session/idle/calibration/userToken`.

## C-41 - dashboard: stored XSS; loader; extension

- **The dashboard** rendered `userId`, `reasons`, `fp`, `ip` through `innerHTML` without
  escaping. One valid user token was enough to plant an `<img onerror=...>` that ran in the
  OPERATOR's browser (the one holding `sk`). The dashboard also still logged in with `pk`, so it
  did not work with the C-39 server. Now: the operator enters `sk` (kept in that tab's
  sessionStorage, sent in a header, never in the URL); every value is escaped, levels are
  allow-listed, numbers are forced through `Number`; `/dashboard` is served with a **nonce-based
  CSP** as a second layer. The server filters `/log` at the source (allow-listed levels, action
  `^[A-Z_]{1,32}$`, reasons 6 x 160, feature names `^[a-z0-9_]{1,40}$`, implausible client clocks
  replaced by the server clock) and `X-Forwarded-For` is only trusted with `BG_TRUST_PROXY=1`.
  Also: `.login{display:grid}` beat the `hidden` attribute, so the login form could never be
  closed (the drawer had the same defect) - now `[hidden]{display:none!important}`.
  Test: `server/test_app.py` 35/35; verified in the browser: the payload renders as text.
- **The loader** `loader/bg-loader.js` had the same C-40 defect (`pagehide`/`beforeunload`
  -> `endSession`). Removed; the loader now forwards the same options as auto-boot.
- **The bundle requested the site's `/storage.js`.** `token.js` loaded storage through
  `import('../storage.js')`; in a single-file bundle that path is relative to the PAGE, so every
  page load produced a 404 in the integrator's Network tab and the token secret was regenerated
  at random. Profiles were not affected (their seal uses a different key). Now `storage` is
  passed in by the caller; verified in the browser: the bundle only requests itself.
- **The extension**'s old version stored the CHARACTERS typed on any site into
  `chrome.storage.local` and used a stale hand-copied engine. It has been rewritten to use the
  shared capture and orchestrator, but the extension is **no longer part of the product** (what
  ships is the library) and is scheduled for removal from the repo.

## C-42 - looking for FRR & FAR reductions that hold in the real world (mostly NEGATIVE)

Added `eval_sdk --dump-vec` (the exact vectors the SDK scores, to an OS temp dir) to screen ideas
quickly, then every candidate was re-measured with the real SDK (`eval_sdk --live`).

| idea | result | decision |
|---|---|---|
| cohort normalisation (score = owner similarity minus population similarity), leave-2-out | AUC +0.008..0.012 on the imitation | **rejected**: needs population statistics; features such as page/click counts depend on the SITE, so statistics from 16 volunteers on the research site do not apply to other sites |
| Fisher feature weights from the population | AUC +0.011 | rejected, same reason |
| two-class owner-vs-population model (LogReg, LDA) | AUC +0.010 / -0.054 | rejected, same reason + needs other people's data on the device |
| smoothing consecutive window scores within a visit | owner 16.4% -> 16.4%, intruder whole session 9.5% -> 10.8% | **rejected and the code removed** |
| sliding window `contextEvents` | see below | **opt-in**, off by default |

**Why smoothing does not help** - the most useful finding of this round: owner friction is
**even across window positions** within a visit (model != LOW 15.5% / 13.8% / 14.3% / 10.4% /
19.6% for windows 1..5+). The owner is not rejected because of one unlucky window; they are
rejected on the DAY their behaviour really is different, and on that day all their windows are
different. That is not noise that can be averaged away; it is step-up's job.

**Sliding window** (`session.contextEvents` = N): the first verdict of a visit still falls at 150
NEW events; later verdicts judge the new events + the most recently judged events, up to N in
total. The context only lives in tab memory and is dropped after a pause >= `idle.awaySec`. Two
defects were found and fixed while measuring it:
- the "typing evidence diverted" rule read the context, so ONE paste polluted the next 2-3
  verdicts and a subject who uses a password manager never finished enrolling (subject 19
  disappeared from the results at N >= 375). Now only new events are checked;
- the harness copied the owner's context into the intruder clone (cleaned up; an intruder with
  stolen credentials arrives through a new visit).

Results (with the C-43 grace period on, 16 subjects):

| | default | N = 450 |
|---|---:|---:|
| owner asked to verify | 14.5% | 14.5% |
| intruder passes first verdict | 13.3% | **10.1%** |
| intruder passes whole session | 9.2% | **8.2%** |
| per-owner AUC / EER | 0.927 / 12.3% | 0.935 / 10.7% |
| takeover undetected within 6 sessions | **0 / 240** | 3 / 240 |

All three undetected pairs are **the same intruder** (subject 22) on three accounts: this
person's style, averaged over a large window, resembles all three; without the sliding window,
one of their windows is occasionally caught. Part of the AUC gain also comes from the 9 count
features that grow with window length (the first window of a visit "looks odd" for intruder AND
owner). So N stays **opt-in** for integrators who fear the first-session intruder more than a
slow takeover.

## C-43 - the owner asked again 30 seconds after passing OTP

After `reportStepUp({passed:true})` the next window could be MEDIUM again straight away, and that
path had no pause at all (the built-in popup only had 15 seconds). Because owner friction piles up
per DAY (C-42), an owner who is "off" that day was asked for OTP every 30 seconds.

`mfa.graceSec` (default **900**, aligned with the PCI DSS 8.2.8 idle limit, the "sudo mode"
pattern): for that long after a PROVEN verification, MEDIUM does not ask for verification again
(`level` LOW, `modelLevel` stays MEDIUM, `stepUpGrace` filled in). Its limits:
- only a real verification opens it - an intruder with stolen credentials has no second factor;
- HIGH still asks for verification; replay and "back after an absence" never get grace;
- an absence >= `idle.awaySec` revokes it, as does a page load after a pause that long, as does a
  change of device fingerprint;
- damped windows **do not train** the model (anti-poisoning).

| `eval_sdk --live`, 16 subjects | before | **graceSec 900** |
|---|---:|---:|
| owner asked to verify | 16.4% | **14.5%** |
| tuning / report split | 15.4% / 17.6% | **13.2% / 16.1%** |
| intruder passes first verdict | 13.5% | **13.3%** |
| intruder passes whole session | 9.5% | **9.2%** |
| takeover detected in session 1 | 88.8% | **89.6%** |
| takeover undetected within 6 sessions | 0% | **0%** |
| AFK data: owner asked to verify | 23.8% | **22.7%** |

Not a single security number got worse; the ones that improved slightly did so because damped
windows no longer enter the pool as "verified". 300 / 900 / 1800 seconds give almost the same
result; 900 was chosen because it matches the standard. The remaining friction on AFK data
(22.7% vs model 16.7%) is the deliberate "back after an absence >= 15 minutes -> re-verify"
rule. An open note that predates this (the SDK at HEAD gives the same number): on AFK data 2.8%
of intruder sessions are never judged (0.6% without AFK) - sensitive actions must call
`assessNow()`.

Tests: `core/lifecycle.test.mjs` J (10 checks) and K (5 sliding-window checks).

---

## C-44 - sessions judged in RANDOM order; a typing rhythm not polluted by pauses

### Finding: the harness judged sessions in random order

`session_id` in the research database is a random UUID, and `load_raw` sorted with
`ORDER BY session_id`. Every harness up to C-43 therefore enrolled the owner with 10 RANDOM
sessions from the whole data-collection period, and then judged the rest in random order too.
Real users are not like that: they enroll with their FIRST visits and then keep using the site.
`tools/export_sessions.py --order time` (now the default) sorts sessions per subject by the
timestamp of their first event.

In time order, owner friction by quintile of usage (C-44 engine): 10.0 / 13.8 / 16.2 / 10.1 /
7.2% - rising in the middle and falling again - the owner's habits shift in the first weeks, and
the progressive pool catches up. There is no systematic "it gets messier over time" trend; that
impression came from per-session views laid out in random order.

### Change: 6 typing-rhythm features (SPEC 1.4.0, 28 -> 34 features)

The old typing features used MEANS of gaps and key holds. The mean gap is polluted by thinking
pauses (one 900 ms pause shifts the mean of a short session a lot), while the median and IQR are
not. Six new features (SPEC §8.10):

| feature | meaning |
|---|---|
| `keystroke_flight_median` / `_iqr` | rhythm of the gaps between keys, robust to long pauses |
| `keystroke_dwell_median` | key hold time, robust to outliers |
| `keystroke_backspace_ratio` | correction habit |
| `keystroke_shift_ratio` | capitalisation habit |
| `keystroke_cross_hand_ratio` | left/right hand pattern |

The hand class is taken from `e.code` (the PHYSICAL position, independent of layout) as `kc` =
L/R/D/S. In `input[type=password]` fields the class is **not** recorded (the left/right order of
a password narrows guessing); `core/privacy.test.mjs` locks this. Research data without `kc`
falls back to the QWERTY class of its ASCII character.

### Results (`eval_sdk --live`, 653 sessions, 16 subjects, time order)

| | C-43 engine (28 features) | **C-44 (34 features)** |
|---|---:|---:|
| owner asked to verify | 12.2% | **11.4%** |
| owner blocked | 0% | **0%** |
| intruder passes first verdict | 12.6% | **10.5%** |
| intruder passes whole session | 8.6% | **7.9%** |
| intruder at the owner's usual hour (`--same-hour`) first / whole | 16.7% / 11.8% | **14.3% / 10.8%** |
| per-owner AUC (macro) | 0.942 | **0.953** |
| AFK data: owner / intruder first / whole | 19.9% / 9.6% / 5.8% | **19.1% / 8.5% / 5.6%** |
| takeover detected in session 1 | 96.3% | 95.0% |
| takeover undetected within 6 sessions | 0.4% (1/240) | 0.4% (1/240) |

Report split (the 8 subjects not used to choose anything): owner 14.4% -> 12.7%, intruder first
verdict 11.4% -> 9.2%. Disclosed as is: takeovers detected in the FIRST session fell 96.3% ->
95.0% (3 pairs out of 240 are only detected in session 2); the one that is never detected is the
same pair on both engines.

New `--same-hour` in eval_sdk: the intruder uses the account at the hours the owner usually does,
so `temporal_time_of_day_score` no longer gives free help. That is a more honest scenario for an
attacker who knows the victim's habits, and the rise from 10.5% to 14.3% is the share of
detection that until now came from the hour alone.

Every new feature contributes (leave-one-out, owner / intruder first verdict): without backspace
11.8 / 10.6; without cross-hand 12.2 / 10.5; without dwell median 12.0 / 10.7; without flight IQR
11.8 / 10.6; without flight median 12.1 / 10.8; without shift 11.3 / 11.1.

### Levers tested and REJECTED

- dropping the hour (temporal) features or the task features (three variants): the owner number
  drops a little but intruders passing the first verdict rise from 12.6% to 16.0-21.9% - breaking
  the "FAR must not rise" condition;
- `retrainEvery` 3: identical to 6;
- `progressiveMaxPool` 45: owner 12.7%, intruder 12.2% - mixed, not used;
- strict mode `contextEvents` 450 + k_low 2.0: owner 11.0%, intruder first verdict 8.7%, never
  detected 0/240 - but on AFK data intruder whole session rises 5.6% -> 6.5%, so it stays opt-in
  (documented in the README as "strict mode").

### Operating point (k_low) on the C-44 engine

| k_low | owner | intruder first verdict | whole session | never detected |
|---|---:|---:|---:|---:|
| 1.25 | 17.0% | 6.5% | 4.8% | 0.4% |
| 1.5 | 14.8% | 8.6% | 6.5% | 0.4% |
| **1.75** | **11.4%** | **10.5%** | **7.9%** | **0.4%** |
| 2.0 | 10.0% | 12.3% | 9.4% | 0.4% |
| 2.5 | 7.7% | 16.6% | 12.9% | 0.4% |

### Two side effects that were handled

1. **Replay.** The median and IQR of gaps are order statistics that are sensitive to millisecond
   jitter; a recording played back with +-2 ms jitter shifts the median of an owner with a very
   even rhythm far enough to cross `replayEps`. That threshold was calibrated (C-35) on the old 28
   features, so the replay distance is still computed in that space - the six new features are
   excluded from `_nearestPastSession`. `core/lifecycle.test.mjs` H is green.
2. **Old stored profiles.** A 28-number vector cannot be compared with a 34-number one; padding
   the empty columns with zeros would poison the model. `init()` discards profiles whose vector
   length differs (once, with a console warning) and the user enrolls again.

Golden 255 -> **319** checks (case `fc06_keystroke_rhythm`: kc, upper case, Shift, Backspace,
Delete, non-ASCII characters, a 1500 ms pause, holds of 0 / 1200 ms), green in JS, Python, Java,
Rust and WASM.

---

## C-45 - from a correct library to a product other people can install

This audit did not touch the model, the features or the thresholds: `eval_sdk --live` before and
after is identical (owner 11.4%, intruder first verdict 10.5%, whole session 7.9%, AUC 0.953) and
the golden file stays at 319/319. What was audited is what happens when this library is installed
on someone else's site, used by real people, on devices and in conditions that are not in the
research data. The method: install it on a realistic demo site (`demo/arunika/`) and run every
flow in a real browser, including the full live path (DOM events -> 30 s clock -> verdict ->
dialog -> OTP -> final verdict).

### The verification dialog

| defect | effect | now |
|---|---|---|
| inline styles in the integrator's page, fixed ids | site CSS changes the dialog; ids can collide; a strict CSP `style-src` blocks it | Shadow DOM + adoptedStyleSheets, zero style attributes, text through textContent |
| no role/focus/Esc | unusable with a keyboard/screen reader | role=dialog, aria-modal, focus trap, Esc, aria-live, focus restored |
| on-screen keyboards (`Unidentified`/229) | phone samples are NEVER complete -> an owner on a phone can never pass | 'soft' mode: gaps between characters from the `input` event; the template stores its mode; a mode mismatch is rejected |
| one `downAt` for all keys | rollover (pressing the next letter before releasing) breaks press/release pairs | per-key tracking |
| Backspace only cleared the recording | the next attempt is always rejected with no explanation | the field is cleared too, with the reason shown |
| time limit counted from opening (60 s enroll) | a 3-round enrollment by a slow typist is closed halfway | counted from inactivity; enroll 90 s |
| no way out | an owner who cannot type the phrase (different keyboard, injury) can only be blocked | `mfa.onFallback` = a "use another method" button |
| the text "your behaviour is different" for every step-up | a policy step-up (a large transfer) accuses the user | text matched to the trigger (verdict vs integrator action) |
| entry animation | in a tab rendered late the dialog could look transparent | removed - a security dialog must never risk being invisible |

### Integrator API

- `stepUp({level, reason})`: the dialog/fallback on request, before a sensitive action.
- `status()`: state for the integrator's UI without exposing vectors (before, only `getState()`).
- `stop()` (logout): before, there was no way to stop - the library kept capturing on behalf of
  an account that had logged out. Now the tail is banked, capture is detached, the clock is
  stopped and the grace period revoked.
- `forget()`: the right to erasure (profile, template, tail, token secret).
- `enrollMfa()` / `forgetMfa()`: enrollment from a settings page; deleting the template requires
  a passed verification first.
- `on('risk', fn)`; the DOM event `behaviorguard:risk` is now broadcast by the core for ALL
  integrations (before, only by auto-boot - an integrator calling init() themselves never
  received it).
- `assessNow().verifiedRecently`: the integrator's policy can avoid asking twice.
- A verdict that raises the dialog is announced IMMEDIATELY (`stage:'awaiting-mfa'`,
  `mfa.awaiting`) and announced again with its result (same `id`). Before, onRisk waited for the
  dialog to close - the integrator could be blind for 2 minutes or more. A verdict that falls
  while another dialog is open: `mfa.busy`.

### Real-world conditions that used to kill or break the library

| condition | before | now |
|---|---|---|
| http site (not a secure context) | `crypto.subtle` missing -> every `_persist` throws -> NO verdict at all, no message | stored unsigned + a warning; unsigned data is rejected on https; the device fingerprint uses FNV |
| script loaded twice | two captures running | the first copy wins |
| browser without `structuredClone` | throws on load | JSON copy |
| init() called concurrently | two captures installed | queued |
| page restored from the back/forward cache | clock dead, no more verdicts | `pageshow` revives it |
| dialog in a background tab | expires unseen -> MFA_FAILED | the leader picks the visible tab; the dialog waits for the tab to be visible |
| one backwards clock step (NTP sync) | "non-monotonic timestamps" -> BLOCK for a human | needs >= 3 steps and > 1% of events |
| on-screen keyboard key holds (~0 ms, uniform) | "identical holds" -> phone users blocked as bots | `soft` keys excluded from the hold check |
| focus on a `<select>`/checkbox without typing | read as "autofill" -> window not eligible to train | `txt:false`; only text fields count |
| verification 10 minutes after the verdict | old windows (possibly someone else's) trained too | only windows <= 2 windows old train |
| unlimited rhythm failures across dialogs | unlimited guessing attempts | `lockAfterFailures` (3): rhythm locked until the fallback passes |
| phrase < 8 characters | the template never forms, silently | console warning |
| automatic enrollment while the user is typing | the dialog steals focus from the form | deferred to the next LOW verdict |

Tests: `core/stepup.test.mjs` (61 checks: A-M), on top of all the older suites, which stay
green. Browser tests (not automated, recorded here): 3-round rhythm enrollment, rhythm
verification before a transfer, OTP fallback (wrong code then right code), replay -> HIGH ->
session stopped, bot injection -> BLOCK, the full live path with the 30 s clock, phone layout.

---

## Verification status after the patches

| Test | Command | Result |
|---|---|---|
| Python engine vs golden | `python core/conformance.py` | 319/319 conformant (SPEC 1.4) |
| JS engine vs golden | `node core/conformance.node.mjs` | 319/319 conformant |
| Step-up regression C-1 + tempo drift C-20 | `core/challenge.test.html` / `.mjs` | 23/23 pass |
| MFA FRR/FAR before vs after C-20 | Gaussian jitter simulation (18-char phrase) | FRR 63.6%->~2%, FAR ~0% |
| Storage C-10 (browser) | `storage.del` on an empty store | does not throw, 0 errors |
| Detector gate C-15/C-8 | `core/ensemble.test.html` / `.mjs` | 11/11 pass |
| Attack simulator C-12..C-15 | `demo/attack_sim.html` | 4/4 HIGH, mimicry via ensemble |
| Integrity heuristics C-16 | `core/integrity.test.html` / `.mjs` | 10/10 pass |
| Full live path C-16..C-18 | real page + DOM events | enrollment 10/10, correct LOW/MEDIUM verdicts, persistent after reload |
| sdk↔extension sync (extension scheduled for removal, C-41) | `tools/sync_core.ps1` | identical, exit 0 |
| Idle segmentation C-23 | `core/idle.test.mjs` / `.html` | 33/33 pass |
| Full idle path C-23 | `core/idle.live.test.mjs` | 20/20 pass |
| Session-length invariance C-24 | `core/invariance.test.mjs` / `.html` | 26/26 pass |
| Measurement validity audit C-25 | `core/audit.test.mjs` | 32/32 pass |
| Held-out validation C-23/C-24 | `python tools/canonical_holdout.py --seeds 42 7 13 2026 99` | NEGATIVE for C-23 segmentation |
| Idle compression C-28 | `core/compress.test.mjs` | 22/22 pass |
| Full idle path C-23 + C-28 | `core/idle.live.test.mjs` | 33/33 pass |
| Held-out C-28 | `python tools/canonical_holdout.py --only 1 2 7 8 ...` | AFK: FRR 18.4% -> 9.7%, FAR unchanged |
| Capture privacy C-30, C-44 | `node core/privacy.test.mjs` | 14/14 pass |
| Lifecycle C-31..C-38, C-42, C-43 | `node core/lifecycle.test.mjs` | 49/49 pass |
| Production step-up, integrator API, real conditions C-45 | `node core/stepup.test.mjs` | 61/61 pass |
| Script-made input, fallback time limit C-46 | `node core/c46.test.mjs` | 25/25 pass |
| Short-burst typing rhythm (rejected C-46 idea) | `node tools/eval_typing.mjs --sweep` | EER 29-38% -> not shipped |
| Server auth + log sanitising C-39, C-41 | `python server/test_app.py` | 35/35 pass |
| Shipped SDK, 30 s windows, time order (C-44) | `node tools/eval_sdk.mjs --live` | owner 11.4%, intruder first verdict 10.5%, whole session 7.9%, AUC 0.953 |
| Java / Rust / WASM conformance | `npm run conformance:java` / `:rust` / `:wasm` | 319/319 conformant |

## C-46 - script-made behaviour, and a harness that silently measured another configuration

Three things in one round: one fundamental security hole, one MEASURING TOOL bug that made part
of the operating-point tables untrustworthy, and one idea that was MEASURED AND THEN REJECTED.
The default verdict did not change: `eval_sdk --live` after all of this is still owner 11.4% /
intruder first verdict 10.5% / whole session 7.9% / AUC 0.953 / EER 10.1%.

### 1. Script-made events counted as human behaviour

Until this point, `capture.js` accepted EVERY DOM event that came by. `isTrusted` was never
checked. The consequence is much bigger than "one verdict can be fooled":

```js
// before: this was enough, from the console or any XSS on the same origin
for (let i = 0; i < 400; i++) {
  document.dispatchEvent(new MouseEvent('mousemove', {clientX: x(i), clientY: y(i)}));
  document.dispatchEvent(new KeyboardEvent('keyup', {key: 'a', code: 'KeyA'}));
}
```

The attacker does not need to guess the owner's behaviour. They broadcast a human-looking event
stream (random jitter, plausible pauses) until the verdict is LOW - and because eligible LOW
windows ALSO TRAIN, the fake vectors enter the baseline pool. What happens is not one missed
check but **the owner's profile shifted toward the attacker**, permanently, with every later
page load reinforcing it. This is a relative of C-35 (replay) through a cheaper door: replay
needs a recording of the owner, this needs nothing.

Now events with `isTrusted === false` **never enter the buffer**. The test is `!== false`, not
`=== true`, so very old browsers without that property fall back to the old behaviour instead of
silently going blind.

The filter deliberately does not cover every event type:

| type | filtered? | reason |
|---|---|---|
| mousemove, click, keydown/keyup, touchmove | yes | this is the timing biometric; there is no legitimate reason for it to come from a script |
| focus / blur | **no** | `el.focus()` called by the site (autofocus, auto-advance after 4 digits) is untrusted but normal, and was counted when the research data was collected. Filtering it only creates a train-vs-serve mismatch on `form_focus_count` |
| scroll | **cannot be** | `window.scrollTo()` emits events with `isTrusted` TRUE. Do not claim to filter what is not filtered |

Dropped events are still COUNTED (`capture.synthetic`, cumulative over the visit). The orchestrator
uses the per-verdict difference: if there are >= 20 fake events AND they are >= 10% of the
evidence size, the window **may not train** (`eligible:false`) and the reason is announced
(`evt.automation`). Deliberately NOT a block and NOT a level raise: some UI libraries (swipe
polyfills, carousels) emit legitimate synthetic events, and blocking on them would lock out an
owner who did nothing. The core defence is "do not train", not "block".

The same second path: **the verification dialog**. The rhythm template is stored on the device,
so a script that can read it only needs to fire keydown/keyup with gaps exactly at the template
medians to PASS without a single finger touching the keyboard. `createRecorder` now rejects the
whole sample if any synthetic event touched it (`error:'synthetic'`), failing closed.

One defect in the patch itself was found before shipping: the filter was first placed INSIDE
`handlers.move`, i.e. AFTER the 50 ms throttle. Fake events still passed the throttle first and
updated `lastMove`, so a script flooding `mousemove` at 1000/s made REAL mouse movement always land
inside the throttle window and never get recorded. Rejecting fake input became a way to silence
the real thing - the attacker does not need to fake behaviour, just erase it. The filter moved
IN FRONT of the throttle (test A6).

Verified in a real browser: 120 fake events broadcast -> 0 entered the buffer, 91 recorded as
synthetic; real typing afterwards was still recorded normally.

### 2. `--k-low`, `--cfg` and `--compress` had no effect at all since C-45

C-45 added `this.cfg = clone(DEFAULTS)` in `_init()` so options from a previous `init()` do not
carry into the next `init()` (C-38, logout A -> login B). Correct for the SDK. But
`tools/eval_sdk.mjs` applied its overrides to `g.cfg` **before** `init()`:

```js
if (K_LOW !== null) g.cfg.k_low = Number(K_LOW);   // <- wiped by _init()
deepMerge(g.cfg, CFG);                             // <- wiped by _init()
g.cfg.session.idleCompressSec = COMPRESS;          // <- wiped by _init()
await g.init({ userId: uid, mfa: { enabled: false } });
```

From then on every `--k-low` sweep ran the DEFAULTS over and over. The symptom was not an error
but **results identical to the last decimal** - which reads as "the knob really has no effect",
not as a bug. It was only noticed because k=1.75 and k=2.0 gave exactly the same numbers on five
metrics at once.

Fixed through the official door: whatever `init()` recognises is passed as an `init()` OPTION
(`calibration.k_low`, `session.*`, `weights`, `baseline`, ...), applied after the reset and before
`_rebuildModel()`; the remaining `--cfg` keys that have no door (progressiveMaxPool, replayEps) are
merged after init because they are only read at scoring time. Checked: k_low 1.25 / 1.75 / 2.5
now give owner friction 14.4% / 10.4% / 7.7% (tuning split).

**Impact on numbers already published: NONE - but that was only known after re-measuring.** The
whole operating-point table (k_low 1.25 / 1.5 / 1.75 / 2.0 / 2.5) and both strict-mode rows
(`contextEvents: 450`, with and without k_low 2.0) were re-run with the fixed harness, 16 subjects,
the same data. All nine rows are **identical to the last decimal** to what was published - because
they were all measured BEFORE C-45 planted the bug. This bug never got the chance to produce a
single wrong published number; it only made every sweep AFTER it useless, without any warning.

What still has to be recorded: during that window, "this knob has no effect" is a conclusion people
would very likely draw, and it is the wrong conclusion. So there is now a cheap check that every
sweep must do: if two different knob values give exactly the same result on several metrics at
once, what is broken is the measuring tool, not the knob.

### 3. REJECTED: behavioural verification without an enrollment template

The question is fair and often asked: if this library recognises people by how they type, why does
step-up verification need a phrase template that has to be enrolled in 3 rounds first? Before that
template exists - i.e. on every new installation - step-up falls 100% to the integrator's fallback
(OTP), without a single bit of behaviour being judged.

The idea: judge the FREE typing rhythm of one input field (~20 keys) against the owner's
statistics, using the scale-free F4 subspace (dwell mean/std/median, flight median/IQR,
backspace / cross-hand / shift ratios). Measured by `tools/eval_typing.mjs`, held out per owner
(trained on the first 10 sessions, tested on later sessions, intruders = the 15 other subjects):

| burst | owner rejected (k=2.5) | intruder passes | AUC | EER |
|---:|---:|---:|---:|---:|
| 12 keys | 3.7% | 86.3% | 0.667 | 37.9% |
| 20 keys | 5.6% | 80.5% | 0.711 | 33.8% |
| 30 keys | 5.9% | 72.5% | 0.738 | 32.2% |
| 40 keys | 7.1% | 64.1% | 0.769 | 29.3% |

EER 29-38%. That is not a security gate; it is a coin toss with extra steps. Even at 40 keys -
twice the phrase length - two out of three intruders pass at an operating point that rejects 7% of
owners. **Not shipped.** Typing rhythm only separates people when the comparison is the SAME text
at the SAME positions (the phrase template, C-20), or when the evidence is a full window (150
events, all 34 features).

So the right answer to the original complaint is not a new algorithm but **WHEN the template is
enrolled**: `enrollMfa()` may already be called for a new user (no model yet - its trust is the
same as the baseline itself, C-2), so its place is ONBOARDING, not waiting for the first LOW
verdict after the model is built. `status().mfa.canEnroll` was added so a settings page knows when
the button should be shown, and `demo/arunika/mulai.html` shows the flow.

### 4. Two deadlocks in the step-up path

| defect | effect | now |
|---|---|---|
| the integrator's `onFallback` awaited with no time limit | a Promise that never settles (an OTP dialog that forgets to resolve, a network call without a timeout) leaves `_mfaBusy` stuck FOREVER: the whole step-up layer is dead for the rest of the page's life, and every verdict comes back `mfa:{busy:true}` | `mfa.fallbackTimeoutMs` (default 300 s); timing out = not verified |
| `lockAfterFailures` without `onFallback` | the rhythm lock only opens on a SUCCESSFUL verification; without a fallback there is no way to succeed -> the owner (e.g. on a different keyboard) is locked out permanently, and the integrator does not know why | warned at `init()`, with the two ways out named explicitly |

## C-47 - REJECTED: outlier-robust mouse features (an improvement that did not replicate)

C-44 gave a real win with one simple idea: nine typing features used means/stds that a single
outlier can drag, so median/IQR versions that drop long pauses were added. A fair question: **the
nine MOUSE features have exactly the same defect - why not treat them the same way?**

`mouse_velocity_mean/std/max` get dragged by one cursor jump (switching windows, the hand letting go
and grabbing again). `mouse_direction_changes` and `mouse_pause_count` are RAW COUNTS that grow with
session length, i.e. the C-24 defect that was never patched on the mouse path.
`mouse_click_interval_mean` is polluted by long thinking pauses.

Two candidates were measured, both through `eval_sdk --live --sdk <copy>` (a complete ablated SDK,
not an imitation), the same time-ordered data, 16 subjects:

**A - ADDITIVE (34 -> 42 features):** add `mouse_velocity_median/iqr`, `mouse_step_median`,
`mouse_pause_ratio`, `mouse_direction_change_ratio`, `mouse_curvature_median`,
`mouse_click_interval_median`, `scroll_delta_median`, all with event pairs separated by >= 1 s
dropped (the C-44 trick moved to the mouse).

**B - REPLACEMENT (still 34 features):** the four count/mean features above replaced by median/ratio
equivalents. The dimension does not grow - this matters, because the training pool holds at most 90
vectors and d=42 means n≈2.1d (the C-22 n-versus-d warning).

| variant | owner | intruder first verdict | whole session | AUC | EER |
|---|---:|---:|---:|---:|---:|
| shipped (34) | 11.4% | 10.5% | 7.9% | 0.953 | 10.1% |
| A (42, additive) | 13.2% | 9.9% | 7.8% | 0.949 | 10.2% |
| B (34, replacement) | 12.9% | 8.1% | 6.1% | **0.956** | 10.0% |

A loses clearly: owner friction +1.8 points for intruders -0.6 points, and AUC drops. Exactly what
C-22 predicts - eight extra dimensions cost more than they carry.

B looks like a win. AUC rises 0.953 -> 0.956, intruder first verdict drops 10.5% -> 8.1%. Its
operating point does shift tighter (owner friction rises), but a higher AUC means that shift can be
paid back with a looser `k_low`. Swept on the TUNING split (the same 8 subjects used to choose k_low
in C-33):

| configuration | owner | intruder first verdict | whole session | AUC | EER |
|---|---:|---:|---:|---:|---:|
| shipped, k_low 1.5 | 12.7% | 9.0% | 5.8% | 0.955 | 9.4% |
| **B, k_low 1.75** | **11.4%** | **7.7%** | **4.6%** | **0.963** | **8.9%** |
| B, k_low 2.0 | 10.0% | 9.9% | 5.9% | 0.963 | 8.8% |

B beats the shipped configuration in EVERY column. At that point the decision looked settled:
replace four formulas, bump SPEC to 1.5, regenerate the golden file, sync four ports.

### Why it was NOT shipped in the end

The report split (8 subjects NEVER used to choose anything), k_low 1.75 for both:

| | shipped | B |
|---|---:|---:|
| owner asked to verify | 12.7% | **14.8%** |
| intruder passes first verdict | 9.2% | 8.6% |
| intruder passes whole session | 8.2% | 7.5% |
| per-owner AUC | **0.952** | 0.949 |
| per-owner EER | **10.7%** | 11.0% |

**Two splits give two answers.** On the tuning split, B's separating power is better (AUC 0.963 vs
0.955). On the report split, it is worse (0.949 vs 0.952). The 16-subject number that looks like a
win (0.956 vs 0.953) is just an average dominated by the tuning split - the split where the whole
operating point was chosen in the first place.

What remains consistent across both splits is only ONE direction: intruders pass less often, owners
are asked more often. That is not better separating power, it is **a threshold shifted tighter** -
and that is already available for free through `calibration: { k_low }`, without changing a single
formula, without breaking compatibility with stored profiles, without touching four ports.

This is the same pattern as C-24 (canonicalisation: three protocol configurations, three answers)
and C-26/C-27 (the withdrawn "16-session enrollment is better" claim). The rule stands: an
improvement that does not replicate on the split not used to choose it is NOT an improvement. Still
34 features, as in SPEC 1.4.

One per-user note that strengthens the rejection: with B, subject 19 jumped from 22% to 37% friction.
An average that improves while one user gets a third worse is not a trade worth shipping without much
stronger evidence.

The ablation copy is not part of the repo (written to an OS temp dir); what is reproducible is the
method: copy `sdk/`, change the formulas, then `node tools/eval_sdk.mjs --live --sdk <copy>` and
compare the **report split**, not the 16-subject number.

## C-48 - an intruder sent money without being asked during the learning period; the enrollment card moves into the library

**Finding (recorded intruder test, 14 Sep 2026).** A friend sitting at the owner's laptop sent
Rp 10,000 twice in Arunika without a single verification. The library did not misjudge: the verdict
was `UNKNOWN` (enrollment had only reached 4/10 a few minutes earlier). What let it through was the
site's POLICY in `demo/arunika/assets/bg-integrasi.js`: `UNKNOWN` was only verified for amounts
>= Rp 1 million. An amount limit is not a safeguard - the intruder just splits the transfer.
`assessNow()` itself already documents UNKNOWN as "ask for verification" (C-33); the demo broke that.

A second gap of the same kind: after 10 pieces of evidence the verdict can be `LOW`, even though
until the training pool reaches 20 the main detector (Mahalanobis, 0.70) is still muted and Isolation
Forest judges alone (C-46). A `LOW` from a half-built engine was used as permission to move money.

**Fix (integrator policy, not the engine - the official FRR/FAR do not change).**
- `UNKNOWN` -> verify, whatever the amount.
- `LOW` with `status().model.mainDetector === false` -> verify for outgoing money.
- The verification grace period (15 minutes) still applies, so the owner is not asked on every
transfer.
The cost falls on the owner during the learning period only (at most once per 15 minutes); once the
main detector is on, behaviour is the same as before. `dist/INSTALL.md` now recommends the same
pattern to other integrators.

**A limit that remains.** In the demo, the one-time code is "sent" as a notification on the same
screen; an intruder who presses "use another method" can read it. In production that code goes to the
owner's phone. For intruder testing, set up the typing rhythm first and do not use the code path.

**Built-in enrollment card.** The "recognising this device" card used to exist only in Arunika's
`mulai.html`, hand-written by the site. Now it is `sdk/core/enroll_ui.js`:
`BehaviorGuard.mountEnrollment(el, options)` and `BehaviorGuard.openEnrollment(options)`, plus a
"see details" button in the `data-panel` panel. The card shows TWO stages (baseline profile 10 ->
main detector 20) so it does not say "done" at exactly the point that let the transfer above
through. Shadow DOM like `mfa.js`; the host deliberately has no `[data-bg-mfa]` so practice typing
counts as evidence (checked in the browser: 9 keys in the card's textarea -> +10 events, the same as a
normal input). `status().evidence.windowSec` was added for the "every ±30 seconds" text.
Example: `dist/panel-pengenalan.html`. Tests: min_check 7/7, stepup 61/61, c46 25/25, privacy
14/14, lifecycle 49/49, integrity 10/10.

The C-1..C-19 changes are all outside the scope of `core/SPEC.md` §1 (challenge, session cycle,
rate limit, storage) **except** C-8, which touches the `ensemble.js` defaults; so conformance was
re-run on both sides and stays at 227/227 (255/255 since SPEC 1.3, C-34; 319/319 since SPEC 1.4, C-44).
