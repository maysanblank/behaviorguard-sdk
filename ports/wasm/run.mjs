// run.mjs - jalankan bg_core.wasm di Node (tanpa browser), buat CI & bukti cepat.
// Logika identik index.html: kasih teks golden.json ke WASM, ia hitung 319 cek sendiri.
//   node ports/wasm/run.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const wasmBytes = readFileSync(join(HERE, 'bg_core.wasm'));
const goldenText = readFileSync(join(HERE, '..', '..', 'core', 'golden.json'), 'utf8');

const { instance } = await WebAssembly.instantiate(wasmBytes, {});
const ex = instance.exports;

const inBytes = new TextEncoder().encode(goldenText);
const inPtr = ex.alloc(inBytes.length);
new Uint8Array(ex.memory.buffer, inPtr, inBytes.length).set(inBytes);

const packed = ex.run_golden(inPtr, inBytes.length);        // u64 -> BigInt
const outPtr = Number(packed >> 32n);
const outLen = Number(packed & 0xffffffffn);
const result = JSON.parse(
  new TextDecoder().decode(new Uint8Array(ex.memory.buffer, outPtr, outLen).slice())
);
ex.dealloc(outPtr, outLen);
ex.dealloc(inPtr, inBytes.length);

console.log();
console.log(`CONFORMANCE (inside WASM)  spec ${result.spec}`);
console.log(`  passed ${result.passed} / ${result.total}`);
console.log(`  RESULT: ${result.verdict}`);
process.exit(result.verdict === 'PASS' ? 0 : 1);
