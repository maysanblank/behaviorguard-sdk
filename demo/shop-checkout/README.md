# Demo: install BehaviorGuard into a plain checkout store

A **plain** store: a real online shop with only **log-in + checkout**, its **own backend**,
and **no MFA or session protection** of any kind. BehaviorGuard is installed with **one line
in the backend and one line in the page**. The store's log-in and checkout code is not
touched.

![BehaviorGuard installed into a plain store](../../assets/demo.gif)

Integrating with your own site (Flask, Node, PHP, Laravel)? See
[docs/INTEGRATION.md](../../docs/INTEGRATION.md).

## Files

| File | What | Touched when installing? |
|---|---|---|
| `shop.py` | The store's backend (Flask): log-in, checkout, orders | 1 line near the bottom (remove the `#`) |
| `index.html` | The store's page | 1 line (the `INSTALL BEHAVIORGUARD HERE` comment) |
| `bg_backend.py` | BehaviorGuard's backend part: mounts its API at `/bg`, the token route, the emailed-code fallback, and the gate in front of the protected routes | no, just imported |
| `plug-behaviorguard.js` | The page part: loads the library, a fresh assessment before guarded buttons, "verify, then retry" when the server says so, a status badge | no, just referenced |
| `inbox.html` | **DEMO** stand-in for the owner's email (the store's `send_email` delivers here) | no |
| `test_install.py` | Checks the store before and after the install line | no |

## Architecture

```
browser (captures mouse / keys / scroll)
   |  34 numbers per 30-s window + counts          (raw events are NOT sent)
   v
store backend :5000
   /bg/v1/...        BehaviorGuard's API, inside the store's own app: the account's profile,
                     verdicts, verifications (SQLite)
   /api/bg-token     a token for the logged-in user and THIS login, signed with the sk
   /api/bg-code      the fallback: a code sent with the store's own send_email, checked HERE,
                     reported to the guard (the attacker has the password, not the mailbox)
   /api/checkout     unchanged code - but the gate asks guard.check() first:
                     no fresh LOW assessment and no verification -> 403 verify
```

The score and the decision are on the store's server. The browser only measures.

## 0. Setup

```bash
pip install flask
python demo/shop-checkout/shop.py    # http://127.0.0.1:5000
```

## Walkthrough

### 1. The plain site
- Open `http://127.0.0.1:5000`, log in (the first log-in with an email creates the account),
  pick items, **Pay now**: it goes straight through.
- DevTools > Network: **no** `behaviorguard.js`. Nothing is watching the session.

### 2. Install it
1. **Backend** - in `shop.py`, block `INSTALL BEHAVIORGUARD (backend part)`, remove the `#`:
   ```python
   from bg_backend import install; install(app, current_user=lambda: session.get("user"), send_code=lambda user, code: send_email(user, "Your verification code", code), protect=["/api/checkout"])
   ```
   `send_email` is the store's own (it already emails receipts). In this demo it delivers to a
   simulated mailbox; the terminal prints its link when an account is created.
   Restart `shop.py`.
2. **Page** - in `index.html`, remove the comment around:
   ```html
   <script src="plug-behaviorguard.js" defer></script>
   ```
3. Log in again (the restart clears the demo store's accounts). The **badge** appears in the
   bottom-left corner: *learning the owner 0/10*, *server decides*.

### 3. Protection on
- **New account (no profile yet, and the store has no MFA):** **Pay now** - the store's server
  answers *verify first*, the plug asks for the **code emailed to the account** (open the
  mailbox link from the terminal); a wrong code is rejected by the server, the right one is
  reported to BehaviorGuard and the same payment goes through.
- **Recognised owner** (use the store normally for a few minutes until the badge turns green):
  pay goes through without interruption.
- **Stolen password, another browser** (a private window, or a second browser): log in with the
  same email and password. The badge says *server decides* and is **not** learning - the
  account's profile is on the server. Someone else's way of using the page turns it red; the
  verification asks for the emailed code, which the attacker does not have, so the payment is
  held, and two `HIGH` verdicts in a row end that login on the server.
- **Try to skip the page:** with that second browser's cookie, `curl -X POST
  http://127.0.0.1:5000/api/checkout` - 403 or 401. The page's script is not what protects the
  route.

Afterwards, comment the two lines out again so the next run starts plain.

## Notes

- `bg_backend.py` keeps BehaviorGuard's data in a fresh temporary SQLite file per start, because
  this demo store keeps its own accounts in memory too. Set `BG_DB=path` to keep profiles.
- `install()` also takes `verify_password=` (re-type the password) for trying things out
  without email. It is weak by nature: whoever stole the password knows it.
- The tenant keys come from `BG_PK`/`BG_SK`, or are generated once into `.bg-tenant.json`
  (gitignored). The `sk` never reaches a page.
- `python demo/shop-checkout/test_install.py` checks all of the above without a browser
  (23 checks).
