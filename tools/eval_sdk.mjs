/**
 * eval_sdk.mjs - ukur SDK yang DIKIRIM, dengan menjalankan kodenya sendiri (C-29).
 *
 * Tiga harness Python sebelumnya meniru mesin SDK dan masing-masing meleset:
 * ambang kuantil-dituning lawan parametrik k_low=3,3; z per-detektor tak di-clamp
 * [-6,6]; Mahalanobis tanpa shrink adaptif; kolam 30 lawan 10+90; sesi yang lolos MFA
 * tak pernah masuk kolam; lantai lengket & blokir-beruntun tak ada. Di sini tidak ada
 * yang ditiru: tiap sesi masuk lewat `BehaviorGuard.scoreExternalEvents`, jalur yang
 * sama yang dilewati pengguna - kompresi idle, integritas, ekstraksi fitur JS, ensemble,
 * ambang, lantai lengket, blokir. Yang disimulasikan hanya dua hal yang memang di luar
 * kode: jam dinding (supaya rate-limit tidak menahan ribuan panggilan per detik) dan
 * hasil step-up (lewat API publik `reportStepUp`, efek yang sama dengan popup MFA aslinya).
 *
 * Tiga ukuran, masing-masing menjawab pertanyaan berbeda:
 *  PEMILIK   tiap sesi sesudah pendaftaran, berurutan, dengan status yang terbawa.
 *            gesekan = vonis akhir != LOW (pemilik melihat popup verifikasi).
 *  PENYUSUP  sesi PERTAMA penyusup di akun pemilik (klon status akhir pemilik).
 *            lolos = vonis akhir LOW (tanpa gesekan apa pun).
 *  AMBIL-ALIH penyusup memakai akun beberapa sesi berturut: berapa sesi ia lolos
 *            sebelum ketahuan, dan apakah akhirnya diblokir.
 *
 *   python tools/export_sessions.py [--afk]
 *   node tools/eval_sdk.mjs [--data F] [--owner-mfa pass|none] [--compress 15|0]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
// --sdk DIR : ukur salinan SDK lain (ablasi). Default = sdk/ yang dikirim.
const _sdkArg = (() => { const i = process.argv.indexOf('--sdk'); return i > 0 ? process.argv[i + 1] : null; })();
const { BehaviorGuard } = await import(_sdkArg ? pathToFileURL(path.resolve(_sdkArg, 'behaviorguard.js')).href : '../sdk/behaviorguard.js');

// ---------- argumen
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const DATA = arg('data', path.join(os.tmpdir(), 'bg_sessions.json'));
const OWNER_MFA = arg('owner-mfa', 'pass');        // pass: pemilik lolos popup; none: tanpa MFA
const COMPRESS = Number(arg('compress', '15'));
const TAKEOVER = Number(arg('takeover', '6'));
const K_LOW = arg('k-low', null);                  // null = default config.js
const DUMP = arg('dump', null);
// --cfg '{"progressiveMaxPool":20}' : timpa konfigurasi (gabung-dalam) untuk ablasi
const CFG = JSON.parse(arg('cfg', '{}'));
// --live : potong tiap sesi jadi jendela windowSec (30 dtk) seperti setInterval di
// browser. Tanpa ini satu vonis = satu sesi riset utuh (menit-an, ~700 event) - satuan
// yang TIDAK PERNAH dinilai SDK di produksi. Lihat DRIFT C-29.
const LIVE = process.argv.includes('--live');
const deepMerge = (t, s) => { for (const [k, v] of Object.entries(s)) t[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? deepMerge(t[k] || {}, v) : v; return t; };                    // tulis ringkasan per-subjek (JSON) untuk sapuan
const REPORT_FOLD = [2, 3, 6, 7, 8, 19, 22, 25]; // FOLD-REPORT seed 42 (reproduce_db / experiment.py)

// ---------- jam simulasi: rate-limit & splitForAssessment membaca Date.now()
let NOW = process.argv.includes('--live') ? 0 : Date.UTC(2027, 0, 1);
Date.now = () => NOW;
const tick = ms => { NOW += ms; };

// localStorage tiruan HANYA untuk ekor lintas-kunjungan (`bg:pending:*`). State utama
// meniru browser ber-IndexedDB (di Node jatuh ke memori storage.js); kunci lain sengaja
// tidak disimpan di sini supaya storage.get tidak membaca salinan localStorage yang
// dirampingkan (itu jalur browser TANPA IndexedDB, bukan kasus umum).
if (LIVE && typeof globalThis.localStorage === 'undefined') {
  const M = new Map();
  globalThis.localStorage = {
    getItem: k => (k.startsWith('bg:pending') ? (M.has(k) ? M.get(k) : null) : null),
    setItem: (k, v) => { if (k.startsWith('bg:pending')) M.set(k, String(v)); },
    removeItem: k => { M.delete(k); },
  };
}
// --dump-vec F : rekam SETIAP vektor yang dinilai SDK (siapa, peran, skor, vonis) untuk
// menyaring ide penilai lain di luar SDK tanpa menjalankan ulang simulasi 2,5 menit.
// Berkas ini berisi fitur turunan data riset -> tulis ke temp OS, JANGAN ke repo.
const DUMP_VEC = arg('dump-vec', null);
const VEC_LOG = [];
if (DUMP_VEC) {
  const orig = BehaviorGuard.prototype._ingestVector;
  BehaviorGuard.prototype._ingestVector = async function (vec, feat, eligible = true, events = null, meta = null) {
    const rec = { u: this.userId, v: Array.from(vec), el: eligible, t: NOW };
    const ev = await orig.call(this, vec, feat, eligible, events, meta);
    if (ev) { rec.lv = ev.level; rec.ml = ev.modelLevel ?? null; rec.s = ev.modelScore ?? ev.score ?? null;
              rec.enr = !!(ev.enrollment || ev.convergence === 'enrollment'); rec.integ = !!ev.integrity; rec.mfa = false; }
    VEC_LOG.push(rec);
    return ev;
  };
  const origStep = BehaviorGuard.prototype.reportStepUp;
  BehaviorGuard.prototype.reportStepUp = async function (r) {
    for (let k = VEC_LOG.length - 1; k >= 0; k--) if (VEC_LOG[k].u === this.userId) { if (r && r.passed) VEC_LOG[k].mfa = true; break; }
    return origStep.call(this, r);
  };
}
const raw = JSON.parse(fs.readFileSync(DATA, 'utf8'));
// --only 19,7 : pemilik yang dinilai (penyusup tetap semua subjek lain) - untuk diagnosa
const ONLY = arg('only', null);
const ALL_SUBJ = Object.keys(raw.subjects).map(Number);
const SUBJ = ALL_SUBJ;
const OWNERS = ONLY ? ONLY.split(',').map(Number) : ALL_SUBJ;
const TRACE = process.argv.includes('--trace');
// --same-hour : penyerang PINTAR yang login di jam-dalam-hari yang sama dengan kebiasaan
// pemilik. Tanpa ini sesi penyusup memakai jam rekamannya sendiri, dan karena tiap relawan
// merekam di blok jam yang khas, fitur temporal_time_of_day_score ikut "menangkap" penyusup
// - sinyal yang di dunia nyata jauh lebih lemah (C-44).
const SAME_HOUR = process.argv.includes('--same-hour');
const todOf = evs => { const t0 = Math.min(...evs.map(e => e.timestamp)); return ((t0 % DAY) + DAY) % DAY; };
let _k = 0;
function impShift(uid, evs) {
  if (!SAME_HOUR || !LIVE) return null;
  const own = raw.subjects[uid], target = todOf(own[(_k++) % own.length]);
  return shiftFor(evs) + ((target - todOf(evs)) % DAY + DAY) % DAY;
}

async function freshGuard(uid) {
  const g = new BehaviorGuard();
  // C-46: HARNESS INI SEMPAT MENGUKUR KONFIGURASI YANG SALAH. Override dulu dipasang ke
  // `g.cfg` SEBELUM init(). Sejak C-45, `_init()` mengerjakan `this.cfg = clone(DEFAULTS)`
  // supaya opsi init() sebelumnya tidak terbawa ke init() berikutnya - perbaikan yang benar
  // untuk SDK-nya, tapi ia MENGHAPUS override itu. Akibatnya `--k-low`, `--cfg`, dan
  // `--compress` tidak berpengaruh apa pun: sapuan k_low 1,25..2,5 yang dijalankan sesudah
  // C-45 sebenarnya menjalankan DEFAULT berulang-ulang, dan hasilnya identik karena memang
  // konfigurasinya identik. Gejalanya terlihat seperti "knob-nya tidak berpengaruh", bukan
  // seperti bug - itulah kenapa ia lolos lama.
  //
  // Perbaikannya lewat PINTU RESMI: apa pun yang dikenali init() dikirim sebagai opsi init(),
  // yang diterapkan SESUDAH reset dan SEBELUM `_rebuildModel()`. Sisa kunci `--cfg` yang tidak
  // punya pintu di init() (progressiveMaxPool, replayEps, blockAfterConsecutiveHigh) hanya
  // dibaca saat penilaian, jadi aman digabung sesudahnya.
  const initOpts = { userId: uid, mfa: { enabled: false } };
  initOpts.session = { ...(CFG.session || {}), idleCompressSec: COMPRESS };
  for (const k of ['weights', 'baseline', 'retrainEvery', 'features', 'thresholds', 'idle', 'aggregateWindows', 'calibrationHoldout'])
    if (k in CFG) initOpts[k] = CFG[k];
  if (K_LOW !== null || CFG.calibration || 'k_low' in CFG || 'k_med_extra' in CFG) {
    initOpts.calibration = { ...(CFG.calibration || {}) };
    if ('k_low' in CFG) initOpts.calibration.k_low = CFG.k_low;
    if ('k_med_extra' in CFG) initOpts.calibration.k_med_extra = CFG.k_med_extra;
    if (K_LOW !== null) initOpts.calibration.k_low = Number(K_LOW);
  }
  await g.init(initOpts);
  deepMerge(g.cfg, CFG);
  if (K_LOW !== null) g.cfg.k_low = Number(K_LOW);
  g.cfg.session.idleCompressSec = COMPRESS;
  try { clearInterval(g._autoTimer); } catch {}
  g.onRisk = () => {};
  return g;
}
// Klon status pemilik untuk satu percobaan penyusup. Model & statistik dibagi pakai
// (tidak pernah dimutasi - _rebuildModel membuat objek baru), sisanya disalin.
function cloneGuard(g, uid) {
  const c = new BehaviorGuard();
  Object.assign(c, g);
  c.cfg = structuredClone(g.cfg);
  c.sessions = g.sessions.map(s => ({ ...s }));
  c.userId = uid; c.onRisk = () => {}; c.capture = null; c._aggBuf = [];
  // penyusup datang lewat KUNJUNGAN BARU (muat-halaman): konteks jendela-geser (C-42)
  // hidup di memori tab pemilik dan tidak ikut. Tanpa ini vonis pertama penyusup
  // tercampur event pemilik dan hasilnya tak mewakili serangan kredensial curian.
  c._ctx = [];
  // masa berlaku step-up (C-43) milik PERANGKAT & kunjungan pemilik: penyusup
  // berkredensial curian datang dari perangkatnya sendiri tanpa verifikasi yang lolos.
  c._mfaPassedAt = null;
  return c;
}

/**
 * Umpankan satu sesi ke guard. Mode sesi: satu panggilan. Mode live: tiru siklus
 * produksi - `_onCaptureEvent` per event (pelacakan kehadiran/absen yang sama dengan
 * capture.js), lalu tiap batas windowSec: buffer >= minEventsAssess -> dinilai; kurang
 * dan event terakhirnya masih segar (< idleGapSec) -> dibawa ke jendela berikut (sama
 * dengan carry-back splitForAssessment); kurang dan basi -> dibuang.
 * Mengembalikan daftar vonis (bisa kosong).
 */
