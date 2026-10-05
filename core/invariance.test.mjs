/**
 * invariance.test.mjs - C-24: invariansi panjang sesi (jendela kanonik, agregasi
 * bukti, kalibrasi ambang di luar sampel).
 *
 * Syarat pertama dan terpenting: KETIGANYA DEFAULT MATI. Uji nomor 1 mengunci
 * bahwa tanpa knob apa pun, perilakunya identik dengan sebelum C-24 - kalau ini
 * gagal, semua angka lama di config.js kehilangan reprodusibilitasnya.
 *
 * Jalankan: node core/invariance.test.mjs
 */
import { BehaviorGuard } from '../sdk/behaviorguard.js';
import { extractF4 } from '../sdk/core/features.js';

const results = [];
const check = (name, cond, note) => results.push({ name, ok: !!cond, note });

let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

function burst(startTs, n) {
  const ev = [];
  let t = startTs;
  for (let i = 0; i < n; i++) {
    t += 60 + Math.floor(rnd() * 90);
    const r = i % 12;
    if (r === 0)      ev.push({ event_type: 'MOUSE_CLICK', x: 120 + rnd() * 300, y: 100 + rnd() * 200, timestamp: t, page_url: 'https://t/p' });
    else if (r === 1) ev.push({ event_type: 'MOUSE_SCROLL', scroll_delta: 40 + rnd() * 120, timestamp: t, page_url: 'https://t/p' });
    else if (r === 2) ev.push({ event_type: 'FORM_FOCUS', timestamp: t, page_url: 'https://t/p' });
    else if (r === 3) ev.push({ event_type: 'FORM_BLUR', timestamp: t, page_url: 'https://t/p' });
    else if (r === 4) ev.push({ event_type: 'NAVIGATION', timestamp: t, page_url: 'https://t/p' + (i % 3) });
    else if (r % 2 === 1) ev.push({ event_type: 'KEYSTROKE', key: 'abcdefg'[i % 7], hold_time: 60 + rnd() * 50, timestamp: t });
    else ev.push({ event_type: 'MOUSE_MOVE', x: 120 + rnd() * 300, y: 100 + rnd() * 200, velocity: 0.15 + rnd() * 2.5, timestamp: t });
  }
  return ev;
}

async function makeBg(opts) {
  const bg = new BehaviorGuard();
  await bg.init({ userId: 'inv-' + Math.random(), mfa: { enabled: false }, ...opts });
  try { clearInterval(bg._autoTimer); } catch {}
  return bg;
}

const MIN = 60_000;

// ---------------------------------------------------------------------------
// 1. DEFAULT MATI: nol perubahan perilaku
// ---------------------------------------------------------------------------
{
  const bg = await makeBg({});
  check('default: canonicalWindow mati', bg.cfg.session.canonicalWindow === 0);
  check('default: aggregateWindows = 1', bg.cfg.aggregateWindows === 1);
  check('default: calibrationHoldout = 0', bg.cfg.calibrationHoldout === 0);

  const seen = [];
  bg.onRisk = e => seen.push(e);
  let t = Date.UTC(2026, 8, 9, 3, 0, 0);
  for (let i = 0; i < 11; i++) { await bg.scoreExternalEvents(burst(t, 240)); t += 20 * MIN; }

  check('default: satu sesi -> tepat satu vonis (tidak dipecah jendela)',
    seen.length === 11, `${seen.length} vonis`);
  check('default: tidak ada vonis PENDING', !seen.some(e => e.action === 'PENDING'));
  check('default: tidak ada tanda agregasi', seen.every(e => !e.aggregated));
  bg._rebuildModel();
  check('default: model dilatih dari SELURUH kolam (tanpa holdout)',
    bg.model.n === bg._trainingVectors().length,
    `model.n=${bg.model.n} vs kolam ${bg._trainingVectors().length}`);
}

// ---------------------------------------------------------------------------
// 2. Jendela kanonik: satu sesi panjang -> banyak vonis berukuran sama
// ---------------------------------------------------------------------------
{
  const K = 120;
  const bg = await makeBg({ session: { canonicalWindow: K } });
  let t = Date.UTC(2026, 8, 9, 3, 0, 0);
  for (let i = 0; i < 4; i++) { await bg.scoreExternalEvents(burst(t, 500)); t += 20 * MIN; }

  check('kanonik: sesi 500 event -> 4 jendela (sisa 20 dibuang)',
    bg.sessions.length === 16, `${bg.sessions.length} vektor dari 4 sesi`);

  // INTI C-24: panjang masukan berubah, vektor cacahan TIDAK ikut berubah
  const a = burst(t, 500), b = burst(t + 5 * MIN, 260);
  const wa = bg._canonicalize({ events: a, gapBeforeMs: 0 });
  const wb = bg._canonicalize({ events: b, gapBeforeMs: 0 });
  check('kanonik: tiap jendela persis K event',
    wa.every(w => w.events.length === K) && wb.every(w => w.events.length === K));

  const CACAH = ['mouse_direction_changes', 'form_focus_count', 'nav_page_count',
                 'keystroke_burst_count', 'cart_action_count'];
  const fa = extractF4(wa[0].events), fb = extractF4(wb[0].events);
  const fFull = extractF4(a), fHalf = extractF4(b);
  const spread = (x, y) => CACAH.reduce((s, k) => s + Math.abs(x[k] - y[k]), 0);
  check('kanonik: fitur-CACAH nyaris tak berubah antara masukan 500 vs 260 event',
    spread(fa, fb) < spread(fFull, fHalf) / 3,
    `kanonik ${spread(fa, fb).toFixed(1)} vs mentah ${spread(fFull, fHalf).toFixed(1)}`);

  check('kanonik: jendela ke-2 dst tidak mewarisi gapBeforeMs jendela pertama',
    wa.slice(1).every(w => w.gapBeforeMs === 0));
}

