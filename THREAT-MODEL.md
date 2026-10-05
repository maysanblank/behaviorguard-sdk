# Threat model

This document states plainly what BehaviorGuard defends against, what it does not, where
the trust boundaries sit, and which attacks we know still work. It is written to be useful
to someone deciding whether to deploy this - which means it is deliberately unflattering.

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
| Automated bots | Synthetic event timing | Partly (see §4.3) |
| Recorded-and-replayed behavior | Victim's own events captured and replayed | Yes, exact and near-exact replays (see §4.3) |
| Credential phishing before login | - | No, this is a login-time control |
| Server-side compromise | - | No |
| Network interception | - | No, use TLS |

The core assumption is simple and worth stating because everything rests on it:
**the legitimate owner's interaction dynamics are stable enough over time, and distinct
enough between people, to be discriminative.** Our data supports this for ordinary users
(per-owner AUC 0.953 over 16 subjects, measured on the shipped library in 30-second
windows), but see §5 on how far that evidence stretches.

---

## 2. Trust boundaries

```
+- the user's browser -----------------------------------+
|                                                        |
|  DOM events --> features --> integrity check            |   <- attacker-reachable
|                    |             |                      |      if the browser is
|  step-up dialog (shows, collects key timings)           |      compromised
|                                                        |
+--------------------+-----------------------------------+
                     |  34 numbers + counts per window, rhythm timings,
                     |  a user token signed by YOUR backend (not forgeable here)
                     v
+- your server (backend mode) --------------------------------------------+
|  account profile, model, verdicts, run rule, floor, rhythm template      |
|  verifications: rhythm checked here, or YOUR factor reported with the sk |
|  guard.check() <-- your routes, before money moves                       |   <- you operate this
+--------------------------------------------------------------------------+
```

**In backend mode the decisions are outside the attacker's reach** even when the attacker
controls the browser: scoring, the verdict, the rhythm match, the training pool and the
permission for a sensitive action all live on your server, and a verification counts only
when the server checked it (rhythm) or your backend reported it with the secret key. What
the browser still controls is **the measurement**: an attacker who owns the page can send
any 34 numbers they like. They still have to look like the owner to the model, window after
window, which is §4.1 (targeted mimicry) - the open problem, now in a much narrower form.

In **local mode** everything is in the browser - computing, storing and enforcing on the
machine the adversary is using. That mode is for trying the library and for research; it
cannot see an attacker on another device (§4.13) and cannot enforce anything (§4.2).

What backend mode buys, and what it costs:

- **Buys:** the profile follows the account to every device; enforcement where the attacker
  cannot reach; raw behavioral data still never transmitted; no vendor sees your users.
- **Costs:** a server to run (a Flask blueprint or `server/app.py`); a network round trip per
  window and per sensitive action; and when the server is unreachable the answer is
  `UNKNOWN` - verify - not "safe".

---

## 3. Data handling

| Data | Where it lives (backend mode) | Leaves the page? |
| --- | --- | --- |
| Raw events (coordinates, key timings) | Memory of the page; an unscored tail may wait in localStorage up to 15 min between page loads | **Never** |
| Typed characters | Not captured: keys become per-page tokens before anything is buffered | **Never** |
| 34-float feature vector, event counts, integrity result | Your server (training pool, per account) | Yes, to your server only |
| Rhythm template (dwell/flight medians + MAD) | Your server, per account | Only the timings of a sample, to be checked |
| Verdicts and reasons | Your server (per login), your callback, the operator log | To your server only |
| Device fingerprint | Not computed in backend mode | - |

In local mode the vector, template and fingerprint stay in IndexedDB / localStorage, sealed
with an HMAC to detect tampering. **That is integrity, not confidentiality** - anyone with
access to the browser profile can read them.

The rhythm template is **biometric-derived data**. Depending on your jurisdiction (GDPR
Art. 9, BIPA, and similar), storing it may carry legal obligations. In backend mode it is
on your server, which makes it your data to protect, retain and erase (`forget()`,
`guard.forget()`, `POST /v1/forget`). That is your call to make, and worth making
deliberately.

---

## 4. Known attacks

### 4.1 Targeted mimicry - OPEN, and the most important gap

An attacker who can observe the victim's typing and mouse behavior, then deliberately
imitate its rhythm, is **not covered by our evaluation and may well succeed**.

