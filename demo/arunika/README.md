# Arunika — a realistic site with BehaviorGuard installed

A fictional digital bank (account opening, dashboard, transfer, bill payment, history,
security settings) used to show the library in a product-like setting. Not a real financial
service; all data lives in the browser's localStorage.

```bash
python -m http.server 8080        # from the repository root
```

Open <http://localhost:8080/demo/arunika/>.

**The demo starts at account opening, on purpose.** The interesting moment is the one a
screenshot cannot show: a brand-new account the library knows nothing about, and a profile
being built from zero while you watch.

| Step | Page | What happens |
| --- | --- | --- |
| 1 | `daftar.html` | Open an account. Type the form — that typing is already your first evidence. |
| 2 | `mulai.html` | Onboarding. A progress ring `0/10`, a live evidence counter, what is measured and what is never stored, and a copy-this-sentence box because typing produces evidence fastest. At the end: **set up typing-rhythm verification** (`enrollMfa()`), which is the point — do it here and the one-time code stays what it should be, a recovery path. |
| 3 | the rest | Normal banking. `beranda.html` nags until enrollment finishes; `keamanan.html` can wipe everything and start the demo over. |

## What to look at

| File | Role |
| --- | --- |
| `assets/app.js`, `*.html` | The site as it existed **before** BehaviorGuard. No library code. |
| `assets/bg-integrasi.js` | **The entire integration** (~200 lines): `init` after login, verdict handling (log, lock sensitive actions, end the session on `BLOCK_SESSION`), a risk-based gate for transfers and password changes (`assessNow()` then `stepUp()`), and a one-time-code fallback wired to `mfa.onFallback` (the recovery path, not the primary one). Fails closed if the library does not load. |
| `assets/status.js` | A status card built from `BehaviorGuard.status()` in the site's own words. |
| `assets/panel-demo.js` | **Presenter panel only** (bottom-left). Shows phase, evidence, verdict gauge and plain-language reasons, and simulates a return after 20 minutes away, a replay of the user's own recorded behavior, and a bot. A real site would not load it. |

The typing-rhythm dialog that appears on `MEDIUM`/`HIGH` belongs to the library; the one-time-code
dialog belongs to the site (in production the code is sent and checked by your server).

## Standalone copy

`python tools/export_demo.py <folder>` writes a self-contained copy (library included) to
`<folder>/site`, for machines without the repository.
