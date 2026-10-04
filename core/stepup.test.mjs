/**
 * stepup.test.mjs - API integrator & jalur step-up versi produksi (C-45).
 *
 *  A. init() diantrekan: dua panggilan bersamaan tidak berjalan tumpang-tindih.
 *  B. status(): fase belajar -> melindungi, tanpa membeberkan vektor.
 *  C. stepUp(): tanpa template & tanpa cadangan = unavailable (gagal-tertutup); cadangan
 *     integrator (onFallback) lolos -> lantai bersih + masa berlaku dimulai; gagal -> tidak.
 *  D. vonis otomatis tanpa template tapi dengan onFallback -> MFA_PASSED lewat cadangan;
 *     vonis yang jatuh saat dialog terbuka ditandai mfa.busy; vonis yang akan memunculkan
 *     dialog diumumkan SEKETIKA (mfa.awaiting) lalu diumumkan lagi dengan hasilnya.
 *  E. verifikasi hanya melatih jendela yang BARU dinilai.
 *  F. stop() = logout: berhenti menangkap, mencabut masa berlaku; forget() menghapus data.
 *  G. enrollMfa() ditolak saat sesi dicurigai.
 *  H. event DOM `behaviorguard:risk` disiarkan dari inti, bukan hanya dari auto-boot.
 *  I. integrity: satu langkah jam mundur bukan bot; keyboard layar sentuh bukan bot.
 *  J. challenge mode 'soft' (keyboard layar sentuh): dwell tidak dinilai, beda mode ditolak.
 *  K. irama dikunci sesudah dialog gagal beruntun; cadangan membukanya; bertahan lintas muat.
 *  L. situs http (tanpa crypto.subtle): penyimpanan, sidik, dan vonis tetap jalan.
 *  M. browser tanpa structuredClone.
 *
 * Jalankan: node core/stepup.test.mjs
 */
globalThis.window = new EventTarget();
(await import('node:events')).setMaxListeners(200, globalThis.window);   // banyak instance uji
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };

const { BehaviorGuard } = await import('../sdk/behaviorguard.js');
const { storage } = await import('../sdk/storage.js');
const { checkIntegrity } = await import('../sdk/core/integrity.js');
const { buildTemplate, verify } = await import('../sdk/core/challenge.js');

const results = [];
const check = (name, cond, note) => results.push({ name, ok: !!cond, note });

