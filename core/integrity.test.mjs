/**
 * integrity.test.mjs - regression tests for the bot/replay heuristics (C-16).
 *
 * The velocity check read `e.velocity || 0` on events whose capture layer never
 * populated `velocity`. Every value collapsed to 0, the standard deviation was 0,
 * and ordinary human sessions were reported as "velocity konstan" and blocked as
 * bots. It fired on exactly the sessions that are mostly mouse movement - a
 * visitor browsing a page without typing much.
 *
 * Run: node core/integrity.test.mjs   (or open core/integrity.test.html)
 */
import { checkIntegrity } from '../sdk/core/integrity.js';

const results = [];
const check = (name, cond) => results.push({ name, ok: !!cond });

// Sesi manusia: interval dan hold bervariasi, gerakan tidak seragam.
function humanSession({ withVelocity = true, n = 60 } = {}) {
  const ev = [];
  let t = 1_700_000_000_000;
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < n; i++) {
    t += 40 + Math.floor(rnd() * 120);           // interval jelas bervariasi
    const e = { event_type: 'MOUSE_MOVE', x: 100 + rnd() * 300, y: 80 + rnd() * 200, timestamp: t };
    if (withVelocity) e.velocity = 0.05 + rnd() * 2.4;
    ev.push(e);
  }
  return ev;
}

// --- C-16: inti regresi ---------------------------------------------------
const noVel = checkIntegrity(humanSession({ withVelocity: false }), { throttled: true });
check('sesi manusia TANPA field velocity tidak ditandai', noVel.suspected === false);
check('tidak ada alasan "velocity konstan" ketika datanya memang tak ada',
  !noVel.reasons.some(r => r.includes('velocity')));

const withVel = checkIntegrity(humanSession({ withVelocity: true }), { throttled: true });
check('sesi manusia DENGAN velocity wajar tidak ditandai', withVel.suspected === false);

// --- deteksi yang HARUS tetap bekerja -------------------------------------
function botConstantVelocity() {
  const ev = []; let t = 1_700_000_000_000;
  for (let i = 0; i < 60; i++) {
    t += 40 + (i % 7) * 13;                       // interval bervariasi agar bukan cek interval yg memicu
    ev.push({ event_type: 'MOUSE_MOVE', x: i * 3, y: 50, timestamp: t, velocity: 1.5 });
  }
  return ev;
}
const botVel = checkIntegrity(botConstantVelocity(), { throttled: true });
check('velocity benar-benar konstan TETAP ditandai', botVel.suspected === true);
check('alasannya menyebut velocity', botVel.reasons.some(r => r.includes('velocity')));

function botConstantInterval() {
  const ev = []; let t = 1_700_000_000_000;
  for (let i = 0; i < 60; i++) {
    t += 50;                                      // metronom sempurna
    ev.push({ event_type: 'KEYSTROKE', key: 'a', hold_time: 40 + (i % 11) * 3, timestamp: t });
  }
  return ev;
}
const botInt = checkIntegrity(botConstantInterval(), { throttled: true });
check('interval konstan tetap ditandai', botInt.suspected === true);

function botIdenticalHold() {
  const ev = []; let t = 1_700_000_000_000;
  for (let i = 0; i < 60; i++) {
    t += 60 + (i % 9) * 17;
    ev.push({ event_type: 'KEYSTROKE', key: 'a', hold_time: 80, timestamp: t });
  }
  return ev;
}
check('hold identik tetap ditandai', checkIntegrity(botIdenticalHold(), { throttled: true }).suspected === true);

// --- kasus tepi ------------------------------------------------------------
check('sesi terlalu pendek tidak dinilai', checkIntegrity([{ event_type: 'MOUSE_MOVE', timestamp: 1 }]).suspected === false);
check('daftar kosong aman', checkIntegrity([]).suspected === false);

const mixed = humanSession({ withVelocity: true, n: 40 });
mixed.forEach((e, i) => { if (i % 2) delete e.velocity; });     // separuh tanpa velocity
check('campuran ada/tak-ada velocity tidak salah-tandai',
  !checkIntegrity(mixed, { throttled: true }).reasons.some(r => r.includes('velocity')));

// --- laporan ---------------------------------------------------------------
const failed = results.filter(r => !r.ok);
const summary = `\nINTEGRITY HEURISTICS (C-16)\n` +
  results.map(r => `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}`).join('\n') +
  `\n\n  passed ${results.length - failed.length} / ${results.length}\n` +
  `  RESULT: ${failed.length ? 'FAILURES PRESENT' : 'MATCHES'}\n`;

if (typeof window !== 'undefined') {
  window.BG_INTEGRITY_TEST = { total: results.length, failed: failed.length, results };
  const pre = document.createElement('pre');
  pre.textContent = summary;
  document.body.appendChild(pre);
} else {
  console.log(summary);
  if (failed.length) process.exit(1);
}
export { results };
