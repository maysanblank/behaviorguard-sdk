# Quickstart

Every way to integrate BehaviorGuard, from a single tag to the ES module and the optional
server, plus the full configuration surface.

There is no build step, no package to install, and no service to sign up for. The library
is one file with zero dependencies.

---

## 1. The fastest path — one script tag

Put `dist/behaviorguard.js` anywhere your page can load it, and add one tag before
`</body>`:

```html
<script src="/dist/behaviorguard.js" data-user="andi@example.com" defer></script>
<script>
  addEventListener('behaviorguard:risk', e => {
    const { level, score, action, reasons } = e.detail;
    if (level === 'HIGH') lockCheckout();
  });
</script>
```

`data-user` is required — it is the identity the baseline belongs to. Use your own stable
account identifier; an email is fine, so is an opaque user id.

Add the tag to **every page you want covered**. Each page load continues the same stored
baseline for that user.

That is the entire integration. Capture, scoring, enrollment, retraining and the step-up
prompt all start automatically.

### See it working immediately

Add `data-panel` and the library mounts its own live status panel — useful while
integrating, and the fastest way to confirm events are being captured:

```html
<script src="/dist/behaviorguard.js" data-user="andi@example.com" data-panel defer></script>
```

---

## 2. Receiving verdicts

Three equivalent ways. Pick one.

**DOM event** (recommended — no globals):

```js
addEventListener('behaviorguard:risk', e => handle(e.detail));
```

**Named global callback:**

```html
<script src="/dist/behaviorguard.js" data-user="andi@example.com" data-callback="onRisk" defer></script>
<script>function onRisk(evt) { handle(evt); }</script>
```

**Config object** — must appear *before* the library tag:

```html
<script>
  window.BehaviorGuardConfig = {
    userId: 'andi@example.com',
    onRisk: evt => handle(evt),
  };
</script>
<script src="/dist/behaviorguard.js" defer></script>
```

### The verdict object

```js
{
  level: 'HIGH',                  // LOW | MEDIUM | HIGH | UNKNOWN (not enough evidence)
  score: -4.21,                   // ensemble score; more negative = more anomalous
  action: 'REQUIRE_STEPUP',       // see the table below
  blocked: false,
  consecutiveHigh: 1,             // how many HIGH verdicts in a row
  reasons: ['keystroke_dwell_time_mean z=-3.90', 'mouse_velocity_std z=3.12'],
  topFeatures: [{ name, z, abs }],
  thresholds: { low: -3.51, medium: -5.63 },
  eligible: true,                 // did this session pass the quality gate?
  modelLevel: 'HIGH',             // raw model verdict, before smoothing
  modelScore: -4.21,
  stickyFloor: false,             // true if the level was raised by the sticky floor
  stepUpGrace: null,              // set when a MEDIUM was not re-asked after a recent step-up
  reverifyAfterAway: false,       // true if raised because the user came back after >= 15 min
  replay: null,                   // set when this window copies a stored one (recorded behavior)
  partialEvidence: null,          // 'keystroke' when typing was pasted/autofilled
  mfa: { shown: true, verified: true }   // present when the built-in step-up ran
}
```

| `action` | Meaning | Suggested response |
| --- | --- | --- |
| `ALLOW_SESSION` | Looks like the owner | Nothing |
| `ABSTAIN` | `UNKNOWN` — not enough evidence yet | **Not** "safe": verify before sensitive actions |
| `REQUIRE_MFA` | `MEDIUM` — mildly unusual | Re-auth before sensitive actions |
| `REQUIRE_STEPUP` | `HIGH` — clearly unusual | Re-auth now; hold risky operations |
| `BLOCK_SESSION` | Sustained `HIGH`, or integrity/rate-limit trip | End the session server-side |
| `MFA_PASSED` | Step-up succeeded; identity proven | Restore normal access |
| `MFA_FAILED` | Step-up failed or was cancelled | Treat as still-risky |

**Enforce consequences on your server.** A client-side check can be bypassed by anyone who
opens devtools — see [THREAT-MODEL.md](../THREAT-MODEL.md).

---

## 3. What to expect on a fresh user

```
windows 1-10      enrollment. level is always LOW, score 0, no step-up.
                  reasons says: "enrollment 3/10"
window 11         first real verdict
```

The window ticks every 30 seconds and when the tab is hidden, but a verdict (or an
enrollment step) needs **150 events** of evidence; fewer are carried forward for up to 15
minutes instead of being thrown away. So enrollment takes roughly ten short bursts of real
interaction — not ten minutes of an idle tab. Windows whose typing was pasted or autofilled
do not count toward enrollment.

If verdicts stay `LOW` forever, the user has not finished enrollment yet. Check
`evt.reasons` — it tells you the count.

---

