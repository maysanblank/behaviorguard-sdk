# BehaviorGuard documentation

Start here. This is the map to every document in the project.

## Get started
- [QUICKSTART.md](QUICKSTART.md) - backend mode and local mode side by side, every
  integration path, the full config surface, and framework notes.
- [INTEGRATION.md](INTEGRATION.md) - step by step: which file to touch in your backend and
  pages (token route, server-side check, OTP report), with Flask, Express, PHP and Laravel
  examples, and what to do if your site has no MFA yet. ([Bahasa Indonesia](INTEGRATION.id.md))
- [../demo/arunika/](../demo/arunika/) - a realistic bank with BehaviorGuard on its backend.
- [../demo/shop-checkout/](../demo/shop-checkout/) - a plain shop with its own backend, and
  the two lines that install BehaviorGuard into it.

## Understand the engine
- [../ARCHITECTURE.md](../ARCHITECTURE.md) - the pipeline end to end, split between the page
  (capture -> features) and your server (standardize -> ensemble -> verdict -> step-up); the
  module map and the design decisions.
- [../core/SPEC.md](../core/SPEC.md) - the normative engine specification. The five runtime
  ports are all conformant to this one document.
- [../THREAT-MODEL.md](../THREAT-MODEL.md) - trust boundaries, known bypasses, and an
  explicit list of what BehaviorGuard is *not*.

## Trust the numbers
- [MEASUREMENT-VALIDITY-AUDIT.md](MEASUREMENT-VALIDITY-AUDIT.md) - the measurement-validity
  audit: how the benchmark is run so it measures the engine that actually ships.
- [holdout-c23-c24.txt](holdout-c23-c24.txt) - held-out results for changes C-23/C-24.
- [holdout-tuning.txt](holdout-tuning.txt) - held-out results across the tuning sweep.
- [../core/DRIFT.md](../core/DRIFT.md) - the C-1..C-49 audit log: every defect, its evidence
  and the test that now guards it.

## Design notes
- [CONTEXT-AND-IDLE-PROPOSAL.md](CONTEXT-AND-IDLE-PROPOSAL.md) - the context-and-idle proposal
  behind the idle-segmentation work.

## Operate
- [../server/README.md](../server/README.md) - the server: keys, user tokens, endpoints, the
  gate, the parity tests, the operator dashboard, and what it does (and does not) store.
- [../ports/README.md](../ports/README.md) - porting guide and per-runtime conformance status.
