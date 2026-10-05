# BehaviorGuard - install on any website

What is in `dist/`:

| File | What |
| --- | --- |
| `behaviorguard.js` | **one classic-script file** (every browser module bundled into one). No `type=module`, no sub-files, no absolute paths |
| `behaviorguard.min.js` | the same, smaller (155 KB, 47 KB gzip), proven to give identical verdicts |
| `server/` | the server side, flat: `guard.py`, `engine.py`, `rhythm.py`, `bg_core.py` (Python standard library; Flask for the HTTP layer) |

## Regenerate (after every edit to `sdk/` or `server/`)
```
python tools/bundle.py     # or: npm run bundle
```

## Recommended: backend mode

The page sends 34 numbers per window to **your** server, which keeps the account's profile and
makes the decisions. An attacker logging in from another laptop is judged against the owner's
profile, and your routes decide whether money moves.

**Server (Flask):** copy `dist/server/*.py` next to your app.
```python
from guard import Guard, create_blueprint
guard = Guard('behaviorguard.db', tenant=(BG_PK, BG_SK))          # keys from your environment
app.register_blueprint(create_blueprint(guard), url_prefix='/bg')

@app.get('/api/bg-token')        # after login: this user, this login session
def bg_token():
    return {'token': guard.mint_token(session['user'], session['login_id'], ttl=900)}

# in each sensitive route, before acting:
c = guard.check(session['user'], session['login_id'], money=True)
if not c['allowed']: return {'verify': True, 'reason': c['reason']}, 403
```

**Page:**
```html
<script src="https://your-cdn.example/behaviorguard.min.js" data-endpoint="/bg" data-token-url="/api/bg-token" defer></script>
```

Node, PHP, Laravel (with `python server/app.py` as a service): `docs/INTEGRATION.md`. A one-line
install for Flask plus a plug that handles the "verify, then retry" for you:
`demo/shop-checkout/` (`bg_backend.py`, `plug-behaviorguard.js`).

## Local mode - one tag, no server

The same engine entirely in the browser. Good for a static page or a prototype; it cannot see an
attacker on another device (the profile is in this browser), and every decision is made in a page
the user controls. Pick ONE way:

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

**Backend mode:** your server checks the code and reports it - `guard.report_verified(None, user,
login_id, passed)`, or `POST /v1/report` with the `sk`. Keep the built-in dialog and point its "use
another method" at your OTP dialog with `mfa.onFallback`; the library counts it once the server
confirms your report. A page that only returns `true` changes nothing.

**Local mode:**
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
const v = await BehaviorGuard.assessNow();                 // a Promise in backend mode
const ready = BehaviorGuard.status().model.mainDetector;   // is the main detector on yet?
if (v.level !== 'LOW' || !ready) askForVerification();
```
In backend mode `guard.check(money=True)` on your server applies exactly these rules; the page
check is for the user experience, the server's answer is the one that counts.
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
- **Raw data never leaves the page.** Backend mode sends 34 numbers per window to your server
  (`connect-src` must allow it); local mode keeps everything in IndexedDB -> localStorage -> memory.