## 4. The built-in step-up challenge

On `MEDIUM` or `HIGH`, the library raises its own prompt: the user retypes their security
phrase, and identity is verified from per-character dwell and flight timing. **This needs no
code from you.**

The template is enrolled during a trusted `LOW` session — never at the moment of
suspicion — so the first time a user sees the prompt is "Set up your security verification".

```js
window.BehaviorGuardConfig = {
  userId: 'andi@example.com',
  mfa: {
    enabled: true,                       // set false to handle step-up yourself
    phrase: 'my secret phrase',          // change this; the default is public
    rounds: 3,                           // enrollment repetitions
    triggerOn: ['MEDIUM', 'HIGH'],
    cooldownMs: 15000,
  },
};
```

**Change the phrase.** The default (`'kunci rahasia saya'`) is in the public source. The
phrase is not a secret in the cryptographic sense — the rhythm is what proves identity —
but a per-deployment phrase is still better.

Pasting is blocked, modified keypresses are ignored, and a sample whose keystroke count does
not match the field is rejected before verification runs. Three failed attempts end the
challenge as failed.

### Using your own step-up (OTP, WebAuthn, email link)

Set `mfa.enabled = false`, act on `REQUIRE_MFA` / `REQUIRE_STEPUP`, and **report the
result back**:

```js
window.BehaviorGuardConfig = { userId: 'andi@example.com', mfa: { enabled: false } };

addEventListener('behaviorguard:risk', async e => {
  if (e.detail.action === 'REQUIRE_MFA' || e.detail.action === 'REQUIRE_STEPUP') {
    const ok = await runMyOtpFlow();              // verified on YOUR server
    BehaviorGuard.reportStepUp({ passed: ok });
  }
});
```

Without this call the library never learns the owner proved themselves: the sticky floor is
never cleared, the owner's drifted behavior never trains the model, and consecutive `HIGH`s
end in `BLOCK_SESSION` for the owner — 25.7% of owner windows in our measurement, versus 0%
with it.

After a passed step-up, `MEDIUM` verdicts are not re-asked for `mfa.graceSec` (900 s). `HIGH`
still is, and 5 minutes away cancels the grace.

---

## 5. ES module

For explicit control over the session lifecycle:

```html
<script type="module">
  import bg from '/sdk/behaviorguard.js';

  await bg.init({
    userId: 'andi@example.com',
    onRisk: evt => {
      if (evt.level === 'HIGH') requireStepUp(evt);
    },
  });

  // before a sensitive action: judge NOW, no side effects, fail closed
  document.querySelector('#change-email').addEventListener('click', () => {
    const v = bg.assessNow();
    if (v.level !== 'LOW') return requireStepUp(v);   // UNKNOWN included
    submitEmailChange();
  });
</script>
```

Useful methods:

| Method | Purpose |
| --- | --- |
| `bg.init(opts)` | Start. Required before anything else. Calling it again (logout A, login B) starts B from zero. |
| `bg.assessNow()` | Verdict right now for a sensitive action. No side effects; `UNKNOWN` + `REQUIRE_STEPUP` when evidence is short. |
| `bg.reportStepUp({passed})` | Report your own step-up result. `passed:true` clears the verdict and lets the window train. |
| `bg.setUserToken(t)` | Refresh the short-lived user token for the optional server. |
| `bg.endSession()` | Score whatever evidence is buffered now (at least 150 events). Returns the verdict or `null`. |
| `bg.getVector()` | Current 28-float vector without closing the session. |
| `bg.getState()` | Sessions, config, thresholds — for dashboards and debugging. |
| `bg.scoreVector(vec)` | Score a vector with no side effects. For evaluation. |
| `bg.clear()` | Erase this user's baseline, template and history. |

---

## 6. Configuration

Every option, with its default. All are optional except `userId`.

```js
window.BehaviorGuardConfig = {
  userId: 'andi@example.com',       // REQUIRED
  onRisk: evt => {},

  calibration: { k_low: 1.75 },     // THE operating-point knob: smaller = stricter

  mfa: { enabled: true, phrase: '...', rounds: 3,
         triggerOn: ['MEDIUM','HIGH'], cooldownMs: 15000,
         graceSec: 900 },           // no re-ask of MEDIUM for 15 min after a passed step-up

  session: { minEventsAssess: 150,  // evidence per verdict
             carryMaxAgeSec: 900,   // how long short evidence is collected
             idleCompressSec: 15,   // idle gaps are shortened to this
             contextEvents: 0 },    // strict mode: e.g. 450 (see README)
  idle: { awaySec: 300,             // absence that resets trust
          reverifyAfterSec: 900 },  // absence that forces re-verification

  baseline: 10,                     // enrollment windows before scoring starts
  retrainEvery: 6,                  // retrain after N new trusted windows
  weights: { isolation_forest: 0.30, svm: 0.70 },   // auto-normalized

  panel: false,                     // mount the built-in live status panel

  pk: null,                         // optional server: public key
  endpoint: null,                   // optional server: base URL
  userToken: null,                  // optional server: token minted by YOUR backend
};
```

