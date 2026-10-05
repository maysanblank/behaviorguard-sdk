# Backlog

What is planned, what is being considered, and what is deliberately out of scope. This is a
roadmap, not a promise - items move as evidence comes in.

## Planned
- [ ] English UI for the Indonesian demo shops (`demo/shop-*`, `monitor/`, `attack_sim.html`).
- [ ] Labeled screenshots in `assets/` (see `assets/README.md` for the shot list).
- [ ] Publish the minified bundle to a CDN path documented in QUICKSTART.

## Considering
- [ ] WebAuthn as a first-class built-in step-up method (today it is a fallback hook).
- [ ] A second server reference implementation (Postgres) beside the SQLite one.
- [ ] Per-feature contribution view in the operator dashboard.
- [ ] Optional on-device model export/import for audit.

## Out of scope (on purpose)
- Shipping raw interaction events or typed characters off the device - this breaks the
  core privacy claim; see [THREAT-MODEL.md](THREAT-MODEL.md).
- Replacing login-time authentication. BehaviorGuard guards the *session after* login; it
  is not a password/OTP replacement.
- A hosted SaaS. The optional server is a reference implementation, not a managed service.

## Done (recent)
- [x] Owner vs attacker recording at the top of the README; install GIF below it.
- [x] Actions badge; CI checks the golden file within the 1e-9 contract (Windows and Linux agree).
- [x] English demo bank (Arunika), SDK messages and test output; demo folders renamed to English.
- [x] C-48 - gate every sensitive transfer on `UNKNOWN` or a half-built engine.
- [x] C-46/C-47 - reject script-generated input as behavior; demo starts at sign-up.
- [x] C-44/C-45 - keystroke-rhythm features, production step-up, integrator API.
- [x] Verified minified bundle (44 KB gzip) with identical-verdict proof.
