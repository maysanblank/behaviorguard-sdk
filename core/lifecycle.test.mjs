/**
 * lifecycle.test.mjs — siklus hidup jangka panjang & API integrator (C-31..C-33).
 *
 *  A. Blok pendaftaran adalah jangkar: tidak bergulir keluar dari kolam, tidak
 *     terpotong penyimpanan, walau ada sesi tak-layak di masa pendaftaran.
 *  B. Riwayat dibatasi (historyMax), tidak tumbuh tanpa batas.
 *  C. Jadwal latih ulang terus berjalan sesudah kolam penuh.
 *  D. Bukti ditunda sampai minEventsAssess; ekor segar dikumpulkan lintas jendela
 *     walau pengguna diam > 30 dtk; ekor pending basi dibuang saat init.
 *  E. reportStepUp: integrator bisa membersihkan lantai & melatih sesi terverifikasi.
 *  F. assessNow: seketika, tanpa efek samping, gagal-tertutup saat bukti kurang.
 *  G. Jalur bot tidak lagi menghapus template MFA dari penyimpanan.
 *
 * Jalankan: node core/lifecycle.test.mjs
 */
import { BehaviorGuard } from '../sdk/behaviorguard.js';
import { storage } from '../sdk/storage.js';

const results = [];
const check = (name, cond, note) => results.push({ name, ok: !!cond, note });

let NOW = Date.UTC(2026, 8, 11, 2, 0, 0);
Date.now = () => NOW;
let seed = 7;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
function burst(t, n = 160, jitter = 1) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    t += 60 + Math.floor(rnd() * 90 * jitter);
    const r = i % 12;
    if (r === 0) ev.push({ event_type: 'MOUSE_CLICK', x: 120 + rnd() * 300, y: 100 + rnd() * 200, timestamp: t });
    else if (r === 1) ev.push({ event_type: 'MOUSE_SCROLL', scroll_delta: 40 + rnd() * 120, timestamp: t });
    else if (r === 2) ev.push({ event_type: 'FORM_FOCUS', timestamp: t });
    else if (r === 3) ev.push({ event_type: 'FORM_BLUR', timestamp: t });
    else if (r % 2 === 1) ev.push({ event_type: 'KEYSTROKE', key: 'k' + (i % 7), hold_time: 60 + rnd() * 50, timestamp: t });
    else ev.push({ event_type: 'MOUSE_MOVE', x: 120 + rnd() * 300, y: 100 + rnd() * 200, velocity: 0.15 + rnd() * 2.5, timestamp: t });
  }
  return ev;
}
async function guard(uid, extra = {}) {
  const g = new BehaviorGuard();
  await g.init({ userId: uid, mfa: { enabled: false }, ...extra });
  try { clearInterval(g._autoTimer); } catch {}
  g.onRisk = () => {};
  return g;
}
const feedOne = async (g, evs) => { NOW = Math.max(NOW, evs[evs.length - 1].timestamp + 1000); return g.scoreExternalEvents(evs); };

