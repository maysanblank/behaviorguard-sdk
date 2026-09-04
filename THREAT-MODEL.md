# Threat model

This document states plainly what BehaviorGuard defends against, what it does not, where
the trust boundaries sit, and which attacks we know still work. It is written to be useful
to someone deciding whether to deploy this — which means it is deliberately unflattering.

If you only read one section, read [What this is not](#what-this-is-not).

---

## 1. What it defends

BehaviorGuard addresses **post-authentication session compromise**: the attacker holds a
session that already passed the login check.

| Scenario | How the session was obtained | Covered? |
| --- | --- | --- |
| Credential stuffing / reused password | Attacker logs in as the user | Yes |
| Session-cookie or token theft | Session replayed from another machine | Yes |
| Remote-access scam ("support" takes over) | Victim hands over live control | Yes |
| Unattended, unlocked device | Physical access to a live session | Yes |
| Malicious extension driving the page | Script-driven interaction | Partly (see §4.3) |
| Automated bots and replay | Synthetic event timing | Partly (see §4.3) |
| Credential phishing before login | — | No, this is a login-time control |
| Server-side compromise | — | No |
| Network interception | — | No, use TLS |

The core assumption is simple and worth stating because everything rests on it:
**the legitimate owner's interaction dynamics are stable enough over time, and distinct
enough between people, to be discriminative.** Our data supports this for ordinary users
(AUC 0.942 over 16 subjects), but see §5 on how far that evidence stretches.

---

## 2. Trust boundaries

```
┌─ the user's browser ────────────────────────────────────┐
│                                                          │
│  DOM events ─▶ features ─▶ model ─▶ verdict ─▶ step-up   │   ← ALL of this is
│                    │                                     │     attacker-reachable
│                    ▼                                     │     if the browser is
│  local storage (baseline, rhythm template)               │     compromised
│                                                          │
└──────────────────────────┬───────────────────────────────┘
                           │  optional hybrid mode:
                           │  28-float feature vectors only
                           ▼
                  ┌─ your server ─────────┐
                  │ account baseline      │   ← you operate this;
                  │ verdict log           │     we make no claims about it
                  └───────────────────────┘
```

**Everything inside the browser is inside the attacker's reach** when the attacker controls
the browser. The library computes, stores and enforces on the same machine the adversary is
using. This is inherent to a client-side design, not a bug we intend to fix.

What that buys, and what it costs:

- **Buys:** raw behavioral data never transmitted; no backend to run; works offline; no
  vendor sees your users.
- **Costs:** no client-side check is authoritative. Verdicts are *advice to your
  application*, and your application decides what they are worth.

**The correct deployment** treats BehaviorGuard as a signal source and enforces
consequences where the attacker cannot reach — server-side. A verdict that only gates
client-side UI can be bypassed by anyone willing to open devtools.

---

## 3. Data handling

| Data | Where it lives | Leaves the device? |
| --- | --- | --- |
| Raw events (coordinates, key timings) | Memory, drained every 30 s | **Never** |
| 28-float feature vector | IndexedDB / localStorage | Only in hybrid mode |
| Rhythm template (dwell/flight medians + MAD) | IndexedDB / localStorage | **Never** |
| Verdicts and reasons | Passed to your callback | Only if you send them |
| Device fingerprint (hash) | IndexedDB / localStorage | Only in hybrid mode |

Stored values are sealed with an HMAC to detect tampering. **This is integrity, not
confidentiality** — the payload is base64, not encrypted, and the key is derived locally.
Anyone with access to the browser profile can read the baseline and the rhythm template.
Treat local storage as readable by the user and by anything running in the origin.

The rhythm template is **biometric-derived data**. Depending on your jurisdiction (GDPR
Art. 9, BIPA, and similar), storing it may carry legal obligations even though it never
leaves the device. That is your call to make, and worth making deliberately.

---

## 4. Known attacks

### 4.1 Targeted mimicry — OPEN, and the most important gap

An attacker who can observe the victim's typing and mouse behavior, then deliberately
imitate its rhythm, is **not covered by our evaluation and may well succeed**.

Our FAR of 5.4% is measured against *other ordinary users behaving naturally*, not against
adversaries optimizing to defeat the model. These are different threat classes and the
second is strictly harder. We have not tested it, we do not claim resistance to it, and we
would expect a determined, well-informed mimic to have meaningfully better odds than 5.4%.

An attacker who can additionally read local storage can retrieve the rhythm template
directly — dwell and flight medians per position — and synthesize a passing sample without
guessing. Nothing in a client-side design prevents this.

**Mitigation if this is in your threat model:** repeat the rhythm check server-side, and
combine with an out-of-band factor.

### 4.2 Client-side bypass — OPEN by design

An attacker controlling the page can call the library's internals directly, overwrite the
stored baseline, suppress the callback, or simply not load the script. `window.BehaviorGuard`
exposes `_instance` for the demo and loader, which makes this trivial rather than merely
possible.

This is not defensible client-side. Enforce server-side.

### 4.3 Synthetic input and replay — PARTLY covered

`core/integrity.js` rejects sessions with tell-tale machine signatures: near-constant
inter-event intervals (std < 3 ms), identical key hold times (std < 1.5 ms), constant
mouse velocity, event rates above 80/s, non-monotonic or duplicated timestamps.

This catches naive automation. It does **not** catch an attacker who injects humanlike
jitter, and a synthetic profile tuned against these specific thresholds will pass. The
checks are heuristics, not a bot-detection product.

### 4.4 The main detector could be permanently inactive — FIXED

The ensemble gate silences the Mahalanobis detector below 20 pooled training sessions,
because a covariance estimated from fewer samples is ill-conditioned. The gate decision was
frozen into the model at build time, and the convergence rule stopped rebuilding once the
owner produced six consecutive `LOW` sessions — which routinely happened at 10 sessions,
before the gate could ever open.

The result: for any user with consistent early behavior, the detector carrying **70% of the
ensemble weight was never switched on**, for the lifetime of that account. Measured on a
seeded model, an impostor session scoring -1811 on the Mahalanobis detector was still
returned as `LOW`, because only the Isolation Forest contributed.

Crossing a gate threshold is a change of model *structure*, not adaptation to new data, so
it now forces a rebuild regardless of convergence. See `core/DRIFT.md` §C-15.

Published held-out figures are unaffected — the evaluation harness builds models through
its own path — but the shipped library was affected, which is exactly the class of gap
`core/DRIFT.md` exists to track.

### 4.5 Baseline poisoning — MITIGATED

The obvious attack on any adaptive system is to drift the baseline toward the attacker,
one session at a time.

Only sessions that scored `LOW`, **or** that passed a genuine step-up verification, are
ever admitted to the training pool. Sessions that failed a gate, tripped integrity, or
scored `MEDIUM`/`HIGH` without verification never teach the model.

This was not always true. An earlier version let an attacker on a fresh device *enroll their
own rhythm template* during a `HIGH` verdict — the enrollment prompt appeared precisely
because no template existed — and the resulting "pass" reset the risk state and admitted the
attacker's session into the training pool. That is a complete takeover chain that ran
*through* the defense. Enrollment now happens only in trusted `LOW` sessions, and only a real
verification (not an enrollment) can prove identity. See `core/DRIFT.md` §C-2, §C-3.

### 4.6 Step-up bypass — FIXED, and worth reading as a cautionary tale

Verification compared the submitted rhythm against the stored template by iterating over
the *template's* length and reading the sample by index. A shorter sample yielded
`undefined`, arithmetic produced `NaN`, and **`NaN > threshold` is false in JavaScript** —
so no violations were recorded and an empty rhythm passed.

Pasting the phrase produced exactly that: correct text, zero keystroke events, verification
passed. `Ctrl+V` was equally effective, because `'v'` passed the single-character key filter
while `'Control'` did not.

Now: `paste`, `drop` and `cut` are blocked on the input; modified keypresses are ignored;
every character in the field must be accounted for by a captured keystroke; the sample's
shape and finiteness must match the template exactly before any comparison happens; and the
miss budget is proportional to phrase length rather than a fixed two. Locked by 20
regression tests in `core/challenge.test.mjs`, enforced in CI. See `core/DRIFT.md` §C-1.

### 4.7 Cross-device baseline poisoning via hybrid mode — OPEN if you enable it

In hybrid mode the client authenticates to your server with a **publishable key embedded in
client-side JavaScript**. Anyone who reads your page source can obtain it and `POST`
arbitrary feature vectors to `/baseline` for any user id, poisoning that account's baseline
across all its devices.

The client also adopts the server's baseline whenever the server holds at least as many
vectors as the local device.

**If you enable hybrid mode, your server must authenticate the user independently** — a
session cookie or bearer token tied to the real account — and must never treat the
publishable key as authorization. The bundled `server/` is a reference implementation for
the demo, not a hardened service.

### 4.8 Denial of service against the owner — LOW severity, real

An attacker who can produce two consecutive `HIGH` verdicts triggers `BLOCK_SESSION`. Since
anyone with brief physical access to an unlocked session can behave unlike the owner on
purpose, this can lock a user out. The run rule (block only on *consecutive* `HIGH`) and the
step-up path exist to keep false blocks rare — held-out owner block rate is a few percent —
but a deliberate attempt will succeed. Provide a recovery path that does not depend on
BehaviorGuard.

---

## 5. Limits of the evidence

- **16 subjects, 653 sessions.** Small. Reported on 8 held-out subjects, which is honest
  protocol, but 8 subjects is a narrow basis for a population claim.
- **One capture environment.** All data came from a similar task context. Behavior across
  devices (laptop trackpad vs. mouse), input methods, and accessibility tools is untested.
  Touch-only devices produce almost no mouse features; expect degradation.
- **Impostors are substitutes, not adversaries.** See §4.1.
- **Hyperparameters were selected on this dataset.** We use a held-out split for the
  headline number, so it is not circular, but absolute values will move on new data. We
  trust the *ordering* of design decisions more than the decimals.
- **The shipped engine and the research engine still differ.** Two clamps diverge, moving
  8 of 16 probe verdicts. Tracked in `core/DRIFT.md`. Numbers must be quoted with the engine
  that produced them.

---

## What this is not

- **Not a second authentication factor.** It is a risk signal that can trigger one.
- **Not a bot-detection product.** The integrity checks are heuristics.
- **Not fraud proof.** A `HIGH` verdict means "this does not look like the owner" — which is
  also what a new keyboard, an injury, a shared account or a bad night look like.
- **Not a login control.** It needs sessions to learn from; the first 10 produce no verdicts.
- **Not resistant to a compromised browser.** Nothing client-side is.
- **Not a replacement for server-side authorization.** Ever.

---

## Reporting a vulnerability

Open a GitHub issue for anything already public. For an unreported bypass, please contact
the maintainer directly first so a fix can ship before the details do.

We would genuinely rather receive a working mimicry attack than not know about it. If you
break it, we will document it here with credit.
