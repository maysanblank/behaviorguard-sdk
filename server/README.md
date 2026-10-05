# BehaviorGuard server

Where BehaviorGuard's decisions are made in **backend mode** (the recommended deployment).
The browser library sends **34 feature numbers per 30-second window**; this side keeps each
account's profile and model, scores, decides, keeps the typing-rhythm template and checks
it, records verifications, and answers your routes' question *"may this session do this
now?"*. Raw events and typed characters never reach it.

| File | What |
|---|---|
| `guard.py` | `Guard`: storage (SQLite), tenants and keys, user tokens, the browser API (`create_blueprint`), the server-side gate `check()`, `report_verified()`, `forget()` |
| `engine.py` | The decision engine: enrollment, training pool, scoring, verdicts, sticky floor, run rule, replay, away/re-verify, step-up grace. A port of the library's own orchestration on top of `core/bg_core.py` |
| `rhythm.py` | The typing-rhythm template and its check (port of `sdk/core/challenge.js`) |
| `app.py` | A standalone service around the same `Guard`, for stacks that are not Flask, plus the operator dashboard |
| `test_app.py`, `test_parity.py`, `test_rhythm.py`, `test_backend_sdk.py` | The tests (below) |

A flat copy of `guard.py`, `engine.py`, `rhythm.py` and `bg_core.py` is written to
`dist/server/` by `python tools/bundle.py`.

## Is the server engine the same as the library?

Yes, and that is tested rather than assumed:

- `python server/test_parity.py` drives the JavaScript library (in local mode) and
  `engine.py` with the same 67 windows - enrollment, ineligible windows, the detector gate
  reopening, retraining, a block, a verification, a replay, the step-up grace and the
  away/re-verify rule - and requires the same level, action, score, thresholds and model on
  every one.
- `python server/test_rhythm.py` runs 40 rhythm samples through `rhythm.py` and
  `challenge.js`: identical answers (owner passes 36, another person 0).
- `core/bg_core.py` itself passes the 319 golden checks (`python core/conformance.py`).

