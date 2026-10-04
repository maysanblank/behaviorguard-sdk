# Quickstart

Every way to integrate BehaviorGuard, from a single tag to the ES module and the optional
server, plus the full configuration surface.

There is no build step, no package to install, and no service to sign up for. The library
is one file with zero dependencies.

---

## 1. The fastest path - one script tag

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

`data-user` is required - it is the identity the baseline belongs to. Use your own stable
account identifier; an email is fine, so is an opaque user id.

Add the tag to **every page you want covered**. Each page load continues the same stored
baseline for that user.

That is the entire integration. Capture, scoring, enrollment, retraining and the step-up
prompt all start automatically.

### See it working immediately

Add `data-panel` and the library mounts its own live status panel - useful while
integrating, and the fastest way to confirm events are being captured:

```html
<script src="/dist/behaviorguard.js" data-user="andi@example.com" data-panel defer></script>
```

---

## 2. Receiving verdicts

Three equivalent ways. Pick one.

**DOM event** (recommended - no globals). Fired for every integration, including a manual
`init()`:

```js
addEventListener('behaviorguard:risk', e => handle(e.detail));
// or, equivalently, with an unsubscribe handle:
const off = BehaviorGuard.on('risk', handle);
```

**Named global callback:**

```html
<script src="/dist/behaviorguard.js" data-user="andi@example.com" data-callback="onRisk" defer></script>
<script>function onRisk(evt) { handle(evt); }</script>
```

