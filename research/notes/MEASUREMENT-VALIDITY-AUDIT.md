# Audit: cases where "the instrument changed, not the person"

Idle time (C-23) and session length (C-24) turned out not to be one-off cases. This document is
the result of **tracing the code**, not guessing from theory - every finding comes with
file:line and, where possible, numbers from actually running the code.

The difference from `CONTEXT-AND-IDLE-PROPOSAL.md` §4: that one catalogues cases that *could*
happen to any behavioural biometric system. This one only lists what **really exists in this
code** and can be pointed to by line.

**Impact** column: `FRR up` the real owner is bothered · `FAR up` an intruder gets through ·
`BLOCK` a legitimate user is hard-blocked.

**Status as of 10 Sep 2026: 8 of 12 patched (C-25), tested by `core/audit.test.mjs` 32/32.**
The other four are deliberately left: A2+B3 are one scale normalisation package that makes old
baselines incomparable (needs baseline versioning), B5 and B6 touch the vector/SPEC. All four
are proposed, not shipped quietly.

| # | Finding | Impact | Evidence | Status |
|---|---|---|---|---|
| A1 | "Just browsing" sessions blocked as bots | **BLOCK** | executed | **DONE** (C-25) |
| A2 | Changing monitor / zoom changes speed | FRR up | executed | Proposed - scale package |
| A3 | Autofill kills 8 keystroke features at once | FRR up FAR up | executed | **DONE** (C-25) |
| A4 | Behaviour tails leak between users | **FAR up** | code reading | **DONE** (C-25) |
| A5 | `PAGE_STEP` trained on but never captured | FRR up | code reading | **DONE** - `markStep()` API |
| B1 | Two tabs overwrite each other's data | FRR up | code reading | **DONE** (C-25) |
| B2 | Screen resolution part of the device fingerprint | FRR up | code reading | **DONE** (C-25) |
| B3 | `scroll_delta` in raw pixels | FRR up | code reading | Proposed - scale package |
| B4 | Touch screens kill the whole mouse block | FRR up | code reading | **DONE** (C-25) |
| B5 | Time of day treated as a biometric | FRR up | code reading | Proposed - touches the vector |
| B6 | Constant features in the baseline become large z | FRR up | code reading | Proposed - touches SPEC |
| B7 | Without IndexedDB, the pool is cut at 30 | FRR up | code reading | **DONE** (C-25) |

---

## A. Proven by running the code

### A1 · "Just browsing" sessions blocked as bots - **BLOCK**

`sdk/core/integrity.js:9`

```js
const evs = filtered.length>=10 ? filtered : events;
```

T5 used to filter to `KEYSTROKE`/`MOUSE_CLICK` so the 50 ms throttle would not be mistaken for a
bot. But **its fallback returns all events** when keystrokes+clicks < 10 - and in such a session
those are almost all `MOUSE_MOVE`, which `capture.js:60-63` throttles at exactly 50 ms. The
intervals become **exactly constant**.

Run on a realistic throttled `mousemove` stream:

| Real mousemove rate | Interval after throttle | Verdict |
|---|---|---|
| 60 Hz | 50.0 ms, std **0.00 ms** | `constant interval` -> **blocked** |
| 100 Hz | 50.0 ms, std **0.00 ms** | **blocked** |
| 125 Hz | 56.0 ms, std **0.00 ms** | **blocked** |
| 144 Hz | 55.6 ms, std 0.50 ms | **blocked** |

The result on the integrity path in `behaviorguard.js`: `action:'BLOCK_SESSION'`,
`eligible:false`, and the session is recorded HIGH. A user reading a long article while moving the
mouse - without much clicking - **is blocked as a bot.**

This is a relative of C-16 brought back to life by its own fallback. It is fragile: one stray click
at the end of a session can lift the std above 3 ms and let it through, so the symptom looks
"intermittent" and is hard to trace from user reports.

**Proposal:** never judge interval regularity on a stream we throttle ourselves. If `filtered` <
10, **do not fall back to `events`** - just skip that interval check (other checks still run), or
compute intervals only from events that are not throttled.

### A2 · Changing monitor or zoom changes "hand speed" - FRR up

`sdk/core/capture.js:40` - `v = Math.hypot(dx,dy)/dt`, with `dx,dy` in CSS pixels.

**Identical** hand movement, only the screen differs:

