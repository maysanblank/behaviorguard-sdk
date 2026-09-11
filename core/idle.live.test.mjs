/**
 * idle.live.test.mjs — jalur PENUH orkestrator untuk C-23 (bukan cuma modulnya).
 *
 * Yang diuji di sini adalah hal yang tidak kelihatan dari `idle.test.mjs`:
 * bagaimana `behaviorguard.js` bereaksi pada sesi yang di tengahnya ada absen.
 *  A. Sesi yang di dalamnya ada jeda 20 menit tidak lagi dinilai sebagai SATU
 *     sesi panjang — ia jadi dua vonis, masing-masing dengan durasi aktifnya.
 *  B. Vonis untuk perilaku SESUDAH absen panjang membawa `resumedAfterAway`, dan
 *     LOW dinaikkan jadi MEDIUM supaya step-up jalan (serangan jam makan siang).
 *  C. Jeda idle biasa (< awaySec) dipotong untuk pengukuran tapi TIDAK mengganggu
 *     pengguna — tidak ada verifikasi ulang.
 *  D. Jendela yang isinya idle menerbitkan ABSTAIN, bukan diam yang dibaca aman.
 *  E. C-28 (DEFAULT sekarang): jeda dikompresi, batch dinilai UTUH jadi satu vonis,
 *     tapi sisi keamanannya (away / verifikasi ulang) tetap jalan.
 *
 * A-D menguji jalur segmentasi C-23 LAMA, jadi dijalankan dengan
 * `session:{idleCompressSec:0}` secara eksplisit. Jalur itu tetap tersedia sebagai knob.
 *
 * Berjalan tanpa DOM: MFA mematikan diri sendiri kalau `document` tidak ada, dan
 * storage jatuh ke memori. Jalankan: node core/idle.live.test.mjs
 */
import { BehaviorGuard } from '../sdk/behaviorguard.js';

const results = [];
const check = (name, cond, note) => results.push({ name, ok: !!cond, note });

const MIN = 60_000;
let seed = 2026;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;

/** Rentetan aktivitas realistis: cukup panjang & beragam untuk lolos gerbang latih. */
function burst(startTs, n = 140, jitter = 1) {
  const ev = [];
  let t = startTs;
  for (let i = 0; i < n; i++) {
    t += 60 + Math.floor(rnd() * 90 * jitter);
    const r = i % 12;
    if (r === 0)      ev.push({ event_type: 'MOUSE_CLICK', x: 120 + rnd() * 300, y: 100 + rnd() * 200, timestamp: t, page_url: 'https://toko/p' });
    else if (r === 1) ev.push({ event_type: 'MOUSE_SCROLL', scroll_delta: 40 + rnd() * 120, timestamp: t, page_url: 'https://toko/p' });
    else if (r === 2) ev.push({ event_type: 'FORM_FOCUS', timestamp: t, page_url: 'https://toko/p' });
    else if (r === 3) ev.push({ event_type: 'FORM_BLUR', timestamp: t, page_url: 'https://toko/p' });
    else if (r === 4) ev.push({ event_type: 'NAVIGATION', timestamp: t, page_url: 'https://toko/p' + (i % 3) });
    else if (r % 2 === 1) ev.push({ event_type: 'KEYSTROKE', key: 'abcdefg'[i % 7], hold_time: 60 + rnd() * 50, timestamp: t });
    else ev.push({ event_type: 'MOUSE_MOVE', x: 120 + rnd() * 300, y: 100 + rnd() * 200, velocity: 0.15 + rnd() * 2.5, timestamp: t });
  }
  return ev;
}

const bg = new BehaviorGuard();
// minEventsAssess 30: tes ini menguji logika idle, bukan ukuran bukti (C-33 -> lifecycle.test)
await bg.init({ userId: 'uji-idle@contoh.id', mfa: { enabled: false }, session: { idleCompressSec: 0, minEventsAssess: 30 } });
try { clearInterval(bg._autoTimer); } catch {}   // jangan tahan proses tetap hidup

// --- pendaftaran: 10 sesi bersih ------------------------------------------
let t = Date.UTC(2026, 8, 9, 3, 0, 0);
for (let i = 0; i < 10; i++) {
  await bg.scoreExternalEvents(burst(t));
  t += 20 * MIN;
}
check('pendaftaran selesai, model terbentuk', !!bg.model, `${bg.sessions.length} sesi`);