**Config object** - must appear *before* the library tag:

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
  id: 7,                          // verdict number; the two events of one verdict share it
  stage: 'final',                 // 'awaiting-mfa' | 'final'
  mfa: { shown: true, verified: true }   // present when a step-up ran
}
```

**One verdict, two events, when a dialog is shown.** A verdict that opens the step-up dialog
is announced immediately with `stage: 'awaiting-mfa'` and `mfa: { awaiting: true }` - the
action is not final yet - and announced again with the same `id`, `stage: 'final'` and the
outcome (`MFA_PASSED` / `MFA_FAILED`). A verdict that arrives while another dialog is still
open carries `mfa: { busy: true }`: the open dialog decides, so do not act on it. In short:

```js
BehaviorGuard.on('risk', e => {
  if (e.mfa && (e.mfa.awaiting || e.mfa.busy)) return showPendingState(e);
  handleFinal(e);
});
```

| `action` | Meaning | Suggested response |
| --- | --- | --- |
| `ALLOW_SESSION` | Looks like the owner | Nothing |
| `ABSTAIN` | `UNKNOWN` - not enough evidence yet | **Not** "safe": verify before sensitive actions |
| `REQUIRE_MFA` | `MEDIUM` - mildly unusual | Re-auth before sensitive actions |
| `REQUIRE_STEPUP` | `HIGH` - clearly unusual | Re-auth now; hold risky operations |
| `BLOCK_SESSION` | Sustained `HIGH`, or integrity/rate-limit trip | End the session server-side |
| `MFA_PASSED` | Step-up succeeded; identity proven | Restore normal access |
| `MFA_FAILED` | Step-up failed or was cancelled | Treat as still-risky |

**Enforce consequences on your server.** A client-side check can be bypassed by anyone who
opens devtools - see [THREAT-MODEL.md](../THREAT-MODEL.md).

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
interaction - not ten minutes of an idle tab. Windows whose typing was pasted or autofilled
do not count toward enrollment.

If verdicts stay `LOW` forever, the user has not finished enrollment yet. Check
`evt.reasons` - it tells you the count.

---

## 4. The built-in step-up challenge

On `MEDIUM` or `HIGH`, the library raises its own dialog: the user retypes a short phrase
shown on screen, and identity is verified from per-character dwell and flight timing. **This
needs no code from you.**

The dialog renders in a Shadow DOM with its own stylesheet (your CSS cannot break it, and it
works under a strict `style-src` CSP), is keyboard- and screen-reader-accessible (focus trap,
`Esc` cancels, live status messages), highlights each character as it is typed, submits by
itself when the phrase is complete, and works with touch-screen keyboards (where only the
gaps between characters are measured). Its timeout counts from the last keystroke.

The template is enrolled during a trusted `LOW` session - never at the moment of
suspicion. By default the library offers it once, at a quiet moment (never while the user
is typing); set `autoEnroll: false` to put it on your settings page instead:

```js
await BehaviorGuard.enrollMfa();   // refuses while the session is under suspicion
await BehaviorGuard.forgetMfa();   // requires a passed step-up first
```

```js
window.BehaviorGuardConfig = {
  userId: 'andi@example.com',
  mfa: {
    enabled: true,                       // set false to handle step-up yourself
    phrase: 'my secret phrase',          // change this; the default is public (min 8 chars)
    rounds: 3,                           // enrollment repetitions
    triggerOn: ['MEDIUM', 'HIGH'],
    brand: 'Your Site', accent: '#1f5fd6', theme: 'auto',   // 'light' | 'dark' | 'auto'
    lang: 'id',                          // 'id' | 'en'; texts: {...} overrides any string
    onFallback: async ({ level, reasons, trigger, why }) => runMyOtpFlow(),  // see below
    autoEnroll: true,
    lockAfterFailures: 3,                // failed dialogs in a row before rhythm is locked
  },
};
```

**Always provide `onFallback`.** It adds a "Use another method" button to the dialog and is
used automatically when the user has no rhythm template yet, when their keyboard differs from
the one they enrolled with, and after `lockAfterFailures` failed dialogs in a row. Return
`true` only when **your server** verified the factor. Without a fallback, an owner who cannot
type the phrase (another keyboard, a phone, an injured hand) has no way out except being
blocked.

**Change the phrase.** The default (`'kunci rahasia saya'`) is in the public source. The
phrase is not a secret in the cryptographic sense - the rhythm is what proves identity -
but a per-deployment phrase is still better.

Pasting is blocked, modified keypresses are ignored, and a sample whose keystroke count does
not match the field is rejected before verification runs. Three failed attempts end the
challenge as failed.

### Using only your own step-up (OTP, WebAuthn, email link)

To keep the built-in dialog but route everything through your factor, use `onFallback`
above. To replace the dialog entirely, set `mfa.enabled = false`, act on `REQUIRE_MFA` /
`REQUIRE_STEPUP`, and **report the result back**:

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
end in `BLOCK_SESSION` for the owner - 25.7% of owner windows in our measurement, versus 0%
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
| `bg.init(opts)` | Start. Required before anything else. Calling it again (logout A, login B) starts B from zero. Concurrent calls are queued. |
| `bg.assessNow()` | Verdict right now for a sensitive action. No side effects; `UNKNOWN` + `REQUIRE_STEPUP` when evidence is short. `verifiedRecently` says whether a step-up passed within `graceSec`. |
| `bg.stepUp({level, reason})` | Show the step-up dialog now (or run `onFallback`). Resolves `{verified, method}`. Use it before a transfer or a password change. |
| `bg.reportStepUp({passed})` | Report your own step-up result. `passed:true` clears the verdict and lets the window train. |
| `bg.status()` | What to show in your UI: `phase` (`learning` / `protecting`), enrollment progress, last verdict, rhythm-template state, remaining grace. No vectors. |
| `bg.enrollMfa()` / `bg.forgetMfa()` | Set up / remove the typing-rhythm template from your settings page. |
| `bg.stop()` | Logout: bank the evidence, stop capturing, cancel the step-up grace. The profile stays. |
| `bg.forget()` | Delete everything stored about this user on this device (right to erasure). |
| `bg.on('risk', fn)` | Subscribe to verdicts; returns an unsubscribe function. |
| `bg.setUserToken(t)` | Refresh the short-lived user token for the optional server. |
| `bg.endSession()` | Score whatever evidence is buffered now (at least 150 events). Returns the verdict or `null`. |
| `bg.getVector()` | Current 34-float vector without closing the session. |
| `bg.getState()` | Sessions, config, thresholds - for dashboards and debugging. |
| `bg.scoreVector(vec)` | Score a vector with no side effects. For evaluation. |
| `bg.clear()` | Erase this user's baseline, template and history (`forget()` also removes the token secret). |

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
         graceSec: 900,             // no re-ask of MEDIUM for 15 min after a passed step-up
         onFallback: null,          // async ctx => boolean: YOUR server-verified factor
         brand: null, accent: null, theme: 'auto', lang: null, texts: null,
         autoEnroll: true, lockAfterFailures: 3,
         timeoutMs: 120000, enrollTimeoutMs: 90000 },   // counted from the last keystroke

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
run your own evaluation with `tools/eval_sdk.mjs` - the published numbers describe the
defaults.

Thresholds are recalibrated per user from their own baseline score distribution; do not set
them globally.

---

## 7. Sensitive actions

Routine verdicts wait for 150 events, so an attacker who logs in and changes the recovery
email in 20 seconds can finish before the first one. Gate every sensitive action - change
email, password or phone, add a device or payee, payout - on an immediate verdict:

```js
const v = BehaviorGuard.assessNow();       // or bg.assessNow() in the ES-module form
if (v.level === 'LOW') return proceed();
const s = await BehaviorGuard.stepUp({ level: v.level === 'HIGH' ? 'HIGH' : 'MEDIUM', reason: 'change your email' });
if (s.verified) proceed();                 // MEDIUM, HIGH, and UNKNOWN (too little evidence)
```

`v.verifiedRecently` is `true` for `graceSec` after a passed step-up, if your policy allows two
transfers in a row without asking twice. **If the library failed to load, treat every
sensitive action as `UNKNOWN`** - never let the absence of the security script mean "safe".

`assessNow()` does not drain the buffer, train, move the sticky floor or count toward the
block rule. During enrollment it returns `UNKNOWN` - there is nothing to compare against yet.

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
library stays fully on-device. Only 34-number feature vectors and verdicts are transmitted,
and a device that already has its own enrollment never adopts a server baseline.

Setup, the Node minting snippet and the dashboard: [server/README.md](../server/README.md).
Residual risks: [THREAT-MODEL.md](../THREAT-MODEL.md) §4.7.

---

## 9. Frameworks

BehaviorGuard captures at the document level and hooks `pushState`/`replaceState`/`popstate`,
so client-side routing is handled without configuration.

**React / Vue / Svelte** - initialize once, outside the component tree:

```js
// main.js
import bg from './behaviorguard.js';
bg.init({ userId: currentUser.id, onRisk: store.handleRisk });
```

Do not call `init()` inside a component that remounts; call it once at app startup.

**Next.js / SSR** - the library requires a DOM. Load it client-side only:

```js
useEffect(() => { import('/sdk/behaviorguard.js').then(m => m.default.init({ userId })); }, []);
```

**Content Security Policy** - the library needs no `unsafe-eval` and makes no network
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
python core/conformance.py       # engine matches the spec        -> 319/319
node   core/lifecycle.test.mjs   # lifecycle and integrator APIs  -> 49/49
node   core/challenge.test.mjs   # step-up layer is fail-closed
python -m http.server 8080       # then open /demo/pemantau/
```

If `conformance.py` does not print `319 / 319`, something in `sdk/core/` has been modified
away from the specification - see [../core/SPEC.md](../core/SPEC.md).
