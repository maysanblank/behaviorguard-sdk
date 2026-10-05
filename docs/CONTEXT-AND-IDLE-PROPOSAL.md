# Proposal: Measurement Validity in Continuous Behavioural Authentication

**Context.** The thesis supervisor's note (9 Sep 2026): *"With idle, someone can just open it and
then leave it to go do something else."*

**Summary.** The note is right, and once traced its consequences turn out to point **two ways,
not one**: idle time raises false rejection of the owner (FRR) *and* opens a session takeover
window (FAR). Both have been patched and measured (C-23). More important than the patch: idle
turned out to be **the first member of a larger class of problems** - situations where what
changes is the *instrument*, not the *person*. This document covers the fix that already runs,
its measurements, a catalogue of similar cases, and one general mechanism proposed to handle
them all.

Tracing idle also surfaced a defect **older than idle**: varying session length read as varying
identity. That has been solved as well, without touching SPEC (§3b, C-24).

---

## 1. Why idle does damage

### 1.1 First consequence - measurement (FRR rises)

The 28 F4 features are computed from **gaps between events** and from
`duration = ts_last − ts_first`. If there is a dead pause in the middle of a session, it enters
the statistics as if it were behaviour. Measured directly (`core/idle.test.mjs`, one run of 40
events, left alone for 12 minutes in the middle):

| Feature | Across the gap (old) | Per segment (new) | Factor |
|---|---:|---:|---:|
| `temporal_session_duration` | 731.2 s | 5.5 s | 133× |
| `mouse_click_interval_mean` | 48,708 ms | 710 ms | 69× |
| `keystroke_flight_time_mean` | 34,797 ms | 509 ms | 68× |
| `keystroke_typing_speed` | 0.030 | 1.998 | 67× |

Four of the 28 features miss by one to two orders of magnitude, and not as random noise but as a
**one-directional bias**. This matters: the research database was collected through dense,
task-based scenarios with almost no long pauses. So the model is trained in a dense world and
used in a world full of pauses - a systematic **train-vs-serve mismatch**. The defect class is
exactly the same as C-16/C-17 in `core/DRIFT.md` (features dead in production because a field
was never filled), only this time the source is time, not an empty field.

### 1.2 Second consequence - security (FAR rises)

The opposite side, and actually the more dangerous one. While the chair is empty the session is
**already authenticated**. Whoever sits down next inherits a legitimate session - the *lunch-break
attack*. The intruder never passes a login at all, so the only available signal is **a long
absence in the middle of the session** - exactly the signal that used to be thrown away.

The consequence is sharp: **removing idle just for FRR's sake widens this hole.** If pauses are
simply cleaned out and forgotten, the system loses its only hint that the person changed. So the
patch has to work on both sides.

### 1.3 Third consequence - silence read as safe

`endSession()` used to return `null` without a trace for buffers below 30 events. An integrator
waiting for a callback could not tell **"checked, safe"** from **"no evidence at all"**, and a
silent default always falls on the trusting side.

---

## 2. What has been done (C-23)

Three layers, in `sdk/core/idle.js` + the orchestrator `sdk/behaviorguard.js`.

**Layer 1 - Segmentation.** The event stream is split at every pause ≥ `session.idleGapSec`
(30 seconds = one assessment window). Each contiguous segment is judged on its own. The feature
formulas in `core/SPEC.md` are **not touched at all** - only *what is fed* into `extractF4`
changes. That is why the golden vectors and all four ports (Python/Rust/Java/WASM) stay at
227/227 without any change. This is a deliberate design choice: put the fix in the sessionisation
layer, not the feature layer, so no old number loses its reproducibility.

**Layer 2 - Two thresholds for two consequences.**

| Knob | Default | Meaning |
|---|---:|---|
| `session.idleGapSec` | 30 s | A pause that must not be measured across |
| `idle.awaySec` | 300 s | "The chair may be empty": the LOW streak resets, trust does not cross the absence |
| `idle.reverifyAfterSec` | 900 s | LOW raised to MEDIUM -> step-up runs once |

The 15-minute threshold is aligned with the PCI DSS 8.2.8 idle-timeout limit (there it is a
*maximum*, so using it as a verification trigger is conservative). It is deliberately separate
from `awaySec`: 5 minutes is enough to stop measuring across the gap, but not enough to justify
bothering the user with a popup.