| Feature | 1080p | 4K (2×) | Factor |
|---|---:|---:|---:|
| `mouse_velocity_mean` | 0.6685 | 1.3371 | **2.00×** |
| `mouse_velocity_max` | 1.2224 | 2.4448 | **2.00×** |
| `mouse_acceleration_std` | 0.0033 | 0.0066 | **2.00×** |
| `mouse_curvature_mean` | 0.0141 | 0.0070 | **0.50×** |

Four features shift by exactly the scale ratio. Not noise - **a linear function of screen size**.
Browser zoom and moving to an external monitor have the same effect.

**Proposal:** divide distances by the viewport diagonal in `capture.js` so they become
DPI-independent. This can be done in the capture layer **without touching SPEC** - `x`/`y` become
viewport-relative. But old baselines become incomparable, so it needs re-enrollment or versioning.

### A3 · Autofill kills 8 keystroke features at once - FRR up **and** FAR up

`sdk/core/capture.js:65-74` installs no `paste` listener, and password managers fill fields
**without any keyboard events at all**.

The same form, typed vs autofilled:

| Feature | Typed | Autofill |
|---|---:|---:|
| `keystroke_dwell_time_mean` | 80.000 | **0** |
| `keystroke_flight_time_mean` | 120.000 | **0** |
| `keystroke_typing_speed` | 4.808 | **0** |
| `keystroke_transition_entropy` | 1.097 | **0** |
| `keystroke_burst_count` | 1.000 | **0** |
| `cross_mouse_keyboard_coordination` | 0.028 | **0** |

**8 of 8 keystroke features drop to zero.** Two sides of the danger:

- **FRR:** an owner who uses a password manager looks deviant at every login.
- **FAR:** an intruder can **weaponise** this - use autofill, and the whole block of keystroke
  evidence disappears. Absence of evidence is not evidence of innocence, but the model cannot tell
  "zero because nobody typed" from "zero because that is how this person types".

**Proposal:** capture `paste` and detect filling without keystrokes, then **ABSTAIN on the
keystroke block** instead of giving it zeros. This is exactly a generalisation of the C-23
ABSTAIN.

### A4 · Behaviour tails leak between users - **FAR up**

`sdk/behaviorguard.js:67,94,98,177,180` - the `bg:pending` key is **global**, not namespaced per
user (compare `ns(userId)` = `bg:${id}`, used for sessions).

The flow: user A closes the page -> their tail is saved to `bg:pending` -> **user B logs in on the
same browser** -> `init()` reads `bg:pending` without checking its owner ->
`scoreExternalEvents(chunk)` -> **A's behaviour is judged, and possibly trained, as B.** On a
shared computer, an internet café, or simply a logout-login, this poisons the baseline.

`clear()` does remove it, but only if the integrator calls it.

**Proposal:** namespace it - `bg:pending:${userId}` - and drop pending data whose owner does not
match. A small fix with a security impact.

### A5 · `PAGE_STEP` trained on but never captured - FRR up

`sdk/core/features.js:28`

```js
const navEv = events.filter(e=> is(e,'NAVIGATION')||is(e,'PAGE_STEP'));
```

The research database contains **2,672 `PAGE_STEP` events**; `capture.js` **never emits one**
(compare the listener list in `capture.js:65-74`). So `nav_step_transition_count` and
`nav_page_transition_pattern` are computed from different event populations in training and in
use.

Other event types present in the research DB but never captured by the SDK: `COPY`, `PASTE`,
`WISHLIST`, `CHALLENGE_INPUT`, `MFA_ACTION`. The last four are not part of F4, so they have no
impact; `PAGE_STEP` is.

This is exactly the same defect class as C-17 (a feature dead in production because its data never
exists). **Proposal:** emit `PAGE_STEP` in capture, or remove it from `navEv` and admit that one
nav feature is not really used.

---

## B. Proven by reading the code (not yet executed)

### B1 · Two tabs overwrite each other - FRR up

Each tab runs its own instance with its own `sessions` array in memory, then
`storage.set(ns(userId), {sessions...})` - **the last writer wins**. Sessions collected by the
other tab are lost. `bg:pending` is worse: two tabs append to the same array, so events from two
different pages **merge into one "session"**.

**Proposal:** a cross-tab lock (`BroadcastChannel` or a `localStorage` lock), or elect one tab as
leader.