**The defaults are the measured configuration.** Move `calibration.k_low` to trade owner
friction against impostor passes (the README has the table). Change the rest only if you
run your own evaluation with `tools/eval_sdk.mjs` — the published numbers describe the
defaults.

Thresholds are recalibrated per user from their own baseline score distribution; do not set
them globally.

---

## 7. Sensitive actions

Routine verdicts wait for 150 events, so an attacker who logs in and changes the recovery
email in 20 seconds can finish before the first one. Gate every sensitive action — change
email, password or phone, add a device or payee, payout — on an immediate verdict:

```js
const v = BehaviorGuard.assessNow();       // or bg.assessNow() in the ES-module form
if (v.level === 'LOW') proceed();
else requireStepUp();                      // MEDIUM, HIGH, and UNKNOWN (too little evidence)
```

`assessNow()` does not drain the buffer, train, move the sticky floor or count toward the
block rule. During enrollment it returns `UNKNOWN` — there is nothing to compare against yet.

---

## 8. Optional server (cross-device baselines, operator dashboard)

By default a baseline is per-device: a user on a new laptop starts enrollment again. The
optional server stores the account baseline on **your** server so a new device adopts it,
and logs verdicts for an operator dashboard.

```html
<script src="/dist/behaviorguard.js"
        data-user="andi@example.com"
        data-pk="pk_your_tenant_key"
        data-endpoint="https://risk.yourcompany.com"
        data-user-token="<minted by your backend after login>"
        defer></script>
```

The public `pk` opens nothing by itself. Every account call needs the short-lived user
token, `HMAC-SHA256(sk, pk|userId|exp)`, minted by your backend with the tenant secret `sk`
after a real login; refresh it with `BehaviorGuard.setUserToken()`. Without a token the
library stays fully on-device. Only 28-number feature vectors and verdicts are transmitted,
and a device that already has its own enrollment never adopts a server baseline.

Setup, the Node minting snippet and the dashboard: [server/README.md](../server/README.md).
Residual risks: [THREAT-MODEL.md](../THREAT-MODEL.md) §4.7.

---

## 9. Frameworks

BehaviorGuard captures at the document level and hooks `pushState`/`replaceState`/`popstate`,
so client-side routing is handled without configuration.

**React / Vue / Svelte** — initialize once, outside the component tree:

```js
// main.js
import bg from './behaviorguard.js';
bg.init({ userId: currentUser.id, onRisk: store.handleRisk });
```

Do not call `init()` inside a component that remounts; call it once at app startup.

**Next.js / SSR** — the library requires a DOM. Load it client-side only:

```js
useEffect(() => { import('/sdk/behaviorguard.js').then(m => m.default.init({ userId })); }, []);
```

**Content Security Policy** — the library needs no `unsafe-eval` and makes no network
requests unless you enable hybrid mode. If you use the built-in step-up prompt or
`data-panel`, they set inline styles, so allow `style-src 'unsafe-inline'` or disable both.

---

## 10. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Verdict is always `LOW` | Enrollment is not finished. Check `evt.reasons` for the count. |
| No verdicts at all | `data-user` missing, or fewer than 150 events of evidence yet (`UNKNOWN`/`ABSTAIN`). |
| `evt.eligible === false` | Window failed the quality gate (<100 events, <5 s, <6 non-zero features, or pasted/autofilled typing), was a replay, or was a graced `MEDIUM`. It is scored but never trains. |
| Step-up never appears | Its template is enrolled during a `LOW` session first; also check `mfa.enabled`. |
| Step-up rejects the real owner | Rhythm drifted (new keyboard, injury). Clear the template with `bg.clear()` and re-enroll. |
| Storage empty in private mode | Expected. The library falls back to memory and does not crash. |
| Owner asked again right after passing your OTP | You are not calling `reportStepUp({passed:true})`. |
| Too many / too few step-ups | `init({calibration:{k_low}})`. Higher = more permissive; see the README table. |

---

## 11. Verifying your install

```bash
python core/conformance.py       # engine matches the spec        -> 255/255
node   core/lifecycle.test.mjs   # lifecycle and integrator APIs  -> 49/49
node   core/challenge.test.mjs   # step-up layer is fail-closed
python -m http.server 8080       # then open /demo/pemantau/
```

If `conformance.py` does not print `255 / 255`, something in `sdk/core/` has been modified
away from the specification — see [../core/SPEC.md](../core/SPEC.md).
