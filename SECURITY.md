# Security policy

## Reporting a vulnerability

Please report an unpublished bypass privately through
[GitHub private vulnerability reporting](https://github.com/maysanblank/behaviorguard-sdk/security/advisories/new),
not in a public issue. Include the version (`BehaviorGuard.version`), the browser, and the smallest steps that reproduce it.

Expect a first reply within 7 days. A confirmed issue gets a fix, a regression test, and an
entry in [core/DRIFT.md](core/DRIFT.md) and [THREAT-MODEL.md](THREAT-MODEL.md) with credit,
unless you ask not to be named.

## In scope

- Getting a verdict of `LOW` for someone who is not the owner, other than by ordinary
  behavioral similarity (see the measured rates in the README).
- Passing the typing-rhythm step-up without the owner's rhythm.
- Making forged or replayed input train the owner's model.
- Getting past the server-side gate (`guard.check()`, `/v1/check`) without a fresh `LOW`
  assessment or a verification, or making a page-side claim count as a verification.
- A login inheriting another login's verification, or one login's verdicts ending another's.
- Reading or changing stored behavior data of another account through the server.
- Typed characters or raw events leaving the page, or being stored.

## Out of scope

These are documented limits, not vulnerabilities:

- In local mode, an attacker with full control of the browser or the page's JavaScript
  bypassing a client-side check ([THREAT-MODEL.md](THREAT-MODEL.md) section 4.2). In backend
  mode the same attacker sending made-up feature vectors is section 4.1, below.
- Targeted mimicry of a specific victim (section 4.1). It is untested and open; a working
  attack is very welcome, as a report, and will be documented with credit.
- The standalone service's deliberate CORS `*` (auth is a header token, never a cookie), and
  open tenant sign-up until you set `BG_TENANT_SIGNUP=0` ([server/README.md](server/README.md)).

## Supported versions

Only the latest release on `main` receives fixes.
