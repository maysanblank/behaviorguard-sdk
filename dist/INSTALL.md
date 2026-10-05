# BehaviorGuard - install on any website (1 tag)

`dist/behaviorguard.js` = **one classic-script file** (every module bundled into one).
No `type=module`, no sub-files, no absolute paths. Host it anywhere (CDN, GitHub Pages, your site's
folder), add one `<script>`. Done.

## Regenerate the bundle (after every edit to `sdk/`)
```
python tools/bundle.py     # or: npm run bundle
```

## How to install - pick ONE

### 1. Simplest: data attribute + DOM event
```html
<script src="https://your-cdn.example/behaviorguard.js" data-user="andi@example.com" defer></script>
<script>
  addEventListener('behaviorguard:risk', e => {
    // e.detail = {level, score, action, reasons, topFeatures, ...}
    if (e.detail.level === 'HIGH') holdTransaction();
  });
</script>
```

### 2. Named callback
```html
<script src="https://your-cdn.example/behaviorguard.js" data-user="andi@example.com" data-callback="onRisk" defer></script>
<script>function onRisk(e){ if(e.level==='HIGH') holdTransaction(); }</script>
```

### 3. Config object (put it BEFORE the tag)
```html
<script>window.BehaviorGuardConfig = { userId:"andi@example.com", onRisk:e=>{ /* ... */ } };</script>
<script src="https://your-cdn.example/behaviorguard.js" defer></script>
```

Everything is automatic: mouse/keyboard/scroll/navigation capture, an assessment every 30 seconds
(the verdict falls once 150 events have been collected), saving the evidence tail when the page
changes, and the built-in typing-rhythm verification popup. Typed characters are never stored.

## Have your own OTP / WebAuthn?
```html
<script>window.BehaviorGuardConfig = { userId:"andi@example.com", mfa:{ enabled:false } };</script>
<script src="https://your-cdn.example/behaviorguard.js" defer></script>
<script>
  addEventListener('behaviorguard:risk', async e => {
    if (e.detail.action === 'REQUIRE_MFA' || e.detail.action === 'REQUIRE_STEPUP') {
      const passed = await runMyOtp();                  // verified on YOUR server
      BehaviorGuard.reportStepUp({ passed });           // REQUIRED: without it the owner can get blocked
    }
  });
</script>
```
After the owner passes, a MEDIUM verdict does not ask again for 15 minutes (HIGH still does).

## Before a sensitive action (change email/password, transfer, add a device)
```js
const v = BehaviorGuard.assessNow();
const ready = BehaviorGuard.status().model.mainDetector;   // is the main detector on yet?
if (v.level !== 'LOW' || !ready) askForVerification();
```
- `UNKNOWN` = no baseline yet / not enough evidence on this page yet. **Verify, whatever the
  amount.** An amount limit ("only >= Rp 1 million") is not a safeguard: an intruder just splits the
  transfer.
- `LOW` before `mainDetector` is on (training pool < 20 pieces of evidence) comes from Isolation
  Forest alone. Do not treat it as permission to move money.
- `v.verifiedRecently` = the owner just passed verification (15 minutes): you may skip asking again.

## "Recognising this device" card (optional, built into the library)
Show the user how far the site has got in recognising them: a progress ring, two stages (baseline
profile 10 -> main detector 20), an event counter, typing practice, and a button to set up
typing-rhythm verification. Not a single line of CSS/HTML from the site.
```js
// inside a page (e.g. a "Get started" or "Security" page)
const card = BehaviorGuard.mountEnrollment('#enrollment', { brand: 'My Shop' });
// ... card.destroy() when the SPA route changes

// or as a dialog, from any button
button.onclick = () => BehaviorGuard.openEnrollment();
```
Options: `lang` (`en`/`id`; default: the page `lang`, then the browser language, then English), `theme` (`auto`/`light`/`dark`), `accent`, `brand`, `practice:false`
(no typing practice), `mfaSetup:false` (no typing-rhythm card), `sentences:[...]`, `texts:{...}`
(override texts), `onComplete(status)` (once, when the main detector switches on). Colour/brand/theme
are taken from `mfa` when not given. The floating `data-panel` now has a **see details** button that
opens this card.

## Advanced tuning (optional)
```js
window.BehaviorGuardConfig = {
  userId: "andi@example.com",
  calibration: { k_low: 1.75 },   // smaller = stricter (table in the README)
  mfa: { enabled: true, phrase: "your site's phrase", graceSec: 900 },
};
```

## Deployment notes
- **MIME / cross-origin:** a plain classic script; no special CORS needed.
- **CSP:** allow the host origin in `script-src`; the built-in popup and `data-panel` use inline
  styles (`style-src 'unsafe-inline'`), or turn both off.
- **Raw data never leaves the device** (IndexedDB -> localStorage -> memory).

---

## Server mode (optional) - cross-device baseline

Without a server, the baseline only exists on that device: an attacker on their own laptop starts
from zero and has nothing to be compared against. With a server, a NEW device pulls the account's
baseline from the server, so the attacker is compared with the real owner right away.

```html
<script src="https://your-cdn.example/behaviorguard.js"
        data-user="andi@example.com"
        data-pk="pk_xxx"
        data-endpoint="https://bg.example.com"
        data-user-token="<minted by your backend after login>" defer></script>
```

`pk` is public and **opens nothing on its own**. A user token
(`HMAC-SHA256(sk, pk|userId|exp)`, short-lived) is required, minted by your server with an `sk` that
never enters the page. Without a token, the library runs purely on the device.

**What leaves the device:** 34 feature numbers per window + the verdict. Raw events and typed
characters are never sent. Server setup, a token-minting example (Node) and the dashboard:
`server/README.md`. Step-by-step for Flask, Express, PHP and Laravel: `docs/INTEGRATION.md`.
