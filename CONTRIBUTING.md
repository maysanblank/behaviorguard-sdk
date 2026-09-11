# Contributing

Thanks for looking. Issues, ports and attacks on the tool are all welcome.

## Ground rules

**`sdk/` is the single source of truth.** `dist/` is generated from it. Never edit
`dist/*` by hand.

```bash
python tools/bundle.py                  # sdk/ -> dist/
```

**Measure the library, not an imitation of it.** Any change that can move a verdict must be
measured with `node tools/eval_sdk.mjs --live` (it drives the shipped code over the research
sessions, exported locally with `python tools/export_sessions.py`; the export holds human
behavioral data and must never be committed). Report owner friction, impostor first-verdict
and whole-session pass, and takeover detection — before and after.

**The spec outranks the code.** If `core/SPEC.md` and an implementation disagree, the spec
is right and the code is the bug. Changing engine behavior means changing the spec,
regenerating `core/golden.json`, and re-running conformance in all five runtimes.

## Before you open a pull request

```bash
python core/conformance.py       # engine vs golden.json    -> 227/227
node   core/challenge.test.mjs   # step-up regression       -> 20/20
node   core/ensemble.test.mjs    # detector-gate regression -> 11/11
```

Without Node, open `core/conformance.html`, `core/challenge.test.html` and
`core/ensemble.test.html` over a local server instead.

If you touched anything numeric, also run `python core/drift_check.py` and say in the PR
whether the gap moved.

## Adding a language port

Read [`ports/README.md`](ports/README.md). The short version: read `core/SPEC.md`, mirror
`core/bg_core.py`, and pass all 227 checks in `core/golden.json` at 1e-9. Two traps that
break most ports — mask every `mulberry32` multiply to 32 bits (§4), and compute
time-of-day in **UTC** (§9).

Good targets: Go, Swift, C#, Kotlin.

## Reporting a security issue

For anything already public, open an issue. For an unreported bypass, contact the
maintainer directly first so a fix can ship before the details do.

We would genuinely rather receive a working mimicry attack than not know about it. Verified
attacks get documented in [`THREAT-MODEL.md`](THREAT-MODEL.md) with credit.

## Style

Match the surrounding code: no build step, no dependencies, no framework. Every runtime
implementation uses only its standard library, and that constraint is deliberate — it is
what makes the tool portable and auditable.

When you fix a logic flaw, document the **failure mode**, not just the fix. `core/DRIFT.md`
§C-1..C-15 is the format: what broke, how it was observed, why it was invisible, what now
prevents it.