Our impostor figures - 10.5% of impostors pass their first verdict, 7.9% pass their whole
session (14.3% / 10.8% when the impostor uses the account at the owner's usual hour) - are measured against *other ordinary users behaving naturally*, not against
adversaries optimizing to defeat the model. These are different threat classes and the
second is strictly harder. We have not tested it, we do not claim resistance to it, and we
would expect a determined, well-informed mimic to have meaningfully better odds.

In local mode an attacker who can read local storage can retrieve the rhythm template
directly and synthesize a passing sample without guessing. In backend mode the template is
on the server and never sent to a page; the attacker would have to guess it, three attempts
per dialog and three dialogs in a row before the rhythm path locks (§4.14).

**Mitigation if this is in your threat model:** backend mode, plus an out-of-band factor for
high-value actions.

### 4.2 Client-side bypass - CLOSED in backend mode, OPEN in local mode

An attacker controlling the page can call the library's internals directly, suppress the
callback, claim a verification, or simply not load the script. `window.BehaviorGuard`
exposes `_instance` for the demo and loader, which makes this trivial rather than merely
possible.

In local mode this is not defensible: the page is the enforcement point. In backend mode the
enforcement point is your route: `guard.check()` answers from the server's own state - no
fresh assessment is `UNKNOWN`, a page saying "verified" changes nothing, a session the
verdict ended stays ended - so skipping the script or calling the protected route directly
gets 403 (tested in `server/test_app.py`, `demo/arunika/test_server.py` and
`demo/shop-checkout/test_install.py`). What a page attacker can still do is lie about the
measurement; see §2 and §4.1.

### 4.3 Synthetic input and replay - PARTLY covered

**Script-generated events (C-46).** Until C-46 the capture layer accepted every DOM event
that reached it, without ever checking `isTrusted`. Anything running JavaScript in the page -
stored XSS, a malicious extension, a tampered third-party tag, or just the console - could do
this:

```js
for (let i = 0; i < 400; i++) {
  document.dispatchEvent(new MouseEvent('mousemove', {clientX: x(i), clientY: y(i)}));
  document.dispatchEvent(new KeyboardEvent('keyup', {key: 'a', code: 'KeyA'}));
}
```

The attacker did not have to guess the owner's behaviour or beat the 10.5% figure: they could
broadcast a humanlike stream until the verdict came back `LOW`, and because eligible `LOW`
windows **train the model**, the forged vectors entered the baseline pool. That is not one
bypassed check - it is the owner's profile being dragged toward the attacker, permanently,
reinforced on every page load. It is a cheaper relative of replay (4.3 below): replay needs a
recording of the victim, this needs nothing.

Events with `isTrusted === false` now never enter the buffer. The test is `!== false`, not
`=== true`, so very old browsers without the property fall back to the previous behaviour
rather than going silently blind. Dropped events are still **counted**: when a window sees at
least 20 of them and they are at least 10% of the evidence, the window is marked ineligible
for training and the reason is reported to the integrator (`evt.automation`). It deliberately
does **not** block or raise the level - some UI libraries emit legitimate synthetic pointer
events, and blocking on that would lock out an owner who did nothing. The defence is "never
teaches the model", not "blocks".

Two deliberate gaps: `focus`/`blur` are **not** filtered, because `el.focus()` called by the
site (autofocus, auto-advance between OTP digits) is untrusted yet completely normal, and
filtering it would only create a train-vs-serve mismatch on `form_focus_count`. And `scroll`
**cannot** be filtered - `window.scrollTo()` produces an event with `isTrusted` true.

The same hole existed inside the verification dialog. The rhythm template lives on the device,
so a script that can read it could fire `keydown`/`keyup` pairs spaced at the template's own
median timings and pass verification with no finger touching a key. A sample touched by any
untrusted key event is now rejected in full (fail-closed).

**Naive automation.** `core/integrity.js` rejects sessions with tell-tale machine signatures:
near-constant inter-event intervals (std < 3 ms), identical key hold times (std < 1.5 ms),
constant mouse velocity, event rates above 80/s, non-monotonic or duplicated timestamps.

This catches naive automation. It does **not** catch an attacker who drives a real browser
through the OS or a debugging protocol - those events are genuinely trusted - nor one who
injects humanlike jitter into a stream that does pass the `isTrusted` gate. A synthetic
profile tuned against these specific thresholds will pass. The checks are heuristics, not a
bot-detection product.

**Replay** of the victim's own recorded behavior (XSS, a malicious extension, a recorder)
produces a feature vector identical to a stored session, which the model would call `LOW`.
A window within 0.05 standardized RMS of any stored window (temporal features excluded) is
now `HIGH` and never trains; the closest pair of genuine owner windows in our data is 0.289
(C-35). A replay that is resampled, reordered or mixed with new input far enough to move
beyond that distance is not caught by this rule and falls back to the model.

### 4.4 The main detector could be permanently inactive - FIXED

The ensemble gate silences the Mahalanobis detector below 20 pooled training sessions,
because a covariance estimated from fewer samples is ill-conditioned. The gate decision was
frozen into the model at build time, and the convergence rule stopped rebuilding once the
owner produced six consecutive `LOW` sessions - which routinely happened at 10 sessions,
before the gate could ever open.

The result: for any user with consistent early behavior, the detector carrying **70% of the
ensemble weight was never switched on**, for the lifetime of that account. Measured on a
seeded model, an impostor session scoring -1811 on the Mahalanobis detector was still
returned as `LOW`, because only the Isolation Forest contributed.

Crossing a gate threshold is a change of model *structure*, not adaptation to new data, so
it now forces a rebuild regardless of convergence. See `core/DRIFT.md` §C-15.

Published held-out figures are unaffected - the evaluation harness builds models through
its own path - but the shipped library was affected, which is exactly the class of gap
`core/DRIFT.md` exists to track.

### 4.5 Baseline poisoning - MITIGATED

The obvious attack on any adaptive system is to drift the baseline toward the attacker,
one session at a time.

Only sessions that scored `LOW`, **or** that passed a genuine step-up verification, are
ever admitted to the training pool. Sessions that failed a gate, tripped integrity, or
scored `MEDIUM`/`HIGH` without verification never teach the model.

This was not always true. An earlier version let an attacker on a fresh device *enroll their
own rhythm template* during a `HIGH` verdict - the enrollment prompt appeared precisely
because no template existed - and the resulting "pass" reset the risk state and admitted the
attacker's session into the training pool. That is a complete takeover chain that ran
*through* the defense. Enrollment now happens only in trusted `LOW` sessions, and only a real
verification (not an enrollment) can prove identity. See `core/DRIFT.md` §C-2, §C-3.

### 4.6 Step-up bypass - FIXED, and worth reading as a cautionary tale

Verification compared the submitted rhythm against the stored template by iterating over
the *template's* length and reading the sample by index. A shorter sample yielded
`undefined`, arithmetic produced `NaN`, and **`NaN > threshold` is false in JavaScript** -
so no violations were recorded and an empty rhythm passed.

Pasting the phrase produced exactly that: correct text, zero keystroke events, verification
passed. `Ctrl+V` was equally effective, because `'v'` passed the single-character key filter
while `'Control'` did not.

Now: `paste`, `drop` and `cut` are blocked on the input; modified keypresses are ignored;
every character in the field must be accounted for by a captured keystroke; the sample's
shape and finiteness must match the template exactly before any comparison happens; and the
miss budget is proportional to phrase length rather than a fixed two. Locked by 20
regression tests in `core/challenge.test.mjs`, enforced in CI. See `core/DRIFT.md` §C-1.

### 4.7 Cross-device profile poisoning through the server - MITIGATED (was open)

Earlier, the client authenticated with only the **publishable key embedded in every page**.
Anyone who read it could read any account's behavior template, overwrite it with their own
vectors (and so be accepted as the owner), forge verdicts, and list every tenant's key
through an unauthenticated `/tenants` (C-39).

Now each tenant has a public `pk` and a secret `sk`. Every account call needs a short-lived
user token, `HMAC-SHA256(sk, pk|userId|sessionId|exp)`, minted by **your** backend after a
real login; the server takes the user and the login session from the token, never from the
request. The page cannot write a profile at all: it sends windows, and the **server** decides
whether a window may train (only `LOW`, eligible, non-replayed windows, or one the owner just
verified). Verifications and the step-up grace belong to the login session, so a second login
never inherits them. The operator dashboard needs `sk`, escapes every client-supplied field
and is served under a nonce CSP, and the server bounds the shape of every input (C-41, C-49).

What remains: anyone holding a valid token for a user (script running in that user's
session, or the attacker's own login with a stolen password) sends windows as that login.
Those windows are scored against the owner's profile; to train it they must first score
`LOW`, which brings us back to §4.1. Mint tokens with short lifetimes, only after
authentication you trust. The bundled `server/` is a reference implementation (Flask +
SQLite), not a hardened service.

### 4.8 An ignored step-up prompt disabled the whole step-up layer - FIXED

The challenge prompt returned a promise that settled only on a button press. If a user
ignored it, two things followed: `endSession()` never resolved for that session, and the
`_mfaBusy` guard was never cleared - so **every later step-up on that page was silently
skipped**. One abandoned prompt turned the step-up layer off for the rest of the page's
life, and nothing surfaced it.

Prompts now carry a timeout (120 s for verification, 60 s for enrollment) and resolve as
cancelled when it expires. Enrollment no longer blocks the verdict path at all - it is a
setup prompt during a quiet `LOW` session, not part of a verdict. See `core/DRIFT.md` §C-18.

### 4.9 Legitimate users blocked as bots - FIXED

The capture layer never populated `velocity`, but the bot heuristic read it. Every value was
`0`, its standard deviation was `0`, and the "constant velocity" rule fired on any session
that was mostly mouse movement - a visitor browsing without typing much. Two of the first
four real human sessions in live testing were blocked.

The same gap pinned `cursor_idle_ratio` at a constant `1.0` in production while the research
data had it varying, so the model was trained on a live feature and deployed against a dead
one - a train/serve mismatch invisible to every held-out number.

Capture now computes velocity, and the heuristic only judges events that actually carry it.
See `core/DRIFT.md` §C-16, §C-17.

**Why this matters beyond the two bugs:** they were reachable only through the real capture
path, and every prior audit had fed synthetic events directly to the scorer, bypassing
capture entirely. Conformance was 227/227 and every regression suite was green the whole
time. Green tests bounded the numeric engine, not the product.

### 4.10 Denial of service against the owner - LOW severity, real

An attacker who can produce two consecutive `HIGH` verdicts triggers `BLOCK_SESSION`. Since
anyone with brief physical access to an unlocked session can behave unlike the owner on
purpose, this can lock a user out. The run rule (block only on *consecutive* `HIGH`) and the
step-up path exist to keep false blocks rare - the owner block rate is 0% when a step-up
path exists, but **25.7% if the integrator wires none** (C-32), so leave the built-in
challenge on or report your own factor (`guard.report_verified`) - and a deliberate attempt
will still succeed. In backend mode the block ends **that login** (the server refuses it);
the owner's other logins are not ended. Provide a
recovery path that does not depend on BehaviorGuard.

### 4.11 Step-up grace - accepted residual risk

After a **proven** step-up, `MEDIUM` verdicts do not ask again for 15 minutes (C-43). An
attacker who never passes a step-up - a stolen password on their own device - never gets
this. The residual case is someone who takes over the owner's **unlocked, just-verified**
session within 5 minutes of the owner leaving: for the rest of the 15 minutes, only a `HIGH`
verdict asks them to verify. A 5-minute absence, a page load after one, a device-fingerprint
change or a replay match all revoke the grace, and graced windows never train the model.
Set `mfa.graceSec: 0` if this trade is wrong for you.

### 4.12 Not enough evidence - by design, and it has a cost

A verdict needs 150 events. An impostor session too short to produce them is never scored
(0.6% of impostor sessions; 2.8% when long idle gaps are injected). Such a window emits
`UNKNOWN`/`ABSTAIN`, never "safe" - but a routine callback that only reacts to `HIGH` will
let it through. An attacker who logs in and changes the recovery email within 20 seconds
can finish before the first routine verdict. **Every sensitive action must be gated on a
fresh assessment and treat `UNKNOWN` as "verify"** - in backend mode that is
`guard.check()`, which does exactly this and fails closed when no assessment is fresh.

### 4.13 Enrollment, and the attacker's own device - CLOSED for a known account in backend mode

The first 10 eligible windows of an account produce no verdict - there is nothing to compare
against. Windows whose keystroke block was pasted or autofilled never count toward
enrollment (their typing features are structurally empty), so a user who only ever uses a
password manager may take a long time to enroll. Until enrollment completes, rely on your
other controls: `guard.check(money=True)` answers "verify" for the whole period, and also
until the main detector is on (20 training windows).

**The attacker's own device** used to be the same case, and it was the most serious design
gap. In local mode the profile lives in the browser that built it, so an attacker who logs in
with a stolen password from their own laptop meets an empty profile - and the library enrolls
*them* as the owner. That is the classic account-takeover path, and local scoring cannot see
it.

In backend mode the profile belongs to the account on your server (C-49). A new login on any
device is scored against the owner's profile from its first window (tested:
`server/test_app.py`, `server/test_backend_sdk.py`, and with real browsers in the Arunika and
shop-checkout demos). What remains is a **brand-new account** - no owner profile exists yet,
for anyone - which is why the fail-closed policy above matters. Sites where a password can
leak before the owner's first sessions can also turn on `enrollRequiresVerified` (see
[server/README.md](server/README.md)): the account then learns only from logins that passed a
verification.

