/**
 * lifecycle.test.mjs - siklus hidup jangka panjang & API integrator (C-31..C-33).
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
 *  H-I. Rekam-ulang, sidik perangkat, init ulang (C-35..C-38).
 *  J. Masa berlaku step-up (C-43): hanya sesudah verifikasi terbukti, hanya MEDIUM,
 *     dicabut oleh absen / kedaluwarsa, tidak melatih model.
 *  K. Jendela geser opt-in (C-42): vonis pertama tanpa konteks, konteks dibuang
 *     sesudah absen, tempel di konteks tidak mencemari vonis berikutnya.
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

// ---------------------------------------------------------------- H (C-35) rekam-ulang
{
  const g = await guard('uji-replay@contoh.id', { session: { minEventsAssess: 30 } });
  let t = NOW;
  const rec = [];
  for (let i = 0; i < 14; i++) { const b = burst(t, 160); rec.push(b); await feedOne(g, b); t += 20 * 60_000; }
  const fresh = await feedOne(g, burst(t, 160)); t += 20 * 60_000;
  check('H: sesi pemilik baru (bukan rekaman) tidak dituduh rekam-ulang', fresh && !fresh.replay, fresh && fresh.level);
  // putar ulang sesi ke-12 dengan waktu digeser 3 hari
  const shiftMs = 3 * 86_400_000;
  const replayed = rec[12].map(e => ({ ...e, timestamp: e.timestamp + shiftMs }));
  const before = g._trainingVectors().length;
  const r = await feedOne(g, replayed);
  check('H: rekaman yang diputar ulang dengan waktu digeser -> HIGH + alasan rekam-ulang',
    r && r.level === 'HIGH' && r.replay && r.reasons[0].includes('rekam-ulang'), r && `${r.level} jarak ${r.replay && r.replay.distance}`);
  check('H: sesi rekam-ulang tidak pernah melatih model', g._trainingVectors().length === before && r.eligible === false);
  const jit = rec[13].map(e => ({ ...e, timestamp: e.timestamp + shiftMs + 86_400_000 + Math.round((rnd() - .5) * 4) }));
  const r2 = await feedOne(g, jit);
  check('H: rekaman dengan jitter waktu +-2 ms tetap tertangkap', r2 && r2.replay, r2 && r2.replay ? r2.replay.distance.toFixed(4) : 'lolos');
}

// ---------------------------------------------------------------- I (C-36..C-38)
{
  const { normalizeUA } = await import('../sdk/core/fingerprint.js');
  const ua = v => `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`;
  check('I: pembaruan otomatis Chrome 139 -> 140 tidak mengubah sidik perangkat', normalizeUA(ua('139.0.0.0')) === normalizeUA(ua('140.0.7339.80')));
  check('I: ganti OS/browser tetap mengubah sidik',
    normalizeUA(ua('139.0.0.0')) !== normalizeUA('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'));

  // C-38: logout A -> login B (tanpa data tersimpan) di tab yang sama
  const g = new BehaviorGuard();
  await g.init({ userId: 'uji-A@contoh.id', mfa: { enabled: false }, session: { minEventsAssess: 30 } });
  try { clearInterval(g._autoTimer); } catch {}
  let t = NOW;
  for (let i = 0; i < 12; i++) { await feedOne(g, burst(t, 160)); t += 20 * 60_000; }
  g.challengeTemplate = { phrase: 'milik A' };
  check('I: (prasyarat) A punya model & template', !!g.model && !!g.challengeTemplate);
  await g.init({ userId: 'uji-B-baru@contoh.id', mfa: { enabled: false } });
  try { clearInterval(g._autoTimer); } catch {}
  check('I: B TIDAK mewarisi model, sesi, maupun template ritme milik A',
    !g.model && g.sessions.length === 0 && !g.challengeTemplate, `model=${!!g.model} sesi=${g.sessions.length} template=${!!g.challengeTemplate}`);
  check('I: opsi init() A (minEventsAssess 30) tidak terbawa ke B', g.cfg.session.minEventsAssess === 150);

  // C-37: popup pendaftaran MFA ditunda sesudah ditutup
  g._mfaEnrollSnoozeUntil = NOW + 3600_000; await g._persist();
  const g2 = new BehaviorGuard();
  await g2.init({ userId: 'uji-B-baru@contoh.id', mfa: { enabled: false } });
  try { clearInterval(g2._autoTimer); } catch {}
  check('I: penundaan popup pendaftaran MFA tersimpan lintas muat-halaman', g2._mfaEnrollSnoozeUntil === NOW + 3600_000);
}

// ---------------------------------------------------------------- J (C-43) masa berlaku step-up
{
  const g = await guard('uji-grace@contoh.id', { session: { minEventsAssess: 30 } });
  check('J: default graceSec = 900 (15 menit)', g.cfg.mfa.graceSec === 900);
  let t = NOW;
  for (let i = 0; i < 12; i++) { await feedOne(g, burst(t, 160)); t += 20 * 60_000; }
  // skor model dikendalikan supaya vonisnya pasti (yang diuji aturannya, bukan modelnya)
  const th = () => g.cfg.thresholds;
  // reportStepUp melatih ulang (model baru), jadi skor dipaksa ulang tiap jendela
  let cur = 'LOW';
  const apply = () => { const lv = cur; g.model.scoreOne = () => lv === 'MEDIUM' ? (th().low + th().medium) / 2 : lv === 'HIGH' ? th().medium - 1 : th().low + 1; };
  const force = lv => { cur = lv; apply(); };
  const win = async () => { apply(); const e = await feedOne(g, burst(t, 160)); t = NOW + 30_000; return e; };
  force('MEDIUM');
  const e0 = await win();
  check('J: tanpa verifikasi, MEDIUM tetap meminta verifikasi', e0.level === 'MEDIUM' && !e0.stepUpGrace, e0.level);
  await g.reportStepUp({ passed: true });
  const pool = g._trainingVectors().length;
  const e1 = await win();
  check('J: sesudah verifikasi lolos, MEDIUM berikutnya tidak ditanya ulang', e1.level === 'LOW' && e1.modelLevel === 'MEDIUM' && e1.stepUpGrace, `${e1.level}/${e1.modelLevel}`);
  check('J: jendela yang diredam TIDAK melatih model', g._trainingVectors().length === pool && e1.eligible === false);
  force('HIGH');
  const e2 = await win();
  check('J: HIGH dalam masa berlaku tetap meminta verifikasi', e2.level === 'HIGH' && !e2.stepUpGrace, e2.level);
  await g.reportStepUp({ passed: true });
  // muat-halaman 1 menit kemudian: masa berlaku ikut; 10 menit diam: dicabut
  NOW += 60_000;
  const g2 = await guard('uji-grace@contoh.id', { session: { minEventsAssess: 30 } });
  check('J: masa berlaku melintasi muat-halaman singkat (situs multi-halaman)', !!g2._mfaPassedAt);
  NOW += 10 * 60_000;
  const g3 = await guard('uji-grace@contoh.id', { session: { minEventsAssess: 30 } });
  check('J: muat-halaman sesudah diam >= awaySec mencabut masa berlaku', !g3._mfaPassedAt);
  // absen di TENGAH jendela (kursi mungkin berganti orang) mencabutnya
  await g.reportStepUp({ passed: true });
  force('MEDIUM');
  const a = burst(t, 80), b = burst(a[a.length - 1].timestamp + 6 * 60_000, 80);
  NOW = b[b.length - 1].timestamp + 1000;
  apply();
  const e3 = await g.scoreExternalEvents([...a, ...b]);
  check('J: absen 6 menit di tengah mencabut masa berlaku -> MEDIUM ditanya', e3.level === 'MEDIUM' && !e3.stepUpGrace, e3.level);
  // kedaluwarsa
  await g.reportStepUp({ passed: true });
  NOW += 16 * 60_000; t = NOW;
  const e4 = await win();
  check('J: lewat 15 menit, MEDIUM kembali meminta verifikasi', e4.level === 'MEDIUM', e4.level);
  // penyusup tanpa verifikasi di perangkat lain: tak pernah mendapat keringanan
  const imp = await guard('uji-grace-lain@contoh.id', { session: { minEventsAssess: 30 } });
  check('J: pengguna yang belum pernah lolos verifikasi tidak punya masa berlaku', !imp._mfaPassedAt);
}

// ---------------------------------------------------------------- K (C-42) jendela geser opt-in
{
  const mk = async (uid, ce) => {
    const g = await guard(uid, { session: { minEventsAssess: 150, contextEvents: ce } });
    const buf = [];
    g.capture = { buffer: buf, drain() { const c = buf.slice(); buf.length = 0; return c; }, peek() { return buf.slice(); } };
    return g;
  };
  check('K: default contextEvents = 0 (mati)', (await guard('uji-ctx0@contoh.id')).cfg.session.contextEvents === 0);
  const g = await mk('uji-ctx@contoh.id', 300);
  const seen = []; g.onRisk = e => { if (!e.abstain) seen.push(e); };
  const step = async evs => { g.capture.buffer.push(...evs); NOW = evs[evs.length - 1].timestamp + 1000; await g.endSession(); };
  let t = NOW;
  const w1 = burst(t, 170); w1[5] = { event_type: 'PASTE', timestamp: w1[5].timestamp };
  await step(w1);
  await step(burst(NOW, 170));
  check('K: vonis pertama kunjungan tanpa konteks (penyusup diperiksa secepat dulu)', seen[0] && seen[0].contextEvents === 0);
  check('K: vonis kedua = event baru + konteks, maksimal 300', seen[1] && seen[1].contextEvents === 130, seen[1] && seen[1].contextEvents);
  check('K: tempel di konteks tidak menandai vonis berikutnya sebagai bukti sebagian',
    seen[0].keystrokeBypassed === true && seen[1].keystrokeBypassed === false);
  await step(burst(NOW + 6 * 60_000, 170));
  check('K: sesudah absen >= awaySec konteks dibuang (tidak meminjam perilaku pemilik)', seen[2] && seen[2].contextEvents === 0, seen[2] && seen[2].contextEvents);
}

const failed = results.filter(r => !r.ok);
console.log(`\nSIKLUS HIDUP & API INTEGRATOR (C-31..C-33, C-42, C-43)\n` +
  results.map(r => `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.note ? '  [' + r.note + ']' : ''}`).join('\n') +
  `\n\n  passed ${results.length - failed.length} / ${results.length}\n  RESULT: ${failed.length ? 'FAIL' : 'PASS'}\n`);
if (failed.length) process.exit(1);
export { results };
