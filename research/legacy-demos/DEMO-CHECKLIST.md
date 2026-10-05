# Manual demo checklist - 3 sites, 3 tenants

Setup: 3 plain e-commerce sites, each its own tenant, manual enrollment.

---

## 0. One-time setup

```bash
python server/app.py          # leave it running on localhost:5055
```

Register 3 tenants. **Write down both `pk` AND `sk`** - `sk` is only shown once:
```
curl -X POST http://localhost:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"Shop A\"}"
curl -X POST http://localhost:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"Shop B\"}"
curl -X POST http://localhost:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"Shop C\"}"
```

Mint a token for the demo account (in production the shop's backend does this after login):
```
python server/app.py mint pk_THIS_SHOP sk_THIS_SHOP LOGGED_IN_ACCOUNT 604800
```

Paste on each site:
```html
<script src="/behaviorguard.js"
        data-user="LOGGED_IN_ACCOUNT"
        data-pk="pk_THIS_SHOP"
        data-endpoint="http://localhost:5055"
        data-user-token="MINTED_TOKEN" defer></script>
```

Without `data-user-token` the library still runs, but purely on the device (no logs to the
dashboard, no cross-device baseline).

---

## 1. How long does enrollment take?

- The first 10 steps = **enrollment** (always LOW, not judged yet - normal, not a failure).
- Each step needs **about 150 events** (mouse movement, typing, scrolling, clicks). The window still
  ticks every 30 seconds; if there are fewer than 150, evidence keeps accumulating until there is
  enough.
- Estimate: 5-10 minutes of real activity per site.

---

## 2. Rules for each step (so it passes the gate)

Gate: **≥ 100 events, ≥ 5 seconds, ≥ 6 non-zero features, and real typing** (not paste/autofill).

- [ ] Move the mouse (do not sit still).
- [ ] **Type in the search box / a form** - REQUIRED. Typing rhythm is the strongest discriminator,
      and a step whose typing was pasted does not count toward enrollment.
- [ ] Scroll up and down, click 1-2 products, change pages.

Check progress: the panel (`data-panel`) or the console shows `enrollment N/10`, or look at the
dashboard.

---

## 3. How to test detection

**A. Owner (you, normal style)** - after enrollment, carry on for a few normal steps.
   -> Mostly LOW. Around 1 in 9 verdicts asking for verification is expected (11.4% in the
   measurements); after passing verification, MEDIUM is not asked again for 15 minutes.

**B. Intruder (someone else, a different style)**:
   1. Open **another browser / incognito** (simulating the intruder's device).
   2. Use the same account and token.
   3. The library pulls the owner's baseline from the server (a new device, no enrollment yet).
   4. Ask **someone else** to use it.
   -> Should be MEDIUM/HIGH, and HIGH twice in a row = BLOCK_SESSION.

> **Honestly:** in the measurements, 10.5% of intruders pass their first verdict and 7.9% pass their
> whole session; 1 of 240 intruder pairs was never detected within 6 sessions. Do not bet on a single
> session - run 3-5 intruder sessions and report the ratio.

---

## 4. Expected results

| Phase | What appears | Normal? |
|---|---|---|
| Enrollment | all LOW, `enrollment N/10` | yes - not judged yet |
| Owner after enrollment | mostly LOW, occasionally MEDIUM | yes - ~1 in 9 verdicts |
| Intruder (another device) | mostly MEDIUM/HIGH, sometimes passes as LOW | yes - ~1 in 10 on the first verdict |
| Not enough evidence | `UNKNOWN` / `ABSTAIN` | yes - it does not mean "safe" |

Dashboard: open `http://localhost:5055/dashboard`, paste that shop's **`sk`** (not `pk`).

---

## 5. Checklist before the demo
- [ ] All 3 sites have a search box / form input.
- [ ] Server running, 3 tenants registered, `pk` + `sk` written down.
- [ ] Tag installed with `pk` + `userId` + `endpoint` + token (check Network: POST /log returns 200).
- [ ] Rehearsed: enrollment -> 1 owner step LOW -> 1 intruder session MEDIUM/HIGH.
- [ ] A second device/incognito window for the intruder role.
- [ ] The limitation line: "an extra verification layer, not an absolute lock; ~1 in 10 intruders
      passes the first check; targeted imitation has not been tested."
