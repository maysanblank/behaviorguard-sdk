# Quickstart

Every way to integrate BehaviorGuard, from the recommended backend mode to a single tag on
a static page, plus the full configuration surface.

No build step and no third-party service. The browser library is one file with zero
dependencies; the server side is pure Python on Flask, and it runs on your own server.

**Two modes, one engine:**

| | Backend mode (recommended) | Local mode |
| --- | --- | --- |
| Profile, model, verdicts | on your server, per **account** | in this browser (IndexedDB) |
| Attacker on another device | judged against the owner's profile from the first window | meets an empty profile |
| Sensitive actions | your route asks `guard.check()`; the page cannot talk past it | the page decides |
| Verifications | rhythm checked on the server; your OTP reported by your server | reported by the page |
| What leaves the page | 34 numbers per window and counts | nothing |
| Needs | `data-endpoint` + a token from your backend | `data-user` |

The decisions are identical: `server/test_parity.py` checks the server engine against the
library window by window.

---

## 1. The recommended path - backend mode

Your backend mounts BehaviorGuard's API, signs a token after login, and asks before each
sensitive action. The full walk-through, with Flask, Node, PHP and Laravel:
[INTEGRATION.md](INTEGRATION.md). In short (Flask):

```python
from guard import Guard, create_blueprint                    # server/ or dist/server/
guard = Guard('behaviorguard.db', tenant=(BG_PK, BG_SK))
app.register_blueprint(create_blueprint(guard), url_prefix='/bg')

@app.get('/api/bg-token')
def bg_token():                                              # user AND this login's id
    return {'token': guard.mint_token(session['user'], session['login_id'], ttl=900)}
```

```html
<script src="/dist/behaviorguard.js" data-endpoint="/bg" data-token-url="/api/bg-token" defer></script>
<script>
  addEventListener('behaviorguard:risk', e => {
    const { level, action, reasons } = e.detail;     // the server's verdict, for your UI
  });
</script>
```

The user id comes from the signed token; the page never says who it is. Add the tag to every
page after login. If the backend cannot be reached, verdicts are `UNKNOWN` (`offline: true`),
never "safe".

## 1b. Local mode - one script tag, no server

For a static page, a prototype, or the research harness:

```html
<script src="/dist/behaviorguard.js" data-user="andi@example.com" defer></script>
<script>
  addEventListener('behaviorguard:risk', e => {
    const { level, score, action, reasons } = e.detail;
    if (level === 'HIGH') lockCheckout();
  });
</script>
```

`data-user` is the identity the baseline belongs to - in this browser only. Use your own
stable account identifier. Capture, scoring, enrollment, retraining and the step-up prompt
all start automatically. Remember the limit: someone logging in from another device starts
from an empty profile, and every decision is made in a page the user controls.

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
    lang: 'en',                          // 'en' | 'id'; null = page lang, then browser; texts: {...} overrides any string
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

### Using your own step-up (OTP, WebAuthn, email link)

**Backend mode:** your server checks the factor and reports it -
`guard.report_verified(None, user, login_id, passed)` in Flask, or `POST /v1/report` with the
`sk` from any stack. `onFallback` opens your dialog; when it returns `true` the library asks
the server whether the report arrived, and only then counts it. A page that merely returns
`true`, or calls `reportStepUp({ passed: true })`, changes nothing.

**Local mode:** to replace the dialog entirely, set `mfa.enabled = false`, act on
`REQUIRE_MFA` / `REQUIRE_STEPUP`, and **report the result back**:

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
| `bg.assessNow()` | Verdict right now for a sensitive action (a Promise in backend mode, also recorded on the server for `guard.check()`). No side effects; `UNKNOWN` + `REQUIRE_STEPUP` when evidence is short. `verifiedRecently` says whether a step-up passed within `graceSec`. |
| `bg.stepUp({level, reason})` | Show the step-up dialog now (or run `onFallback`). Resolves `{verified, method}`. Use it before a transfer or a password change. |
| `bg.reportStepUp({passed})` | Local mode: report your own step-up result (`passed:true` clears the verdict and lets the window train). Backend mode: only picks up what your server reported with `report_verified`. |
| `bg.status()` | What to show in your UI: `phase` (`learning` / `protecting`), enrollment progress, last verdict, rhythm-template state, remaining grace. No vectors. |
| `bg.enrollMfa()` / `bg.forgetMfa()` | Set up / remove the typing-rhythm template from your settings page. |
| `bg.stop()` | Logout: bank the evidence, stop capturing, cancel the step-up grace. The profile stays. |
| `bg.forget()` | Right to erasure. Local mode: everything stored on this device. Backend mode: the account's profile and template on the server, after a fresh verification. |
| `bg.on('risk', fn)` | Subscribe to verdicts; returns an unsubscribe function. |
| `bg.setUserToken(t)` | Backend mode: replace the user token (or let `tokenUrl` / `getToken` refresh it). |
| `bg.endSession()` | Score whatever evidence is buffered now (at least 150 events). Returns the verdict or `null`. |
| `bg.getVector()` | Current 34-float vector without closing the session. |
| `bg.getState()` | Sessions, config, thresholds - for dashboards and debugging. |
| `bg.scoreVector(vec)` | Score a vector with no side effects. For evaluation. |
| `bg.clear()` | Erase this user's baseline, template and history (`forget()` also removes the token secret). |

---

## 6. Configuration

