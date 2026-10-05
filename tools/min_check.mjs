/**
 * min_check.mjs - dist/behaviorguard.min.js harus berperilaku PERSIS seperti dist/behaviorguard.js.
 *
 * Kedua bundel dijalankan di konteks terpisah dengan jam tiruan dan event yang sama
 * (pendaftaran 10 jendela + 30 jendela vonis, dua gaya perilaku), lalu seluruh urutan vonis
 * (level, aksi, skor) dibandingkan. Isi template literal (CSS dialog) juga harus identik.
 *
 * Jalankan: node tools/min_check.mjs      (sesudah python tools/bundle.py)
 */
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FULL = fs.readFileSync(path.join(ROOT, 'dist', 'behaviorguard.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'dist', 'behaviorguard.min.js'), 'utf8');

function sandbox() {
  let now = Date.UTC(2026, 8, 12, 3, 0, 0);
  const et = new EventTarget();
  const noop = () => {};
  const ctx = {
    console: { log: noop, warn: noop, error: noop },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    TextEncoder, TextDecoder, crypto: globalThis.crypto, performance, structuredClone,
    btoa, atob, Intl, EventTarget, CustomEvent, Event,
    navigator: { userAgent: 'min-check', language: 'id-ID' }, screen: { colorDepth: 24 },
    location: { href: 'http://localhost/uji' }, history: { pushState: noop, replaceState: noop },
    document: { currentScript: null, readyState: 'complete', visibilityState: 'visible',
      addEventListener: noop, removeEventListener: noop, documentElement: { getAttribute: () => 'id' } },
    addEventListener: et.addEventListener.bind(et), removeEventListener: et.removeEventListener.bind(et),
    dispatchEvent: et.dispatchEvent.bind(et), scrollY: 0,
    __setNow: t => { now = t; }, __now: () => now,
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext('Date.now = () => __now();', ctx);
  return ctx;
}

let seed;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
function burst(t, n, style) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    t += (style ? 90 : 60) + Math.floor(rnd() * 90);
    const r = i % 12;
    if (r === 0) ev.push({ event_type: 'MOUSE_CLICK', x: 120 + rnd() * 300, y: 100 + rnd() * 200, timestamp: t });
    else if (r === 1) ev.push({ event_type: 'MOUSE_SCROLL', scroll_delta: 40 + rnd() * 120, timestamp: t });
    else if (r === 2) ev.push({ event_type: 'FORM_FOCUS', txt: true, timestamp: t });
    else if (r === 3) ev.push({ event_type: 'FORM_BLUR', timestamp: t });
    else if (r % 2 === 1) ev.push({ event_type: 'KEYSTROKE', key: 'k' + (i % 7), kc: rnd() < 0.5 ? 'L' : 'R', hold_time: (style ? 150 : 60) + rnd() * 50, timestamp: t });
    else ev.push({ event_type: 'MOUSE_MOVE', x: 120 + rnd() * 300, y: 100 + rnd() * 200, velocity: (style ? 1.5 : 0.15) + rnd() * 2.5, timestamp: t });
  }
  return ev;
}

async function run(src) {
  const ctx = sandbox();
  vm.runInContext(src, ctx);
  const BG = ctx.BehaviorGuard;
  const out = [];
  seed = 2026;
  await BG.init({ userId: 'min@contoh.id', mfa: { enabled: false }, session: { minEventsAssess: 30 }, onRisk: e => out.push([e.level, e.action, e.score == null ? null : +e.score.toFixed(12)]) });
  BG._instance._stopTimer();
  let t = ctx.__now();
  for (let i = 0; i < 40; i++) {
    const evs = burst(t, 160, i >= 25 && i % 3 === 0);   // sebagian jendela bergaya lain
    ctx.__setNow(evs[evs.length - 1].timestamp + 1000);
    await BG._instance.scoreExternalEvents(evs);
    t += 20 * 60_000;
  }
  return { out, status: BG.status(), version: BG.version };
}

const results = [];
const check = (name, cond, note) => results.push({ name, ok: !!cond, note });
const a = await run(FULL), b = await run(MIN);
check('jumlah vonis sama', a.out.length === b.out.length && a.out.length >= 40, `${a.out.length} vs ${b.out.length}`);
check('urutan vonis identik (level, aksi, skor 12 desimal)', JSON.stringify(a.out) === JSON.stringify(b.out));
check('ada vonis selain LOW (uji tidak trivial)', a.out.some(x => x[0] !== 'LOW' && x[0] != null), a.out.map(x => x[0][0]).join(''));
check('status akhir identik', JSON.stringify({ ...a.status, lastVerdict: null }) === JSON.stringify({ ...b.status, lastVerdict: null }));
check('versi sama', a.version === b.version, a.version);
const css = s => { s = s.replace(/\r\n/g, '\n'); const i = s.indexOf('const CSS = `'); return i < 0 ? null : s.slice(i, s.indexOf('`;', i + 13)); };
check('CSS dialog (template literal) utuh', css(FULL) && css(FULL) === css(MIN));
check('berkas kecil memang lebih kecil', MIN.length < FULL.length * 0.7, `${(MIN.length / 1024).toFixed(1)} KB vs ${(FULL.length / 1024).toFixed(1)} KB`);

let ok = 0;
for (const r of results) { console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.note != null ? `  [${r.note}]` : ''}`); if (r.ok) ok++; }
console.log(`\n  passed ${ok} / ${results.length}`);
console.log(`  RESULT: ${ok === results.length ? 'PASS' : 'FAIL'}`);
process.exit(ok === results.length ? 0 : 1);
