# Add BehaviorGuard to your site

For sites that **already have a login** and want to protect sensitive actions (checkout,
transfer, change email) without rewriting existing code. Working examples:
[`demo/shop-checkout/`](../demo/shop-checkout/) (the smallest) and
[`demo/arunika/`](../demo/arunika/) (a full bank).

> Versi bahasa Indonesia: [INTEGRATION.id.md](INTEGRATION.id.md)

## Map: three places to touch

| # | Where | What you add | Why there |
|---|---|---|---|
| 1 | BehaviorGuard's server | Flask: mount it inside your app. Other stacks: run `server/app.py` | it keeps every account's profile and makes the decisions |
| 2 | Your backend | a token route, a check before each sensitive route, a report after your own OTP | only your backend knows who logged in, and only it may hold the `sk` |
| 3 | Your pages | one `<script>` tag in the layout used after login | behavior is captured in the browser |

Your login, checkout and database code **stay as they are**.

```
browser --(34 numbers per 30-s window, token)-->  BehaviorGuard server  (profile, verdicts)
   ^                                                   ^        |
   | token route (after login)                         | sk     | check / report (sk)
your backend ------------------------------------------+--------+
   before /api/checkout: "may this login do this now?"  ->  allowed, or 403 verify
```

Raw events (mouse paths, keystrokes) are **never sent**. Scoring, verdicts, the
typing-rhythm check and the permission for a sensitive action are on the server.

---

## Step 1 - BehaviorGuard's server

**Flask:** nothing to run. Copy `server/guard.py`, `server/engine.py`, `server/rhythm.py` and
`core/bg_core.py` (or the flat copy in `dist/server/`) next to your app, and mount it:

```python
from guard import Guard, create_blueprint
guard = Guard(os.environ.get('BG_DB', 'behaviorguard.db'), tenant=(os.environ['BG_PK'], os.environ['BG_SK']))
app.register_blueprint(create_blueprint(guard), url_prefix='/bg')
```

Make the keys once: `python -c "import secrets; print('pk_' + secrets.token_hex(12)); print('sk_' + secrets.token_hex(24))"`.

**Any other stack:** run the service and create a tenant. The `sk` is shown only once:

```bash
pip install flask
python server/app.py          # http://127.0.0.1:5055
curl -X POST http://127.0.0.1:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"My Shop\"}"
```

Either way keep the keys in your **backend** environment, never in a page:

```
BG_PK=pk_xxxxxxxx
BG_SK=sk_xxxxxxxx
BG_URL=https://bg.example.com      # the service's address (not needed when embedded)
```

If the `sk` leaks into a page, anyone can mint a token for any user. Deploy notes:
[server/README.md](../server/README.md).

---

## Step 2 - Your backend

Three things, all next to your login routes (after your session middleware):

| What | Rule |
|---|---|
| `GET /api/bg-token` | a token for the logged-in user **and this login session**. Take the user from the session, never from the request. Not logged in: 401. |
| a check before each sensitive route | ask BehaviorGuard "may this login do this now?". Not allowed: answer **403** with `{"verify": true}` (the page verifies and sends the request again). Session ended: **401**, log the user out. |
| a report after your own factor | when *your* server checked an OTP, a WebAuthn assertion or a re-typed password, tell BehaviorGuard. That is the only way such a verification counts. |

The token is four parts, signed with the `sk`:

```
b64url(userId) "." b64url(sessionId) "." exp "." hex(HMAC-SHA256(sk, pk|userId|sessionId|exp))
```

`sessionId` is any id that is **new on every login** (your session id, or a random value you
store in the session at login). Verifications belong to it, so an attacker's login never
inherits the owner's. 15 minutes is a good lifetime; the library fetches a new token from
your route when the old one expires.

### Flask (embedded)

```python
@app.get('/api/bg-token')
def bg_token():
    if 'user' not in session: return {'error': 'not logged in'}, 401
    session.setdefault('login_id', secrets.token_hex(16))      # or set it in your login route
    return {'token': guard.mint_token(session['user'], session['login_id'], ttl=900)}

@app.post('/api/checkout')
def checkout():
    user, sid = session['user'], session['login_id']
    if guard.blocked(user, sid):
        session.clear(); return {'ended': True}, 401
    c = guard.check(user, sid, money=True)                     # always=True for password/email changes
    if not c['allowed']: return {'verify': True, 'level': c['level'], 'reason': c['reason']}, 403
    ...                                                        # your existing code

@app.post('/api/otp/verify')
def otp_verify():
    ok = my_otp_check(session['user'], request.json['code'])   # your own check
    guard.report_verified(None, session['user'], session['login_id'], ok)
    return {'ok': ok}
```

Or take [`demo/shop-checkout/bg_backend.py`](../demo/shop-checkout/bg_backend.py), which does
all of this from one line after your routes:

```python
from bg_backend import install
install(app, current_user=lambda: session.get("user"),
        send_code=lambda user, code: send_email(user, "Your verification code", code), protect=["/api/checkout"])
```