**Layer 3 - ABSTAIN.** A window without evidence now issues an `UNKNOWN` verdict / `ABSTAIN`
action, **once** per idle run (not every window, so a tab left open overnight does not flood the
log). The system may say *"I don't know"* instead of guessing. This is the part that generalises
best - see §5.

**Bonus.** The live tail of the buffer is now returned to the buffer instead of being thrown away
every 30 seconds. A user browsing slowly eventually adds up to a session.

**Test status.**

| Test | Command | Result |
|---|---|---|
| Segmentation module + the §1.1 numbers | `node core/idle.test.mjs` | 33/33 pass |
| Full orchestrator path | `node core/idle.live.test.mjs` | 20/20 pass |
| Engine conformance (SPEC unchanged) | `python core/conformance.py` | 227/227 conformant |
| Same, JS engine | `node core/conformance.node.mjs` | 227/227 conformant |
| Step-up / gate / integrity regression | 3 existing suites | 23/23, 11/11, 10/10 |

---

## 3. Ablation on the research database - and one derived finding

`python tools/idle_ablation.py` re-extracts features from `raw_events` (482,203 events, 19
subjects with ≥14 sessions), injects **one** AFK pause of 2-20 minutes at a random point in each
test session, and judges four arms with **exactly the same model and thresholds**. The main
metric is the mean |z| against the owner baseline, grouped by how time can damage a feature:

| Arm | TIME features | COUNT features | SHAPE features |
|---|---:|---:|---:|
| CLEAN (whole session, no pause) | **1.12** | 0.95 | 2.60 |
| CONTROL: cut only, no pause | 1.25 | 2.00 | 3.11 |
| GAPPED, no segmentation (today) | **12.42** | 0.95 | 2.60 |
| GAPPED + segmentation (C-23) | **1.14** | 2.01 | 3.13 |

How to read it:

- **The damage the supervisor raised is measurable: TIME-feature |z| rises 1.12 -> 12.42
  (11×).** An owner session that was merely left alone for a while looks 12 standard deviations
  away from itself. That is not noise, that is a false identity.
- **Segmentation restores it almost perfectly: 12.42 -> 1.14**, in line with the clean arm.
- **The COUNT column shows a derived finding.** Segmentation raises it 0.95 -> 2.01 - but the
  CONTROL arm (clean sessions cut at the same point, without a pause) is also 2.00. So that rise
  is **not a cost of segmentation**, but the effect of "the session got shorter", which exists
  with or without idle. This control is what prevents a misreading.

**Derived finding - ALREADY SOLVED, see §3b.** Nine of the 28 features are **raw counts** -
`mouse_direction_changes`, `mouse_pause_count`, `form_focus_count`, `nav_page_count`,
`cart_action_count`, and so on - which grow with session length. As a result **every change in
session length is read as a change in identity**. This is a problem in its own right, older than
idle, and it affects every case in §4 that changes session length. The obvious fix is rate
normalisation (`count / active_duration`) - but that touches `core/SPEC.md`, so it needs a new SPEC
version + a regenerated golden file + syncing four ports, and every old number loses its
reproducibility. **It turns out there is a route that avoids all of that cost; see §3b.**

> **A limit that must be stated whenever these numbers are quoted.** The absolute FRR/FAR from
> `idle_ablation.py` are **not** the thesis headline numbers: the model is built from 10 baseline
> sessions without the held-out/prequential protocol of `reproduce_db.py`, so its operating point
> is much looser (FAR ~97%). Only the **differences between arms** are valid to read, because all
> four arms use identical models and thresholds. The pauses are also injected synthetically,
> assuming the user continues the same behaviour after returning; this isolates the effect of
> **time**, and is not a substitute for a field test.

---

## 3b. Solving it without touching SPEC (C-24)

The obvious fix for §3 is to turn the formulas into rates. The cost is heavy: SPEC v1.3, a
regenerated golden file, syncing four ports, and **every old number losing its reproducibility**.
There is a second route that avoids all of that.

