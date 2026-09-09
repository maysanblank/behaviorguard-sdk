# BehaviorGuard

**Detect account takeover from how someone moves, types and navigates — entirely on the
device, with a built-in step-up challenge. One script tag. No backend required.**

[![conformance](https://img.shields.io/badge/conformance-227%2F227%20across%205%20runtimes-brightgreen)](core/golden.json)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)](#no-dependencies-anywhere)

> Versi bahasa Indonesia: [README.id.md](README.id.md)

---

## The problem

Authentication is a **door check**, not a **guard**. Almost every control fires once, at
login: password, OTP, device fingerprint. Everything after that is trusted.

That is exactly the window attackers use. Credential stuffing, session-cookie theft,
malicious browser extensions, remote-access scams and physical device handoff all produce
the same thing — a session that **passed the door check** and is now driven by someone
else. The login was legitimate. The session is not.

The usual answer is a server-side risk engine: it sees IP, user agent and coarse behavior,
it requires a backend, and it ships your users' interaction data off-device. For a small
team, a research project, or a privacy-sensitive product, that is a heavy and often
unacceptable price.

**BehaviorGuard makes the session itself continuously accountable.** It builds a model of
how *this account's owner* behaves — mouse dynamics, keystroke rhythm, navigation shape —
and re-scores the live session every 30 seconds. When the behavior stops looking like the
owner, it raises a step-up challenge that verifies identity by **typing rhythm**, not by a
code the attacker may already control.

Raw interaction data never leaves the browser.

---

## 30-second quickstart

One tag. No build step, no bundler, no account, no API key.

```html
<script src="dist/behaviorguard.js" data-user="andi@example.com" defer></script>
<script>
  addEventListener('behaviorguard:risk', e => {
    // e.detail = { level, score, action, reasons, topFeatures, ... }
    if (e.detail.level === 'HIGH') lockCheckout();
  });
</script>
```

That is the whole integration. Capture (pointer, keystroke, scroll, focus, navigation),
scoring, enrollment, retraining and the step-up prompt all start on their own.

**The built-in step-up needs no code at all.** On a `MEDIUM` or `HIGH` verdict the library
raises its own challenge and asks the user to retype their security phrase; identity is
proven from per-character dwell and flight timing. Disable it with
`window.BehaviorGuardConfig = { mfa: { enabled: false } }`.

Prefer explicit control? [docs/QUICKSTART.md](docs/QUICKSTART.md) covers the ES-module
form, the config object, the browser-extension deployment and framework notes.

---

## What you actually see

```
sessions 1-10    enrollment       no verdicts yet - the model is learning the owner
session 11+      LOW              ALLOW_SESSION
                 MEDIUM           REQUIRE_MFA       -> step-up prompt
                 HIGH             REQUIRE_STEPUP    -> step-up prompt
                 HIGH twice       BLOCK_SESSION     -> run rule: sustained, not a bad day
```

Every verdict carries its reasoning — the top deviating features with their z-scores — so
`HIGH` is never a black box:

```js
{ level: 'HIGH', score: -4.21, action: 'REQUIRE_STEPUP',
  reasons: ['keystroke_dwell_time_mean z=-3.90', 'mouse_velocity_std z=3.12'],
  modelLevel: 'HIGH', modelScore: -4.21, stickyFloor: false, consecutiveHigh: 1 }
```

---

## Results

Held-out evaluation on **653 sessions from 16 human subjects**. Subjects are split 8/8 with
seed 42: hyperparameters are tuned on the first 8 and **reported on the 8 the model never
saw**. Impostors are simulated by scoring every other subject's sessions against each
owner's model.

**Shipped configuration** — Mahalanobis (shrinkage 0.3), weights IF 0.30 / Mahalanobis
0.70, parametric thresholds (`k_low` 3.3, `k_med_extra` 2.0):

| Metric | Value |
| --- | --- |
| FRR (owner asked to re-verify) | **16.1%** |
| FAR (impostor scored as normal) | **5.4%** |
| ROC AUC | 0.942 |
| EER | 11.9% |
| FAR at FRR 15% | 7.7% |

Reproduce exactly: `python tools/experiment.py --calib parametric`, row `maha s.3 3/7`.

**What replacing the detector bought.** The previous shipped engine collapsed the baseline
pool to a single average point, discarding the shape of the distribution:

| Engine | FRR | FAR | AUC | EER |
| --- | --- | --- | --- | --- |
| centroid-RBF (previous) | 17.7% | **36.2%** | 0.860 | 21.0% |
| Mahalanobis (current) | 16.1% | **5.4%** | 0.942 | 11.9% |

A 6.7x reduction in false accepts at a comparable false-reject rate, because covariance
turns the decision boundary from a sphere into an ellipse — so an impostor sitting near the
owner's mean is still caught.

**The step-up layer changes the cost of being wrong.** A single `HIGH` triggers
verification rather than a block; only consecutive `HIGH` verdicts block. Owners have bad
days and produce isolated outliers; a real takeover produces sustained ones.

### Read these numbers honestly

- **FAR 5.4% means roughly 1 in 18 impostor sessions still scores as normal.** This is a
  step-up layer, not a lock. Treat `HIGH` as "make them prove it", never as proof of fraud.
- **The impostors here are 15 other ordinary users, not attackers imitating a specific
  victim.** Targeted mimicry is **untested** and is the most important open threat — see
  [THREAT-MODEL.md](THREAT-MODEL.md).
- **16 subjects is a small sample.** Expect several points of movement on a different
  population. What we consider robust is the *ordering* of the design choices, not the
  third decimal place.
- **The research pipeline and the shipped library are not yet numerically identical.**
  `tools/reproduce_db.py` uses scikit-learn's `OneClassSVM` and reports FRR 35.1% /
  FAR 0.9% — a *different engine*, and not the one that ships, because it cannot train in a
  browser. Two safety clamps also still differ between them, currently moving **8 of 16**
  probe verdicts. This is measured and reproducible (`python core/drift_check.py`) and
  documented in [core/DRIFT.md](core/DRIFT.md). **Any number you quote must name its
  engine.** The table above is the shipped one.

---

## One brain, five runtimes

Behavioral scoring is only useful if it runs where your stack already is. So the algorithm
is specified **independently of any runtime**, and every implementation is checked against
the *same* numeric contract — not asserted to match, **proven** to match.

| Runtime | Reach | Conformance |
| --- | --- | --- |
| JavaScript | browser, Node, edge, extensions | 227/227 |
| Python | servers, data and ML | 227/227 |
| Rust | systems, CLI, embedded | 227/227 |
| Java | JVM, **Android**, Kotlin | 227/227 |
| WASM | any WASM host | 227/227 |

- [`core/SPEC.md`](core/SPEC.md) — the normative specification. *If the code and the spec
  disagree, the spec is right and the code is the bug.*
- [`core/golden.json`](core/golden.json) — 227 explicit input/output checks, tolerance 1e-9.

CI runs all five on every push, plus a regression suite for the step-up layer and a check
that `sdk/` and `extension/` have not diverged.

### No dependencies, anywhere

No `npm install`, no `pip install`, no model download, no network call. Every port uses
only its standard library — including a hand-written JSON reader in the compiled ones. The
entire browser build is one 87 KB classic script.

---

## Try the demo

No Node required.

```bash
python -m http.server 8080
```

Then open <http://localhost:8080/demo/pemantau/>.

The left pane is an ordinary shop page with **zero BehaviorGuard code inside it** — check
the Network tab, it loads no SDK. The right pane attaches from the outside and shows live
scores, the session log and the top deviating features. Move the mouse, type, click through
products for 10-12 sessions to enroll, then let someone else drive and watch the verdict
move.

```bash
python core/conformance.py      # engine vs golden.json   -> 227/227
node   core/challenge.test.mjs  # step-up regression      -> 20/20
node   core/ensemble.test.mjs   # detector-gate regression -> 11/11
python core/drift_check.py      # honest engine-gap report
```

`demo/attack_sim.html` runs four attack vectors — paste replay, speed bot, minimal mouse
path, and rhythm mimicry — against a seeded owner model. All four should come back `HIGH`,
and the mimicry one should be caught by the **ensemble**, not by the bot heuristics.

---

## How it works

```
DOM events -> 28 features -> z-score vs owner -> IF 0.30 + Mahalanobis 0.70
                                                          |
                                    parametric thresholds (mean - k*std)
                                                          |
                                      LOW / MEDIUM / HIGH + reasons
                                                          |
                                     step-up challenge (typing rhythm)
```

- **Enrollment** — the first 10 sessions build the owner baseline; no verdicts are emitted.
- **Retraining** — every 6 sessions, but **only sessions that scored `LOW`, or that passed a
  genuine step-up verification, are ever allowed to teach the model.** That is what stops a
  slow takeover from gradually becoming the new normal.
- **Prequential** — session *N* is always judged by a model that has not seen session *N*.
- **Convergence** — training stops on a two-sided rule: a window of consecutive `LOW`
  sessions **and** a cohort guard, so the model neither over- nor under-fits.

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
| CyberSignature | ML behavioral-biometrics identity core | Server-side Python, not an embeddable library |
| BehavioSec / ForgeRock | Enterprise continuous authentication | Commercial, closed, server-side; data leaves the device |

The combination below is what we have not found elsewhere:

1. **It trains in the browser.** Every detector is browser-trainable, so there is no server
   ML and no model-serving step. This is a real design constraint, not a convenience — it is
   why Mahalanobis was chosen over an SVM that needs libsvm to fit.
2. **Fusion, not keystrokes alone.** 28 features across mouse dynamics, keystroke timing,
   temporal rhythm, navigation and form interaction.
3. **A drop-in library, not a notebook.** One tag, one line, zero dependencies.
4. **The step-up challenge is included.** Most detectors emit a score and stop; the hard
   part is what you do at `MEDIUM`. BehaviorGuard ships the response, not just the signal.
5. **Cross-language conformance as a first-class artifact.** A spec plus a golden file means
   a port is *proven* equivalent, not hoped to be.
6. **A published, honest gap report.** [`core/DRIFT.md`](core/DRIFT.md) documents where our
   own numbers do not yet line up. We would rather ship that than quietly round it away.

---

## Security posture

The step-up layer is **client-side re-authentication for convenience and friction**, not a
cryptographic second factor. An attacker who fully controls the browser can bypass any
client-only check. For a real security boundary, verify the rhythm server-side as well, or
combine it with an out-of-band factor.

We audited our own defenses adversarially and found and fixed **eighteen** logic flaws.
Two are worth naming, because both defeated the product entirely and neither was visible
from reading the code:

- **A complete step-up bypass.** Pasting the phrase produced zero keystroke events, and
  `NaN > x` silently returns false in JavaScript — so an empty rhythm recorded no
  violations and passed every check.
- **The main detector was never active.** The ensemble gate needs 20 pooled sessions, but
  the convergence rule froze the model at 10. For any user whose early sessions were
  consistent, the Mahalanobis detector — 70% of the ensemble weight — stayed switched off
  permanently, and an impostor session scoring -1811 on that detector was still returned
  as `LOW`.
- **Ordinary humans were blocked as bots.** The capture layer never populated `velocity`,
  while the bot heuristic read it — so every value was 0, its standard deviation was 0, and
  any session that was mostly mouse movement was reported as "constant velocity". The same
  gap pinned one of the 28 features at a constant, so the model was trained on a live
  feature and deployed against a dead one. Found only by driving a real page; every earlier
  audit had fed synthetic events straight past the capture layer.

Each fix is documented with its failure mode, its empirical evidence, and a regression
test, in [`core/DRIFT.md`](core/DRIFT.md) sections C-1 to C-24.

Known limitations, trust boundaries and open attacks: [THREAT-MODEL.md](THREAT-MODEL.md).

---

## Privacy

Raw events never leave the device. Features are computed locally and the baseline is stored
locally (IndexedDB, falling back to localStorage, then memory). There is no telemetry and
no default network destination.

The optional hybrid mode syncs a **28-float feature vector per session** to a server you
run, so an account baseline can follow a user across devices. Raw events are still never
transmitted. It is off unless you supply both a key and an endpoint.

---

## Project layout

```
sdk/          the library (entry + 18 core modules)    <- single source of truth
dist/         one-file bundle for a plain <script> tag
loader/       one-line drop-in loader
extension/    MV3 extension for third-party sites      <- synced from sdk/, verified in CI
core/         SPEC.md, golden.json, conformance runners, DRIFT.md, tests
ports/        Rust, Java and WASM implementations
demo/         offline two-pane demo (clean site + external monitor)
tools/        reproduction, experiments, bundler, sync
server/       optional hybrid-mode backend and dashboard
```

---

## Documentation

| Document | What is in it |
| --- | --- |
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | Every integration path, the config surface, framework notes |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Pipeline, module map, lifecycle, design decisions |
| [core/SPEC.md](core/SPEC.md) | Normative engine specification |
| [THREAT-MODEL.md](THREAT-MODEL.md) | Trust boundaries, known bypasses, what this is not |
| [core/DRIFT.md](core/DRIFT.md) | Measured engine gaps and the C-1..C-24 security audit |
| [docs/USULAN-KONTEKS-DAN-IDLE.md](docs/USULAN-KONTEKS-DAN-IDLE.md) | Idle handling (C-23), session-length invariance (C-24), the measurement-validity gate, and 20+ cases where the *instrument* changes rather than the person |
| [ports/README.md](ports/README.md) | Porting guide and conformance status |

---

## License

MIT — see [LICENSE](LICENSE).

Built as thesis research and released because the problem is common and the honest version
of the answer is worth sharing. Issues and ports are welcome.
