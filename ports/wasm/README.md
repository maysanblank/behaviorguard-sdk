# BehaviorGuard Core — WebAssembly

**One binary, every runtime.** `bg_core.wasm` is the Rust core (feature extraction +
scoring engine) compiled once to WebAssembly. Any host with a WASM runtime — browsers,
Node, Deno, Bun, Go (wazero), Python (wasmtime), .NET, edge/serverless workers — loads the
*same bytes* and gets numerically identical results. No per-language port required.

This is "one brain, many languages" in its most literal form: not four source ports, but a
single compiled artifact that everything calls.

## What's here

| File | What |
|---|---|
| `bg_core.wasm` | the compiled core (~210 KB, zero imports, no WASI) |
| `index.html` | browser demo: feeds `golden.json` in, runs 319 checks **inside** WASM |
| `run.mjs` | the same demo for Node (headless / CI) |

**Verified:** the module runs the full contract inside WASM and returns
`{"passed":255,"total":255,"verdict":"SESUAI"}` — identical to the native Rust, Python,
Java and JS runs.

> **Honest scope — what this artifact does *not* do yet.** The only public entry point is
> `run_golden` (a self-test that proves numeric equivalence). It does **not** yet export
> production `extract(events)` / `score(baseline, vector)` functions, so you cannot drop this
> `.wasm` into an app to score live sessions — only to prove the compiled core matches the
> contract. The production ABI is the next step (see the table below); it reuses the exact
> same memory convention. Also: verification so far is browser (Chromium) + the native Rust
> build; the Node path (`run.mjs`) is exercised in CI, not hand-run on every platform.

## Run it

```bash
# Node (headless)
node ports/wasm/run.mjs

# Browser — serve the repo, then open the demo
python -m http.server 8091      # http://127.0.0.1:8091/ports/wasm/index.html
```

## Rebuild the artifact

```bash
rustup target add wasm32-unknown-unknown          # once
cd ports/rust && cargo build --release --target wasm32-unknown-unknown --lib
cp target/wasm32-unknown-unknown/release/bg_core.wasm ../wasm/bg_core.wasm
```

The `.wasm` is checked in so consumers don't need a Rust toolchain. CI rebuilds it and
runs `run.mjs` to guarantee the committed binary still matches the contract.

## ABI (call it from any language)

Four exports, C ABI, all over the module's linear memory — no `wasm-bindgen`, no glue crate:

| Export | Signature | Purpose |
|---|---|---|
| `alloc` | `(size: i32) -> ptr: i32` | reserve `size` bytes in WASM memory |
| `dealloc` | `(ptr: i32, size: i32)` | free a buffer from `alloc` or `run_golden` |
| `run_golden` | `(ptr: i32, len: i32) -> i64` | read golden.json text at `ptr..ptr+len`, run all 319 checks, return a result-JSON pointer packed as `(out_ptr << 32) \| out_len` |
| `memory` | (exported memory) | the linear memory both sides read/write |

Calling convention:

```js
const p = ex.alloc(bytes.length);
new Uint8Array(ex.memory.buffer, p, bytes.length).set(bytes);   // write input
const packed = ex.run_golden(p, bytes.length);                  // i64 -> BigInt
const outPtr = Number(packed >> 32n), outLen = Number(packed & 0xffffffffn);
const json = new TextDecoder().decode(new Uint8Array(ex.memory.buffer, outPtr, outLen).slice());
ex.dealloc(outPtr, outLen); ex.dealloc(p, bytes.length);        // free both
```

The same three-step pattern (write bytes → call → read bytes) works from Go (wazero),
Python (wasmtime), and any other host — the tiny JSON in/out contract is language-neutral
by design. Extending the ABI with `extract(events_json) -> 34 floats` and
`score(baseline+vector) -> verdict` for production use follows the exact same pattern.
