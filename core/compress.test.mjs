/**
 * compress.test.mjs - regresi kompresi waktu diam (C-28).
 *
 * Yang dikunci di sini:
 *  1. Kompresi TIDAK membuang atau menambah event, dan tidak mengubah urutan.
 *  2. Jeda di bawah ambang (jeda berpikir) tidak tersentuh sama sekali.
 *  3. Jeda AFK dipendekkan jadi tepat ambangnya.
 *  4. Fitur berpenyebut waktu yang dirusak AFK kembali ke dekat nilai tanpa-AFK,
 *     sedangkan fitur yang bukan fungsi waktu identik.
 *  5. Bedanya dengan segmentasi C-23: fitur-cacah TIDAK mengecil.
 *
 * Jalankan: node core/compress.test.mjs
 */
import { compressIdle, segmentByIdle } from '../sdk/core/idle.js';
import { extractF4 } from '../sdk/core/features.js';

const results = [];
const check = (name, cond, note) => results.push({ name, ok: !!cond, note });

const T0 = 1_700_000_000_000;
const GAP = 15_000;

function burst(startTs, n = 60, step = 120) {
  const ev = [];
  let t = startTs, seed = 17;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < n; i++) {
    t += step + Math.floor(rnd() * 40);
    if (i % 5 === 0)      ev.push({ event_type: 'MOUSE_CLICK', x: 100 + rnd() * 200, y: 90 + rnd() * 150, timestamp: t });
    else if (i % 7 === 0) ev.push({ event_type: 'FORM_FOCUS', timestamp: t });
    else if (i % 3 === 0) ev.push({ event_type: 'KEYSTROKE', key: 'abcde'[i % 5], hold_time: 70 + rnd() * 40, timestamp: t });
    else                  ev.push({ event_type: 'MOUSE_MOVE', x: 100 + rnd() * 200, y: 90 + rnd() * 150, velocity: 0.2 + rnd() * 2, timestamp: t });
  }
  return ev;
}

// ---------------------------------------------------------------------------
// 1-3. Sifat dasar
// ---------------------------------------------------------------------------
// Sesi riset nyata ~600 event dalam beberapa menit; sisa jeda 15 dtk harus kecil
// dibanding sesinya, jadi datanya dibuat sepanjang itu juga.
const A = burst(T0, 400);
const AFK_MS = 10 * 60 * 1000;
const B = burst(A[A.length - 1].timestamp + AFK_MS, 400).map(e => ({ ...e }));
const clean = [...A, ...burst(A[A.length - 1].timestamp + 150, 400)];
const gapped = [...A, ...B];

const comp = compressIdle(gapped, GAP);
check('jumlah event tetap', comp.length === gapped.length, `${comp.length} vs ${gapped.length}`);
check('jenis & urutan event tetap',
  comp.every((e, i) => e.event_type === gapped[i].event_type && e.x === gapped[i].x));
check('masukan tidak dimutasi', gapped[A.length].timestamp === B[0].timestamp);
const maxGap = comp.slice(1).reduce((m, e, i) => Math.max(m, e.timestamp - comp[i].timestamp), 0);
check('tidak ada jeda yang melebihi ambang sesudah kompresi', maxGap <= GAP, `${maxGap} ms`);
check('jeda AFK dipendekkan TEPAT jadi ambang',
  comp[A.length].timestamp - comp[A.length - 1].timestamp === GAP);
check('sesi padat tanpa jeda panjang tidak berubah sedikit pun',
  compressIdle(A, GAP).every((e, i) => e.timestamp === A[i].timestamp));
const think = [...A, ...burst(A[A.length - 1].timestamp + 9_000, 20)];
check('jeda berpikir 9 dtk (< ambang) tidak tersentuh',
  compressIdle(think, GAP).every((e, i) => e.timestamp === think[i].timestamp));
check('kosong -> kosong', compressIdle([], GAP).length === 0);
check('ambang 0 = mati (hanya diurutkan)',
  compressIdle(gapped, 0).every((e, i) => e.timestamp === gapped[i].timestamp));
const shuffled = [...gapped].reverse();
check('masukan tak terurut tetap benar',
  compressIdle(shuffled, GAP).every((e, i) => e.timestamp === comp[i].timestamp));

// ---------------------------------------------------------------------------
// 4. Fitur: enam yang dirusak AFK pulih, sisanya identik
// ---------------------------------------------------------------------------
const fClean = extractF4(clean), fGap = extractF4(gapped), fComp = extractF4(comp);
const TIME_FEATS = ['mouse_click_interval_mean', 'keystroke_typing_speed', 'form_field_switch_rate',
                    'keystroke_flight_time_mean', 'temporal_session_duration'];
const rel = (a, b) => Math.abs(a - b) / Math.max(1e-9, Math.abs(b));
for (const k of TIME_FEATS) {
  const before = rel(fGap[k], fClean[k]), after = rel(fComp[k], fClean[k]);
  check(`${k}: dirusak AFK lalu dipulihkan`, after < before && after < 0.35,
    `meleset ${(before * 100).toFixed(0)}% -> ${(after * 100).toFixed(0)}%`);
}
// (kecepatan mouse SENGAJA tidak ada di sini: ia dihitung dari dt, jadi ikut waktu)
const SHAPE = ['keystroke_transition_entropy', 'keystroke_dwell_time_mean', 'mouse_curvature_mean',
               'form_focus_count', 'mouse_direction_changes'];
for (const k of SHAPE) {
  check(`${k}: bukan fungsi waktu -> identik dengan versi ber-AFK`, fComp[k] === fGap[k]);
}

// ---------------------------------------------------------------------------
// 5. Beda dengan segmentasi: fitur-cacah tidak mengecil
// ---------------------------------------------------------------------------
const segs = segmentByIdle(gapped, 30_000);
const fSeg = extractF4(segs[0].events);
check('segmentasi memecah sesi (pembanding)', segs.length === 2);
check('kompresi mempertahankan cacahan fokus form, segmentasi memotongnya',
  fComp.form_focus_count === fGap.form_focus_count && fSeg.form_focus_count < fComp.form_focus_count,
  `utuh ${fGap.form_focus_count} / kompres ${fComp.form_focus_count} / segmen ${fSeg.form_focus_count}`);

// ---------------------------------------------------------------------------
const failed = results.filter(r => !r.ok);
console.log(`\nKOMPRESI WAKTU DIAM (C-28)\n` +
  results.map(r => `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.note ? '  [' + r.note + ']' : ''}`).join('\n') +
  `\n\n  passed ${results.length - failed.length} / ${results.length}\n` +
  `  RESULT: ${failed.length ? 'FAIL' : 'PASS'}\n`);
if (failed.length) process.exit(1);
export { results };
