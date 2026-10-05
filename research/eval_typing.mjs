/**
 * eval_typing.mjs - seberapa jauh RENTETAN KETIK PENDEK (satu frasa, ~20 tombol) bisa
 * membedakan orang, tanpa template pendaftaran apa pun?
 *
 * KENAPA DIUKUR. Sampai C-45, step-up bawaan hanya punya SATU jalur perilaku: ritme
 * per-posisi terhadap template yang harus didaftarkan lebih dulu (3 putaran). Sebelum
 * template itu ada - yaitu di SETIAP pemasangan baru, dan di setiap pemilik yang belum
 * sempat mendaftar - verifikasi jatuh 100% ke jalur cadangan integrator (OTP/WebAuthn).
 * Di keadaan itu tidak ada satu pun bit perilaku yang dinilai. Pertanyaan berkas ini:
 * apakah ritme ketik bebas (bukan frasa tetap) dari satu kolom isian sudah cukup untuk
 * memberi BUKTI, sehingga keadaan "belum punya template" tidak lagi berarti nol perilaku.
 *
 * PROTOKOL (held-out, per pemilik):
 *   - fitur    : sub-ruang F4 yang BEBAS-SKALA (rasio/median/IQR), jadi ia bermakna sama
 *                untuk 20 tombol maupun 150 event. Cacahan & kecepatan-per-durasi dibuang.
 *   - latih    : rentetan ketik dari `--baseline` sesi PERTAMA pemilik (urut waktu).
 *   - ambang   : mean + k*std dari jarak pada rentetan latih (parametrik, seperti SDK).
 *   - FRR      : rentetan pemilik dari sesi SESUDAH baseline (tak pernah dilihat).
 *   - FAR      : rentetan SUBJEK LAIN dinilai terhadap statistik pemilik ini.
 *   - AUC/EER  : per pemilik, dirata-rata.
 *
 * Jalankan:
 *   node research/eval_typing.mjs --data <bg_sessions_time.json> [--burst 20] [--k 2.5]
 *   node research/eval_typing.mjs --data ... --sweep        (tabel burst x k)
 */
import fs from 'node:fs';
import { extractF4 } from '../sdk/core/features.js';

const argv = process.argv.slice(2);
const arg = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d; };
const has = n => argv.includes('--' + n);

const DATA = arg('data', (await import('node:path')).join((await import('node:os')).tmpdir(), 'bg_sessions_time.json'));
const BASELINE = +arg('baseline', 10);

// Sub-ruang bebas-skala: nilainya tidak ikut membesar bersama jumlah tombol.
// (keystroke_typing_speed, _burst_count, _transition_entropy sengaja TIDAK dipakai -
//  ketiganya fungsi dari panjang/durasi rentetan, jadi tidak sebanding lintas panjang.)
export const TYPING_FEATURES = [
  'keystroke_dwell_time_mean', 'keystroke_dwell_time_std',
  'keystroke_dwell_median', 'keystroke_flight_median', 'keystroke_flight_iqr',
  'keystroke_backspace_ratio', 'keystroke_cross_hand_ratio', 'keystroke_shift_ratio',
];

function burstsOf(events, n) {
  const ks = events.filter(e => e.event_type === 'KEYSTROKE');
  const out = [];
  for (let i = 0; i + n <= ks.length; i += n) {
    const chunk = ks.slice(i, i + n);
    const f = extractF4(chunk);
    out.push(TYPING_FEATURES.map(k => f[k]));
  }
  return out;
}

function statsOf(vecs) {
  const d = vecs[0].length, mean = new Array(d).fill(0), std = new Array(d).fill(0);
  for (const v of vecs) for (let i = 0; i < d; i++) mean[i] += v[i] / vecs.length;
  for (const v of vecs) for (let i = 0; i < d; i++) std[i] += (v[i] - mean[i]) ** 2 / vecs.length;
  for (let i = 0; i < d; i++) std[i] = Math.sqrt(std[i]);
  return { mean, std };
}

// Jarak = akar rata-rata z^2 atas dimensi yang punya sebaran. Fitur yang di data latih
// selalu bernilai sama (std 0) tidak membawa informasi -> dilewati, bukan jadi tak hingga.
function dist(v, st) {
  let s = 0, n = 0;
  for (let i = 0; i < v.length; i++) {
    const sd = st.std[i];
    if (!(sd > 1e-9)) continue;
    const z = (v[i] - st.mean[i]) / sd;
    s += z * z; n++;
  }
  return n ? Math.sqrt(s / n) : Infinity;
}