// ---------------------------------------------------------------- A + B + C
{
  const g = await guard('uji-siklus@contoh.id', { session: { minEventsAssess: 30 } });
  let t = NOW;
  // pendaftaran dengan 2 sesi TAK-LAYAK (terlalu sedikit event untuk melatih) di tengahnya
  for (let i = 0; i < 12; i++) {
    const n = (i === 3 || i === 6) ? 40 : 160;
    await feedOne(g, burst(t, n)); t += 20 * 60_000;
  }
  const pre = g._enrollPrefix();
  check('A: ujung blok pendaftaran = sesudah sesi LAYAK ke-10 (bukan indeks 10)', pre === 12, `prefix ${pre}`);
  const enrollVecs = g.sessions.slice(0, pre).filter(s => s.eligible !== false).map(s => s.vector);
  check('A: 10 vektor pendaftaran layak', enrollVecs.length === 10);
  // 300 sesi LOW berikutnya: kolam progresif bergulir, riwayat dipadatkan
  const rebuilds = [];
  const orig = g._rebuildModel.bind(g);
  g._rebuildModel = () => { rebuilds.push(g.sessions.length); return orig(); };
  for (let i = 0; i < 300; i++) { await feedOne(g, burst(t, 160)); t += 20 * 60_000; }
  const tv = g._trainingVectors();
  check('A: seluruh vektor pendaftaran tetap di kolam sesudah 300 sesi',
    enrollVecs.every(v => tv.some(w => w === v)), `${tv.length} vektor kolam`);
  check('B: riwayat dibatasi (blok pendaftaran + historyMax)', g.sessions.length <= pre + g.cfg.historyMax,
    `${g.sessions.length} entri`);
  // Model yang konvergen SENGAJA berhenti latih ulang selama semua vonis LOW (C-15), jadi
  // jumlah totalnya tidak diharapkan 300/6. Yang dikunci: latih ulang masih terjadi
  // SESUDAH kolam progresif penuh (dulu: ukuran kolam macet -> tiap sesi atau tak pernah).
  const afterFull = rebuilds.filter(n => n > pre + g.cfg.progressiveMaxPool + 10).length;
  check('C: latih ulang tetap berjalan sesudah kolam penuh, tapi tidak tiap sesi',
    afterFull >= 1 && rebuilds.length < 300, `${rebuilds.length} total, ${afterFull} sesudah kolam penuh`);
  // storage tanpa IndexedDB: blok pendaftaran tidak boleh terpotong
  const mem = new Map();
  globalThis.localStorage = { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
  await g._persist();
  const sealed = mem.get('bg:uji-siklus@contoh.id');
  const [, b64] = sealed.split(':');
  const saved = JSON.parse(decodeURIComponent(escape(atob(b64))));
  const savedPre = saved.sessions.slice(0, saved.enrollPrefix).filter(s => s.eligible !== false);
  check('A: salinan localStorage mempertahankan blok pendaftaran di DEPAN',
    savedPre.length === 10 && savedPre.every((s, i) => JSON.stringify(s.vector) === JSON.stringify(enrollVecs[i])),
    `${saved.sessions.length} sesi disimpan, prefix ${saved.enrollPrefix}`);
  delete globalThis.localStorage;
}

// ---------------------------------------------------------------- D
{
  const g = await guard('uji-bukti@contoh.id');
  check('D: default minEventsAssess = 150', g.cfg.session.minEventsAssess === 150);
  const buf = [];
  g.capture = { buffer: buf, drain() { const c = buf.slice(); buf.length = 0; return c; }, peek() { return buf.slice(); } };
  const seen = []; g.onRisk = e => seen.push(e);
  let t = NOW;
  const a = burst(t, 80); buf.push(...a);
  NOW = a[a.length - 1].timestamp + 1000; await g.endSession();
  check('D: 80 event -> belum ada vonis, ekor dikembalikan ke buffer', seen.filter(e => !e.abstain).length === 0 && buf.length === 80, `buffer ${buf.length}`);
  NOW += 60_000; await g.endSession();                       // diam 60 dtk (> idleGapSec 30)
  check('D: diam 60 dtk tidak membuang bukti yang sedang dikumpulkan', buf.length === 80, `buffer ${buf.length}`);
  const b = burst(NOW, 90); buf.push(...b);
  NOW = b[b.length - 1].timestamp + 1000; await g.endSession();
  const v = seen.filter(e => !e.abstain);
  check('D: 80 + 90 event -> SATU vonis atas 170 event', v.length === 1 && buf.length === 0,
    `${v.length} vonis, buffer ${buf.length}`);
  NOW += 20 * 60_000; await g.endSession();
  // ekor basi di pending saat init
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: k => store.delete(k) };
  const tail = burst(NOW - 3 * 3600_000, 60);                // ekor 3 jam lalu
  store.set('bg:pending:uji-basi@contoh.id', JSON.stringify(tail));
  const g2 = await guard('uji-basi@contoh.id');
  check('D: ekor pending berumur 3 jam dibuang saat init', !store.has('bg:pending:uji-basi@contoh.id') && !g2._pendingEvents);
  const fresh = burst(NOW - 60_000, 60);
  store.set('bg:pending:uji-segar@contoh.id', JSON.stringify(fresh));
  await guard('uji-segar@contoh.id');
  check('D: ekor pending 1 menit lalu (pindah halaman) tetap dipakai', store.has('bg:pending:uji-segar@contoh.id'));
  delete globalThis.localStorage;
}