**The problem is not the formula but the varying length.** So do not change the formula - **make
the length the same.** Each contiguous segment is cut into **canonical windows** of a fixed K
events. Counts automatically become comparable, without a single line of feature formula changing.

Under a canonical window, the features even change meaning for the better:

- counts -> **composition**: "out of K events, how many were clicks"
- `temporal_session_duration` -> **speed**: "how long it took to produce K events"

Both are more biometric than "how long the session happened to be". Hard requirement: used in
**enrollment AND scoring** - if only one of them, we just trade one train-vs-serve mismatch for
another.

**Results** (`tools/idle_ablation.py --canonical 120`, mean |z|):

| Arm | TIME features | COUNT features | SHAPE features |
|---|---:|---:|---:|
| Clean, whole session | 0.83 | 1.00 | 1.90 |
| Control: cut only | 0.84 | **1.01** | 1.90 |
| Gapped, no segmentation | 8.41 | 1.00 | 1.91 |
| Gapped + segmentation (C-23) | 0.84 | **1.00** | 1.89 |

Compare the COUNT column with the §3 table (0.95 vs **2.02**). Here all four arms line up at 1.00 -
**invariance fully restored**. And the TIME column proves the two fixes complement each other
rather than replace each other: canonicalisation alone does not cure idle (8.41), and segmentation
alone does not cure session length.

### Two follow-on consequences, and how they were solved

**(i) Short windows = less evidence per verdict.** The temptation is to loosen the threshold, but
that only moves the error to the FAR side. The right way: **collect the evidence of M windows and
judge their average** - trading **latency for confidence**, not FRR for FAR. Measured: AUC 0.770
(M=1) -> 0.789 -> 0.808 -> **0.829** (M=5), FAR 25.0% -> **9.4%**.

One trap worth noting in the thesis: the analytic shortcut "tighten the threshold by `std/√M`" is
**wrong, and wrong in one direction**. That formula assumes the windows are independent, while
consecutive windows from the same session are correlated - the real spread is wider, the threshold
ends up too tight, and it is the owner who gets rejected (tested: FRR stuck at 46.5%). The right way
is to **aggregate the training scores in exactly the same way** and calibrate on top of that, so the
correlation is carried along without having to be assumed.

**(ii) Thresholds calibrated in-sample.** After (i) was fixed the FRR was still high, and the root
was more basic: `_rebuildModel` calibrated the thresholds from the scores of **exactly the vectors
used to fit** the detector. In-sample scores are always optimistic - the model was fitted to those
very points - so the threshold is too tight and the owner's next session falls outside it. **This is
exactly the same mechanism as C-22**, one layer up. Setting aside 30% of the pool for calibration
only: **FRR 46.5% -> 27.8%, EER 32.9% -> 28.6%**.

### What ships, and what does not yet

All three are installed in the SDK as knobs, **all OFF by default**:

```js
BehaviorGuard.init({
  userId: 'andi@example.com',
  session: { canonicalWindow: 120 },   // 0 = off (default)
  aggregateWindows: 3,                 // 1 = off (default)
  calibrationHoldout: 0.3,             // 0 = off (default)
});
```

Off by default is not timidity but a condition of honesty: if the defaults change, every headline
number in `config.js` loses its reproducibility in a single commit.

**What must be stated honestly.** All three are proven in **direction**, not in **operating point**.
On the ablation harness the canonical EER (~28-33%) is still far from the 11.9% EER of the
whole-session protocol. Partly because the ablation harness is loose, partly because a 120-event
window really carries less evidence than a ~600-event session. **Before quoting these numbers in the
thesis, re-run them with the held-out protocol of `reproduce_db.py`.**

The real trade-off: canonicalisation trades **peak separating power** for **invariance**. The clean
arm without canonicalisation reaches AUC 0.810 - but as soon as its session length changes it drops
to 0.636. With canonicalisation it holds at 0.742-0.746 in **all** arms. And because in production
sessions really are 30-second windows, never whole research sessions, the invariant regime is the one
that matches deployment conditions.

---

## 4. Catalogue of similar cases

Idle is the first member of this class: **situations where what changes is the instrument, not the
person.** A behavioural biometric system infers identity from a signal that is really a mix of
`identity × device × context × physical condition`. Every case below shifts one of the factors other
than identity - and a naive system reads it as "someone else".