function auc(pos, neg) {          // pos = jarak pemilik (kecil), neg = jarak penyusup
  let win = 0;
  for (const p of pos) for (const q of neg) win += p < q ? 1 : (p === q ? 0.5 : 0);
  return win / (pos.length * neg.length);
}
function eer(pos, neg) {
  const all = [...pos, ...neg].sort((a, b) => a - b);
  let best = 1;
  for (const t of all) {
    const frr = pos.filter(p => p > t).length / pos.length;
    const far = neg.filter(q => q <= t).length / neg.length;
    best = Math.min(best, Math.max(frr, far));
  }
  return best;
}

function run(db, burst, k, verbose) {
  const ids = Object.keys(db.subjects);
  const per = [];
  for (const id of ids) {
    const sess = db.subjects[id];
    if (sess.length <= BASELINE + 2) continue;
    const train = sess.slice(0, BASELINE).flatMap(s => burstsOf(s, burst));
    const own = sess.slice(BASELINE).flatMap(s => burstsOf(s, burst));
    if (train.length < 8 || own.length < 4) continue;
    const st = statsOf(train);
    const dTrain = train.map(v => dist(v, st)).filter(Number.isFinite);
    if (!dTrain.length) continue;
    const m = dTrain.reduce((a, b) => a + b, 0) / dTrain.length;
    const sd = Math.sqrt(dTrain.reduce((a, b) => a + (b - m) ** 2, 0) / dTrain.length);
    const thr = m + k * sd;
    const dOwn = own.map(v => dist(v, st)).filter(Number.isFinite);
    const dImp = [];
    for (const other of ids) {
      if (other === id) continue;
      for (const s of db.subjects[other].slice(0, 6)) for (const v of burstsOf(s, burst)) {
        const d = dist(v, st); if (Number.isFinite(d)) dImp.push(d);
      }
    }
    if (!dOwn.length || !dImp.length) continue;
    const frr = dOwn.filter(d => d > thr).length / dOwn.length;
    const far = dImp.filter(d => d <= thr).length / dImp.length;
    per.push({ id, frr, far, auc: auc(dOwn, dImp), eer: eer(dOwn, dImp), nOwn: dOwn.length, nImp: dImp.length, thr });
  }
  const avg = f => per.reduce((a, p) => a + f(p), 0) / per.length;
  if (verbose) {
    console.log(`\n  rentetan ${burst} tombol, k=${k}, ${per.length} pemilik`);
    console.log('  pemilik  ditolak   penyusup lolos   AUC     EER    n(pemilik/penyusup)');
    for (const p of per) console.log(`  ${p.id.padEnd(7)}  ${(p.frr * 100).toFixed(1).padStart(5)}%   ${(p.far * 100).toFixed(1).padStart(12)}%   ${p.auc.toFixed(3)}  ${(p.eer * 100).toFixed(1).padStart(5)}%   ${p.nOwn}/${p.nImp}`);
  }
  return { burst, k, n: per.length, frr: avg(p => p.frr), far: avg(p => p.far), auc: avg(p => p.auc), eer: avg(p => p.eer) };
}

const db = JSON.parse(fs.readFileSync(DATA, 'utf8'));
console.log(`data: ${DATA}\nsubjek: ${Object.keys(db.subjects).length}   baseline: ${BASELINE} sesi   fitur: ${TYPING_FEATURES.length} (bebas-skala)`);

if (has('sweep')) {
  console.log('\n  burst   k     pemilik ditolak   penyusup lolos    AUC     EER');
  for (const b of [12, 16, 20, 30, 40]) {
    for (const k of [1.5, 2.0, 2.5, 3.0]) {
      const r = run(db, b, k, false);
      console.log(`  ${String(b).padStart(5)}  ${k.toFixed(1)}   ${(r.frr * 100).toFixed(1).padStart(13)}%   ${(r.far * 100).toFixed(1).padStart(12)}%   ${r.auc.toFixed(3)}  ${(r.eer * 100).toFixed(1)}%`);
    }
  }
} else {
  const r = run(db, +arg('burst', 20), +arg('k', 2.5), true);
  console.log(`\n  RATA-RATA (${r.n} pemilik): pemilik ditolak ${(r.frr * 100).toFixed(1)}%  penyusup lolos ${(r.far * 100).toFixed(1)}%  AUC ${r.auc.toFixed(3)}  EER ${(r.eer * 100).toFixed(1)}%`);
}
