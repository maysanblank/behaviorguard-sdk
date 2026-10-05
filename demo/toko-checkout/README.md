# Demo: plug BehaviorGuard into a checkout-only shop

A **plain** shop: a real online store with only **login + checkout**, its **own backend**, and
**no MFA or session protection** of any kind. BehaviorGuard is plugged in with **one line in
the backend and one line in the page**. The shop's login and checkout code is not touched.

![BehaviorGuard plugged into a plain shop](../../assets/demo.gif)

Integrating with your own site (Node, PHP, Laravel)? See
[docs/INTEGRATION.md](../../docs/INTEGRATION.md).

## Files

| File | What | Touched when plugging in? |
|---|---|---|
| `shop.py` | Shop backend (Flask): login, checkout, order list | 1 line near the bottom (remove the `#`) |
| `index.html` | Shop page | 1 line (the `COLOK` comment block) |
| `bg_backend.py` | BehaviorGuard backend part: `/api/bg-token` and `/api/bg-reauth` | no, just imported |
| `plug-behaviorguard.js` | Page part: loads the library, badge, button gate, password confirm | no, just referenced |

## Architecture

```
browser (captures mouse / keys / scroll)
   |  34 feature values per 30 s + verdict        (raw events are NOT sent)
   v
BG server :5055  --->  cross-device baseline + log  --->  operator dashboard
   ^
shop backend :5000  /api/bg-token   mint a token for the logged-in user (with the tenant sk)
                    /api/bg-reauth  re-check the password (verification path; the shop has no MFA)
```
The score is computed in the browser; the BG server stores features and verdicts for the
dashboard and the cross-device baseline.

## 0. Setup

```bash
pip install flask
```
Two terminals:
```bash
python server/app.py                 # BG server + dashboard  -> http://127.0.0.1:5055
```
```bash
python demo/toko-checkout/shop.py    # shop                   -> http://127.0.0.1:5000
```

## Walkthrough

### 1. The plain site
- Open `http://127.0.0.1:5000`, log in (first login registers the account), pick items,
  **Bayar sekarang** (pay): it goes straight through.
- DevTools > Network: **no** `behaviorguard.js`. Nothing is watching the session.

### 2. Plug it in
1. **Backend** - in `shop.py`, block `COLOK BEHAVIORGUARD (bagian backend)`, remove the `#`:
   ```python
   from bg_backend import pasang; pasang(app, current_user=lambda: session.get("user"), verify_password=cek_sandi)
   ```
   Restart `shop.py`.
2. **Page** - in `index.html`, under the `COLOK BEHAVIORGUARD DI SINI` comment, add:
   ```html
   <script src="plug-behaviorguard.js" defer></script>
   ```
3. Log in again (the restart clears the demo data). The **badge** appears in the bottom-left
   corner: learning the owner, `mode: backend`.

### 3. Protection on
- **New user (no profile yet, and the shop has no MFA):** pay, a **password confirmation**
  appears, a wrong password is rejected by the server, the right one lets checkout through.
- **Recognised owner** (use the shop normally for a few minutes until the badge turns green):
  pay goes through without interruption.
- **Hijacked session:** someone else uses the session for 30-60 s, the badge turns red, pay
  asks for verification, the attacker does not know the password, the action is **held**.
- **Dashboard:** `http://127.0.0.1:5055/dashboard`, paste the `sk` from
  `demo/toko-checkout/.bg-tenant.json`.

Afterwards, comment the two lines out again so the next run starts plain.

## If the BG server (5055) is not running
The plug still works in **on-device mode**: protection and verification still run, just
without the baseline sync and the dashboard. The badge says `mode: on-device`.