Every option, with its default. Backend mode needs `endpoint` plus `token`, `tokenUrl` or `getToken`; local mode needs `userId`.

```js
window.BehaviorGuardConfig = {
  userId: 'andi@example.com',       // local mode only; in backend mode it comes from the token
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

  endpoint: null,                   // backend mode: BehaviorGuard's API ('/bg', or the service URL)
  pk: null,                         // backend mode: public key (optional when mounted in your app)
  token: null,                      // backend mode: user token minted by YOUR backend after login
  tokenUrl: null,                   // ...or a route that returns {token}; used again when it expires
  getToken: null,                   // ...or an async function that returns one
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
const v = await BehaviorGuard.assessNow(); // a Promise in backend mode; await is harmless in local mode
if (v.level === 'LOW') return proceed();
const s = await BehaviorGuard.stepUp({ level: v.level === 'HIGH' ? 'HIGH' : 'MEDIUM', reason: 'change your email' });
if (s.verified) proceed();                 // MEDIUM, HIGH, and UNKNOWN (too little evidence)
```

`v.verifiedRecently` is `true` for `graceSec` after a passed step-up, if your policy allows two
transfers in a row without asking twice. **If the library failed to load, treat every
sensitive action as `UNKNOWN`** - never let the absence of the security script mean "safe".

`assessNow()` does not drain the buffer, train, move the sticky floor or count toward the
block rule. During enrollment it returns `UNKNOWN` - there is nothing to compare against yet.

In backend mode the client-side check above is only for the user experience. The decision
that counts is `guard.check(user, login_id, money=True)` in the route that does the action:
it allows after a fresh `LOW` assessment (the `assessNow()` call is what records it) or a
verification in this login, and answers "verify first" otherwise. Answer 403, step up, and
send the request again - `demo/shop-checkout/plug-behaviorguard.js` does exactly that.

---

## 8. Backend mode details

```html
<script src="/dist/behaviorguard.js"
        data-endpoint="https://risk.yourcompany.com"
        data-pk="pk_your_tenant_key"
        data-token-url="/api/bg-token"
        defer></script>
```

When BehaviorGuard is mounted inside your own app, `data-endpoint="/bg"` and `data-pk` can be
left out.

- **The token** is `b64url(userId).b64url(sessionId).exp.hex(HMAC-SHA256(sk, pk|userId|sessionId|exp))`,
  signed by your backend after a real login. `sessionId` is new on every login: verifications
  belong to it, the profile belongs to the account. Pass it as `data-token`, or let the
  library fetch it from `data-token-url` (or `getToken()` in the config); on a 401 it fetches a
  fresh one and retries once.
- **What is sent** per window: the 34 numbers, the event count, active seconds, the gap before
  the window, whether keystrokes were bypassed, how many inputs were made by a script, the
  integrity result, and the longest absence. Never events, never characters.
- **What the server keeps** per account: the training pool, the verdict state, the rhythm
  template (timings, not letters), and per login the verification time and the last
  assessment.
- **`forget()`** asks for a verification first, then erases the account's profile on the
  server. `forgetMfa()` likewise removes the rhythm template.

Setup, endpoints and the dashboard: [server/README.md](../server/README.md). Residual risks:
[THREAT-MODEL.md](../THREAT-MODEL.md).

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

**Content Security Policy** - the library needs no `unsafe-eval`. In backend mode it
connects to your endpoint (`connect-src`); in local mode it makes no network requests. If you use the built-in step-up prompt or
`data-panel`, they set inline styles, so allow `style-src 'unsafe-inline'` or disable both.

---

## 10. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| Verdict is always `LOW` | Enrollment is not finished. Check `evt.reasons` for the count. |
| No verdicts at all | No `data-endpoint` + token (backend) or `data-user` (local), or fewer than 150 events of evidence yet (`UNKNOWN`/`ABSTAIN`). |
| Every verdict is `UNKNOWN` with `offline: true` | The backend refused or could not be reached: check the token route and the endpoint. |
| `evt.eligible === false` | Window failed the quality gate (<100 events, <5 s, <6 non-zero features, or pasted/autofilled typing), was a replay, or was a graced `MEDIUM`. It is scored but never trains. |
| Step-up never appears | Its template is enrolled during a `LOW` session first; also check `mfa.enabled`. |
| Step-up rejects the real owner | Rhythm drifted (new keyboard, injury). Remove it with `forgetMfa()` (asks for another verification first) and re-enroll. |
| Storage empty in private mode | Expected. The library falls back to memory and does not crash. |
| Owner asked again right after passing your OTP | Backend: your server did not call `report_verified` for this login's session id. Local: you are not calling `reportStepUp({passed:true})`. |
| Too many / too few step-ups | `init({calibration:{k_low}})`. Higher = more permissive; see the README table. |

---

## 11. Verifying your install

```bash
python core/conformance.py           # engine matches the spec           -> 319/319
node   core/lifecycle.test.mjs       # lifecycle and integrator APIs     -> 49/49
node   core/challenge.test.mjs       # step-up layer is fail-closed
python server/test_app.py            # server API, tokens, gate          -> 58/58
python server/test_backend_sdk.py    # the library over HTTP vs a server -> 21/21
python demo/arunika/server.py        # then open http://127.0.0.1:8300
```

If `conformance.py` does not print `319 / 319`, something in `sdk/core/` has been modified
away from the specification - see [../core/SPEC.md](../core/SPEC.md).