### Node.js / Express (with the service)

```js
import crypto from 'node:crypto';
const { BG_PK, BG_SK, BG_URL } = process.env;
const b64u = s => Buffer.from(s).toString('base64url');

function bgToken(userId, sessionId, ttl = 900) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = crypto.createHmac('sha256', BG_SK).update(`${BG_PK}|${userId}|${sessionId}|${exp}`).digest('hex');
  return `${b64u(userId)}.${b64u(sessionId)}.${exp}.${sig}`;
}
const bg = (path, body) => fetch(BG_URL + path, { method: 'POST', body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + BG_SK } }).then(r => r.json());

app.get('/api/bg-token', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'not logged in' });
  res.json({ token: bgToken(req.session.user, req.session.id), endpoint: BG_URL, pk: BG_PK });
});

// before each sensitive route
async function behaviorGate(req, res, next) {
  const c = await bg('/v1/check', { userId: req.session.user, sessionId: req.session.id, money: true });
  if (c.ended) { req.session.destroy(() => {}); return res.status(401).json({ ended: true }); }
  if (!c.allowed) return res.status(403).json({ verify: true, level: c.level, reason: c.reason });
  next();
}
app.post('/api/checkout', behaviorGate, checkoutHandler);

// after your own OTP check
await bg('/v1/report', { userId: req.session.user, sessionId: req.session.id, passed: ok });
```

### PHP (no framework, with the service)

```php
<?php
function bg_b64u($s) { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }
function bg_token($user, $sid, $ttl = 900) {
    $pk = getenv('BG_PK'); $sk = getenv('BG_SK'); $exp = time() + $ttl;
    $sig = hash_hmac('sha256', "$pk|$user|$sid|$exp", $sk);
    return bg_b64u($user) . '.' . bg_b64u($sid) . ".$exp.$sig";
}
function bg_call($path, $body) {
    $ctx = stream_context_create(['http' => ['method' => 'POST', 'content' => json_encode($body),
        'header' => "Content-Type: application/json\r\nAuthorization: Bearer " . getenv('BG_SK')]]);
    return json_decode(file_get_contents(getenv('BG_URL') . $path, false, $ctx), true);
}
```

`bg-token.php`:

```php
<?php
session_start(); require 'bg.php'; header('Content-Type: application/json');
if (empty($_SESSION['user'])) { http_response_code(401); exit('{}'); }
echo json_encode(['token' => bg_token($_SESSION['user'], session_id()),
                  'endpoint' => getenv('BG_URL'), 'pk' => getenv('BG_PK')]);
```

At the top of `checkout.php` (and every sensitive endpoint):

```php
$c = bg_call('/v1/check', ['userId' => $_SESSION['user'], 'sessionId' => session_id(), 'money' => true]);
if (!empty($c['ended'])) { session_destroy(); http_response_code(401); exit(json_encode(['ended' => true])); }
if (empty($c['allowed'])) { http_response_code(403); exit(json_encode(['verify' => true, 'reason' => $c['reason']])); }
```

Call `session_regenerate_id(true)` in your login, so every login gets a new session id.

### Laravel (with the service)

`routes/web.php`:

```php
use Illuminate\Support\Facades\Http;

Route::middleware('auth')->group(function () {
    Route::get('/api/bg-token', function () {
        $pk = env('BG_PK'); $sk = env('BG_SK'); $user = auth()->user()->email; $sid = session()->getId();
        $exp = time() + 900; $b64 = fn ($s) => rtrim(strtr(base64_encode($s), '+/', '-_'), '=');
        $sig = hash_hmac('sha256', "$pk|$user|$sid|$exp", $sk);
        return ['token' => $b64($user) . '.' . $b64($sid) . ".$exp.$sig", 'endpoint' => env('BG_URL'), 'pk' => $pk];
    });
    Route::post('/api/checkout', [CheckoutController::class, 'store'])->middleware('behavior');
});
```

`app/Http/Middleware/BehaviorGate.php` (register it as `behavior`):

```php
public function handle($request, Closure $next) {
    $c = Http::withToken(env('BG_SK'))->post(env('BG_URL') . '/v1/check',
        ['userId' => auth()->user()->email, 'sessionId' => session()->getId(), 'money' => true])->json();
    if (!empty($c['ended'])) { auth()->logout(); return response()->json(['ended' => true], 401); }
    if (empty($c['allowed'])) return response()->json(['verify' => true, 'reason' => $c['reason']], 403);
    return $next($request);
}
```

Laravel regenerates the session id on login already. It rejects a POST without a CSRF token;
the plug (Step 3) sends it when the layout has `<meta name="csrf-token" content="{{ csrf_token() }}">`.

---

## Step 3 - Your pages: one script tag

**Simplest**, if your sensitive buttons already go through your own JavaScript:

```html
<script src="/js/behaviorguard.min.js" data-endpoint="/bg" data-token-url="/api/bg-token" defer></script>
```

