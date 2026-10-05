# BehaviorGuard server (optional)

A small multi-tenant backend for two things: **a baseline that follows the user across devices**
and **a verdict log for the operator dashboard**. It only stores **34 feature numbers per window**
and their verdicts. Raw events and typed characters never reach it.

The library runs fully without this server. The server only comes into play when the site provides
a `pk`, an `endpoint`, **and** a user token.

## Run

```bash
pip install flask
python server/app.py          # http://0.0.0.0:5055
python server/test_app.py     # 35 tests: auth, IDOR, poisoning, XSS, CSP
```

Environment variables: `BG_DB` (SQLite location), `BG_ADMIN_TOKEN` (turns on `GET /tenants`),
`BG_TRUST_PROXY=1` (only behind a proxy that overwrites `X-Forwarded-For`).

## Three keys, three roles

| Key | Where | Unlocks |
|---|---|---|
| `pk_...` (public) | in the page, `data-pk` | **nothing on its own** |
| `sk_...` (secret) | only on your server | the operator dashboard + minting user tokens |
| user token | minted by your server after login, short-lived | the baseline & log of **that account only** |

Token: `b64url(userId) "." exp "." hex(HMAC-SHA256(sk, pk|userId|exp))`, 7 days at most.
The server takes `userId` from the token, never from the request body.

## Flow

1. **Create a tenant** (sk is shown only once):
   ```bash
   curl -X POST http://localhost:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"Andi's Shop\"}"
   ```
2. **Mint a token** in your backend after the user logs in. Node:
   ```js
   import crypto from 'node:crypto';
   function bgToken(pk, sk, userId, ttlSec = 3600) {
     const exp = Math.floor(Date.now() / 1000) + ttlSec;
     const sig = crypto.createHmac('sha256', sk).update(`${pk}|${userId}|${exp}`).digest('hex');
     return `${Buffer.from(userId).toString('base64url')}.${exp}.${sig}`;
   }
   ```
   Local test: `python server/app.py mint <pk> <sk> <userId> [ttl_seconds]`.
   More backends (Flask, PHP, Laravel): [docs/INTEGRATION.md](../docs/INTEGRATION.md).
3. **Install on the page**:
   ```html
   <script src="/dist/behaviorguard.js" data-user="andi@example.com"
           data-pk="pk_xxx" data-endpoint="https://bg.example.com" data-user-token="<token>"></script>
   ```
   Token expired? Refresh it with `BehaviorGuard.setUserToken(newToken)`.
4. **Dashboard**: open `http://localhost:5055/dashboard`, paste the `sk`. The key is kept in that
   tab's sessionStorage only and sent in a header, never in the URL.

## Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/tenant` | - | create a tenant -> `{pk, sk}` |
| GET | `/baseline` | `pk` + token | the token owner's baseline |
| POST | `/baseline` `{vectors}` | `pk` + token | store a baseline (NaN/inf dropped, max 100 x 40) |
| POST | `/log` `{level, score, ...}` | `pk` + token | record a verdict (filtered, see below) |
| GET | `/api/dashboard` | `sk` | this tenant's dashboard data |
| GET | `/api/account?u=` | `sk` | one account's details |
| GET | `/tenants` | `BG_ADMIN_TOKEN` | list tenants (off without the env var) |
| GET | `/dashboard` | - | static page; nonce-based CSP |

## What is protected (and why)

- **A leaked `pk` is normal** - it is in every page. It used to be enough on its own to read and
  **overwrite** any account's behaviour template (making the attacker the "owner"). Now no account
  operation works without a token (C-39).
- **Log contents are sent by the client.** The dashboard escapes every value and is served with a
  nonce-based CSP; the server also limits their shape: allow-listed levels, action `A-Z_`, reasons
  6 x 160 characters, feature names `a-z0-9_`, implausible client clocks replaced by the server
  clock (C-41).
- **An already enrolled device never accepts a baseline from the server.** Only new devices adopt
  it.

Residual risk: anyone holding a user's valid token can write that user's server baseline, and the
user's NEW devices will adopt it. Mint short-lived tokens, only after an authentication you trust.
There is no rate limit on `/tenant` yet; CORS `*` is deliberate (the SDK runs on any origin). This
is a reference implementation (Flask + SQLite), not a hardened service. See THREAT-MODEL.md §4.7.

## Deploy

Behind nginx + gunicorn: `gunicorn -w 2 -b 127.0.0.1:5055 app:app` (call `init_db()` once), set
`BG_TRUST_PROXY=1`, keep `BG_DB` on a persistent volume or switch to Postgres.
