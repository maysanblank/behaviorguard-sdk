# BehaviorGuard documentation

Start here. This is the map to every document in the project.

## Get started
- [QUICKSTART.md](QUICKSTART.md) - every integration path (script tag, ES module, config
  object), the full config surface, and framework notes (React/Vue/plain HTML).
- [INTEGRATION.md](INTEGRATION.md) - step by step: which file to touch in your backend and
  pages, with Flask, Express, PHP and Laravel examples, and what to do if your site has no
  MFA yet. ([Bahasa Indonesia](INTEGRATION.id.md))
- [../demo/toko-checkout/](../demo/toko-checkout/) - a plain shop with its own backend, and
  the two lines that plug BehaviorGuard into it.

## Understand the engine
- [../ARCHITECTURE.md](../ARCHITECTURE.md) - the pipeline end to end: capture -> features ->
  standardize -> ensemble -> verdict -> step-up; the module map and the design decisions.
- [../core/SPEC.md](../core/SPEC.md) - the normative engine specification. The five runtime
  ports are all conformant to this one document.
- [../THREAT-MODEL.md](../THREAT-MODEL.md) - trust boundaries, known bypasses, and an
  explicit list of what BehaviorGuard is *not*.

## Trust the numbers
- [AUDIT-VALIDITAS-PENGUKURAN.md](AUDIT-VALIDITAS-PENGUKURAN.md) - the measurement-validity
  audit: how the benchmark is run so it measures the engine that actually ships.
- [hasil-holdout-c23-c24.txt](hasil-holdout-c23-c24.txt) - held-out results for changes C-23/C-24.
- [hasil-holdout-tuning.txt](hasil-holdout-tuning.txt) - held-out results across the tuning sweep.
- [../core/DRIFT.md](../core/DRIFT.md) - the C-1..C-48 audit log: every defect, its evidence
  and the test that now guards it.

## Design notes
- [USULAN-KONTEKS-DAN-IDLE.md](USULAN-KONTEKS-DAN-IDLE.md) - the context-and-idle proposal
  behind the idle-segmentation work.

## Operate
- [../server/README.md](../server/README.md) - the optional backend: keys, user tokens,
  the operator dashboard, and what it does (and does not) store.
- [../ports/README.md](../ports/README.md) - porting guide and per-runtime conformance status.