// --- A. satu panggilan berisi jeda 20 menit -> DUA vonis -------------------
const seen = [];
bg.onRisk = e => seen.push(e);

const a = burst(t, 140);
const gapMs = 20 * MIN;
const b = burst(a[a.length - 1].timestamp + gapMs, 140);
const last = await bg.scoreExternalEvents([...a, ...b]);

check('A: satu batch bergap menghasilkan 2 vonis, bukan 1',
  seen.length === 2, `${seen.length} vonis`);
check('A: durasi yang dinilai = waktu AKTIF, bukan 20 menit jam dinding',
  seen.every(e => e.features && e.features.temporal_session_duration < 60),
  seen.map(e => e.features && e.features.temporal_session_duration.toFixed(1)).join(' / ') + ' dtk');
check('A: telemetri idle ikut di setiap vonis',
  seen.every(e => e.idle && typeof e.idle.activeSec === 'number'));
check('A: segmen kedua mencatat jeda 20 menit sebagai "away"',
  seen[1].idle.gapClass === 'away' && Math.abs(seen[1].idle.gapBeforeMs - gapMs) < 500);

// --- B. perilaku sesudah absen panjang -> verifikasi ulang -----------------
check('B: vonis sesudah absen menandai resumedAfterAway',
  !!last.resumedAfterAway, JSON.stringify(last.resumedAfterAway));
check('B: absen tercatat ~20 menit',
  Math.abs(last.resumedAfterAway.awayMs - gapMs) < 500);
check('B: LOW dinaikkan jadi MEDIUM (step-up), bukan dilewatkan',
  last.reverifyAfterAway === true && last.level === 'MEDIUM' && last.modelLevel === 'LOW',
  `model=${last.modelLevel} vonis=${last.level}`);
check('B: aksinya minta verifikasi', last.action === 'REQUIRE_MFA', last.action);
check('B: alasannya bisa dibaca manusia',
  last.reasons.some(r => r.includes('absen')), last.reasons[0]);
check('B: vonis segmen PERTAMA (sebelum absen) tidak ikut dinaikkan',
  seen[0].reverifyAfterAway === false && !seen[0].resumedAfterAway);

// --- C. jeda idle biasa (< awaySec) tidak mengganggu pengguna --------------
seen.length = 0;
let t2 = last.features ? b[b.length - 1].timestamp + 30 * MIN : t;
const c1 = burst(t2, 140);
const c2 = burst(c1[c1.length - 1].timestamp + 90_000, 140);   // 90 dtk: idle, bukan away
await bg.scoreExternalEvents([...c1, ...c2]);
check('C: jeda 90 dtk tetap memotong pengukuran jadi 2 segmen', seen.length === 2);
check('C: 90 dtk diklasifikasi "idle", bukan "away"', seen[1].idle.gapClass === 'idle');
check('C: jeda idle biasa TIDAK memicu verifikasi ulang',
  seen.every(e => e.reverifyAfterAway === false));

// --- D. jendela tanpa bukti -> ABSTAIN, bukan diam -------------------------
seen.length = 0;
bg.cfg.idle.abstainAfterWindows = 2;
bg._noAssessRuns = 0; bg._abstainEmitted = false;
const r1 = await bg.scoreExternalEvents([]);          // jendela 1: kosong
const r2 = await bg.scoreExternalEvents([]);          // jendela 2: ambang tercapai
const r3 = await bg.scoreExternalEvents([]);          // jendela 3: tidak spam
check('D: jendela idle pertama belum menerbitkan apa-apa', r1 === null);
check('D: jendela idle kedua menerbitkan ABSTAIN',
  r2 && r2.action === 'ABSTAIN' && r2.level === 'UNKNOWN');
check('D: ABSTAIN tidak dibanjiri tiap jendela', r3 === null);
check('D: ABSTAIN menjelaskan alasannya', r2.reasons[0].includes('ditinggal'), r2.reasons[0]);
check('D: ABSTAIN tidak pernah dianggap sesi layak latih', r2.eligible === false);
check('D: hanya satu callback untuk seluruh rentetan idle', seen.length === 1);