(With the service, `data-endpoint` is its address and `data-pk` your public key; the token
route can also return them.) Then, before your `fetch('/api/checkout', ...)`, call
`await BehaviorGuard.assessNow()` so the server has a fresh assessment, and when the answer
is 403 `verify`, call `await BehaviorGuard.stepUp()` and send the request again.

**Or the plug, which does that for you** without touching your code:

1. Copy `dist/behaviorguard.js` and `demo/shop-checkout/plug-behaviorguard.js` into your public
   assets.
2. Add to the **layout used after login**, before `</body>`:

```html
<script src="/js/plug-behaviorguard.js" data-lib="/js/behaviorguard.js" defer></script>
```

3. Mark sensitive buttons with `data-checkout`:

```html
<button data-checkout>Pay now</button>
```

The plug fetches the token, starts the library in backend mode, takes a fresh assessment when
a guarded button is clicked, and when your server answers 403 `verify` it shows the
verification and sends the same request again (401 `ended` logs the user out). Buttons
rendered later (React/Vue) are covered too, because it listens at the document level.

| Attribute | Default | Purpose |
|---|---|---|
| `data-token-url` | `/api/bg-token` | token route |
| `data-code-url` | `/api/bg-code` | emailed-code routes (fallback; `/verify` appended) |
| `data-reauth-url` | `/api/bg-reauth` | password re-check route (weaker fallback) |
| `data-lib` | `/dist/behaviorguard.js` | library location |
| `data-gate` | `[data-checkout]` | selector for guarded buttons |
| `data-badge` | - | `off` hides the status badge |
| `data-rhythm` | - | `on` also offers typing-rhythm verification |

**Why after login and not on the login page?** BehaviorGuard learns the **account owner**.
On the login page there is no owner yet.

---

## Step 4 - No MFA on your site yet?

**The problem.** A new account has no profile: 10 windows for the baseline and 20 before the
main detector switches on (one window = 30 seconds of use). Until then the server's answer
for a money action is "verify first" (fail closed, on purpose). If your site has no way to
verify anyone, a new user cannot check out until the profile exists.

**The fix: one verification method that your server checks**, reported with
`report_verified` (or `POST /v1/report`):

| Option | How | Strength | When |
|---|---|---|---|
| A. Re-enter password | `install(..., verify_password=)` (`/api/bg-reauth`) | weak: if the password was stolen, the attacker knows it too | trying it out only |
| B. Email / SMS code | `install(..., send_code=)` (`/api/bg-code`), or your own OTP route | stronger: the attacker also needs the mailbox or phone | production, anything with money (the demo uses this) |
| C. Built-in typing-rhythm check | the user enrolls a phrase once; the server keeps the template and checks it | strong for an enrolled owner | once the user is recognised |

For option C add a button to the account settings page:

```html
<button onclick="BehaviorGuard.openEnrollment()">Turn on typing-rhythm verification</button>
```

Enrollment is only allowed while the session is trusted (`BehaviorGuard.status().mfa.canEnroll`).
After that the built-in dialog appears on its own, with A or B as "use another method".

---

## Step 5 - Check that it works

- [ ] DevTools > Network: requests to `/bg/v1/assess` carry a `vector` of 34 numbers and
      counts, **not** lists of mouse moves or letters.
- [ ] `BehaviorGuard.status().mode` is `"backend"`.
- [ ] A new user's sensitive action gets 403 from your route, the verification appears, and
      after it the same request goes through.
- [ ] Log in to the same account from a **second browser**: `status().phase` is `protecting`
      at once (the profile is on the server), and that login does not share the first one's
      verification.
- [ ] Call your protected route with `curl` and a valid session cookie but no assessment:
      403.

## Common problems

| Symptom | Cause | Fix |
|---|---|---|
| `status().mode` is `local` | no `data-endpoint`, or no token/token route | check Step 3 and that `/api/bg-token` answers when logged in |
| Every request to `/bg` is 401 | token signed with the wrong key, wrong `pk`, or the four parts in another order | compare with `python server/app.py mint <pk> <sk> <user> <sid>` |
| Every sensitive action asks to verify | still learning (`status().enrollment`), or the page never calls `assessNow()` before the request | expected while learning; otherwise add the assessment (the plug does it) |
| A verification passes but the retry is still 403 | your OTP route did not call `report_verified` for **this** login's session id | report with the same session id you put in the token |
| Error 419 in Laravel | missing CSRF token | add `<meta name="csrf-token">` to the layout |

## Limits you need to know

- **The learning period.** A brand-new account has nothing to compare against, so the
  server asks for verification; option B (OTP) is much safer than A during this period.
- **Forged measurements.** Someone who fully controls a browser can send made-up feature
  vectors. They still have to look like the owner to the model on every window, which is
  the targeted-mimicry problem in [THREAT-MODEL.md](../THREAT-MODEL.md). Keep your own
  server-side rules for high-value actions (limits, OTP for new payees).
