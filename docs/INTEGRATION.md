# Add BehaviorGuard to your site

For sites that **already have a login** and want to protect sensitive actions (checkout,
transfer, change email) without rewriting existing code. Working example:
[`demo/toko-checkout/`](../demo/toko-checkout/).

> Versi bahasa Indonesia: [INTEGRATION.id.md](INTEGRATION.id.md)

## Map: three places to touch

| # | Where | File | What you add | Why there |
|---|---|---|---|---|
| 1 | BehaviorGuard server | separate process | `python server/app.py` + create a tenant | stores baselines and verdict logs, serves the dashboard |
| 2 | Your backend | the file with your login routes | 2 routes: `/api/bg-token`, `/api/bg-reauth` | only the backend knows who is logged in, and only it may hold `sk` |
| 3 | Your pages | the layout used **after login** | 1 `<script>` tag + `data-checkout` on sensitive buttons | behaviour is captured in the browser |

Your login, checkout and database code **stay as they are**.

```
browser  --(34 feature values + verdict, every 30 s)-->  BG server :5055 --> dashboard
   ^                                                         ^
   | token (after login)                                     | pk + sk (once)
your backend  ------------------------------------------------
```
Raw events (mouse paths, keystrokes) are **never sent**. The score is computed in the
browser; the BG server keeps features and verdicts for the cross-device baseline and the
dashboard.

---

## Step 1 - BehaviorGuard server (once)

```bash
pip install flask
python server/app.py
```

Create a tenant. You get a public `pk` and a secret `sk`; the `sk` is shown only once:

```bash
curl -X POST http://localhost:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"My Shop\"}"
```

Keep both in your **backend** environment (for example `.env`), not in code and never in a
page:

```
BG_PK=pk_xxxxxxxx
BG_SK=sk_xxxxxxxx
BG_ENDPOINT=https://bg.example.com
```

If `sk` leaks into a page, anyone can mint a token for any user. For production, see the
Deploy section in [server/README.md](../server/README.md).

---

## Step 2 - Your backend: two routes

Put them next to your login routes, **after** your session/auth middleware, because they
need to know who is logged in.

| Route | Job | Rules |
|---|---|---|
| `GET /api/bg-token` | mint a BehaviorGuard token for the logged-in user | take `userId` from the **session**, never from the request body. Not logged in: 401. |
| `POST /api/bg-reauth` | re-check the logged-in user's password | checked on the **server** with the same password check your login uses. Rate-limit it. |

`/api/bg-token` response:

```json
{ "enabled": true, "userId": "andi@example.com", "pk": "pk_...", "endpoint": "https://bg.example.com",
  "token": "<token>", "fallback": true }
```

Token = `base64url(userId) "." exp "." hex(HMAC-SHA256(sk, pk|userId|exp))`, valid for one hour.

### Flask (used by the demo)

Copy [`demo/toko-checkout/bg_backend.py`](../demo/toko-checkout/bg_backend.py) next to your
app file and add **one line** after your login routes:

```python
from bg_backend import pasang
pasang(app, current_user=lambda: session.get("user"), verify_password=check_password)
```

`check_password(user, password) -> bool` is the password check you already have.

### Node.js / Express

```js
import crypto from 'node:crypto';
const BG = { pk: process.env.BG_PK, sk: process.env.BG_SK, endpoint: process.env.BG_ENDPOINT };

function bgToken(userId, ttl = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = crypto.createHmac('sha256', BG.sk).update(`${BG.pk}|${userId}|${exp}`).digest('hex');
  return `${Buffer.from(userId).toString('base64url')}.${exp}.${sig}`;
}

// after app.use(session(...)) and your login routes
app.get('/api/bg-token', (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ enabled: false });
  res.json({ enabled: true, userId: user, pk: BG.pk, endpoint: BG.endpoint,
             token: bgToken(user), fallback: true });
});

app.post('/api/bg-reauth', express.json(), async (req, res) => {
  const user = req.session.user;
  if (!user) return res.status(401).json({ ok: false });
  res.json({ ok: await checkPassword(user, req.body.password) });   // your own check
});
```