// --- E. C-28: kompresi (default) -------------------------------------------
const bc = new BehaviorGuard();
await bc.init({ userId: 'uji-kompres@contoh.id', mfa: { enabled: false }, session: { minEventsAssess: 30 } });
try { clearInterval(bc._autoTimer); } catch {}
check('E: default mengirim kompresi 15 dtk', bc.cfg.session.idleCompressSec === 15);
let tc = Date.UTC(2026, 8, 9, 3, 0, 0);
for (let i = 0; i < 10; i++) { await bc.scoreExternalEvents(burst(tc)); tc += 20 * MIN; }
const seenC = [];
bc.onRisk = e => seenC.push(e);
// dua separuh 70 event = 140, sama panjang dgn sesi pendaftaran: yang diuji di sini
// jedanya, bukan panjang sesinya (itu urusan C-24)
const ca = burst(tc, 70);
const cb = burst(ca[ca.length - 1].timestamp + gapMs, 70);
const lastC = await bc.scoreExternalEvents([...ca, ...cb]);
check('E: batch dengan jeda 20 menit dinilai UTUH jadi 1 vonis', seenC.length === 1, `${seenC.length} vonis`);
check('E: durasi yang dinilai = waktu aktif + sisa jeda 15 dtk, bukan 20 menit',
  lastC.features.temporal_session_duration < 60, lastC.features.temporal_session_duration.toFixed(1) + ' dtk');
check('E: telemetri tetap mencatat 2 rentetan aktif di dalam 1 vonis', seenC[0].idle && seenC[0].idle.batchSegments === 2,
  String(seenC[0].idle && seenC[0].idle.batchSegments));
check('E: absen 20 menit TETAP terdeteksi dari waktu asli', !!lastC.resumedAfterAway &&
  Math.abs(lastC.resumedAfterAway.awayMs - gapMs) < 500, JSON.stringify(lastC.resumedAfterAway));
check('E: jeda diklasifikasi "away"', lastC.idle.gapClass === 'away');
check('E: LOW dinaikkan jadi MEDIUM (serangan jam makan siang tetap ditangani)',
  lastC.modelLevel !== 'LOW' || (lastC.reverifyAfterAway === true && lastC.level === 'MEDIUM'),
  `model=${lastC.modelLevel} vonis=${lastC.level}`);

seenC.length = 0;
const cc1 = burst(b[b.length - 1].timestamp + 60 * MIN, 70);
const cc2 = burst(cc1[cc1.length - 1].timestamp + 90_000, 70);
await bc.scoreExternalEvents([...cc1, ...cc2]);
check('E: jeda 90 dtk -> tetap 1 vonis (tidak dipecah)', seenC.length === 1);
check('E: 90 dtk diklasifikasi "idle"', seenC[0].idle.gapClass === 'idle');
check('E: jeda idle biasa TIDAK memicu verifikasi ulang', seenC[0].reverifyAfterAway === false);

const raw = [...ca, ...cb];
const unit = bc._compressedUnit(raw, { longestGapMs: gapMs });
check('E: ekor yang dikembalikan ke buffer memakai event ASLI, bukan hasil kompresi',
  unit[0].rawEvents === raw && unit[0].endTs === cb[cb.length - 1].timestamp);
check('E: tak ada event yang dibuang ke unit penilaian', unit[0].events.length === raw.length);
check('E: kompresi 0 = jalur segmentasi lama',
  (await (async () => { bc.cfg.session.idleCompressSec = 0; seenC.length = 0;
     await bc.scoreExternalEvents([...burst(tc + 200 * MIN, 140), ...burst(tc + 230 * MIN, 140)]);
     bc.cfg.session.idleCompressSec = 15; return seenC.length; })()) === 2);

// --- laporan ---------------------------------------------------------------
const failed = results.filter(r => !r.ok);
const summary = `\nIDLE — JALUR PENUH ORKESTRATOR (C-23 + C-28)\n` +
  results.map(r => `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.note ? '  [' + r.note + ']' : ''}`).join('\n') +
  `\n\n  lulus ${results.length - failed.length} / ${results.length}\n` +
  `  HASIL: ${failed.length ? 'ADA KEGAGALAN' : 'SESUAI'}\n`;

console.log(summary);
if (failed.length) process.exit(1);
export { results };