**Impact** column: `FRR up` = the real owner is bothered; `FAR up` = an intruder gets through.

### A. Presence and attention

| # | Case | Impact | Status |
|---|---|---|---|
| A1 | **Idle/AFK** - the page is opened and then left | FRR up | **Done (C-23)** |
| A2 | **Background tab / unfocused window** - the browser throttles timers to 1/minute and sends no `mousemove`; a 30-second window quietly becomes a window of several minutes | FRR up | Partly: `visibilitychange` is already watched; timer throttling is not yet compensated |
| A3 | **Rapid multitasking** - switching to WhatsApp/Excel in the middle of filling a form | FRR up | Done through segmentation (a pause < 5 min = idle, not away) |
| A4 | **Very short sessions** - open, click one thing, leave | FRR up | Done: ABSTAIN, not a guess |
| A5 | **Unattended session takeover** - the owner leaves, someone else sits down | **FAR up** | **Done (C-23 layer 2)** |

### B. Environment and device - *the instrument changes*

| # | Case | Impact | Proposal |
|---|---|---|---|
| B1 | **Changing input modality** - mouse <-> trackpad <-> touch screen <-> stylus. Speed, curvature and acceleration distributions are completely different | heavy FRR up | A **per-context** baseline (§5). A trackpad and a mouse are two instruments, not two people |
| B2 | **Changing resolution / external monitor / browser zoom** - speed in px/ms changes even when the hand moves the same | FRR up | Scale normalisation: divide distances by the viewport diagonal -> DPI-independent units |
| B3 | **Slow device / heavy page** - events get coalesced, producing fake pauses and speeds | FRR up | Detect coalescing; lower the weight of janky sessions or ABSTAIN |
| B4 | **Phone vs laptop** - the whole mouse feature block is zero on a touch screen | heavy FRR up | A special case of B1; needs a separate baseline |
| B5 | **Remote desktop / VDI / screen sharing** - all timing distorted by the network | FRR up **and** FAR up | Detect + ABSTAIN. Also an attack vector of its own: an attacker can deliberately go through RDP to blur their rhythm |
| B6 | **OS settings change** - pointer acceleration, `prefers-reduced-motion`, battery saver | FRR up | Part of the context key |

### C. Legitimate human variation

| # | Case | Impact | Proposal |
|---|---|---|---|
| C1 | **Physical condition** - injury, tiredness, illness, sleepiness, or one hand (holding a coffee, carrying a child) | FRR up | Cannot be removed. The answer is a friendly step-up, not a block |
| C2 | **Body position** - laptop on the lap, on a train, lying down | FRR up | Same |
| C3 | **Long-term drift** - the user gets better at using the application | FRR up | Already handled by the trust loop + progressive retraining |
| C4 | **Time zone / night shift / DST** - `temporal_time_of_day_score` deviates while the person is the same | FRR up | This feature is **context, not biometrics**. Proposal: take it out of the identity vector, use it as a separate risk signal |
| C5 | **Assistive technology** - screen readers, keyboard-only navigation, voice input, switch access | heavy FRR up | **An inclusion and ethics issue, not just accuracy.** A system that does not handle it systematically locks disabled users out of their own accounts. Must go into the limitations chapter |

### D. Input paths that are not typing

| # | Case | Impact | Proposal |
|---|---|---|---|
| D1 | **Password manager / browser autofill** - the form is filled with **zero** keystrokes; the whole `keystroke_*` block degenerates | FRR up **and** FAR up | Explicit detection. A session without keystrokes must not be confidently judged LOW - that is ABSTAIN, because the keystroke evidence really does not exist |
| D2 | **Copy-paste** - 30 characters arrive through 2 events | FRR up | Already handled in the MFA layer (C-1 rejects paste); not yet in the session scoring layer |
| D3 | **Extensions that change the DOM** - translate, adblock, third-party autofill | FRR up | Part of the context key |

### E. Legitimate multiple identities

