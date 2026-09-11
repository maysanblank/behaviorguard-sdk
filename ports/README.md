# BehaviorGuard Core — language ports

**One brain, every runtime.** BehaviorGuard's scoring engine and feature extraction are
defined once, as a language-agnostic contract, and implemented independently in several
languages. Every implementation must produce **the same numbers** from the same input —
proven, not asserted, against a single shared golden file.

```
raw events ──▶ 34-float feature vector ──▶ risk verdict
   (SPEC §8)              (exchange format)        (SPEC §5)
```

## Why this matters

A behavioral-biometrics library that only runs in one runtime isn't a library — it's a
lock-in. Real deployments are polyglot: the capture happens in a browser, the scoring may
run on a Go/Java/Python backend, an Android app, an edge worker, or a native binary. So the
*algorithm* is specified independently of any runtime, and each ecosystem gets a faithful
port that is **byte-for-byte compatible within 1e-9**.

## The contract

- **[`core/SPEC.md`](../core/SPEC.md)** — the normative spec. If code and spec disagree,
  the spec is right and the code is the bug.
- **[`core/golden.json`](../core/golden.json)** — the numeric contract: explicit inputs and
  expected outputs. **319 checks** (204 feature-extraction + 115 engine). Inputs are written
  out literally, so a new port never has to reproduce any generator — just read, compute, compare.

An implementation is **conformant** only if it passes every check in `golden.json`.

## Conformance status

| Language | Runtime reach | How to run | Status |
|---|---|---|---|
| **JavaScript** | browser, Node, edge/serverless | `node core/conformance.node.mjs` or `core/conformance.html` | ✅ 255/255 |
| **Python** | servers, data/ML, scripting | `python core/conformance.py` | ✅ 255/255 |
| **Rust** | systems, WASM, CLIs, high-perf | `cd ports/rust && cargo run --release` | ✅ 255/255 |
| **Java** | JVM, **Android**, Kotlin/Scala, enterprise | `cd ports/java && java BgConformance.java ../../core/golden.json` | ✅ 255/255 |
| **WASM** | *any* WASM host: browser, Node, Deno, Go, Python, edge | `node ports/wasm/run.mjs` — see [`ports/wasm/`](wasm/) | ✅ 255/255 |

All are **dependency-free** — standard library only, including a small hand-written JSON
reader in the compiled ports. No package registry, no network, no build server needed.

The **WASM** row is special: it isn't a fifth source port, it's the Rust core compiled once
to a single `bg_core.wasm` that every runtime with a WASM engine loads directly. That's the
shortest path to "runs literally everywhere" — one binary instead of N ports.

## Run everything

From the repo root:

```bash
# Python
python core/conformance.py

# Rust
( cd ports/rust && cargo run --release )

# Java (single-file source launch, JDK 11+)
( cd ports/java && java BgConformance.java ../../core/golden.json )

# JavaScript — serve the repo, then open core/conformance.html
python -m http.server 8099   # then browse http://127.0.0.1:8099/core/conformance.html
```

Each prints `lulus 255 / 255` and `HASIL: SESUAI` ("passed 255/255", "RESULT: MATCHES").

## Porting to a new language

The bar is deliberately low because the hard part — defining the contract — is already done:

1. Read **[`core/SPEC.md`](../core/SPEC.md)** end to end. Pay special attention to §4
   (the `mulberry32` PRNG — mask every multiply to 32 bits; this is the #1 cause of failed
   ports) and §9 (determinism: time-of-day is **UTC**, not local time).
2. Mirror **[`core/bg_core.py`](../core/bg_core.py)** — it's the readable reference.
3. Read `core/golden.json`, run the two paths (`feature_cases` then `cases`), compare each
   value with a relative tolerance of `1e-9`.
4. When you print `255 / 255`, you're done. Add a row to the table above.

Good next targets by ecosystem reach: **Go** (cloud/CLI), **Swift** (iOS), **C#** (.NET),
**WASM** (compile the Rust core once, call it from anywhere).