const DAY = 86_400_000;
function shiftFor(evs) {
  const t0 = Math.min(...evs.map(e => e.timestamp));
  return t0 > NOW + 60_000 ? 0 : Math.ceil((NOW + 60_000 - t0) / DAY) * DAY;
}
async function feed(g, evs, stepUp = false, presetShift = null) {
  if (!LIVE) { tick(30 * 60_000); const e = await g.scoreExternalEvents(evs); return e ? [e] : []; }
  // Buffer tiruan menggantikan capture DOM; sisanya kode SDK asli: tiap batas windowSec
  // dipanggil endSession() -> drain -> penilaian -> carry-back ekor oleh splitForAssessment.
  // Jam simulasi = waktu event, jadi keputusan "ekor masih segar" sama dengan di browser.
  const W = g.cfg.session.windowSec * 1000;
  // Jam simulasi HARUS sama dengan waktu event (splitForAssessment membandingkan
  // Date.now() dengan timestamp event) dan HARUS maju terus (token bucket rate-limit).
  // Sesi penyusup datang dari tanggal lain, jadi tiap kunjungan digeser KELIPATAN 24 JAM
  // sampai jatuh sesudah jam sekarang: jam-dalam-hari (temporal_time_of_day_score) tetap
  // identik, urutan waktu tetap maju.
  const shift = presetShift ?? shiftFor(evs);
  const sorted = evs.map(e => ({ ...e, timestamp: e.timestamp + shift })).sort((a, b) => a.timestamp - b.timestamp);
  g._lastEventAt = 0;                      // tiap kunjungan = muat-halaman baru
  if (!g.capture) { const buf = []; g.capture = { buffer: buf, drain() { const c = buf.slice(); buf.length = 0; return c; }, peek() { return buf.slice(); } }; }
  const out = [];
  g.onRisk = e => out.push(e);             // semua vonis, persis yang diterima integrator
  let edge = sorted[0].timestamp + W, i = 0;
  // stepUp: pemilik menjawab popup SEKETIKA (sebelum jendela berikutnya), seperti di
  // browser - bukan di akhir kunjungan. Menunda ke akhir kunjungan membuat semua jendela
  // sesudah vonis pertama terkunci lantai lengket (artefak yang sempat menggelembungkan
  // gesekan pemilik di run live pertama).
  const tickTo = async (t) => {
    NOW = Math.max(NOW, t);
    const before = out.length;
    await g.endSession();
    if (stepUp) for (const e of out.slice(before)) if (needsStepUp(e)) await g.reportStepUp({ passed: true });
  };
  while (i < sorted.length) {
    while (i < sorted.length && sorted[i].timestamp < edge) { g._onCaptureEvent(sorted[i]); g.capture.buffer.push(sorted[i]); i++; }
    await tickTo(edge);
    edge += W;
    // lompati deretan jendela kosong, tapi tetap berdetak sekali di ujungnya (ABSTAIN/ekor basi)
    if (i < sorted.length && sorted[i].timestamp >= edge + W) { await tickTo(sorted[i].timestamp - 1); edge = sorted[i].timestamp + W; }
  }
  await tickTo(edge);                    // detak terakhir kunjungan
  g._bankTail();                         // pagehide: ekor ke bg:pending, dinilai di kunjungan berikut
  g.capture.buffer.length = 0;
  g.onRisk = () => {};
  return out;
}

