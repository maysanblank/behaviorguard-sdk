/**
 * idle.test.mjs - regresi segmentasi idle (C-23).
 *
 * Yang dikunci di sini:
 *  1. Jeda idle memang MERUSAK fitur kalau tidak dipotong (bukti angka, bukan klaim).
 *  2. Setelah dipecah per segmen, fitur kembali ke nilai yang benar.
 *  3. Ekor yang masih hidup dikembalikan (tidak dibuang), ekor basi dijatuhkan.
 *  4. Akuntansi waktu aktif vs idle.
 *
 * Jalankan: node core/idle.test.mjs   (atau buka core/idle.test.html)
 */
import { segmentByIdle, idleAccounting, splitForAssessment, classifyGap,
         GAP_MS_DEFAULT, AWAY_MS_DEFAULT } from '../sdk/core/idle.js';
import { extractF4 } from '../sdk/core/features.js';

const results = [];
const check = (name, cond, note) => results.push({ name, ok: !!cond, note });
const near = (a, b, tol) => Math.abs(a - b) <= tol;

const T0 = 1_700_000_000_000;

/** Rentetan aktivitas padat: gerak mouse + klik + ketik, interval wajar. */
function burst(startTs, n = 40, step = 120) {
  const ev = [];
  let t = startTs, seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < n; i++) {
    t += step + Math.floor(rnd() * 40);
    if (i % 5 === 0)      ev.push({ event_type: 'MOUSE_CLICK', x: 100 + rnd() * 200, y: 90 + rnd() * 150, timestamp: t });
    else if (i % 3 === 0) ev.push({ event_type: 'KEYSTROKE', key: 'abcde'[i % 5], hold_time: 70 + rnd() * 40, timestamp: t });
    else                  ev.push({ event_type: 'MOUSE_MOVE', x: 100 + rnd() * 200, y: 90 + rnd() * 150, velocity: 0.2 + rnd() * 2, timestamp: t });
  }
  return ev;
}

// ---------------------------------------------------------------------------
// 1. Segmentasi dasar
// ---------------------------------------------------------------------------
const A = burst(T0, 40);
const AFK_MS = 12 * 60 * 1000;                       // 12 menit ditinggal
const B = burst(A[A.length - 1].timestamp + AFK_MS, 40);
const gapped = [...A, ...B];

const segs = segmentByIdle(gapped, GAP_MS_DEFAULT);
check('sesi dengan jeda 12 menit terpecah jadi 2 segmen', segs.length === 2, `dapat ${segs.length}`);
check('segmen 1 berisi seluruh rentetan pertama', segs[0].events.length === A.length);
check('segmen 2 berisi seluruh rentetan kedua', segs[1].events.length === B.length);
check('jeda sebelum segmen 2 tercatat utuh', near(segs[1].gapBeforeMs, AFK_MS, 200));
check('tidak ada event yang hilang',
  segs.reduce((s, x) => s + x.events.length, 0) === gapped.length);

const oneSeg = segmentByIdle(A, GAP_MS_DEFAULT);
check('sesi padat tanpa jeda tetap 1 segmen', oneSeg.length === 1);

check('event kosong -> tanpa segmen', segmentByIdle([], GAP_MS_DEFAULT).length === 0);
check('satu event -> satu segmen', segmentByIdle([A[0]], GAP_MS_DEFAULT).length === 1);

// urutan acak (akumulator bg:pending menggabung ekor lintas-halaman) tetap benar
const shuffled = [...gapped].sort(() => 0.5 - ((T0 % 7) / 7));
check('masukan tak terurut tetap tersegmentasi benar',
  segmentByIdle(shuffled, GAP_MS_DEFAULT).length === 2);

// ---------------------------------------------------------------------------
// 2. INTI: jeda idle merusak fitur; segmentasi mengembalikannya
// ---------------------------------------------------------------------------
const fGapped = extractF4(gapped);           // cara LAMA: satu vektor melintasi jeda
const fSeg    = extractF4(segs[1].events);   // cara BARU: hanya segmen kontigu
const fClean  = extractF4(B);                // acuan: rentetan yang sama tanpa jeda

check('acuan: segmen hasil pemotongan identik dengan rentetan bersih',
  near(fSeg.temporal_session_duration, fClean.temporal_session_duration, 1e-9) &&
  near(fSeg.mouse_click_interval_mean, fClean.mouse_click_interval_mean, 1e-9));

// temporal_session_duration: jam dinding vs waktu aktif
check('LAMA: durasi ikut menelan 12 menit mati',
  fGapped.temporal_session_duration > 700,
  `${fGapped.temporal_session_duration.toFixed(1)} dtk`);
check('BARU: durasi = waktu aktif segmen saja',
  fSeg.temporal_session_duration < 30,
  `${fSeg.temporal_session_duration.toFixed(1)} dtk`);

// mouse_click_interval_mean: satu jeda raksasa mendominasi rata-rata
check('LAMA: rata-rata interval klik meledak karena satu jeda',
  fGapped.mouse_click_interval_mean > 10 * fSeg.mouse_click_interval_mean,
  `${fGapped.mouse_click_interval_mean.toFixed(0)} ms vs ${fSeg.mouse_click_interval_mean.toFixed(0)} ms`);

