# Arunika - a realistic site with BehaviorGuard on its backend

A fictional digital bank (account opening, dashboard, transfer, bill payment, history,
security settings) used to show BehaviorGuard in a product-like setting. Not a real
financial service and no real money.

Arunika has **its own backend** (`server.py`, Flask), like a real site: accounts, passwords,
balances and history live on the server. BehaviorGuard runs in **backend mode**: the
browser captures behavior and sends 34 summary numbers per 30-second window; the account's
profile, the verdicts, the typing-rhythm template and the verifications are kept and
decided **on Arunika's server**. That is what makes the account-takeover case work: log in
with the stolen password from another laptop and that laptop is judged against the owner's
profile from its first window.

```bash
pip install flask
python demo/arunika/server.py          # http://127.0.0.1:8300
python demo/arunika/server.py --lan    # also reachable from a second laptop on the same network
```

Data (accounts, keys, behavior profiles) goes to `demo/arunika/.data/`, which is gitignored.
Delete that folder to start from nothing.

## The demo, in order

**It starts at account opening, on purpose.** The interesting moment is a brand-new account
the system knows nothing about, and a profile being built from zero while you watch.

| Step | Page | What happens |
| --- | --- | --- |
| 1 | `signup.html` | Open an account (on the server). Typing the form is already the first evidence. |
| 2 | `start.html` | Onboarding: a progress ring `0/10`, a live evidence counter, what is measured and what never leaves the page, a copy-this-sentence box. Then **set up typing-rhythm verification** (`enrollMfa()`); the template is built and kept on the server. |
| 3 | the rest | Normal banking. Transfers, payments and the password change go through the server-side gate. |
| 4 | a second laptop | Log in to the same account with its password (`--lan`, or a second browser profile). The profile is already there: the phase is *protecting*, not learning. A stranger's behavior is `HIGH`, two in a row end the session, and **the server** logs that login out. The one-time code goes to the owner's phone, which that laptop does not have. |

The sample account (link on the log-in page) has a pre-filled history:
`nadia.putri@example.com` / `arunika123`. Use it on the second laptop.

## How BehaviorGuard is installed

Three places on the server and one file in the browser. No other line of the bank changed.

| Where | What |
| --- | --- |
| `server.py`: `app.register_blueprint(create_blueprint(guard), url_prefix='/bg')` | BehaviorGuard's API, mounted inside the bank's own Flask app. |
| `server.py`: `GET /api/bg-token` | After login, the page gets a short-lived token signed with the secret key, carrying the user id and **this login's** session id. The identity never comes from the page. |
| `server.py`: `gate()` before `/api/transfer`, `/api/pay`, `/api/password` | `guard.check(user, sid, money=True)` (or `always=True` for the password). Not allowed means `403 verify`, and no money moves. A session the verdict ended gets `401` and is logged out. |
| `server.py`: `/api/otp/verify` | The bank checks its own one-time code and tells BehaviorGuard: `guard.report_verified(...)`. The browser cannot do this; it does not have the secret key. |
| `assets/bg-integration.js` | The browser side (~350 lines): `init({ endpoint: '/bg', tokenUrl: '/api/bg-token' })`, verdict handling (log, lock, end the session), `Guard.act()` = `assessNow()`, `stepUp()` when needed, then the request, retrying once if the server says verify. The one-time-code dialog is wired to `mfa.onFallback`. |

**Where the decision is made.** The browser computes the 34 numbers and the bot/integrity
check (it needs raw events, which never leave the page). Scoring, the verdict, the
typing-rhythm match and the permission to move money are on the server. A script in the
page can skip `bg-integration.js` and call `/api/transfer` directly; the server still
answers `403 verify`. `test_server.py` checks exactly that.

## What to look at

| File | Role |
| --- | --- |
| `server.py` | The bank's backend, with BehaviorGuard's three server-side hooks (marked in the header). |
| `assets/app.js`, `*.html` | The site's pages. The account comes from the server (`window.ARUNIKA_ME`). |
| `assets/bg-integration.js` | The browser side of the integration (above). Fails closed if the library does not load. |
| `assets/status.js` | A status card built from `BehaviorGuard.status()` in the site's own words. |
| `assets/demo-panel.js` | **Presenter panel only** (bottom-left). Phase, evidence, verdict gauge, plain-language reasons; simulates a return after 20 minutes away, a replay of the user's own recorded behavior, and a bot. A real site would not load it. |
| `phone.html` | **DEMO**: the account's simulated phone, where the one-time codes arrive. |
| `test_server.py` | 38 checks of the backend: `python demo/arunika/test_server.py`. |

## Demo-only shortcuts (marked `DEMO` in the code)

- The one-time code is "sent" to `phone.html` instead of an SMS. Only the browser that
  created the account holds the phone's key, so a second laptop that logs in with the
  password does not receive the codes.
- *Presentation mode* (on `start.html` and in the panel) uses 60-event windows and a
  15-second clock, so enrollment is about 3x faster. It is kept on the account, so every
  browser opening it uses the same size. The published accuracy numbers were measured at
  150 events per window and do not apply in this mode.
- The panel's *Delete profile* and *Restart the demo* skip the verification that the real
  *Delete behavior profile* button (Security page) requires.
