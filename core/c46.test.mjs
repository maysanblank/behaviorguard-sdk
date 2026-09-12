/**
 * c46.test.mjs - C-46: perilaku HARUS datang dari manusia, dan step-up tidak boleh macet.
 *
 *  A. capture.js menjatuhkan event yang dibuat skrip (`isTrusted === false`) dan
 *     MENGHITUNGnya; event tanpa properti itu (peramban lama) tetap diterima.
 *  B. fokus/blur SENGAJA tidak disaring - lihat DRIFT C-46 untuk alasannya. Diuji supaya
 *     keputusan itu tidak hilang diam-diam kalau seseorang "merapikan" kodenya nanti.
 *  C. Jendela yang tercemar masukan sintetis TIDAK boleh melatih model, dan alasannya
 *     sampai ke integrator - tanpa memblokir (kebijakan itu milik integrator).
 *  D. Perekam dialog verifikasi menolak seluruh sampel yang tersentuh event tiruan: tanpa
 *     ini, skrip yang bisa membaca template tersimpan tinggal menembakkan jeda median.
 *  E. `mfa.onFallback` yang tidak pernah selesai tidak boleh menyangkutkan `_mfaBusy`
 *     seumur halaman.
 *  F. `status().mfa.canEnroll` jujur tentang kapan pendaftaran irama boleh ditawarkan.
 *
 * Jalankan: node core/c46.test.mjs
 */
const results = [];
const check = (name, cond, note) => results.push({ name, ok: !!cond, note });

// ---- DOM tiruan (pola yang sama dengan privacy.test.mjs)
const L = {};
const on = (t, f) => { (L[t] = L[t] || []).push(f); };
globalThis.window = { scrollY: 0, addEventListener: on, removeEventListener() {} };
globalThis.document = { addEventListener: on, removeEventListener() {}, visibilityState: 'visible',
  documentElement: { getAttribute: () => 'id' } };
globalThis.location = { href: 'https://bank.contoh/beranda' };
// Node 24 mengekspor `navigator` sebagai getter saja -> ditimpa lewat defineProperty
Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'uji-c46', language: 'id-ID' }, configurable: true });
globalThis.screen = { colorDepth: 24 };
let NOW = 1_800_000_000_000;
Date.now = () => NOW;
const fire = (t, e) => (L[t] || []).forEach(f => f(e));
const target = { type: 'text', matches: () => true, closest: () => null };

const { createCapture } = await import('../sdk/core/capture.js');
const { createRecorder } = await import('../sdk/core/mfa.js');

// ============================================================ A. saringan isTrusted
const cap = createCapture(() => {});
cap.attach();

// 1) event tiruan: mouse, tombol, klik
for (let i = 0; i < 12; i++) {
  fire('mousemove', { isTrusted: false, clientX: 100 + i * 9, clientY: 80 + i * 4, target });
  NOW += 60;
  fire('keydown', { isTrusted: false, key: 'a', code: 'KeyA', repeat: false, target });
  NOW += 90;
  fire('keyup', { isTrusted: false, key: 'a', code: 'KeyA', target });
  fire('click', { isTrusted: false, clientX: 10, clientY: 10, target });
  NOW += 50;
}
check('A1 nol event sintetis masuk buffer', cap.peek().length === 0, `${cap.peek().length} masuk`);
check('A2 event sintetis dihitung', cap.synthetic >= 24, `${cap.synthetic}`);

// 2) event sungguhan (isTrusted true) tetap masuk
const sebelum = cap.synthetic;
for (let i = 0; i < 6; i++) {
  fire('keydown', { isTrusted: true, key: 'b', code: 'KeyB', repeat: false, target });
  NOW += 85;
  fire('keyup', { isTrusted: true, key: 'b', code: 'KeyB', target });
  NOW += 120;
}
const ks = cap.peek().filter(e => e.event_type === 'KEYSTROKE');
check('A3 ketikan tepercaya tetap terekam', ks.length === 6, `${ks.length}`);
check('A4 ketikan tepercaya tidak menaikkan hitungan sintetis', cap.synthetic === sebelum);

// 3) peramban lama tanpa properti isTrusted -> gagal ke perilaku lama, bukan buta
fire('keydown', { key: 'c', code: 'KeyC', repeat: false, target }); NOW += 80;
fire('keyup', { key: 'c', code: 'KeyC', target }); NOW += 100;
check('A5 event tanpa properti isTrusted tetap diterima (peramban lama)',
  cap.peek().filter(e => e.event_type === 'KEYSTROKE').length === 7);