| # | Case | Impact | Proposal |
|---|---|---|---|
| E1 | **Shared accounts** - family, shop, admin assistant | FRR up | A multi-modal (mixture) baseline, or accept it and lower sensitivity. Must be an explicit product decision, not an accident |
| E2 | **Shared computer / kiosk / internet café** | FRR up and FAR up | Shorten `reverifyAfterSec` for this context |
| E3 | **Legitimate delegation** - an admin helping a customer through the customer's account | FAR up (technically right to be suspicious) | Needs a "delegation" path on the application side |

### F. Population shift

| # | Case | Impact | Proposal |
|---|---|---|---|
| F1 | **Application redesigned** - navigation/form features shift for **every** user at once | mass FRR up | Watch the aggregate non-LOW rate; a sudden spike = population drift, not a wave of intruders. This is an important operational alarm |
| F2 | **A browser version changes event throttling** | mass FRR up | Same |

### G. Attacks on the mitigations themselves

This is the part most often missing from similar proposals, even though every mitigation above
creates a new attack surface.

| # | Case | Impact | Proposal |
|---|---|---|---|
| G1 | **Idle padding** - the attacker deliberately inserts pauses so events per window stay under 30 and the session is never judged | **FAR up** | This is why ABSTAIN has to be *visible*. Silently-not-judging is exactly what the attacker wants; ABSTAIN + an integrator policy ("high-value actions need a verdict, not merely the absence of one") closes it |
| G2 | **Imitating the owner's idle pattern** | FAR up | Residual risk; name it in the limitations chapter |
| G3 | **Weaponising D1** - the attacker uses autofill so the keystroke block is empty and there is nothing to compare | FAR up | Same as G1: absence of evidence ≠ evidence of innocence |
| G4 | **Fake context claims** - if per-context baselines are applied, the attacker claims a "new context" to get a loose baseline | FAR up | A new context is **never** automatically trusted: it must go through its own enrollment with step-up, not inherit the old context's trust |
| G5 | **Raw event replay** | FAR up | Already handled by `integrity.js` + rate limiting |

---

## 5. The proposed general mechanism

The twenty-plus cases in §4 do not need twenty patches. Almost all of them come down to the same
three questions, and those three questions can be made into **one gate in front of scoring**:

```
raw events
     |
     v
[ MEASUREMENT VALIDITY GATE ]  <-- proposed
     |
     +--> (a) is this really behaviour?          -> if not: cut it (C-23 layer 1)
     +--> (b) is there enough evidence?          -> if not: ABSTAIN (C-23 layer 3)
     +--> (c) is the instrument still the same?  -> if not: another context's baseline
     |
     v
score -> LOW / MEDIUM / HIGH
```

**The main conceptual change: add a 4th output, ABSTAIN.** Today's system has to choose
LOW/MEDIUM/HIGH for every session - including sessions whose data is not fit to judge. A biometric
system that is allowed to say *"not enough evidence"* is more honest **and** safer than one that
guesses, because a guess on empty evidence is always biased toward accepting. This already works
for the idle case; the proposal is to generalise it to D1 (no keystrokes), B3 (janky sessions), B5
(remote detected) and A4 (sessions too short).

**Context key (`contextKey`).** Baselines are split by
`input_modality × viewport_bucket × device_class`. The reason is not only accuracy: one baseline
**cannot** represent two different instruments - a trackpad and a mouse produce different speed
distributions from the same person. Merging both into one baseline widens its spread, and a wider
baseline means **intruders get in more easily**. So separating contexts improves FRR *and* FAR at
the same time. Mandatory condition (G4): a new context goes through its own enrollment with step-up,
never inheriting the old context's trust.

**Scale normalisation.** Speed is expressed in px/ms today. Dividing it by the viewport diagonal
makes it DPI-independent and closes B2 almost for free. This touches SPEC, so it goes into Stage 2
together with the rate normalisation from §3.

---

## 6. Proposed new metrics for the thesis

FRR/FAR alone cannot capture the problems this document discusses - a system can have 0% FRR
precisely because it judges far fewer sessions than people think. Proposal: report two extra numbers
side by side.

1. **Coverage** - what percentage of session time was actually verified, not ABSTAIN. This is what
   G1 attacks, and without this metric the attack is invisible. FRR/FAR must be reported
   **conditional on coverage**; a 5% FRR at 30% coverage is much weaker than a 12% FRR at 90%
   coverage, even though the first number looks better.
