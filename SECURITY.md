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
- Reading or changing stored behavior data of another account through the optional server.
- Typed characters or raw events leaving the device, or being stored.

## Out of scope

These are documented limits, not vulnerabilities:

- An attacker with full control of the browser or the page's JavaScript bypassing a
  client-side check ([THREAT-MODEL.md](THREAT-MODEL.md) section 4.2).
- Targeted mimicry of a specific victim (section 4.1). It is untested and open; a working
  attack is very welcome, as a report, and will be documented with credit.
- The optional server's deliberate CORS `*`, and the missing rate limit on `/tenant`
  ([server/README.md](server/README.md)).

## Supported versions

Only the latest release on `main` receives fixes.