// 4) banjir event tiruan tidak boleh MEMBUNGKAM gerakan asli lewat throttle mousemove.
//    Saringan ada di depan throttle; kalau di belakang, tiap event palsu ikut memperbarui
//    `lastMove` dan gerakan sungguhan selalu jatuh di dalam jendela 50 ms.
NOW += 5000;                                   // jauh dari gerakan terakhir
const moveSebelum = cap.peek().filter(e => e.event_type === 'MOUSE_MOVE').length;
for (let i = 0; i < 200; i++) fire('mousemove', { isTrusted: false, clientX: i, clientY: i, target });
fire('mousemove', { isTrusted: true, clientX: 500, clientY: 400, target });
check('A6 banjir event tiruan tidak menghambat gerakan asli (saringan di depan throttle)',
  cap.peek().filter(e => e.event_type === 'MOUSE_MOVE').length === moveSebelum + 1);

// ============================================================ B. fokus/blur tidak disaring
fire('focusin', { isTrusted: false, target });
fire('focusout', { isTrusted: false, target });
check('B1 fokus/blur yang dipanggil situs (el.focus()) TETAP terekam - keputusan C-46',
  cap.peek().some(e => e.event_type === 'FORM_FOCUS') && cap.peek().some(e => e.event_type === 'FORM_BLUR'));

// ============================================================ C. jendela tercemar tidak melatih
const { BehaviorGuard } = await import('../sdk/behaviorguard.js');

// `s` menggeser gaya sedikit tiap jendela. Tanpa itu tiap jendela IDENTIK dan detektor
// rekam-ulang (C-35) yang menyala, bukan yang sedang diuji di sini.
let seed = 12345;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
function burst(t0, n) {
  const ev = [];
  let t = t0;
  for (let i = 0; i < n; i++) {
    t += 55 + Math.floor(rnd() * 90);
    const r = i % 10;
    if (r === 0) ev.push({ event_type: 'MOUSE_CLICK', x: 120 + rnd() * 300, y: 90 + rnd() * 200, timestamp: t });
    else if (r === 1) ev.push({ event_type: 'MOUSE_SCROLL', scroll_delta: 40 + rnd() * 100, timestamp: t });
    else if (r % 2) ev.push({ event_type: 'KEYSTROKE', key: 'k' + (i % 6), kc: rnd() < 0.5 ? 'L' : 'R', hold_time: 70 + rnd() * 50, timestamp: t });
    else ev.push({ event_type: 'MOUSE_MOVE', x: 100 + rnd() * 400, y: 70 + rnd() * 250, velocity: 0.3 + rnd() * 0.7, timestamp: t });
  }
  return ev;
}

const g = new BehaviorGuard();
await g.init({ userId: 'sintetis@uji.id', mfa: { enabled: false }, session: { minEventsAssess: 40 } });
try { clearInterval(g._autoTimer); } catch { }
g.onRisk = () => { };
let T = NOW;
for (let i = 0; i < 12; i++) { const e = burst(T, 120); NOW = e[e.length - 1].timestamp + 500; await g.scoreExternalEvents(e); T += 20 * 60_000; }
check('C0 model terbentuk sesudah pendaftaran', !!g.model);

// capture tiruan: seolah 60 event tiruan datang sejak vonis terakhir
g.capture = { synthetic: 60, peek: () => [], buffer: [] };
const evs = burst(T, 120);
NOW = evs[evs.length - 1].timestamp + 500;
const kotor = await g.scoreExternalEvents(evs);
check('C1 vonis melaporkan masukan sintetis', !!(kotor && kotor.automation && kotor.automation.syntheticInputs === 60),
  JSON.stringify(kotor && kotor.automation));
check('C2 jendela tercemar TIDAK layak melatih', kotor && kotor.eligible === false);
check('C3 alasannya bisa dibaca integrator', !!(kotor && (kotor.reasons || []).some(r => /dibuat skrip/.test(r))));
check('C4 TIDAK diblokir karena sintetis - kebijakan itu milik integrator',
  kotor && kotor.blocked !== true, `level ${kotor && kotor.level}`);
check('C5 vektor tercemar tidak masuk kolam latih',
  g.sessions[g.sessions.length - 1].eligible === false);

// hitungan tidak bertambah -> jendela berikutnya bersih lagi
T += 20 * 60_000;
const evs2 = burst(T, 120);
NOW = evs2[evs2.length - 1].timestamp + 500;
const bersih = await g.scoreExternalEvents(evs2);
check('C6 jendela berikutnya bersih lagi (selisih, bukan total kumulatif)',
  bersih && !bersih.automation);

// C7: ganti pengguna (logout -> login) memasang capture BARU yang hitungannya dari nol.
// Penanda di orkestrator harus ikut nol, kalau tidak deteksi mati sampai kunjungan baru
// melewati angka lama.
await g.init({ userId: 'pengguna-lain@uji.id', mfa: { enabled: false }, session: { minEventsAssess: 40 } });
try { clearInterval(g._autoTimer); } catch { }
check('C7 hitungan sintetis ikut direset saat ganti pengguna', (g._synthSeen || 0) === 0, String(g._synthSeen));