const needsStepUp = e => e && !e.enrollment && !e.abstain && e.level !== 'LOW' && e.level !== 'UNKNOWN' && !e.integrity && !e.rateLimited;
const own = [], imp = [], take = [], perUser = {}, noVerdict = [];
let ownerIntegrity = 0, impIntegrity = 0;
const t0 = performance.now();
for (const uid of OWNERS) {
  let g = await freshGuard('owner-' + uid);
  const sess = raw.subjects[uid];
  const pu = perUser[uid] = { n: 0, friction: 0, block: 0, model: 0 };
  g._lastEventAt = 0;
  for (const evs of sess) {
   // tiap sesi riset = satu KUNJUNGAN: halaman dimuat ulang, state dibaca dari storage.
   // Tanpa ini jeda berhari-hari antar-kunjungan terbaca sebagai "absen" di tengah sesi.
   let pre = [], sh = null;
   if (LIVE) {
     // jam = awal kunjungan INI sebelum init(): init() memutuskan umur ekor pending
     // dengan Date.now(), dan di browser itu adalah waktu kunjungan baru.
     sh = shiftFor(evs); NOW = Math.min(...evs.map(e => e.timestamp)) + sh - 1000;
     g = await freshGuard('owner-' + uid); g._lastEventAt = 0;
     // init() menilai ekor pending lewat setTimeout(100); tangkap vonisnya
     g.onRisk = e => pre.push(e); await new Promise(r => setTimeout(r, 120)); g.onRisk = () => {};
     if (OWNER_MFA === 'pass') for (const e of pre) if (needsStepUp(e)) await g.reportStepUp({ passed: true });
   }
   if (TRACE) console.error(`  [${uid}] -- kunjungan ${sess.indexOf(evs) + 1}/${sess.length} ${new Date(Math.min(...evs.map(e => e.timestamp))).toISOString().slice(0, 16)} ${evs.length} event`);
   const got = [...pre, ...await feed(g, evs, LIVE && OWNER_MFA === 'pass', sh)];
   if (TRACE) for (const e of got) console.error(`  [${uid}] ${e.level} ${e.action} el=${e.eligible} n=${e.idle ? e.idle.events : '-'} ctx=${e.context ?? '-'} ${(e.reasons || [])[0] || ''}`);
   for (const e of got) {
    if (!e || e.convergence === 'enrollment' || e.enrollment || e.abstain) continue;
    if (e.integrity) { ownerIntegrity++; }
    const rec = { uid, level: e.level, modelLevel: e.modelLevel ?? e.level, score: e.modelScore ?? e.score,
                  blocked: !!e.blocked, integrity: !!e.integrity, rateLimited: !!e.rateLimited,
                  // penyebab gesekan: dipisah supaya "model salah" tidak tercampur dengan
                  // aturan status (lantai lengket, absen, bukti sebagian)
                  cause: e.level === 'LOW' ? 'LOW' : [e.modelLevel !== 'LOW' && 'model', e.stickyFloor && 'lantai',
                          e.reverifyAfterAway && 'absen', e.partialEvidence && 'sebagian', e.integrity && 'bot'].filter(Boolean).join('+') || 'lain',
                  n: e.idle ? e.idle.events : undefined, graced: !!e.stepUpGrace };
    own.push(rec); pu.n++;
    if (rec.level !== 'LOW') pu.friction++;
    if (rec.modelLevel !== 'LOW') pu.model++;
    if (rec.blocked) pu.block++;
    // pemilik menjawab popup dan lolos: jalur yang sama dengan runMfaChallenge terverifikasi
    // pemilik menjawab step-up dan lolos -> API publik yang sama dengan integrator nyata
    // (mode live sudah menjawabnya seketika di dalam feed)
    if (!LIVE && OWNER_MFA === 'pass' && needsStepUp(e)) await g.reportStepUp({ passed: true });
   }
  }
  // ---- penyusup: sesi pertama di akun pemilik
  for (const vid of SUBJ) {
    if (vid === uid) continue;
    for (const evs of raw.subjects[vid]) {
      const c = cloneGuard(g, `imp-${uid}-${vid}-${Math.random().toString(36).slice(2)}`);
      c._lastEventAt = 0;
      tick(2_000);
      const vs = (await feed(c, evs, false, impShift(uid, evs))).filter(e => !e.abstain && !e.enrollment);
      // sesi penyusup yang TIDAK PERNAH mendapat vonis (bukti tak pernah cukup) bukan
      // 'tidak dihitung' - ia lolos tanpa diperiksa. Dicatat terpisah.
      if (!vs.length) { noVerdict.push({ uid, vid }); continue; }
      const e = vs[0];                              // jendela/sesi PERTAMA penyusup
      if (vs.some(x => x.integrity)) impIntegrity++;
      imp.push({ uid, vid, level: e.level, modelLevel: e.modelLevel ?? e.level,
                 score: e.modelScore ?? e.score, blocked: !!e.blocked,
                 // mode live: apakah SELURUH sesi penyusup lewat tanpa satu pun gesekan
                 wholeSessionClean: vs.every(x => x.level === 'LOW'), windows: vs.length });
    }
    // ---- ambil-alih: K sesi berturut penyusup, status terbawa
    const c = cloneGuard(g, `take-${uid}-${vid}`);
    const seq = [];
    c._lastEventAt = 0;
    for (const evs of raw.subjects[vid].slice(0, TAKEOVER)) {
      const vs = (await feed(c, evs, false, impShift(uid, evs))).filter(e => !e.abstain);
      // satu entri per SESI penyusup: sesi dianggap lolos hanya kalau tak satu jendela pun tersandung
      if (vs.length) seq.push(vs.some(e => e.blocked) ? 'BLOCK' : (vs.every(e => e.level === 'LOW') ? 'LOW' : vs.find(e => e.level !== 'LOW').level));
    }
    take.push({ uid, vid, seq });
    if (TRACE && seq.length && seq.every(s => s === "LOW")) console.error(`  TAK-KETAHUAN pemilik ${uid} <- penyusup ${vid}: ${seq.length} sesi dinilai, sesi penyusup tersedia ${raw.subjects[vid].length}, jendela/sesi ${raw.subjects[vid].slice(0, TAKEOVER).map(e => e.length).join(",")} event`);
  }
  process.stderr.write(`subjek ${uid} selesai (${((performance.now() - t0) / 1000).toFixed(0)} dtk)\n`);
}