### 4.14 The step-up fallback and rhythm guessing - MITIGATED (C-45)

`mfa.onFallback` is the integrator's own factor (OTP, WebAuthn). In backend mode its return
value is not trusted: the library asks the server whether your backend reported the
verification (`guard.report_verified` / `POST /v1/report`, signed with the `sk`) for this
login in the last two minutes, and counts it only then. In local mode the library trusts the
return value exactly as it trusts `reportStepUp` - the client-side boundary of §4.2.

Before C-45 each verdict opened a fresh dialog with three attempts, with no memory across
dialogs, so an impostor who kept coming back had unlimited tries at the owner's rhythm.
After `mfa.lockAfterFailures` (default 3) exhausted dialogs in a row, persisted across page
loads (on the server, per account, in backend mode), the rhythm path is locked and only the
fallback can verify; a passed verification unlocks it. Without a fallback configured the locked state is fail-closed (`unavailable`),
not a pass.

### 4.15 Deployment conditions that used to silence the library - FIXED (C-45)

- **Plain http.** `crypto.subtle` exists only in secure contexts. Every save threw, the
  verdict path threw with it, and the timer swallowed the error: the library was installed
  and produced no verdict at all. It now stores unsigned data on insecure origins (the HMAC
  was tamper-evidence keyed by a public string, not secrecy) and warns once; unsigned data is
  refused on a secure origin, so https is not weakened.