### B2 · Screen resolution is part of the device fingerprint - FRR up

`sdk/core/fingerprint.js:8` puts `screen.width+'x'+screen.height` into the fingerprint. Plug in an
external monitor -> the fingerprint changes -> `behaviorguard.js:60-62` forces
`lastRisk='MEDIUM'`, and the sticky floor holds it until three consecutive LOW sessions.

Plugging in a monitor is not changing devices. **Proposal:** take resolution out of the
fingerprint (it is already handled by B3/A2 as context), or treat a resolution change as "new
context", not "suspicious device".

### B3 · `scroll_delta` in raw pixels - FRR up

`sdk/core/capture.js:48` stores `Math.abs(cur-lastScrollY)` in pixels; `features.js:121` reads it
into `nav_scroll_depth_mean`. The value depends on viewport height and page length, not on the
person's scrolling habit. A taller screen -> one scroll moves more pixels.

**Proposal:** normalise to viewport height. This touches the meaning of a field in SPEC, so it goes
into the same package as A2.

### B4 · Touch screens kill the whole mouse block - FRR up

`capture.js:65-74` only installs `mousemove`/`click`/`scroll`/`keydown`/`keyup`. On a touch screen
`mousemove` practically never appears, so **nine mouse features become zero** - exactly the A3
pattern, but for the other block.

**Proposal:** this is the strongest candidate for a **per-context baseline** (see
`CONTEXT-AND-IDLE-PROPOSAL.md` §5): touch and mouse are two instruments, not two people.

### B5 · Time of day treated as a biometric - FRR up

`temporal_time_of_day_score` is 1 of the 28 identity features. It is not a property of the body -
it is **context**. Night shifts, overtime, or travel across time zones shift it without identity
changing at all.

**Proposal:** take it out of the identity vector and use it as a separate risk signal. Conveniently
`reproduce_db.py` already has an `F4_MINUS_TEMP` arm - so testing it costs almost nothing, it only
needs comparing.

### B6 · Constant features in the baseline become large z - FRR up

`sdk/core/standardize.js:14`

```js
const std = variance.map(v => Math.sqrt(v) < 1e-9 ? 1 : Math.sqrt(v));
```

If a feature is **constant** during enrollment - e.g. `cart_action_count` is always 0 because the
user has never used the cart - its standard deviation is forced to 1. The first time they add 3
items: `z = 3`. The system reads "3 standard deviations" when all that happened is **the user did
something new**.

This punishes exploring the application's features, and hits new users most often.

**Proposal:** mark features that are constant in the baseline and lower their weight, or use a
wide prior for features never seen to vary.

### B7 · Without IndexedDB, the pool is cut at 30 - FRR up

`sdk/storage.js:109` truncates to `sessions.slice(-30)` before writing to localStorage. IndexedDB
accepts the whole thing, so it is usually fine - but in private mode or in browsers that block IDB,
the pool is **cut at 30** while `progressiveMaxPool` = 90.

C-22 already showed what happens when the pool is too small relative to d=28: an unstable
covariance, adaptive shrinkage holding back, weaker detection. On this path the symptom appears
**only for some users**, so it is easy to mistake for a difference between people.

**Proposal:** store a compact form (vectors only, without `feat`) so more sessions fit, and report
the active storage mode through `getState()`.

---

## Suggested order of work

If a choice has to be made, this order seems the most sensible:

1. **A1** - the only one that **blocks legitimate users**. Its fix is the smallest.
2. **A4** - the only one that leaks **between users**; a security issue, not an accuracy one.
3. **A3** - two directions at once (FRR and FAR), and also a second application of ABSTAIN, which
   strengthens the general argument in §5 of the proposal.
4. **A5** - small, and closes one more train-vs-serve mismatch (a relative of C-17).
5. **B5** - testing it costs almost nothing because the `F4_MINUS_TEMP` arm already exists.
6. **A2 + B3** - one scale normalisation package; bigger because old baselines become
   incomparable.
7. **B4** - the biggest; best merged into the per-context baseline work.

Items 1-4 are all small fixes that do not touch SPEC and do not change a single headline number.
Items 6-7 change the meaning of stored data, so they need baseline versioning.

**Not yet done:** the group B findings have not been proven by running code, only by reading it.
Before any of them goes into the thesis as a claim, it should get a probe like A1-A3 first.
