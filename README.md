<p align="center">
  <img src="assets/banner.svg" alt="BehaviorGuard - continuous behavioral-biometrics account-takeover detection" width="100%">
</p>

# BehaviorGuard

**Detect account takeover from how someone moves, types and navigates - and act on it
where it counts, on your own server. One script tag in the page, a few lines in your
backend, a built-in step-up challenge.**

[![conformance](https://github.com/maysanblank/behaviorguard-sdk/actions/workflows/conformance.yml/badge.svg)](https://github.com/maysanblank/behaviorguard-sdk/actions/workflows/conformance.yml)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](#no-dependencies-anywhere)

> Versi bahasa Indonesia: [README.id.md](README.id.md)

## Demo

Owner vs attacker, same account, same password:

<p align="center">
  <img src="assets/detection.gif" alt="The owner passes the typing-rhythm check and the transfer goes through; a second person on the same account fails it and the session is ended" width="100%">
</p>

Installing it on a plain store with its own backend, then logging in from a second browser
with the stolen password:

<p align="center">
  <img src="assets/demo.gif" alt="BehaviorGuard installed on a plain checkout store: one line in the backend, one in the page; the server refuses the payment until the user verifies, and a second login with the stolen password is judged against the owner's profile and ended" width="100%">
</p>

---

## The problem

Authentication is a **door check**, not a **guard**. Almost every control fires once, at
login: password, OTP, device fingerprint. Everything after that is trusted.

That is exactly the window attackers use. Credential stuffing, session-cookie theft,
malicious browser extensions, remote-access scams and physical device handoff all produce
the same thing - a session that **passed the door check** and is now driven by someone
else. The login was legitimate. The session is not.

The usual answer is a commercial risk engine: a vendor's servers receive your users'
interaction data and send back a score you cannot inspect. For a small team, a research
project, or a privacy-sensitive product, that is a heavy and often unacceptable price.

**BehaviorGuard makes the session itself continuously accountable, on infrastructure you
own.** It builds a model of how *this account's owner* behaves - mouse dynamics, keystroke
rhythm, navigation shape - and re-scores the live session every 30 seconds. When the
behavior stops looking like the owner, it asks for a step-up: its own typing-rhythm
challenge, or your OTP / WebAuthn. Your backend gets the last word on every sensitive
action.

The page sends **34 summary numbers per 30-second window** to your server. Raw events never
leave the page, and the characters a user types are never sent or stored anywhere.

---

## Where it runs

```
 browser (your page)                         your server (Flask blueprint, or server/app.py)
 ---------------------------------           ---------------------------------------------------
 capture: pointer, keys, scroll, nav         the account's profile and model (any device)
 34 features per 30-s window       ------>   score, verdict LOW / MEDIUM / HIGH, run rule
 bot / integrity check (raw events)          typing-rhythm template and its check
 step-up dialog (Shadow DOM)       <------   verifications: rhythm, or YOUR OTP reported
                                             guard.check() before money moves  <- your routes
```

- **The profile belongs to the account, not the browser.** An attacker who logs in with a
  stolen password from their own laptop meets the owner's profile on the first window, not
  an empty one.
- **The decision that moves money is made on your server.** `guard.check()` in your route
  says allowed or "verify first". A script in the page cannot talk its way past it, and
  cannot vouch for its own verification: only your backend reports that (it holds the
  secret key).
- **Fail closed.** No fresh assessment, backend unreachable, not enough evidence: the answer
  is "verify", never "safe".

What the browser still does, and why: it computes the 34 numbers (so raw behavior stays in
the page) and runs the bot/integrity heuristics, which need the raw event stream.

A **local mode** also exists - the same engine entirely in the browser, the profile in
IndexedDB, no server. It is what the research harness and the conformance suite drive, and
it is handy for trying the library on a static page. It cannot protect against an attacker
on another device (the profile is not there), so it is not the recommended deployment.

---

## Quickstart (Flask, about 15 lines)

The server side ships in `server/` (`guard.py`, `engine.py`, `rhythm.py`, plus `core/bg_core.py`;
a flat copy is in `dist/server/`). Standard library plus Flask, nothing else.

```python
from guard import Guard, create_blueprint

guard = Guard('behaviorguard.db', tenant=(BG_PK, BG_SK))          # keys from your environment
app.register_blueprint(create_blueprint(guard), url_prefix='/bg')  # the browser's API

@app.get('/api/bg-token')                      # after login: a token for THIS user and THIS login
def bg_token():
    return {'token': guard.mint_token(current_user.id, session['login_id'], ttl=900)}

@app.post('/api/transfer')
def transfer():
    c = guard.check(current_user.id, session['login_id'], money=True)
    if not c['allowed']:
        return {'verify': True, 'reason': c['reason']}, 403      # the page steps up, then retries
    ...                                                          # move the money

# your own OTP, checked by you, reported to the guard:
guard.report_verified(None, current_user.id, session['login_id'], passed=True)
```

The page:

```html
<script src="/dist/behaviorguard.min.js" data-endpoint="/bg" data-token-url="/api/bg-token" defer></script>
<script>
  // before a sensitive action: a fresh assessment, kept on the server for guard.check()
  async function beforeTransfer() {
    const v = await BehaviorGuard.assessNow();     // UNKNOWN means "not enough evidence": fail closed
    if (v.level === 'LOW') return true;
    return (await BehaviorGuard.stepUp({ reason: 'send this transfer' })).verified;
  }
</script>
```

That is the whole integration. Capture, enrollment, scoring, retraining and the step-up
prompt all start on their own; the user id comes from the signed token, never from the page.

**Not on Flask?** Run `server/app.py` as a service and sign the token in your own backend
(HMAC-SHA256, four lines in Node, PHP or Laravel): [docs/INTEGRATION.md](docs/INTEGRATION.md).

**The built-in step-up needs no code at all.** On a `MEDIUM` or `HIGH` verdict the library
raises its own dialog and asks the user to retype a short phrase; the per-character dwell
and flight timing are matched **on the server** against the owner's template. The dialog
lives in a Shadow DOM (site CSS cannot break it, strict CSP is fine), is accessible, and
works with touch-screen keyboards.

**Already have OTP or WebAuthn?** It is the dialog's "use another method" path, used
automatically when the user has no rhythm template yet or has failed too often. Your server
checks the code and calls `guard.report_verified(...)`; the library then picks it up:

```js
window.BehaviorGuardConfig = { mfa: { onFallback: async () => await myOtpDialog() } };
```

`BehaviorGuard.status()` gives you what to show in your own UI (learning vs protecting,
enrollment progress, last verdict), `stop()` is logout, `forget()` erases the account's
profile (after a fresh verification).

For production, serve `dist/behaviorguard.min.js` (155 KB, **47 KB gzip**). It is the same
bundle with whole-line comments and indentation removed, and `node tools/min_check.mjs`
proves it returns the identical verdict sequence.

More: [docs/QUICKSTART.md](docs/QUICKSTART.md) covers every integration path, the config
object and framework notes.

---

## What you actually see

```
sessions 1-10    enrollment       no verdicts yet - the model is learning the owner
session 11+      LOW              ALLOW_SESSION
                 MEDIUM           REQUIRE_MFA       -> step-up prompt
                 HIGH             REQUIRE_STEPUP    -> step-up prompt
                 HIGH twice       BLOCK_SESSION     -> run rule: sustained, not a bad day
                 UNKNOWN          ABSTAIN           -> not enough evidence yet (never "safe")
```

A verdict needs 150 events of evidence; the window still ticks every 30 seconds and
collects evidence until it has enough. After the owner passes a step-up, `MEDIUM` verdicts
do not ask again for 15 minutes (`HIGH` always does, and walking away for 5 minutes
cancels it).

Every verdict carries its reasoning - the top deviating features with their z-scores - so
`HIGH` is never a black box:

```js
{ level: 'HIGH', score: -4.21, action: 'REQUIRE_STEPUP',
  reasons: ['keystroke_dwell_time_mean z=-3.90', 'mouse_velocity_std z=3.12'],
  modelLevel: 'HIGH', modelScore: -4.21, stickyFloor: false, consecutiveHigh: 1 }
```

---

## Results

Measured on **653 sessions from 16 human subjects** by driving the **shipped library
itself** (`node research/eval_sdk.mjs --live`): every session is replayed through the real
capture-to-verdict path in 30-second windows, exactly as `setInterval` runs in a browser.
The harness drives the library in local mode; the server engine (`server/engine.py`) is
checked against it decision by decision (`python server/test_parity.py`: the same level,
action, score, thresholds and model on every window, including enrollment, retraining,
blocking, step-up, replay and the away rule), so these numbers are the backend's numbers.
Sessions are replayed **in the order they were recorded**, one visit each (page load, state
read back from storage), so enrollment is each owner's first ten visits. Owners answer
step-ups through the public `reportStepUp` API. Impostors are the other 15 subjects, each
arriving through a fresh visit on the owner's account.

| Owner | |
| --- | --- |
| Verdicts that asked the owner to verify | **11.4%** |
| ... in the last fifth of each owner's history | 7.2% |
| Owner blocked | **0%** |

| Impostor (stolen password, own device) | at their own hour | at the owner's usual hour |
| --- | ---: | ---: |
| Passed the first verdict with no friction | **10.5%** | 14.3% |
| Got through the **whole** session with no friction | **7.9%** | 10.8% |
| Never assessed (session too short to collect evidence) | 0.6% | 0.6% |

| Takeover (impostor keeps using the account, 6 sessions) | |
| --- | --- |
| Caught in the first session | **95.0%** |
| Caught within 3 sessions | 99.6% |
| Never caught in 6 sessions | **0.4%** (1 of 240 pairs) |

Threshold-free separation, per owner: AUC **0.953**, EER **10.1%**.

The right-hand impostor column is the smarter attacker who logs in at the same time of day
as the owner (`--same-hour`). Each volunteer recorded in a characteristic block of hours, so
the time-of-day feature catches part of the left column for free; the right column removes
that help.

### Choosing an operating point

One knob, `init({ calibration: { k_low } })`. Smaller is stricter.

| `k_low` | owner asked to verify | impostor passes 1st verdict | impostor passes whole session | takeover never caught |
| --- | ---: | ---: | ---: | ---: |
| 1.25 | 17.0% | 6.5% | 4.8% | 0.4% |
| 1.5 | 14.8% | 8.6% | 6.5% | 0.4% |
| **1.75 (default)** | **11.4%** | **10.5%** | **7.9%** | **0.4%** |
| 2.0 | 10.0% | 12.3% | 9.4% | 0.4% |
| 2.5 | 7.7% | 16.6% | 12.9% | 0.4% |

The default was chosen on 8 subjects and checked on the other 8 (C-33). On those 8 held-out
subjects alone, the default gives 12.7% owner friction and 9.2% impostor first-verdict passes.

**Strict mode (opt-in):** `session: { contextEvents: 450 }` lets later verdicts in a visit
reuse the evidence just assessed.

| strict mode | owner asked to verify | impostor passes 1st verdict | whole session | takeover never caught |
| --- | ---: | ---: | ---: | ---: |
| `contextEvents: 450` | 12.5% | 7.0% | 6.3% | 0% |
| `contextEvents: 450`, `k_low: 2.0` | 11.0% | 8.7% | 7.9% | 0% |

The second row beats the default on every column here, but on the AFK variant of the data
(users who walk away mid-session) impostors pass the whole session 6.5% instead of 5.6%, so
it is not the default. See [core/DRIFT.md](core/DRIFT.md) C-42 and C-44.

### Read these numbers honestly

- **About 1 in 10 impostors passes the first check** (1 in 7 if they log in at the owner's
  usual hour). This is a step-up layer, not a lock.
  Treat `HIGH` as "make them prove it", never as proof of fraud, and gate sensitive actions
  with `assessNow()`.
- **The impostors are 15 other ordinary users, not attackers imitating a specific
  victim.** Targeted mimicry is **untested** and is the most important open threat - see
  [THREAT-MODEL.md](THREAT-MODEL.md).
- **Owner friction is not random noise.** It is flat across windows within a visit: an
  owner is flagged on the *days* their behavior differs, in every window of that day. It
  cannot be averaged away; it is what the step-up is for. That is why passing a step-up
  now buys 15 quiet minutes. It also falls as the model learns from those step-ups: 10.0%
  in the first fifth of an owner's history, 16.2% in the middle, 7.2% in the last.
- **16 subjects is a small sample.** Expect several points of movement on a different
  population and a different site.
- **Two promising ideas were measured and rejected.** Honest negative results, both in
  [core/DRIFT.md](core/DRIFT.md):
  - *Behavioral step-up with no enrolled phrase* - scoring free typing from a single field
    (~20 keys) against the owner's statistics. EER 29-38%; at an operating point that rejects
    7% of owners, two of three impostors still pass. Typing rhythm only separates people when
    the *same text at the same positions* is compared, or when the evidence is a full window.
    So the phrase template stays, and the fix was to enroll it *earlier* (at onboarding).
  - *Outlier-robust mouse features* (median/IQR/rates replacing mean/counts, the C-44 idea
    moved to the pointer). Won on the tuning fold (AUC 0.963 vs 0.955) and **lost on the
    report fold** (0.949 vs 0.952). The only effect consistent across both folds was a
    stricter operating point - which `calibration: { k_low }` already gives for free, without
    changing a formula, breaking stored profiles, or touching four ports. An improvement that
    does not replicate on the split it was not chosen on is not an improvement.
- **Earlier numbers in this repository described other engines.** FRR 16.1% / FAR 5.4% came
  from a Python harness scoring whole research sessions (~700 events), a unit the library
  never scores; FRR 35.1% / FAR 0.9% came from scikit-learn's One-Class SVM, which does not
  ship. The table above is the first measurement of the library users actually get
  ([core/DRIFT.md](core/DRIFT.md) C-27, C-29).

### Data and reproducibility

- **The data.** 16 volunteers, 653 sessions, recorded in task-based scenarios (browse, search,
  fill in forms, check out). Those sessions are dense, with few long pauses; real use is not,
  which is why idle handling exists ([research/notes/CONTEXT-AND-IDLE-PROPOSAL.md](research/notes/CONTEXT-AND-IDLE-PROPOSAL.md)).
- **Not published.** Every volunteer agreed to their interaction data being used for this
  research. It is behavioral biometric data of real people, so it stays out of this
  repository: `research/export_sessions.py` writes to the OS temp directory, never to the repo.
- **Run the same measurement on your own data.** `research/eval_sdk.mjs` reads one JSON file,
  `{"subjects": {"<id>": [[event, ...], ...]}}`, sessions in recording order, events in the
  capture format of [core/SPEC.md](core/SPEC.md) section 8 (what
  `BehaviorGuard._instance.capture.peek()` returns). At least 11 sessions per subject (10 to
  enroll) and two or more subjects:

  ```bash
  node research/eval_sdk.mjs --data my_sessions.json --live
  node research/eval_sdk.mjs --data my_sessions.json --live --same-hour
  ```

---

## One brain, five runtimes

Behavioral scoring is only useful if it runs where your stack already is. So the algorithm
is specified **independently of any runtime**, and every implementation is checked against
the *same* numeric contract - not asserted to match, **proven** to match.

| Runtime | Reach | Conformance |
| --- | --- | --- |
| JavaScript | browser, Node, edge | 319/319 |
| Python | servers, data and ML | 319/319 |
| Rust | systems, CLI, embedded | 319/319 |
| Java | JVM, **Android**, Kotlin | 319/319 |
| WASM | any WASM host | 319/319 |

- [`core/SPEC.md`](core/SPEC.md) - the normative specification (v1.4.0). *If the code and
  the spec disagree, the spec is right and the code is the bug.*
- [`core/golden.json`](core/golden.json) - 319 explicit input/output checks, tolerance 1e-9,
  including real mouse-move pairs that sit exactly on a `pi/4` turn, where `atan2` differs by
  one ulp between math libraries (C-34).

The server engine sits on the Python core (`core/bg_core.py`, 319/319), and its decision
layer is checked against the JavaScript library window by window (`server/test_parity.py`).
CI runs all five runtimes on every push, plus the regression suites for the step-up layer,
the detector gate, the integrity heuristics, the server API and the parity check.

### No dependencies, anywhere

No `npm install`, no model download, no third-party service. Every port uses only its
standard library - including a hand-written JSON reader in the compiled ones. The entire
browser build is one ~267 KB classic script (155 KB minified). The server engine is pure
Python; Flask is only the HTTP layer, and you can mount the same `Guard` behind anything.

---

## Try the demo

```bash
pip install flask
python demo/arunika/server.py        # http://127.0.0.1:8300   (--lan to reach it from a second laptop)
```

**Arunika, a realistic bank with BehaviorGuard on its backend** ([demo/arunika](demo/arunika/)).
Accounts, balances and history live on its own Flask server; BehaviorGuard's API is mounted
inside it, transfers, payments and the password change ask `guard.check()` first, and its
one-time code (delivered to a simulated phone) is reported with `guard.report_verified()`.

It **starts at account opening**, on purpose: you watch a profile being built from zero for
an account the system knows nothing about - a live `0/10` progress ring, an evidence counter,
what is measured and what never leaves the page, and the step that matters, enrolling the
typing rhythm. Then open the same account from a **second laptop** (or a second browser
profile) with its password: it is judged against the owner's profile from its first window,
a stranger's behavior is `HIGH`, and the server ends that login. A presenter panel shows the
live phase, evidence, verdict gauge and plain-language reasons, and can simulate a
lunch-break return, a replay of your own recorded behavior, and a bot.

**Install it on a plain store (the GIF above):** [demo/shop-checkout](demo/shop-checkout/) - a
Flask shop with its own backend and no MFA. One commented line in the backend, one in the
page; the README there walks through it.

```bash
python demo/shop-checkout/shop.py    # http://127.0.0.1:5000
```

**Local mode, no server:** `python -m http.server 8080`, then
<http://localhost:8080/research/legacy-demos/monitor/> (a shop page with zero BehaviorGuard code,
scored from the outside) and the three plug-and-play shops in
[research/legacy-demos/](research/legacy-demos/README.md).

```bash
python core/conformance.py           # engine vs golden.json              -> 319/319
node   core/lifecycle.test.mjs       # long-run lifecycle & APIs          -> 49/49
node   core/stepup.test.mjs          # step-up, fallback, lockout         -> 61/61
node   core/c46.test.mjs             # script-made input rejected         -> 25/25
node   core/privacy.test.mjs         # no typed characters stored         -> 14/14
python server/test_app.py            # server API: tokens, gate, IDOR     -> 61/61
python server/test_parity.py         # server engine == JS library        -> 67 windows
python server/test_rhythm.py         # server rhythm check == JS          -> 40 cases
python server/test_backend_sdk.py    # the library over HTTP vs a server  -> 21/21
python demo/arunika/test_server.py   # the demo bank's backend            -> 38/38
```

`research/legacy-demos/attack_sim.html` runs four attack vectors - paste replay, speed bot, minimal mouse
path, and rhythm mimicry - against a seeded owner model.

---

## How it works

```
DOM events -> drop duplicates -> compress idle gaps -> 150 events of evidence
          -> 34 features -> z-score vs owner -> IF 0.30 + Mahalanobis 0.70
          -> per-owner thresholds (mean - k*std) -> LOW / MEDIUM / HIGH + reasons
          -> replay check, sticky floor, run rule, away/re-verify, step-up grace
          -> step-up (typing rhythm, or your OTP via guard.report_verified)
          -> guard.check() in your route before the sensitive action
```

The first two lines run in the page; everything from the z-score on runs on your server.

- **Enrollment** - the first 10 eligible sessions build the owner baseline. They are an
  anchor: they never roll out of the training pool.
- **Trust loop** - only windows that scored `LOW`, or that passed a genuine step-up, are
  ever allowed to teach the model. That is what stops a slow takeover from gradually
  becoming the new normal.
- **Idle** - gaps of 15 s or more are shortened, not cut, so a coffee break is not read as
  a different person. A 5-minute absence resets trust; 15 minutes asks for re-verification
  (the lunch-break attack).
- **Replay** - a session that is a near-exact copy of a stored one (recorded and replayed)
  is `HIGH` and never trains.

Full detail: [ARCHITECTURE.md](ARCHITECTURE.md) and [core/SPEC.md](core/SPEC.md).

---

## Prior art, and what is different here

Behavioral biometrics is not a new field. Most open-source work in it is a **research
classifier**: keystroke-only, notebook-shaped, trained offline, and not something you can
drop into a site.

| Project | What it is | How BehaviorGuard differs |
| --- | --- | --- |
| [njanakiev/keystroke-biometrics](https://github.com/njanakiev/keystroke-biometrics) | Keras keystroke-rhythm impostor classifier | Research notebook, keystroke-only, offline training |
| [belyabl9/Dynamics](https://github.com/belyabl9/Dynamics) | Keystroke dynamics as an auth factor | Keystroke-only, no drop-in browser runtime |
| [JUSTRUST-swu/continuous-authentication-behavioral-biometrics](https://github.com/JUSTRUST-swu/continuous-authentication-behavioral-biometrics) | Keystroke and mouse continuous authentication, evaluated on the KMT dataset | Offline Python evaluation, not an embeddable runtime |
| CyberSignature | ML behavioral-biometrics identity core | Server-side Python, not an embeddable library |
| [TypingDNA](https://www.typingdna.com/) | Typing biometrics; a JS recorder collects patterns in the browser | Matching runs behind a commercial API; keystroke-only |
| BioCatch | Behavioral biometrics for banks | Commercial, closed, server-side |
| BehavioSec / ForgeRock | Enterprise continuous authentication | Commercial, closed, server-side; data leaves the device |

The combination below is what we have not found elsewhere:

1. **Self-hosted, small and inspectable.** The detectors are light enough to train per
   account inside your own backend on every window - no GPU, no model-serving step, no
   vendor receiving your users' behavior. The same engine also runs entirely in the browser.
2. **Fusion, not keystrokes alone.** 34 features across mouse dynamics, keystroke timing,
   temporal rhythm, navigation and form interaction.
3. **A drop-in library, not a notebook.** One tag, zero dependencies.
4. **The response is included.** Most detectors emit a score and stop; BehaviorGuard ships
   the step-up, the run rule, the re-verify-after-absence rule and the integrator APIs.
5. **Cross-language conformance as a first-class artifact.** A spec plus a golden file means
   a port is *proven* equivalent, not hoped to be.
6. **It measures itself.** `research/eval_sdk.mjs` replays research data through the shipped
   code, and [`core/DRIFT.md`](core/DRIFT.md) records every place where an earlier number
   turned out to describe something else.

---

## Security posture

In backend mode the verdict, the typing-rhythm match and the permission for a sensitive
action are decided on your server, and a verification only counts when your server reports
it with the secret key. What remains on the client is the measurement: an attacker who fully
controls the browser can send forged feature vectors. Those cannot skip the gate - they have
to look like the owner to the model, window after window - and that is the open problem
(targeted mimicry) in [THREAT-MODEL.md](THREAT-MODEL.md). Treat the step-up as risk-based
friction in front of your own factors, not as a cryptographic factor itself.

We audited our own defenses adversarially and fixed more than forty logic flaws, each with
its failure mode, its evidence and a regression test in [`core/DRIFT.md`](core/DRIFT.md)
(C-1 to C-49). A few that defeated the product entirely:

- **Script-generated events counted as behavior.** The capture layer never checked
  `isTrusted`, so anything running JavaScript in the page could `dispatchEvent` a humanlike
  stream until the verdict came back `LOW` - and since eligible `LOW` windows train the
  model, the forged vectors joined the owner's baseline. Not a bypassed check: the owner's
  profile dragged toward the attacker, permanently. Untrusted events are now never recorded,
  are counted, and mark the window ineligible for training (C-46).
- **A complete step-up bypass.** Pasting the phrase produced zero keystroke events, and
  `NaN > x` silently returns false in JavaScript - so an empty rhythm passed every check.
- **The main detector was never active.** The convergence rule froze the model before the
  Mahalanobis detector (70% of the weight) was switched on; an impostor scoring -1811 on it
  was still returned as `LOW`.
- **Passwords were stored in plain text.** The capture layer kept the characters users
  typed and banked them to localStorage. Keys are now per-page tokens; the one feature that
  needs them is bit-identical (C-30).
- **The measurement harness silently ignored its own knobs.** After C-45 reset config inside
  `init()`, `eval_sdk.mjs` set `--k-low`, `--cfg` and `--compress` *before* `init()`, so every
  sweep re-ran the default. The symptom was results identical to the last decimal, which reads
  as "the knob does nothing" rather than as a bug. Fixed, and every non-default number it
  produced was re-measured (C-46).
- **The public key opened everything.** On the server, the `pk` embedded in every page could
  read and overwrite any account's behavior template. Per-user HMAC tokens now gate every
  account call, and the operator dashboard escapes all client-supplied fields under a nonce
  CSP (C-39, C-41).
- **The profile lived in the attacker's browser too.** In the original design the profile was
  stored only in the browser that built it, so an attacker logging in from their own laptop
  met an empty profile - and the library started learning *them* as the owner. The profile,
  verdicts, rhythm template and verifications now live on the server, per account (C-49).

Known limitations, trust boundaries and open attacks: [THREAT-MODEL.md](THREAT-MODEL.md).

---

## Privacy

Raw events never leave the page, and typed characters are never sent or stored anywhere.
The page sends, per 30-second window, the 34 feature numbers, how many events and seconds
they came from, and the bot-check result. Your server keeps per account: those vectors (the
training pool), the verdicts, and the typing-rhythm template (key hold and gap times for one
phrase, not the letters). There is no telemetry and no third party: the server is yours.

`forget()` erases an account's profile and template (after a fresh verification, so an
attacker in the session cannot wipe the owner and be learned instead); your backend can
call `guard.forget(..., require_verified=False)` when an account is deleted.

---

## Project layout

```
dist/         WHAT YOU COPY: behaviorguard.js (+ .min.js) for the page, dist/server/ for
              your backend, INSTALL.md
sdk/          the browser library source (entry + 18 core modules)  <- single source of truth
server/       the backend source: guard.py (API, tokens, gate), engine.py (decisions),
              rhythm.py, app.py (standalone service + operator dashboard), tests
demo/         Arunika (a bank with a backend) and shop-checkout (the install demo)
docs/         documentation set - start at docs/README.md
core/         SPEC.md, golden.json, conformance runners, DRIFT.md (audit log), tests
ports/        Rust, Java and WASM implementations of the engine
tools/        build and check scripts (bundler, extension sync, parity and min checks)
research/     the scripts and notes behind the published numbers, and the earlier local-mode demos
extension/    experimental Chrome extension: the same engine on any site (a synced copy of sdk/)
assets/       banner and GIFs used in this README
```

---

## Documentation

| Document | What is in it |
| --- | --- |
| [docs/README.md](docs/README.md) | Documentation index - the map to everything below |
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | Every integration path, the config surface, framework notes |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Pipeline, module map, lifecycle, design decisions |
| [core/SPEC.md](core/SPEC.md) | Normative engine specification |
| [THREAT-MODEL.md](THREAT-MODEL.md) | Trust boundaries, known bypasses, what this is not |
| [docs/INTEGRATION.md](docs/INTEGRATION.md) | Your backend in Flask, Node, PHP or Laravel: token, gate, OTP report |
| [core/DRIFT.md](core/DRIFT.md) | The C-1..C-49 audit: every defect, its evidence and its test |
| [server/README.md](server/README.md) | The server: keys, user tokens, endpoints, gate, dashboard |
| [ports/README.md](ports/README.md) | Porting guide and conformance status |
| [BACKLOG.md](BACKLOG.md) | Roadmap - what is planned and explicitly out of scope |

---

## License

MIT - see [LICENSE](LICENSE).

Built as thesis research and released because the problem is common and the honest version
of the answer is worth sharing. Issues and ports are welcome.