let NOW = Date.UTC(2026, 8, 12, 2, 0, 0);
Date.now = () => NOW;
let seed = 11;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
function burst(t, n = 160) {
  const ev = [];
  for (let i = 0; i < n; i++) {
    t += 60 + Math.floor(rnd() * 90);
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
const feedOne = async (g, evs) => { NOW = Math.max(NOW, evs[evs.length - 1].timestamp + 1000); return g.scoreExternalEvents(evs); };
async function enrolled(uid, mfa = { enabled: false }) {
  const g = new BehaviorGuard();
  await g.init({ userId: uid, mfa, session: { minEventsAssess: 30 } });
  g._stopTimer();
  let t = NOW;
  for (let i = 0; i < 11; i++) { await feedOne(g, burst(t)); t += 20 * 60_000; }
  return g;
}

// ---------------------------------------------------------------- A
{
  const g = new BehaviorGuard();
  let active = 0, maxActive = 0;
  const orig = g._init.bind(g);
  g._init = async (o) => { active++; maxActive = Math.max(maxActive, active); await new Promise(r => setTimeout(r, 20)); try { return await orig(o); } finally { active--; } };
  await Promise.all([g.init({ userId: 'a1@contoh.id', mfa: { enabled: false } }), g.init({ userId: 'a2@contoh.id', mfa: { enabled: false } })]);
  g._stopTimer();
  check('A: dua init() bersamaan dijalankan berurutan, bukan tumpang-tindih', maxActive === 1, `maks bersamaan ${maxActive}`);
  check('A: yang terakhir menang', g.userId === 'a2@contoh.id');
  let threw = false; try { await g.init({}); } catch { threw = true; }
  check('A: init tanpa userId tetap ditolak', threw);
}

// ---------------------------------------------------------------- B
{
  const g = new BehaviorGuard();
  await g.init({ userId: 'b@contoh.id', mfa: { enabled: false }, session: { minEventsAssess: 30 } });
  g._stopTimer();
  let st = g.status();
  check('B: sebelum ada data -> fase belajar 0/10', st.phase === 'learning' && st.enrollment.done === 0 && st.enrollment.need === 10);
  let t = NOW;
  for (let i = 0; i < 4; i++) { await feedOne(g, burst(t)); t += 20 * 60_000; }
  check('B: progres pendaftaran terhitung', g.status().enrollment.done === 4, `${g.status().enrollment.done}`);
  for (let i = 0; i < 7; i++) { await feedOne(g, burst(t)); t += 20 * 60_000; }
  st = g.status();
  check('B: sesudah 10 sesi layak -> fase melindungi', st.phase === 'protecting', st.phase);
  check('B: vonis terakhir tersedia', st.lastVerdict && ['LOW', 'MEDIUM', 'HIGH'].includes(st.lastVerdict.level));
  check('B: status tidak membeberkan vektor/sesi', !('sessions' in st) && !JSON.stringify(st).includes('vector'));
  check('B: versi tercantum', typeof st.version === 'string' && st.version.length > 0);
}

// ---------------------------------------------------------------- C
{
  const g = await enrolled('c@contoh.id', { enabled: true });
  g.lastRisk = 'HIGH'; g._highRun = 1;
  let r = await g.stepUp();
  check('C: tanpa template & tanpa cadangan -> unavailable, tidak lolos', r.unavailable && !r.verified);
  check('C: gagal-tertutup: lantai tetap', g.lastRisk === 'HIGH');
  g.cfg.mfa.onFallback = async ctx => { g._lastFallbackCtx = ctx; return false; };
  r = await g.stepUp({ reason: 'transfer' });
  check('C: cadangan gagal -> tidak lolos, lantai tetap', !r.verified && r.method === 'fallback' && g.lastRisk === 'HIGH');
  check('C: cadangan menerima konteks (trigger, alasan)', g._lastFallbackCtx && g._lastFallbackCtx.trigger === 'integrator' && g._lastFallbackCtx.reasons[0] === 'transfer');
  g.cfg.mfa.onFallback = async () => true;
  r = await g.stepUp();
  check('C: cadangan lolos -> verified lewat fallback', r.verified && r.method === 'fallback');
  check('C: lantai lengket dibersihkan & HIGH beruntun direset', g.lastRisk === 'LOW' && g._highRun === 0);
  check('C: masa berlaku step-up dimulai', g.status().mfa.graceLeftSec > 0);
  g.cfg.mfa.onFallback = async () => { throw new Error('jaringan putus'); };
  const ce = console.error; console.error = () => {};
  r = await g.stepUp();
  console.error = ce;
  check('C: cadangan yang melempar = gagal, bukan lolos', !r.verified);
  g.cfg.mfa.onFallback = async () => 'ya';
  r = await g.stepUp();
  check('C: hanya true persis yang dihitung lolos', !r.verified);
}

// ---------------------------------------------------------------- D
{
  const g = await enrolled('d@contoh.id', { enabled: true, onFallback: async () => true });
  const evt = { level: 'HIGH', action: 'REQUIRE_STEPUP', blocked: false, reasons: ['uji'] };
  await g._maybeMfa(evt);
  check('D: vonis HIGH tanpa template -> cadangan -> MFA_PASSED', evt.action === 'MFA_PASSED' && evt.mfa && evt.mfa.fallback);
  g._mfaBusy = true;
  const e2 = { level: 'MEDIUM', action: 'REQUIRE_MFA', reasons: [] };
  g._mfaPassedAt = null;
  await g._maybeMfa(e2);
  check('D: vonis saat dialog terbuka ditandai mfa.busy', e2.mfa && e2.mfa.busy === true && e2.action === 'REQUIRE_MFA');
  g._mfaBusy = false;
  const g2 = await enrolled('d2@contoh.id', { enabled: true });
  const e3 = { level: 'MEDIUM', action: 'REQUIRE_MFA', reasons: [] };
  await g2._maybeMfa(e3);
  check('D: tanpa template & tanpa cadangan -> aksi vonis tetap (bukan MFA_FAILED)', e3.action === 'REQUIRE_MFA' && e3.mfa.unavailable);
  // dengan template tapi tanpa DOM nyata: dialog tidak bisa tampil -> dibatalkan -> gagal-tertutup
  g2.challengeTemplate = buildTemplate([{ dwell: new Array(12).fill(90), flight: new Array(11).fill(140) }, { dwell: new Array(12).fill(92), flight: new Array(11).fill(142) }]);
  const e4 = { level: 'MEDIUM', action: 'REQUIRE_MFA', reasons: [] };
  await g2._maybeMfa(e4);
  check('D: dialog tak bisa tampil -> MFA_FAILED, bukan lolos', e4.action === 'MFA_FAILED' && e4.mfa.shown && !e4.mfa.verified);
}

// ---------------------------------------------------------------- D2: diumumkan seketika
{
  let release;
  const gate = new Promise(r => { release = r; });
  const g = await enrolled('d3@contoh.id', { enabled: true, onFallback: () => gate });
  const seen = [];
  g.onRisk = e => seen.push({ id: e.id, stage: e.stage, action: e.action, mfa: e.mfa });
  g.thresholds = null;
  g.cfg.thresholds = { low: 1e9, medium: -1e9 };   // paksa MEDIUM
  g._rebuildModel = () => {};
  g.cfg.calibrateThresholds = false;
  const p = feedOne(g, burst(NOW + 1000));
  await new Promise(r => setTimeout(r, 50));
  check('D2: vonis diumumkan SEBELUM verifikasi selesai (mfa.awaiting)', seen.length === 1 && seen[0].mfa && seen[0].mfa.awaiting && seen[0].stage === 'awaiting-mfa', JSON.stringify(seen));
  release(true);
  await p;
  check('D2: lalu diumumkan lagi dengan hasil (id sama, final, MFA_PASSED)', seen.length === 2 && seen[1].id === seen[0].id && seen[1].stage === 'final' && seen[1].action === 'MFA_PASSED', JSON.stringify(seen.map(x => [x.id, x.stage, x.action])));
}

// ---------------------------------------------------------------- E
{
  const g = await enrolled('e@contoh.id');
  const last = g.sessions[g.sessions.length - 1];
  last.risk = 'MEDIUM'; last.mfaVerified = false;
  NOW += 10 * 60_000;                               // 10 menit sesudah jendela terakhir
  await g.reportStepUp({ passed: true });
  check('E: verifikasi 10 menit kemudian TIDAK melatih jendela lama', !last.mfaVerified);
  check('E: tapi tetap membersihkan lantai', g.lastRisk === 'LOW');
  const r = await feedOne(g, burst(NOW + 1000));
  const fresh = g.sessions[g.sessions.length - 1];
  fresh.mfaVerified = false;
  await g.reportStepUp({ passed: true });
  check('E: verifikasi segera sesudah vonis melatih jendela itu', fresh.mfaVerified === true, r && r.level);
}

// ---------------------------------------------------------------- F
{
  const g = await enrolled('f@contoh.id');
  await g.reportStepUp({ passed: true });
  check('F: (prasyarat) masa berlaku aktif', g.status().mfa.graceLeftSec > 0);
  await g.stop();
  const st = g.status();
  check('F: stop() -> tidak aktif, tanpa pengguna, tanpa capture', !st.ready && st.userId === null && g.capture === null && st.phase === 'off');
  check('F: stop() menghentikan jam penilaian', g._autoTimer === null);
  const saved = await storage.get('bg:f@contoh.id');
  check('F: profil tetap tersimpan sesudah logout', saved && saved.sessions && saved.sessions.length >= 10);
  check('F: masa berlaku step-up dicabut saat logout', saved && saved.mfaPassedAt === null);
  const r = await g.reportStepUp({ passed: true });
  check('F: reportStepUp sesudah logout tidak berefek', r.applied === false);
  const g2 = new BehaviorGuard();
  await g2.init({ userId: 'f@contoh.id', mfa: { enabled: false } }); g2._stopTimer();
  check('F: login lagi memulihkan profil', g2.status().phase === 'protecting' && g2.status().mfa.graceLeftSec === 0);
  await g2.forget();
  check('F: forget() menghapus profil dari penyimpanan', (await storage.get('bg:f@contoh.id')) === null);
  check('F: forget() mengosongkan memori', g2.sessions.length === 0 && !g2.model);
}

// ---------------------------------------------------------------- G
{
  const g = await enrolled('g@contoh.id', { enabled: true, autoEnroll: false });
  g.lastRisk = 'MEDIUM';
  const r = await g.enrollMfa();
  check('G: enrollMfa ditolak saat sesi dicurigai', !r.enrolled && /dicurigai/.test(r.reason));
  g.lastRisk = 'LOW'; g._lastEvt = { level: 'LOW' };
  g.challengeTemplate = { v: 2, dwell: [], flight: [] };
  const r2 = await g.enrollMfa();
  check('G: template yang ada tidak bisa ditimpa lewat enrollMfa', !r2.enrolled && r2.already);
}

// ---------------------------------------------------------------- H
{
  const got = [];
  window.addEventListener('behaviorguard:risk', e => got.push(e.detail));
  const g = new BehaviorGuard();
  await g.init({ userId: 'h@contoh.id', mfa: { enabled: false }, session: { minEventsAssess: 30 } });   // init MANUAL
  g._stopTimer();
  await feedOne(g, burst(NOW));
  check('H: init manual tetap menyiarkan behaviorguard:risk', got.length === 1 && got[0].enrollment);
  const g2 = new BehaviorGuard();
  await g2.init({ userId: 'h2@contoh.id', mfa: { enabled: false }, session: { minEventsAssess: 30 }, onRisk: () => { throw new Error('bug integrator'); } });
  g2._stopTimer();
  const n0 = got.length;
  const origErr = console.error; console.error = () => {};
  const r = await feedOne(g2, burst(NOW));
  console.error = origErr;
  check('H: onRisk integrator yang melempar tidak mematikan vonis/event', r && got.length === n0 + 1);
}

// ---------------------------------------------------------------- I
{
  const human = [];
  let t = 1_000_000;
  for (let i = 0; i < 60; i++) { t += 90 + (i * 37) % 140; human.push({ event_type: 'KEYSTROKE', key: 'k1', hold_time: 70 + (i * 13) % 50, timestamp: t }); }
  const oneJump = human.map((e, i) => i === 30 ? e : { ...e, timestamp: e.timestamp - (i > 30 ? 4000 : 0) });
  check('I: satu langkah jam mundur (sinkron NTP) bukan bot', !checkIntegrity(oneJump, { throttled: true }).suspected, checkIntegrity(oneJump, { throttled: true }).reasons.join(','));
  const shuffled = human.map((e, i) => ({ ...e, timestamp: i % 5 === 0 ? e.timestamp - 3000 : e.timestamp }));
  check('I: urutan waktu diacak berkali-kali tetap ditandai', checkIntegrity(shuffled, { throttled: true }).suspected);
  const soft = human.map((e, i) => ({ ...e, hold_time: 1 + (i % 2), soft: true }));
  check('I: keyboard layar sentuh (tahan ~1 ms seragam) bukan bot', !checkIntegrity(soft, { throttled: true }).suspected, checkIntegrity(soft, { throttled: true }).reasons.join(','));
  const bot = human.map(e => ({ ...e, hold_time: 80 }));
  check('I: tahan identik dari keyboard fisik tetap ditandai', checkIntegrity(bot, { throttled: true }).suspected);
}

// ---------------------------------------------------------------- J
{
  const fl = base => Array.from({ length: 11 }, (_, i) => base + ((i * 53) % 90));
  const soft = [0, 1, 2].map(k => ({ mode: 'soft', dwell: new Array(12).fill(0), flight: fl(150 + k * 3) }));
  const tp = buildTemplate(soft);
  check('J: template soft terbentuk dan bertanda mode', tp && tp.mode === 'soft');
  check('J: sampel soft pemilik lolos', verify({ mode: 'soft', dwell: new Array(12).fill(0), flight: fl(152) }, tp).ok);
  const imp = { mode: 'soft', dwell: new Array(12).fill(0), flight: Array.from({ length: 11 }, (_, i) => 400 + ((i * 71) % 300)) };
  check('J: ritme soft orang lain ditolak', !verify(imp, tp).ok);
  const hard = { dwell: new Array(12).fill(90), flight: fl(152) };
  const vr = verify(hard, tp);
  check('J: sampel keyboard fisik terhadap template soft ditolak (beda mode)', !vr.ok && vr.modeMismatch);
  check('J: campuran mode saat pendaftaran ditolak', buildTemplate([soft[0], hard]) === null);
  const th = buildTemplate([{ dwell: new Array(12).fill(90), flight: fl(150) }, { dwell: new Array(12).fill(93), flight: fl(152) }]);
  check('J: template lama tanpa mode = keyboard fisik', th && th.mode === 'hard' && verify({ dwell: new Array(12).fill(91), flight: fl(151) }, th).ok);
  check('J: sampel soft terhadap template fisik ditolak', verify({ mode: 'soft', dwell: new Array(12).fill(0), flight: fl(151) }, th).modeMismatch);
}

// ---------------------------------------------------------------- K: kunci irama sesudah gagal beruntun
{
  const tpl = buildTemplate([{ dwell: new Array(12).fill(90), flight: new Array(11).fill(140) }, { dwell: new Array(12).fill(92), flight: new Array(11).fill(142) }]);
  const g = await enrolled('k@contoh.id', { enabled: true });
  g.challengeTemplate = tpl;
  g._mfaFailStreak = 3;
  let r = await g._stepUpFlow({ level: 'HIGH' });
  check('K: irama terkunci & tanpa cadangan -> unavailable (bukan dialog lagi)', r.unavailable && r.mfa.locked);
  check('K: status melaporkan terkunci', g.status().mfa.locked === true && g.status().mfa.failStreak === 3);
  let why = null;
  g.cfg.mfa.onFallback = async ctx => { why = ctx.why; return true; };
  r = await g._stepUpFlow({ level: 'HIGH' });
  check('K: irama terkunci -> langsung jalur cadangan', r.verified && r.method === 'fallback' && why === 'rhythm-locked');
  const v = await g.stepUp();
  check('K: verifikasi berhasil membuka kunci (hitungan kembali 0)', v.verified && g._mfaFailStreak === 0 && !g.status().mfa.locked);
  g._mfaFailStreak = 2; await g._persist();
  const g2 = new BehaviorGuard(); await g2.init({ userId: 'k@contoh.id', mfa: { enabled: false } }); g2._stopTimer();
  check('K: hitungan gagal bertahan lintas muat-halaman', g2._mfaFailStreak === 2);
}

// ---------------------------------------------------------------- L: situs http (tanpa crypto.subtle)
{
  const desc = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
  const real = globalThis.crypto;
  const fake = { getRandomValues: a => real.getRandomValues(a) };
  const LS = new Map();
  globalThis.localStorage = { getItem: k => (LS.has(k) ? LS.get(k) : null), setItem: (k, v) => LS.set(k, String(v)), removeItem: k => LS.delete(k) };
  globalThis.screen = globalThis.screen || { colorDepth: 24 };
  if (typeof globalThis.navigator === 'undefined') globalThis.navigator = { userAgent: 'node', language: 'id-ID' };   // Node 20
  Object.defineProperty(globalThis, 'crypto', { value: fake, configurable: true, writable: true });
  const warn = console.warn; console.warn = () => {};
  let okRound = false, err = null;
  try {
    await storage.set('bg:uji-http', { sessions: [{ vector: [1, 2, 3] }], x: 'é' });
    const back = await storage.get('bg:uji-http');
    okRound = back && back.x === 'é' && back.sessions[0].vector[2] === 3;
  } catch (e) { err = e.message; }
  const { getFingerprint } = await import('../sdk/core/fingerprint.js');
  let fp = null; try { fp = await getFingerprint(); } catch (e) { fp = 'ERR ' + e.message; }
  // jalur vonis penuh tanpa crypto: dulu melempar di _persist dan tak pernah memberi vonis
  let verdicts = 0;
  const g = new BehaviorGuard();
  try {
    await g.init({ userId: 'http@contoh.id', mfa: { enabled: false }, session: { minEventsAssess: 30 }, onRisk: () => verdicts++ });
    g._stopTimer();
    let t = NOW; for (let i = 0; i < 11; i++) { await feedOne(g, burst(t)); t += 20 * 60_000; }
  } catch (e) { err = err || e.message; }
  console.warn = warn;
  check('L: tanpa crypto.subtle penyimpanan tetap bekerja', okRound, err);
  check('L: tanpa crypto.subtle sidik perangkat tetap terbentuk (bukan "unknown")', typeof fp === 'string' && /^[0-9a-f]{32}$/.test(fp), fp);
  check('L: tanpa crypto.subtle vonis tetap keluar (11 dari 11)', verdicts === 11 && g.status().phase === 'protecting', `${verdicts} vonis`);
  if (desc) Object.defineProperty(globalThis, 'crypto', desc); else globalThis.crypto = real;
  // muat-halaman baru (modul penyimpanan segar, tanpa salinan memori) di konteks yang punya crypto
  const fresh = (await import('../sdk/storage.js?muat-ulang')).storage;
  const raw = LS.get('bg:uji-http') || '';
  const back2 = await fresh.get('bg:uji-http');
  check('L: data tanpa tanda tangan DITOLAK begitu crypto tersedia (https tidak melemah)', raw.startsWith('nosig:') && back2 === null, raw.slice(0, 6));
  delete globalThis.localStorage;
}

// ---------------------------------------------------------------- M: browser lama tanpa structuredClone
{
  const sc = globalThis.structuredClone;
  globalThis.structuredClone = undefined;
  let okM = false;
  try { const g = new BehaviorGuard(); okM = g.cfg.features.length === 34 && g.cfg.mfa.enabled === true; } catch {}
  globalThis.structuredClone = sc;
  check('M: tanpa structuredClone pustaka tetap bisa dibuat', okM);
}

let ok = 0;
for (const r of results) { console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.note != null ? `  [${r.note}]` : ''}`); if (r.ok) ok++; }
console.log(`\n  lulus ${ok} / ${results.length}`);
console.log(`  HASIL: ${ok === results.length ? 'SESUAI' : 'ADA KEGAGALAN'}`);
process.exit(ok === results.length ? 0 : 1);