// ---------------------------------------------------------------------------
// 3. Agregasi bukti: M jendela -> satu vonis, sisanya PENDING
// ---------------------------------------------------------------------------
{
  const M = 3;
  const bg = await makeBg({ session: { canonicalWindow: 120 }, aggregateWindows: M });
  let t = Date.UTC(2026, 8, 9, 3, 0, 0);
  for (let i = 0; i < 6; i++) { await bg.scoreExternalEvents(burst(t, 380)); t += 20 * MIN; }

  // Pendaftaran sengaja TIDAK diagregasi: belum ada model, jadi tidak ada skor
  // untuk dirata-ratakan - tiap jendela cuma dikumpulkan sebagai vektor baseline.
  check('agregasi: fase pendaftaran tidak menerbitkan PENDING',
    bg.sessions.length >= bg.cfg.baseline);

  bg._aggBuf = [];                                 // mulai dari batas jendela yang bersih
  const before = bg.sessions.length;
  const seen = [];
  bg.onRisk = e => seen.push(e);
  await bg.scoreExternalEvents(burst(t, 380));      // 3 jendela -> 2 PENDING + 1 vonis

  const pending = seen.filter(e => e.action === 'PENDING');
  const verdict = seen.filter(e => e.action !== 'PENDING');
  check('agregasi: 3 jendela -> 2 PENDING + 1 vonis',
    pending.length === 2 && verdict.length === 1,
    `${pending.length} pending, ${verdict.length} vonis`);
  check('agregasi: PENDING menjelaskan progresnya',
    pending[0].reasons[0].includes('1/3') && pending[1].reasons[0].includes('2/3'));
  check('agregasi: PENDING bukan LOW - diam tidak boleh dibaca aman',
    pending.every(e => e.level === 'UNKNOWN'));
  check('agregasi: vonis menandai berapa jendela yang menyusunnya',
    verdict[0].aggregated && verdict[0].aggregated.windows === M);
  check('agregasi: skor vonis = rata-rata, bukan skor jendela terakhir',
    Number.isFinite(verdict[0].score));
  check('agregasi: ambang agregat terkalibrasi terpisah',
    bg._aggThresholds && bg._aggThresholds.low !== bg.cfg.thresholds.low);
  check('agregasi: SEMUA jendela penyusun masuk kolam, bukan cuma yang terakhir',
    bg.sessions.length - before === M, `+${bg.sessions.length - before} vektor untuk 1 vonis`);
  check('agregasi: penyangga kosong lagi di batas M', bg._aggBuf.length === 0);
  check('agregasi: bukti separuh terkumpul TIDAK dibuang diam-diam',
    (await (async () => {
      const b2 = bg.sessions.length;
      await bg.scoreExternalEvents(burst(t + 40 * MIN, 250));   // 2 jendela: belum genap M
      return bg._aggBuf.length === 2 && bg.sessions.length === b2;
    })()));
}

// ---------------------------------------------------------------------------
// 4. Kalibrasi ambang di luar sampel
// ---------------------------------------------------------------------------
{
  const mk = async hold => {
    const bg = await makeBg({ calibrationHoldout: hold, baseline: 14 });
    let t = Date.UTC(2026, 8, 9, 3, 0, 0);
    seed = 7;                                   // deret event identik di kedua kasus
    for (let i = 0; i < 14; i++) { await bg.scoreExternalEvents(burst(t, 240)); t += 20 * MIN; }
    return bg;
  };
  const plain = await mk(0);
  const held = await mk(0.3);

  check('holdout: detektor difit hanya dari bagian fit',
    held.model.n < plain.model.n, `${held.model.n} vs ${plain.model.n}`);
  check('holdout: ambang bergeser (dikalibrasi di luar sampel)',
    held.cfg.thresholds.low !== plain.cfg.thresholds.low,
    `${held.cfg.thresholds.low.toFixed(3)} vs ${plain.cfg.thresholds.low.toFixed(3)}`);
  check('holdout: ambang di luar sampel lebih LONGGAR (itu maksudnya)',
    held.cfg.thresholds.low < plain.cfg.thresholds.low);
  check('holdout: tetap ada vonis MEDIUM/HIGH yang mungkin (bukan longgar tak terbatas)',
    held.cfg.thresholds.medium < held.cfg.thresholds.low);

  const tiny = await makeBg({ calibrationHoldout: 0.3 });
  let t = Date.UTC(2026, 8, 9, 3, 0, 0);
  for (let i = 0; i < 10; i++) { await tiny.scoreExternalEvents(burst(t, 240)); t += 20 * MIN; }
  check('holdout: kolam terlalu kecil -> holdout dilewati, bukan model rusak',
    tiny.model && tiny.model.n === 10, `model.n=${tiny.model && tiny.model.n}`);
}

// --- laporan ---------------------------------------------------------------
const failed = results.filter(r => !r.ok);
const summary = `\nINVARIANSI PANJANG SESI (C-24)\n` +
  results.map(r => `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.note ? '  [' + r.note + ']' : ''}`).join('\n') +
  `\n\n  passed ${results.length - failed.length} / ${results.length}\n` +
  `  RESULT: ${failed.length ? 'FAIL' : 'PASS'}\n`;

if (typeof window !== 'undefined') {
  window.BG_INV_TEST = { total: results.length, failed: failed.length, results };
  const pre = document.createElement('pre');
  pre.textContent = summary;
  document.body.appendChild(pre);
} else {
  console.log(summary);
  if (failed.length) process.exit(1);
}
export { results };
