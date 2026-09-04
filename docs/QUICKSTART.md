# Quickstart

Every way to integrate BehaviorGuard, from a single tag to a browser extension, plus the
full configuration surface.

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
  level: 'HIGH',                  // LOW | MEDIUM | HIGH
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
  mfa: { shown: true, verified: true }   // present when a step-up ran
}
```

| `action` | Meaning | Suggested response |
| --- | --- | --- |
| `ALLOW_SESSION` | Looks like the owner | Nothing |
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
sessions 1-10     enrollment. level is always LOW, score 0, no step-up.
                  reasons says: "enrollment 3/10"
session 11        first real verdict
```

A session closes every 30 seconds, when the tab is hidden, and on page unload. So a user
reaches session 11 after roughly five minutes of genuine interaction — not five minutes of
an idle tab, because sessions with fewer than 30 events are discarded.

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

To handle step-up yourself, set `mfa.enabled = false` and act on `REQUIRE_MFA` /
`REQUIRE_STEPUP` in your own flow.

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

  // close a session at a meaningful moment instead of waiting for the timer
  document.querySelector('#checkout').addEventListener('click', async () => {
    const verdict = await bg.endSession();
    if (verdict && verdict.level !== 'LOW') holdOrder(verdict);
  });
</script>
```

Useful methods:

| Method | Purpose |
| --- | --- |
| `bg.init(opts)` | Start. Required before anything else. |
| `bg.endSession()` | Close and score the current session now. Returns the verdict or `null`. |
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

  baseline: 10,                     // enrollment sessions before scoring starts
  retrainEvery: 6,                  // retrain cadence, in owner sessions
  weights: { isolation_forest: 0.30, svm: 0.70 },   // auto-normalized
  thresholds: { low: -0.4, medium: -0.8 },          // overridden by calibration

  mfa: { enabled: true, phrase: '...', rounds: 3,
         triggerOn: ['MEDIUM','HIGH'], cooldownMs: 15000 },

  panel: false,                     // mount the built-in live status panel

  pk: null,                         // hybrid mode: publishable key
  endpoint: null,                   // hybrid mode: your server base URL
};
```

**The defaults are the validated configuration.** Change `weights`, `baseline` or
`retrainEvery` only if you are running your own evaluation — the shipped values come from a
held-out sweep and are the ones the published numbers describe.

`thresholds` is normally not worth setting: bands are recalibrated per user from their own
baseline score distribution, which is strictly better than a global constant.

---

## 7. Browser extension (sites you do not control)

To monitor a third-party site, load `extension/` as an unpacked MV3 extension:

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. **Load unpacked** → select the `extension/` folder
4. Open the target site

`content.js` captures interaction without modifying the page; scoring stays on-device and
the verdict surfaces in the extension badge and popup.

`extension/` is generated from `sdk/` by `tools/sync_core.ps1` and CI fails if the two
diverge — so do not edit `extension/core/*` directly. Edit `sdk/`, then run:

```bash
npm run sync-core     # or: powershell -File tools/sync_core.ps1
```

---

## 8. Hybrid mode (optional, cross-device baselines)

By default a baseline is per-device: a user on a new laptop starts enrollment again. Hybrid
mode stores the account baseline on **your** server so it follows the user — which also
means an attacker on a fresh device is scored against the real owner's baseline immediately.

```html
<script src="/dist/behaviorguard.js"
        data-user="andi@example.com"
        data-pk="pk_your_tenant_key"
        data-endpoint="https://risk.yourcompany.com"
        defer></script>
```

Only 28-float feature vectors are transmitted. Raw events never are.

> **Read [THREAT-MODEL.md](../THREAT-MODEL.md) §4.7 before enabling this.** The publishable
> key is visible in your page source. Your server **must** authenticate the user
> independently — with a session cookie or bearer token tied to the real account — and must
> never treat that key as authorization. The bundled `server/` is a demo reference, not a
> hardened service.

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
| No verdicts at all | `data-user` missing, or fewer than 30 events per session. |
| `evt.eligible === false` | Session failed the quality gate (<100 events, <5 s, <6 non-zero features). It is scored but never trains. |
| Step-up never appears | Its template is enrolled during a `LOW` session first; also check `mfa.enabled`. |
| Step-up rejects the real owner | Rhythm drifted (new keyboard, injury). Clear the template with `bg.clear()` and re-enroll. |
| Storage empty in private mode | Expected. The library falls back to memory and does not crash. |
| Extension not capturing | Check `host_permissions` in `manifest.json`, then reload the extension. |
| Too many / too few `HIGH` verdicts | Tune `k_low` in `sdk/core/config.js`. Higher = more permissive. |

---

## 11. Verifying your install

```bash
python core/conformance.py       # engine matches the spec        -> 227/227
node   core/challenge.test.mjs   # step-up layer is fail-closed   -> 20/20
python -m http.server 8080       # then open /demo/pemantau/
```

If `conformance.py` does not print `227 / 227`, something in `sdk/core/` has been modified
away from the specification — see [../core/SPEC.md](../core/SPEC.md).
