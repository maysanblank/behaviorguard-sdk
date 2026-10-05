/**
 * audit.test.mjs - regresi untuk temuan audit A1..A5 / B1..B7
 * (research/notes/MEASUREMENT-VALIDITY-AUDIT.md). Semua temuan di kelas yang sama:
 * ada sesuatu selain IDENTITAS yang menggeser sinyalnya.
 *
 * Jalankan: node core/audit.test.mjs
 */
import { checkIntegrity } from '../sdk/core/integrity.js';
import { groupByStream, segmentByIdle } from '../sdk/core/idle.js';
import { BehaviorGuard } from '../sdk/behaviorguard.js';

const results = [];
const check = (name, cond, note) => results.push({ name, ok: !!cond, note });

// ---------------------------------------------------------------------------
// A1 · sesi "cuma menelusuri" tidak boleh diblokir sebagai bot
// ---------------------------------------------------------------------------
function throttledBrowsing(hz, n) {
  const ev = []; let t = 1_700_000_000_000, last = 0; const step = 1000 / hz;
  for (let i = 0; i < n * 20 && ev.length < n; i++) {
    t += step;
    if (t - last < 50) continue;
    last = t;
    ev.push({ event_type: 'MOUSE_MOVE', x: 100 + ((i * 37) % 300), y: 80 + ((i * 53) % 200),
              velocity: 0.1 + ((i * 17) % 23) / 10, timestamp: Math.round(t) });
  }
  return ev;
}
for (const hz of [60, 100, 125, 144]) {
  const ev = throttledBrowsing(hz, 200);
  const r = checkIntegrity(ev, { throttled: true });
  check(`A1: menelusuri @${hz}Hz tidak diblokir`, r.suspected === false,
    r.reasons.join(',') || 'bersih');
}
// deteksi yang HARUS tetap hidup: bot sungguhan punya keystroke/klik beraturan
function bot() {
  const ev = []; let t = 1_700_000_000_000;
  for (let i = 0; i < 40; i++) { t += 100; ev.push({ event_type: 'KEYSTROKE', key: 'a', hold_time: 50, timestamp: t }); }
  return ev;
}
const b = checkIntegrity(bot(), { throttled: true });
check('A1: bot interval konstan TETAP tertangkap', b.suspected === true, b.reasons.join(','));
check('A1: hold identik tetap tertangkap', b.reasons.some(r => r.includes('hold')));

// non-throttled tetap dinilai penuh (jalur server / event yang disuntik)
const raw = checkIntegrity(throttledBrowsing(100, 200), {});
check('A1: aliran non-throttled tetap dinilai keteraturannya', raw.suspected === true,
  raw.reasons.join(','));

// ---------------------------------------------------------------------------
// B1 · dua tab = dua aliran, tidak boleh diukur menyatu
// ---------------------------------------------------------------------------
{
  const t0 = 1_700_000_000_000;
  const a = [], c = [];
  for (let i = 0; i < 20; i++) {
    a.push({ event_type: 'MOUSE_MOVE', x: i, y: i, timestamp: t0 + i * 200, tabId: 'aaa' });
    c.push({ event_type: 'KEYSTROKE', key: 'x', hold_time: 70, timestamp: t0 + i * 200 + 100, tabId: 'bbb' });
  }
  const mixed = [...a, ...c].sort((x, y) => x.timestamp - y.timestamp);
  const streams = groupByStream(mixed);
  check('B1: aliran dua tab terpisah', streams.length === 2, `${streams.length} aliran`);
  check('B1: tiap aliran utuh', streams.every(s => s.length === 20));
  check('B1: tak ada event hilang',
    streams.reduce((n, s) => n + s.length, 0) === mixed.length);
  check('B1: aliran diurutkan deterministik menurut event pertama',
    streams[0][0].timestamp <= streams[1][0].timestamp);

  // tanpa tabId (data lama) -> tetap SATU aliran, perilaku lama tak berubah
  const legacy = mixed.map(({ tabId, ...e }) => e);
  check('B1: event tanpa tabId tetap satu aliran (kompatibel mundur)',
    groupByStream(legacy).length === 1);
  check('B1: daftar kosong aman', groupByStream([]).length === 0);
}