// keystroke_typing_speed: keyEv.length / duration runtuh
check('LAMA: kecepatan ketik runtuh ke ~0',
  fGapped.keystroke_typing_speed < 0.1 * fSeg.keystroke_typing_speed,
  `${fGapped.keystroke_typing_speed.toFixed(3)} vs ${fSeg.keystroke_typing_speed.toFixed(3)}`);

// keystroke_flight_time_mean: satu selisih raksasa menarik mean
check('LAMA: flight time rata-rata tertarik jeda',
  fGapped.keystroke_flight_time_mean > 5 * fSeg.keystroke_flight_time_mean,
  `${fGapped.keystroke_flight_time_mean.toFixed(0)} ms vs ${fSeg.keystroke_flight_time_mean.toFixed(0)} ms`);

// fitur yang TIDAK boleh berubah karena segmentasi (bukan fungsi waktu)
check('entropi transisi tuts tidak dirusak jeda (kontrol negatif)',
  near(extractF4(A).keystroke_transition_entropy, segmentByIdle(A)[0].events.length ? extractF4(segmentByIdle(A)[0].events).keystroke_transition_entropy : -1, 1e-12));

// ---------------------------------------------------------------------------
// 3. splitForAssessment: ekor hidup dikembalikan, ekor basi dijatuhkan
// ---------------------------------------------------------------------------
const big = burst(T0, 40);
const tail = burst(big[big.length - 1].timestamp + 60_000, 8);   // 8 event, terlalu pendek
const mixSegs = segmentByIdle([...big, ...tail], GAP_MS_DEFAULT);
const nowFresh = tail[tail.length - 1].timestamp + 2_000;        // ekor baru saja terjadi
const nowStale = tail[tail.length - 1].timestamp + 120_000;      // ekor sudah basi

const fresh = splitForAssessment(mixSegs, 30, nowFresh, GAP_MS_DEFAULT);
check('segmen panjang dinilai', fresh.assess.length === 1);
check('ekor pendek yang masih hidup DIKEMBALIKAN, bukan dibuang',
  fresh.carry && fresh.carry.events.length === 8);
check('tidak ada yang dijatuhkan saat ekor masih hidup', fresh.dropped.length === 0);

const stale = splitForAssessment(mixSegs, 30, nowStale, GAP_MS_DEFAULT);
check('ekor basi tidak dikembalikan ke buffer', stale.carry === null);
check('ekor basi dijatuhkan (dan bisa dilaporkan)', stale.dropped.length === 1);

const allShort = splitForAssessment(segmentByIdle(burst(T0, 5), GAP_MS_DEFAULT), 30, T0 + 6_000, GAP_MS_DEFAULT);
check('tak ada segmen layak -> assess kosong (pemicu ABSTAIN)', allShort.assess.length === 0);

// ---------------------------------------------------------------------------
// 4. Akuntansi waktu + klasifikasi jeda
// ---------------------------------------------------------------------------
const acct = idleAccounting(gapped, GAP_MS_DEFAULT);
check('akuntansi: 2 segmen', acct.segments === 2);
check('akuntansi: idleMs ≈ jeda sebenarnya', near(acct.idleMs, AFK_MS, 300), `${acct.idleMs} ms`);
check('akuntansi: wall = aktif + idle', near(acct.wallMs, acct.activeMs + acct.idleMs, 2));
check('akuntansi: rasio aktif kecil untuk sesi yang mayoritas ditinggal',
  acct.activeRatio < 0.05, acct.activeRatio.toFixed(4));
check('akuntansi: jeda terpanjang tercatat', near(acct.longestGapMs, AFK_MS, 300));
check('akuntansi sesi padat: rasio aktif 1.0', idleAccounting(A, GAP_MS_DEFAULT).activeRatio === 1);
check('akuntansi tanpa event aman', idleAccounting([], GAP_MS_DEFAULT).activeRatio === 0);

check('jeda 2 dtk = micro (masih perilaku)', classifyGap(2_000) === 'micro');
check('jeda 45 dtk = idle (jangan diukur melintas)', classifyGap(45_000) === 'idle');
check('jeda 12 mnt = away (kursi mungkin kosong)', classifyGap(AFK_MS) === 'away');
check('ambang away default 5 menit', AWAY_MS_DEFAULT === 300_000);

// --- laporan ---------------------------------------------------------------
const failed = results.filter(r => !r.ok);
const summary = `\nIDLE SEGMENTATION (C-23)\n` +
  results.map(r => `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.note ? '  [' + r.note + ']' : ''}`).join('\n') +
  `\n\n  passed ${results.length - failed.length} / ${results.length}\n` +
  `  RESULT: ${failed.length ? 'FAIL' : 'PASS'}\n`;

if (typeof window !== 'undefined') {
  window.BG_IDLE_TEST = { total: results.length, failed: failed.length, results };
  const pre = document.createElement('pre');
  pre.textContent = summary;
  document.body.appendChild(pre);
} else {
  console.log(summary);
  if (failed.length) process.exit(1);
}
export { results };