// ============================================================ D. perekam dialog
function fakeInput() {
  const h = {};
  return {
    value: '', _h: h,
    addEventListener: (t, f) => { (h[t] = h[t] || []).push(f); },
    emit: (t, e) => (h[t] || []).forEach(f => f({ preventDefault() { }, ...e })),
  };
}
const hooks = { onRestart() { }, onCaps() { }, onKeyup() { }, onChange() { } };
let perf = 1000;
globalThis.performance = { now: () => perf };

// (i) ketikan sungguhan -> sampel utuh
let inp = fakeInput();
let rec = createRecorder(inp, hooks);
for (const ch of 'kunci rahasia') {
  inp.emit('keydown', { key: ch, code: 'K' + ch, repeat: false, getModifierState: () => false });
  perf += 95;
  inp.value += ch;
  inp.emit('input', { inputType: 'insertText' });
  inp.emit('keyup', { key: ch, code: 'K' + ch });
  perf += 120;
}
let s = rec.sample();
check('D1 ketikan sungguhan menghasilkan sampel utuh', !s.error && s.dwell.length === inp.value.length, s.error || '');

// (ii) satu event tiruan mencemari SELURUH sampel
inp = fakeInput();
rec = createRecorder(inp, hooks);
for (const ch of 'kunci rahasia') {
  inp.emit('keydown', { isTrusted: ch === 'r' ? false : true, key: ch, code: 'K' + ch, repeat: false, getModifierState: () => false });
  perf += 95;
  inp.value += ch;
  inp.emit('input', { inputType: 'insertText' });
  inp.emit('keyup', { isTrusted: ch === 'r' ? false : true, key: ch, code: 'K' + ch });
  perf += 120;
}
s = rec.sample();
check('D2 satu event tiruan menolak seluruh sampel (gagal-tertutup)', s.error === 'synthetic', s.error || 'LOLOS');

// (iii) sepenuhnya tiruan (skrip yang meniru jeda template)
inp = fakeInput();
rec = createRecorder(inp, hooks);
for (const ch of 'kunci rahasia') {
  inp.emit('keydown', { isTrusted: false, key: ch, code: 'K' + ch, repeat: false, getModifierState: () => false });
  perf += 95;
  inp.value += ch;
  inp.emit('input', { inputType: 'insertText' });
  inp.emit('keyup', { isTrusted: false, key: ch, code: 'K' + ch });
  perf += 120;
}
check('D3 ketikan yang sepenuhnya dibuat skrip ditolak', rec.sample().error === 'synthetic');

// ============================================================ E. batas waktu jalur cadangan
Date.now = () => Date.now.real ? Date.now.real() : NOW;   // kembalikan jam nyata untuk setTimeout
const realNow = Date.now;
globalThis.Date.now = () => NOW;

const g2 = new BehaviorGuard();
let gantung = 0;
await g2.init({
  userId: 'gantung@uji.id',
  mfa: { enabled: true, onFallback: () => new Promise(() => { gantung++; }), fallbackTimeoutMs: 120 },
});
try { clearInterval(g2._autoTimer); } catch { }
const t0 = realNow.call(Date);
const hasil = await g2._runFallback({ level: 'MEDIUM', reasons: [], trigger: 'uji', why: 'uji' });
check('E1 onFallback yang menggantung berakhir dengan "tidak terverifikasi"', hasil === false, String(hasil));
check('E2 onFallback benar-benar dipanggil', gantung === 1);
check('E3 tidak menyangkutkan _mfaBusy', !g2._mfaBusy);

// stepUp() sesudahnya masih bisa jalan (bukan "busy" selamanya)
const lanjut = await g2.stepUp({ level: 'MEDIUM', reason: 'uji lanjutan' });
check('E4 step-up berikutnya tidak dijawab "sedang sibuk"', lanjut.busy !== true, JSON.stringify(lanjut));

// ============================================================ F. canEnroll
const st = g2.status();
check('F1 canEnroll true di sesi tenang tanpa template', st.mfa.canEnroll === true, JSON.stringify(st.mfa));
g2.lastRisk = 'HIGH';
check('F2 canEnroll false saat sesi dicurigai (pasangan C-2)', g2.status().mfa.canEnroll === false);
g2.lastRisk = 'LOW';
g2.challengeTemplate = { v: 2, mode: 'hard', dwell: [], flight: [] };
check('F3 canEnroll false kalau sudah terdaftar', g2.status().mfa.canEnroll === false);

// ---- laporan
let ok = 0;
for (const r of results) { console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.note != null && r.note !== '' ? `  [${r.note}]` : ''}`); if (r.ok) ok++; }
console.log(`\n  lulus ${ok} / ${results.length}`);
console.log(`  HASIL: ${ok === results.length ? 'SESUAI' : 'ADA KEGAGALAN'}`);
process.exit(ok === results.length ? 0 : 1);