// ---------------------------------------------------------------- E + F
{
  const g = await guard('uji-stepup@contoh.id', { session: { minEventsAssess: 30 } });
  let t = NOW;
  for (let i = 0; i < 12; i++) { await feedOne(g, burst(t, 160)); t += 20 * 60_000; }
  g.lastRisk = 'HIGH'; g._highRun = 1;                        // habis vonis HIGH
  g.sessions[g.sessions.length - 1].risk = 'HIGH';             // sesi itu tidak LOW -> belum melatih
  const before = g._trainingVectors().length;
  const r = await g.reportStepUp({ passed: true });
  check('E: reportStepUp(passed) membersihkan lantai lengket', r.applied && g.lastRisk === 'LOW' && g._highRun === 0);
  check('E: sesi yang lolos verifikasi ikut melatih model', g._trainingVectors().length === before + 1);
  const saved = await storage.get('bg:uji-stepup@contoh.id');
  check('E: hasilnya tersimpan (kunjungan berikutnya tidak memuat lantai lama)', saved && saved.lastRisk === 'LOW');
  const r2 = await g.reportStepUp({ passed: false });
  check('E: reportStepUp(gagal) tidak membersihkan apa pun', !r2.applied);

  // F. assessNow
  const buf = [];
  g.capture = { buffer: buf, drain() { const c = buf.slice(); buf.length = 0; return c; }, peek() { return buf.slice(); } };
  buf.push(...burst(t, 12));
  const a = g.assessNow();
  check('F: bukti < 30 -> UNKNOWN + minta verifikasi (gagal-tertutup)', a.level === 'UNKNOWN' && a.action === 'REQUIRE_STEPUP');
  buf.push(...burst(buf[buf.length - 1].timestamp, 60));
  const snap = JSON.stringify({ s: g.sessions.length, lr: g.lastRisk, hr: g._highRun, ls: g._lowStreak, b: buf.length });
  const b = g.assessNow();
  check('F: bukti cukup -> vonis nyata, bukti & status parsialnya dilaporkan', ['LOW', 'MEDIUM', 'HIGH'].includes(b.level)
    && b.evidence.events === 72 && b.evidence.partial === (72 < g.cfg.session.minEventsAssess),
    `${b.level}, ${b.evidence.events} event`);
  check('F: TANPA efek samping (buffer, kolam, lantai, hitungan HIGH utuh)',
    snap === JSON.stringify({ s: g.sessions.length, lr: g.lastRisk, hr: g._highRun, ls: g._lowStreak, b: buf.length }));
  g.lastRisk = 'MEDIUM';
  const c = g.assessNow();
  check('F: lantai lengket yang belum terselesaikan ikut menaikkan vonis', c.level !== 'LOW', c.level);
  const fresh = await guard('uji-baru@contoh.id');
  check('F: selama pendaftaran -> UNKNOWN (belum ada pembanding)', fresh.assessNow().enrollment === true);
}

// ---------------------------------------------------------------- G
{
  const g = await guard('uji-bot@contoh.id', { session: { minEventsAssess: 30 } });
  let t = NOW;
  for (let i = 0; i < 12; i++) { await feedOne(g, burst(t, 160)); t += 20 * 60_000; }
  g.challengeTemplate = { phrase: 'x', dwell: [1], flight: [1] };
  await g._persist();
  // bot: interval PERSIS konstan
  const bot = []; let bt = t;
  for (let i = 0; i < 60; i++) { bt += 100; bot.push({ event_type: i % 2 ? 'KEYSTROKE' : 'MOUSE_CLICK', key: 'k1', hold_time: 80, x: 5, y: 5, timestamp: bt }); }
  const e = await feedOne(g, bot);
  const saved = await storage.get('bg:uji-bot@contoh.id');
  check('G: sesi bot tetap diblokir', e && e.integrity === true);
  check('G: template MFA pemilik TIDAK terhapus dari penyimpanan oleh jalur bot', saved && saved.challengeTemplate && saved.challengeTemplate.phrase === 'x');
  check('G: memori & penyimpanan sepakat soal lastRisk', g.lastRisk === saved.lastRisk, `${g.lastRisk}/${saved.lastRisk}`);
}

const failed = results.filter(r => !r.ok);
console.log(`\nSIKLUS HIDUP & API INTEGRATOR (C-31..C-33)\n` +
  results.map(r => `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.note ? '  [' + r.note + ']' : ''}`).join('\n') +
  `\n\n  lulus ${results.length - failed.length} / ${results.length}\n  HASIL: ${failed.length ? 'ADA KEGAGALAN' : 'SESUAI'}\n`);
if (failed.length) process.exit(1);
export { results };