// ---------- metrik
const pct = (a, b) => b ? (100 * a / b) : 0;
function roc(o, i) {
  // skor lebih tinggi = lebih normal. AUC = P(skor pemilik > skor penyusup), seri = 1/2
  const O = o.filter(Number.isFinite), I = i.filter(Number.isFinite);
  const all = [...O.map(s => [s, 1]), ...I.map(s => [s, 0])].sort((a, b) => a[0] - b[0]);
  let rank = 0, sumO = 0;
  for (let k = 0; k < all.length;) {
    let j = k; while (j < all.length && all[j][0] === all[k][0]) j++;
    const r = (k + 1 + j) / 2;                 // peringkat rata-rata untuk yang seri
    for (let m = k; m < j; m++) if (all[m][1]) sumO += r;
    k = j;
  }
  const auc = (sumO - O.length * (O.length + 1) / 2) / (O.length * I.length);
  // EER: sapu ambang
  const thr = [...new Set(all.map(x => x[0]))];
  let eer = 50, best = 1e9;
  for (const t of thr) {
    const frr = pct(O.filter(s => s <= t).length, O.length), far = pct(I.filter(s => s > t).length, I.length);
    if (Math.abs(frr - far) < best) { best = Math.abs(frr - far); eer = (frr + far) / 2; }
  }
  const tiesAtFloor = I.filter(s => s <= -5.999).length;
  return { auc, eer, tiesAtFloor };
}
function summarize(label, ownSet, impSet, takeSet) {
  const n = ownSet.length, m = impSet.length;
  const r = roc(ownSet.map(x => x.score), impSet.map(x => x.score));
  // AUC GABUNGAN mencampur skala skor 16 orang; ambang SDK dibuat PER PEMILIK, jadi yang
  // relevan untuk keputusan adalah AUC per pemilik lalu dirata-rata (makro). Keduanya
  // dilaporkan: z di-clamp [-6,6] merapatkan skala skor antar-orang dan menurunkan AUC
  // gabungan tanpa mengubah daya pisah per orang (lihat DRIFT C-29).
  const uids = [...new Set(ownSet.map(x => x.uid))];
  const per = uids.map(u => roc(ownSet.filter(x => x.uid === u).map(x => x.score),
                                impSet.filter(x => x.uid === u).map(x => x.score))).filter(z => Number.isFinite(z.auc));
  const macroAuc = per.reduce((a, z) => a + z.auc, 0) / per.length, macroEer = per.reduce((a, z) => a + z.eer, 0) / per.length;
  const det1 = takeSet.filter(t => t.seq[0] && t.seq[0] !== 'LOW').length;
  const det3 = takeSet.filter(t => t.seq.slice(0, 3).some(s => s !== 'LOW')).length;
  const never = takeSet.filter(t => t.seq.length && t.seq.every(s => s === 'LOW')).length;
  const blocked = takeSet.filter(t => t.seq.includes('BLOCK')).length;
  const lowBefore = takeSet.map(t => { const k = t.seq.findIndex(s => s !== 'LOW'); return k < 0 ? t.seq.length : k; });
  console.log(`\n== ${label}`);
  console.log(`PEMILIK   ${n} sesi | gesekan (vonis akhir != LOW) ${pct(own.filter(x => ownSet.includes(x) && x.level !== 'LOW').length, n).toFixed(1)}%` +
              ` | vonis model != LOW ${pct(ownSet.filter(x => x.modelLevel !== 'LOW').length, n).toFixed(1)}%` +
              ` | diblokir ${pct(ownSet.filter(x => x.blocked).length, n).toFixed(1)}%`);
  console.log(`PENYUSUP  ${m} sesi | jendela/sesi pertama lolos ${pct(impSet.filter(x => x.level === 'LOW').length, m).toFixed(1)}%` +
              (LIVE ? ` | SELURUH sesi lolos tanpa gesekan ${pct(impSet.filter(x => x.wholeSessionClean).length, m).toFixed(1)}% (rata2 ${(impSet.reduce((a, x) => a + x.windows, 0) / m).toFixed(1)} jendela)` : '') +
              ` | vonis model LOW ${pct(impSet.filter(x => x.modelLevel === 'LOW').length, m).toFixed(1)}%` +
              ` | HIGH ${pct(impSet.filter(x => x.modelLevel === 'HIGH').length, m).toFixed(1)}%`);
  const nv = noVerdict.filter(x => ownSet.some(o => o.uid === x.uid)).length;
  console.log(`TANPA VONIS  ${nv} sesi penyusup tak pernah dinilai (${pct(nv, nv + m).toFixed(1)}% dari semua sesi penyusup) -> lolos tanpa diperiksa`);
  console.log(`BEBAS-AMBANG  AUC per-pemilik (makro) ${macroAuc.toFixed(3)} | EER per-pemilik ${macroEer.toFixed(1)}% | AUC gabungan ${r.auc.toFixed(3)} | EER gabungan ${r.eer.toFixed(1)}% | skor penyusup mentok di lantai -6: ${pct(r.tiesAtFloor, m).toFixed(1)}%`);
  console.log(`AMBIL-ALIH ${takeSet.length} pasangan x ${TAKEOVER} sesi | ketahuan di sesi-1 ${pct(det1, takeSet.length).toFixed(1)}%` +
              ` | dalam 3 sesi ${pct(det3, takeSet.length).toFixed(1)}% | tak pernah ketahuan ${pct(never, takeSet.length).toFixed(1)}%` +
              ` | berakhir diblokir ${pct(blocked, takeSet.length).toFixed(1)}% | rata2 sesi lolos sebelum ketahuan ${(lowBefore.reduce((a, b) => a + b, 0) / takeSet.length).toFixed(2)}`);
}
if (DUMP) {
  const by = {};
  for (const u of OWNERS) {
    const o = own.filter(x => x.uid === u), i = imp.filter(x => x.uid === u), t = take.filter(x => x.uid === u);
    by[u] = { n: o.length, fr: o.filter(x => x.level !== 'LOW').length, blk: o.filter(x => x.blocked).length,
              m: i.length, pass: i.filter(x => x.level === 'LOW').length, nv: noVerdict.filter(x => x.uid === u).length,
              clean: i.filter(x => x.wholeSessionClean).length,
              tk: t.length, never: t.filter(x => x.seq.length && x.seq.every(s => s === 'LOW')).length,
              det1: t.filter(x => x.seq[0] && x.seq[0] !== 'LOW').length,
              os: o.map(x => x.score), is: i.map(x => x.score),
              // urutan vonis pemilik (L/M/H, 'g' = MEDIUM yang tak ditanya ulang) dan rincian
              // per penyusup: [sesi dinilai, lolos vonis pertama, lolos seluruh sesi]
              ol: o.map(x => x.graced ? 'g' : x.level[0]).join(''),
              iv: Object.fromEntries([...new Set(i.map(x => x.vid))].map(v => { const q = i.filter(x => x.vid === v);
                    return [v, [q.length, q.filter(x => x.level === 'LOW').length, q.filter(x => x.wholeSessionClean).length]]; })),
              tq: Object.fromEntries(t.map(x => [x.vid, x.seq.map(s => s[0]).join('')])) };
  }
  fs.writeFileSync(DUMP, JSON.stringify({ k_low: K_LOW, data: path.basename(DATA), compress: COMPRESS, ownerMfa: OWNER_MFA, by }));
}
if (DUMP_VEC) fs.writeFileSync(DUMP_VEC, JSON.stringify({ features: (await import('../sdk/core/config.js')).DEFAULTS?.features ?? null, log: VEC_LOG }));
console.log(`MODE: ${LIVE ? 'LIVE (jendela ' + 30 + ' dtk, seperti produksi)' : 'SESI UTUH (satuan riset, BUKAN produksi)'}`);
console.log(`PENYUSUP: ${SAME_HOUR ? 'jam-dalam-hari DISAMAKAN dengan pemilik (--same-hour)' : 'jam rekamannya sendiri'}`);
console.log(`SDK: sdk/behaviorguard.js | k_low=${K_LOW ?? 'default'} | data ${path.basename(DATA)} (afk=${raw.afk}) | kompresi ${COMPRESS} dtk | pemilik-MFA=${OWNER_MFA}`);
const rl = own.filter(x => x.rateLimited).length + imp.filter(x => x.rateLimited).length;
if (rl) console.log(`PERINGATAN: ${rl} vonis kena rate-limit - jam simulasi terlalu rapat, angka TIDAK sah`);
console.log(`integritas (dituduh bot): sesi pemilik ${ownerIntegrity}, sesi penyusup ${impIntegrity}`);
summarize('SEMUA 16 subjek', own, imp, take);
const rf = new Set(REPORT_FOLD);
summarize('HANYA belahan-lapor seed 42 (8 subjek yang tak dipakai memilih k_low)',
  own.filter(x => rf.has(x.uid)), imp.filter(x => rf.has(x.uid)), take.filter(x => rf.has(x.uid)));
console.log(`
masa berlaku step-up (C-43): ${own.filter(x => x.graced).length} vonis pemilik MEDIUM tidak ditanya ulang (${pct(own.filter(x => x.graced).length, own.length).toFixed(1)}%)`);
const causes = {}; for (const x of own) if (x.level !== 'LOW') causes[x.cause] = (causes[x.cause] || 0) + 1;
console.log('\npenyebab gesekan pemilik: ' + Object.entries(causes).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' | '));
const fr = Object.entries(perUser).map(([u, p]) => [u, pct(p.friction, p.n)]);
console.log('\ngesekan pemilik per subjek: ' + fr.map(([u, v]) => `${u}:${v.toFixed(0)}%`).join(' '));