- **Loaded twice** (tag manager plus a manual tag): the second copy replaced the first and
  two capture instances ran. The first copy now wins.
- **Library missing** (blocked by an extension, CDN down): this is on the integrator. The
  demo integration treats it as `UNKNOWN` and sends every sensitive action to OTP. Do the
  same; never let the absence of the security script mean "safe".

### 4.16 The step-up layer could deadlock - FIXED (C-46)

Two ways the verification layer could stop working entirely, both of them fail-*closed* in
the security sense but broken as a product:

- `mfa.onFallback` is the integrator's code and was awaited with no timeout. A promise that
  never settles - an OTP dialog whose cancel button forgets to resolve, a network call with no
  timeout of its own - pinned `_mfaBusy` forever. Every later verdict came back
  `mfa: {busy: true}`, and an integrator that (correctly) waits for the dialog result never
  acted again for the lifetime of the page. There is now a timeout
  (`mfa.fallbackTimeoutMs`, default 300 s); timing out counts as *not verified*.
- `mfa.lockAfterFailures` locks the rhythm path after N consecutive failed dialogs, and only a
  *successful* verification unlocks it. With no `onFallback` configured there is no way to
  succeed, so an owner - possibly just using a different keyboard - is locked out of
  verification permanently, with nothing in the integrator's logs explaining why. `init()` now
  warns when that combination is configured, naming both escapes.

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
- **Earlier numbers measured other engines.** The Python research harnesses imitated the
  library and each missed it somewhere (whole sessions instead of 30-second windows,
  different thresholds, no sticky floor). Headline numbers now come from
  `research/eval_sdk.mjs`, which drives the shipped code itself (C-29); the Python tools are
  research-only.

---

## What this is not

- **Not a second authentication factor.** It is a risk signal that can trigger one.
- **Not a bot-detection product.** The integrity checks are heuristics.
- **Not fraud proof.** A `HIGH` verdict means "this does not look like the owner" - which is
  also what a new keyboard, an injury, a shared account or a bad night look like.
- **Not a login control.** It needs sessions to learn from; the first 10 produce no verdicts.
- **Not resistant to a compromised browser's measurements.** In backend mode a compromised
  page cannot grant itself anything, but it can lie about how the user behaves (§4.1).
- **Not a replacement for server-side authorization.** `guard.check()` adds a behavioral
  condition to your authorization; it does not replace it.

---

## Reporting a vulnerability

Open a GitHub issue for anything already public. For an unreported bypass, use
[private vulnerability reporting](https://github.com/maysanblank/behaviorguard-sdk/security/advisories/new)
first so a fix can ship before the details do. See [SECURITY.md](SECURITY.md).

We would genuinely rather receive a working mimicry attack than not know about it. If you
break it, we will document it here with credit.