2. **Time-to-detect** - for the takeover scenario (A5), how many seconds of intruder behaviour are
   needed before a non-LOW verdict comes out. This is the right metric for *continuous*
   authentication, while FAR is the metric for *single-gate* authentication.

These two metrics are what lift the idle discussion from "a bug fix" to a methodological
contribution.

---

## 7. Staged plan

| Stage | Content | Touches SPEC? | Status |
|---|---|---|---|
| **1** | Idle segmentation, two absence thresholds, ABSTAIN | No | **Done, tested** |
| **2** | Session-length invariance: canonical window + evidence aggregation + out-of-sample calibration (§3b) | **No** - an alternative route that avoids SPEC v1.3 | **Done, tested, off by default** |
| **2b** | DPI-independent speed scale normalisation (B2) | Can live in the capture layer, without SPEC | Proposed |
| **3** | Context key + per-context baselines (B1/B4/B6) with separate enrollment | No (lifecycle layer) | Proposed |
| **4** | Generalised ABSTAIN (D1, B3, B5) + coverage & time-to-detect metrics | No | Proposed |

**For the thesis limitations chapter**, what must be stated as it is:

- The 30 / 300 / 900 second thresholds are **reasoned engineering choices, not yet tuned against
  field data**. All three are exposed as knobs in `init({session, idle})`.
- Segmentation removes pauses from the measurement, but **cannot tell *left alone* from *reading
  without touching anything*** - both are equally silent at the DOM layer. That is exactly why the
  answer is ABSTAIN + re-verification, not a guess.
- The §3 ablation uses synthetic pauses, assuming the user's behaviour does not change after
  returning. That isolates the effect of time cleanly, but is not a substitute for a field test.
- Cases C5 (assistive technology) and E1 (shared accounts) are **not yet handled**, and both concern
  real users, not just numbers.

---

## 8. Summary for supervision

1. The note is right, and once traced its consequences point **two ways**: idle raises FRR through
   damaged features, *and* raises FAR through a session takeover window.
2. The damage is measurable: the |z| of time-based features rises **1.12 -> 12.42** from a single
   AFK pause. Segmentation brings it back to **1.14**.
3. The fix **does not touch `core/SPEC.md`** - the golden file and all four ports stay at 227/227.
   Only what is fed to the feature extractor changes.
4. The security side is handled separately with its own threshold: an absence ≥15 minutes triggers
   re-verification even if the behaviour afterwards looks normal.
5. The ablation surfaced a **derived finding**: 9 of the 28 features are raw counts that grow with
   session length, so every change in session length is read as a change in identity. That problem
   is older than idle and became the Stage 2 proposal.
6. That finding **has been solved too**, without touching SPEC (§3b): the problem is not the formula
   but the varying length, so the length is made the same (**canonical window**). COUNT-feature |z|
   2.02 -> **1.01**, exactly the same as whole sessions. Its two consequences were closed as well:
   aggregating the evidence of M windows (AUC 0.770 -> 0.829) and out-of-sample threshold
   calibration (FRR 46.5% -> 27.8%, whose root turned out to be C-22 again). All of it is **off by
   default** - the direction is proven, the operating point is not yet tuned.
7. Idle turned out to be the first member of a class: **when what changes is the instrument, not the
   person** (§4, 20+ cases). The proposal is one mechanism for all of them - a measurement validity
   gate with a 4th output, **ABSTAIN**, because a biometric system allowed to say "I don't know" is
   more honest and safer than one that guesses.

---

### Related files

| File | Content |
|---|---|
| `sdk/core/idle.js` | Segmentation, active-time accounting, pause classification |
| `sdk/core/config.js` | Knobs `session.idleGapSec`, `idle.*` |
| `sdk/behaviorguard.js` | Presence tracker, back-from-absence policy, ABSTAIN |
| `core/idle.test.mjs` / `.html` | 33 module tests + the §1.1 numbers |
| `core/idle.live.test.mjs` | 20 full orchestrator path tests |
| `core/invariance.test.mjs` / `.html` | 26 C-24 tests; the first locks "the defaults change nothing" |
| `tools/idle_ablation.py` | The §3 ablation on the research database |
| `core/DRIFT.md` § C-23, C-24 | Defect records in this repo's audit format |