// ---------------------------------------------------------------------------
// A3 · bukti keystroke yang dialihkan tidak boleh jadi dasar kepercayaan
// ---------------------------------------------------------------------------
let seed = 3;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
function session(startTs, { typed = true, paste = false, n = 200 } = {}) {
  const ev = []; let t = startTs;
  for (let i = 0; i < n; i++) {
    t += 60 + Math.floor(rnd() * 90);
    const r = i % 10;
    if (r === 0) ev.push({ event_type: 'MOUSE_CLICK', x: 100 + rnd() * 200, y: 90 + rnd() * 150, timestamp: t });
    else if (r === 1) ev.push({ event_type: 'FORM_FOCUS', timestamp: t });
    else if (r === 2) ev.push({ event_type: 'FORM_BLUR', timestamp: t });
    else if (r === 3) ev.push({ event_type: 'MOUSE_SCROLL', scroll_delta: 40 + rnd() * 80, timestamp: t });
    else if (r === 4) ev.push({ event_type: 'NAVIGATION', page_url: 'https://t/p' + (i % 3), timestamp: t });
    else if (typed && r % 2 === 1) ev.push({ event_type: 'KEYSTROKE', key: 'abcd'[i % 4], hold_time: 60 + rnd() * 40, timestamp: t });
    else ev.push({ event_type: 'MOUSE_MOVE', x: 100 + rnd() * 250, y: 90 + rnd() * 180, velocity: 0.2 + rnd() * 2, timestamp: t });
  }
  if (paste) ev.push({ event_type: 'PASTE', chars: 24, timestamp: t + 40 });
  return ev;
}
{
  const bg = new BehaviorGuard();
  await bg.init({ userId: 'audit-a3', mfa: { enabled: false } });
  try { clearInterval(bg._autoTimer); } catch {}
  let t = Date.UTC(2026, 8, 10, 3, 0, 0);
  for (let i = 0; i < 11; i++) { await bg.scoreExternalEvents(session(t)); t += 20 * 60_000; }

  const normal = await bg.scoreExternalEvents(session(t)); t += 20 * 60_000;
  check('A3: sesi diketik biasa tidak ditandai', !normal.partialEvidence);

  const auto = await bg.scoreExternalEvents(session(t, { typed: false })); t += 20 * 60_000;
  check('A3: form tersentuh tanpa ketikan ditandai partialEvidence',
    auto.partialEvidence === 'keystroke');
  check('A3: alasannya bisa dibaca manusia',
    auto.reasons.some(r => r.includes('autofill')), auto.reasons[0]);
  check('A3: sesi autofill TIDAK PERNAH melatih model', auto.eligible === false);

  const pasted = await bg.scoreExternalEvents(session(t, { typed: true, paste: true }));
  check('A3: tempel juga ditandai walau ada ketikan',
    pasted.partialEvidence === 'keystroke');

  // sesi menelusuri murni (tanpa form) BUKAN kasus A3 - nol keystroke-nya jujur
  const browse = [];
  let bt = t + 40 * 60_000;
  for (let i = 0; i < 200; i++) { bt += 70; browse.push({ event_type: i % 9 === 0 ? 'MOUSE_CLICK' : 'MOUSE_MOVE', x: 100 + rnd() * 200, y: 90 + rnd() * 150, velocity: 0.3 + rnd() * 2, timestamp: bt }); }
  const br = await bg.scoreExternalEvents(browse);
  check('A3: menelusuri murni (tanpa form) TIDAK ditandai', br && !br.partialEvidence);
}

// ---------------------------------------------------------------------------
// A5 · markStep menerbitkan PAGE_STEP yang dibaca features.js
// ---------------------------------------------------------------------------
{
  const bg = new BehaviorGuard();
  await bg.init({ userId: 'audit-a5', mfa: { enabled: false } });
  try { clearInterval(bg._autoTimer); } catch {}
  check('A5: markStep tersedia di instance', typeof bg.markStep === 'function');
  bg.markStep('alamat'); bg.markStep('pembayaran');
  const buf = bg.capture ? bg.capture.peek() : [];
  const steps = buf.filter(e => e.event_type === 'PAGE_STEP');
  check('A5: PAGE_STEP masuk buffer', steps.length === 2, `${steps.length}`);
  check('A5: nama langkah terbawa', steps[0].page_url.includes('alamat'));
  check('A5: aman dipanggil tanpa nama', (bg.markStep(), true));
}

// ---------------------------------------------------------------------------
// A4 · pending diberi ruang nama per pengguna
// ---------------------------------------------------------------------------
{
  const src = (await import('node:fs')).readFileSync(
    new URL('../sdk/behaviorguard.js', import.meta.url), 'utf8');
  check('A4: kunci pending ber-ruang-nama per pengguna',
    src.includes('const nsPending = id => `bg:pending:${id}`'));
  check('A4: tidak ada lagi penulisan ke kunci global',
    !/setItem\('bg:pending'/.test(src) && !/getItem\('bg:pending'/.test(src));
  check('A4: sisa kunci lama dibersihkan saat init',
    src.includes('removeItem(LEGACY_PENDING)'));

  const fp = (await import('node:fs')).readFileSync(
    new URL('../sdk/core/fingerprint.js', import.meta.url), 'utf8');
  check('B2: resolusi layar keluar dari sidik perangkat',
    !fp.includes("screen.width+'x'+screen.height"));
  check('B2: sidik masih memakai penanda mesin yang stabil',
    fp.includes('navigator.userAgent') && fp.includes('colorDepth'));

  const cap = (await import('node:fs')).readFileSync(
    new URL('../sdk/core/capture.js', import.meta.url), 'utf8');
  check('B4: touchmove ditangkap', cap.includes("addEventListener('touchmove'"));
  check('B4: sentuhan dilepas juga saat detach', cap.includes("removeEventListener('touchmove'"));
  check('A3: paste ditangkap', cap.includes("addEventListener('paste'"));

  const st = (await import('node:fs')).readFileSync(
    new URL('../sdk/storage.js', import.meta.url), 'utf8');
  check('B7: localStorage menyimpan bentuk ringkas, bukan memotong di 30',
    st.includes('feat:null') && st.includes('slice(-90)'));
}

// --- laporan ---------------------------------------------------------------
const failed = results.filter(r => !r.ok);
const summary = `\nAUDIT VALIDITAS PENGUKURAN (A1..A5, B1..B7)\n` +
  results.map(r => `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.note ? '  [' + r.note + ']' : ''}`).join('\n') +
  `\n\n  passed ${results.length - failed.length} / ${results.length}\n` +
  `  RESULT: ${failed.length ? 'FAIL' : 'PASS'}\n`;

console.log(summary);
if (failed.length) process.exit(1);
export { results };