So the accuracy measured on the library ([README](../README.md#results)) holds for the server.

## Two ways to run it

**Inside your Flask app** (one process, the demos do this):

```python
from guard import Guard, create_blueprint
guard = Guard('behaviorguard.db', tenant=(BG_PK, BG_SK))
app.register_blueprint(create_blueprint(guard), url_prefix='/bg')
```

**As a service** (any stack: Node, PHP, Laravel, Go):

```bash
pip install flask
python server/app.py                  # http://127.0.0.1:5055  (BG_HOST, BG_PORT to change)
curl -X POST http://127.0.0.1:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"My Shop\"}"
```

`/tenant` returns `{pk, sk}`; the `sk` is shown once. Keep both in your backend's
environment. Set `BG_TENANT_SIGNUP=0` once your tenants exist. Other variables: `BG_DB`
(SQLite location), `BG_ADMIN_TOKEN` (turns on `GET /tenants`), `BG_ALLOWED_ORIGIN` (CORS,
default `*`; auth is a header token, never a cookie), `BG_TRUST_PROXY=1` (only behind a proxy
that overwrites `X-Forwarded-For`).

## Keys and tokens

| Key | Where | Unlocks |
|---|---|---|
| `pk_...` (public) | in the page (`data-pk`; optional when embedded) | **nothing on its own** |
| `sk_...` (secret) | only on your server | minting user tokens, reporting verifications, the operator dashboard |
| user token | minted by your backend after login, short-lived | that account, in **that login session** only |

```
token = b64url(userId) "." b64url(sessionId) "." exp "." hex(HMAC-SHA256(sk, pk|userId|sessionId|exp))
```

`sessionId` is your login session's id - a new value on every login. Verifications and the
step-up grace belong to it, so an attacker's login on another device never inherits the
owner's. The profile belongs to the account, so it is there for every login. The server
takes the user and the session from the token, never from a request body. Tokens live at
most 7 days; 15 minutes is a good value, and the library refreshes through `tokenUrl` or
`getToken` when the server answers 401.

`guard.mint_token(user, sid, ttl)` does it in Python; other languages:
[docs/INTEGRATION.md](../docs/INTEGRATION.md). For a local test:
`python server/app.py mint <pk> <sk> <userId> <sessionId> [ttl]`.

## What your routes call

| Call | When |
|---|---|
| `guard.check(user, sid, money=True)` | before moving money. Allowed after a fresh `LOW` assessment (with the main detector on) or a verification in this login; otherwise `{'allowed': False, 'reason': ...}` -> answer 403 and let the page step up |
| `guard.check(user, sid, always=True)` | password, recovery email, new payee: always needs a verification in the last 2 minutes |
| `guard.blocked(user, sid)` | the verdict ended this login: log it out |
| `guard.report_verified(pk, user, sid, passed)` | your own factor (OTP, WebAuthn, password) was checked by you. The only way a non-rhythm verification counts |
| `guard.forget(pk, user, require_verified=False)` | the account was deleted |

`check()` fails closed: no assessment in the last 90 seconds means `UNKNOWN`, which needs a
verification. The page's `assessNow()` is what records a fresh one.

**Stricter enrollment (optional).** By default a brand-new account learns from its first
logged-in windows, whoever is logged in. If a password can be stolen before the owner has
used the account, let it learn only from logins that passed a verification (an OTP at
sign-up, for example):

```python
import engine
guard = Guard(db_path, tenant=(pk, sk), cfg={**engine.CFG, 'enrollRequiresVerified': True})
```

Until that login verifies, its windows are not added to the profile and the verdict says
`enrollment waits for a verification in this login`. Off by default, so the server engine
still takes the same decisions as the browser library.

## Endpoints

Browser (headers `Authorization: Bearer <pk>` and `X-BG-User-Token: <token>`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/v1/assess` | one window `{vector, events, activeSec, gapBeforeMs, keystrokeBypassed, synthetic, integrity, away}` -> `{verdict, status}` |
| POST | `/v1/probe` | `assessNow()`: a verdict now, no training, kept for `check()` |
| GET | `/v1/session` | status for the page (phase, enrollment, model, risk, verification grace) |
| POST | `/v1/rhythm/verify` | a rhythm sample (key hold and gap times, no characters) |
| POST | `/v1/rhythm/enroll` | set up the template (only in a trusted, `LOW` session; never overwrites one) |
| DELETE | `/v1/rhythm`, `/v1/profile` | remove the template / erase the profile (both need a verification in the last 2 minutes) |

Server to server (`Authorization: Bearer <sk>`): `POST /v1/report {userId, sessionId, passed}`.

Service only (`app.py`): `POST /tenant`, `GET /api/dashboard` and `GET /api/account?u=` (sk),
`GET /tenants` (`BG_ADMIN_TOKEN`), `GET /dashboard` (static page, nonce CSP; paste the sk,
kept in that tab's sessionStorage only).

## What is protected (and why)

- **A leaked `pk` is normal** - it is in every page. Nothing works without a user token
  signed with the `sk` (C-39).
- **The browser cannot vouch for itself.** A page that says "verified" changes nothing; a
  verification counts when the rhythm check passed here, or when your backend reported it
  with the `sk`. `report_verified` also refuses an account the server has never seen.
- **Input is shaped before it reaches the engine.** Vectors must be 34 finite numbers,
  counts and times are clamped, reasons and feature names are length-limited, the dashboard
  escapes everything under a nonce CSP (C-41). Windows are rate-limited per login (12 a
  minute by default), probes and rhythm attempts too.
- **Erasing needs a fresh verification**, so an attacker in a session cannot wipe the owner's
  profile and be learned instead.

Residual risk: whoever holds a valid user token can send windows as that login. The token
proves who logged in, not who is at the keyboard - which is the point of the behavior check,
and why the training pool only takes `LOW` or verified windows. This is a reference
implementation (Flask + SQLite, a per-account lock), not a hardened service; see
[THREAT-MODEL.md](../THREAT-MODEL.md).

## Tests

```bash
python server/test_app.py            # 61: tokens, sessions, gate, report, IDOR, XSS, CSP, rate limits
python server/test_parity.py         # engine.py == the JS library, 67 windows   (needs node; NODE=path)
python server/test_rhythm.py         # rhythm.py == challenge.js, 40 cases       (needs node)
python server/test_backend_sdk.py    # the library over HTTP against app.py, 21  (needs node)
```

## Deploy

Behind nginx + gunicorn, for example `gunicorn -w 2 -b 127.0.0.1:5055 "app:create_app()"`.
Set `BG_TRUST_PROXY=1`, keep `BG_DB` on a persistent volume. With more than one worker the
SQLite file is shared and per-account work is serialised by a lock per process plus SQLite's
own locking; for heavy traffic, move the two tables to Postgres.