### PHP (no framework)

`bg-token.php`:

```php
<?php
session_start();                                   // same session as your login
header('Content-Type: application/json');
if (empty($_SESSION['user'])) { http_response_code(401); echo json_encode(['enabled' => false]); exit; }

$pk = getenv('BG_PK'); $sk = getenv('BG_SK'); $user = $_SESSION['user'];
$exp = time() + 3600;
$sig = hash_hmac('sha256', "$pk|$user|$exp", $sk);
$b64 = rtrim(strtr(base64_encode($user), '+/', '-_'), '=');
echo json_encode(['enabled' => true, 'userId' => $user, 'pk' => $pk, 'endpoint' => getenv('BG_ENDPOINT'),
                  'token' => "$b64.$exp.$sig", 'fallback' => true]);
```

`bg-reauth.php`:

```php
<?php
session_start();
header('Content-Type: application/json');
if (empty($_SESSION['user'])) { http_response_code(401); echo json_encode(['ok' => false]); exit; }
$body = json_decode(file_get_contents('php://input'), true);
$hash = getPasswordHash($_SESSION['user']);        // from your database
echo json_encode(['ok' => password_verify($body['password'] ?? '', $hash)]);
```

These are not under `/api/...`, so tell the plug with attributes (see Step 3):
`data-token-url="/bg-token.php" data-reauth-url="/bg-reauth.php"`.

### Laravel

`routes/web.php`:

```php
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;

Route::middleware('auth')->group(function () {
    Route::get('/api/bg-token', function () {
        $pk = env('BG_PK'); $sk = env('BG_SK'); $user = auth()->user()->email;
        $exp = time() + 3600;
        $sig = hash_hmac('sha256', "$pk|$user|$exp", $sk);
        $b64 = rtrim(strtr(base64_encode($user), '+/', '-_'), '=');
        return ['enabled' => true, 'userId' => $user, 'pk' => $pk, 'endpoint' => env('BG_ENDPOINT'),
                'token' => "$b64.$exp.$sig", 'fallback' => true];
    });
    Route::post('/api/bg-reauth', function (Request $r) {
        return ['ok' => Hash::check($r->input('password', ''), auth()->user()->password)];
    })->middleware('throttle:5,1');
});
```

Laravel rejects a POST without a CSRF token. The plug sends it automatically when your
layout has `<meta name="csrf-token" content="{{ csrf_token() }}">` (the Laravel starter kits
include it).

---

## Step 3 - Your pages: one script tag

1. Copy two files into your public assets folder:
   - `dist/behaviorguard.js` (the library)
   - `demo/toko-checkout/plug-behaviorguard.js` (the glue: token, badge, gate, password confirm)
2. Add this tag to the **layout used after login**, right before `</body>`:

```html
<script src="/js/plug-behaviorguard.js" data-lib="/js/behaviorguard.js" defer></script>
```

3. Mark every sensitive button with `data-checkout`:

```html
<button data-checkout>Pay now</button>
<button data-checkout data-bg-reason="changing your email">Save new email</button>
```

**Why after login and not on the login page?** BehaviorGuard learns the **account owner**.
On the login page there is no owner yet, so there is nothing to protect.

Where the tag goes:

| Your site | Put it in |
|---|---|
| Plain HTML | every page after login, before `</body>` |
| PHP | the footer/layout file your member pages `include` |
| Laravel | `resources/views/layouts/app.blade.php`, before `</body>`, inside `@auth ... @endauth` |
| React / Vue (SPA) | `index.html`. Logging in without a page reload is fine: the plug retries after the user interacts and when a guarded button is clicked |

Attributes on the script tag:

| Attribute | Default | Purpose |
|---|---|---|
| `data-token-url` | `/api/bg-token` | token route |
| `data-reauth-url` | `/api/bg-reauth` | password re-check route |
| `data-lib` | `/dist/behaviorguard.js` | library location |
| `data-user` | - | user id when the backend is not plugged in (on-device mode) |
| `data-gate` | `[data-checkout]` | selector for guarded buttons |
| `data-badge` | - | `off` hides the status badge |

Buttons rendered later (React/Vue) are guarded too, because the gate listens for clicks at
the document level.

---

## Step 4 - No MFA on your site yet?

This is the part that trips people up.

**The problem.** BehaviorGuard needs time to learn the owner: 10 windows for the baseline and
20 before the main detector switches on (one window = 30 seconds of use). Until then the
verdict is `UNKNOWN`, and for a sensitive action `UNKNOWN` means **ask for verification**
(fail-closed, on purpose). If your site has no way to verify anyone, a new user **cannot
check out at all** until their profile exists.

**The fix: provide one verification method that your server checks.** Pick one:

| Option | How | Strength | When |
|---|---|---|---|
| A. Re-enter password | `/api/bg-reauth` route (Step 2) | weak: if the password was stolen, the attacker knows it too | cheapest, for getting started or demos |
| B. Email / SMS OTP | backend sends a code and checks it | stronger: the attacker also needs the email account or phone | production, especially anything involving money |
| C. Built-in typing-rhythm check | the user enrolls a phrase once | strong for sessions already recognised | enable once the user's status is LOW risk |

Option A is what the demo ships. For option B, change `/api/bg-reauth` to check an OTP code
instead of a password; the plug only needs its dialog text changed.

For option C, add a button to the account settings page:

```html
<button onclick="BehaviorGuard.openEnrollment()">Turn on typing-rhythm verification</button>
```

Enrollment is only allowed while the session is judged safe
(`BehaviorGuard.status().mfa.canEnroll`). Once enrolled, the built-in verification dialog
appears on its own, and A or B stays available as "use another method".

Rule for every option: the fallback may only return `true` after **your server** has checked
the factor ([THREAT-MODEL.md](../THREAT-MODEL.md) section 4.14).

---

## Step 5 - Check that it works

- [ ] The badge in the bottom-left corner appears and says **mode: backend**.
- [ ] DevTools > Network shows requests to the BG server (`/baseline`, `/log`) carrying
      feature numbers, **not** lists of mouse moves or letters.
- [ ] A new user clicks a sensitive button, a password confirmation appears, a wrong password
      is rejected and the right one goes through.
- [ ] The dashboard at `http://<bg-server>:5055/dashboard` (paste your `sk`) shows that user's
      verdicts.

## Common problems

| Symptom | Cause | Fix |
|---|---|---|
| Badge says `mode: on-device` | `/api/bg-token` returns 404/401, or the BG server is down | check the Step 2 routes and `BG_ENDPOINT` |
| No badge at all | tag placed on a pre-login page, or wrong `data-lib` path | open the Console: the `[plug]` messages say why |
| No password prompt, action is simply held | `/api/bg-token` returns `fallback: false` or no `fallback` | add `/api/bg-reauth` and send `fallback: true` |
| Error 419 in Laravel | missing CSRF token | add `<meta name="csrf-token">` to the layout |
| Every sensitive action asks for verification | still learning (badge shows x/10) | expected; stops once the owner is recognised |

## Limits you need to know

- **The browser gate can be bypassed.** An attacker who opens DevTools or calls
  `/api/checkout` directly never goes through the plug. BehaviorGuard detects and asks for
  verification on the client; it does **not replace** server-side checks. For high-value
  transactions your backend still needs its own rules (amount limits, server-checked OTP).
  See [THREAT-MODEL.md](../THREAT-MODEL.md) section 4.2.
- **The learning period is a gap.** An attacker logging in from a new device with a stolen
  password meets an empty profile. That is why sensitive actions under `UNKNOWN` always ask
  for verification, and why option B (OTP) is much safer than A during this period.
