/**
 * challenge.test.mjs - uji regresi lapisan step-up (C-1).
 *
 * Berkas ini mengunci celah "tempel frasa = lolos MFA": verify() versi lama
 * mengiterasi panjang TEMPLATE dan membandingkan `undefined` -> NaN, dan
 * `NaN > x` selalu false, sehingga sampel kosong menghasilkan NOL pelanggaran
 * dan dinyatakan LOLOS.
 *
 * Jalankan: node core/challenge.test.mjs      (atau buka core/challenge.test.html)
 */
import { buildTemplate, verify, MIN_DWELL_POINTS } from '../sdk/core/challenge.js';

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
}

// Pendaftaran pemilik: frasa 12 karakter, 3 putaran, jitter manusiawi.
const owner = [
  { dwell: [88, 94, 91, 87, 95, 90, 92, 89, 93, 86, 90, 94],
    flight: [135, 148, 141, 139, 152, 144, 138, 146, 140, 143, 137] },
  { dwell: [92, 89, 95, 90, 88, 94, 87, 93, 91, 90, 95, 88],
    flight: [142, 139, 150, 136, 147, 141, 145, 138, 149, 140, 144] },
  { dwell: [90, 92, 88, 93, 91, 89, 94, 90, 87, 92, 91, 90],
    flight: [138, 144, 146, 140, 143, 139, 142, 147, 141, 145, 139] },
];
const tmpl = buildTemplate(owner);
check('template terbentuk dari pendaftaran yang sah', !!tmpl);
check('template menandai versi 2', tmpl && tmpl.v === 2);

// --- Yang HARUS lolos ---
check('pemilik dengan ritme mirip -> lolos',
  verify({ dwell: [91, 90, 92, 89, 93, 91, 90, 92, 90, 89, 92, 91],
           flight: [140, 143, 145, 138, 146, 142, 141, 144, 142, 143, 140] }, tmpl).ok);

// --- Yang HARUS ditolak (regresi C-1) ---
const mustFail = [
  ['tempel: nol event ketik', { dwell: [], flight: [] }],
  ['Ctrl+V: satu dwell nyasar', { dwell: [90], flight: [] }],
  ['ketik sebagian lalu tempel', { dwell: [90, 91], flight: [140] }],
  ['dwell lengkap tapi flight kosong', { dwell: [91, 90, 92, 89, 93, 91, 90, 92, 90, 89, 92, 91], flight: [] }],
  ['sampel berisi NaN', { dwell: new Array(12).fill(NaN), flight: new Array(11).fill(140) }],
  ['sampel berisi Infinity', { dwell: new Array(12).fill(Infinity), flight: new Array(11).fill(140) }],
  ['ritme penyusup jauh beda', { dwell: new Array(12).fill(300), flight: new Array(11).fill(600) }],
  ['sampel null', null],
  ['dwell bukan array', { dwell: 'aaaaaaaaaaaa', flight: new Array(11).fill(140) }],
  ['lebih panjang dari template', { dwell: new Array(13).fill(90), flight: new Array(12).fill(140) }],
];
for (const [name, sample] of mustFail) {
  check(`ditolak - ${name}`, verify(sample, tmpl).ok === false);
}

// --- Bentuk template ---
check('frasa terlalu pendek -> template ditolak',
  buildTemplate([{ dwell: new Array(5).fill(90), flight: new Array(4).fill(140) },
                 { dwell: new Array(5).fill(91), flight: new Array(4).fill(141) }]) === null);
check('satu putaran pendaftaran -> ditolak', buildTemplate([owner[0]]) === null);
check('bentuk sampel tidak konsisten -> ditolak',
  buildTemplate([owner[0], { dwell: new Array(11).fill(90), flight: new Array(10).fill(140) }]) === null);
check('tanpa template -> ditolak', verify({ dwell: [], flight: [] }, null).ok === false);
check(`ambang minimum titik ukur = ${MIN_DWELL_POINTS}`, MIN_DWELL_POINTS >= 8);

// --- Anggaran meleset proporsional, bukan angka tetap 2 ---
const r = verify({ dwell: [91, 90, 92, 89, 93, 91, 90, 92, 90, 89, 92, 91],
                   flight: [140, 143, 145, 138, 146, 142, 141, 144, 142, 143, 140] }, tmpl);
check('anggaran meleset dihitung dari jumlah pemeriksaan', r.budget === Math.max(1, Math.floor(0.12 * r.checks)));
check('jumlah pemeriksaan = dwell + flight', r.checks === 23);

// --- C-20: drift tempo antar-sesi pemilik HARUS lolos, penyusup TETAP ditolak ---
// Pemilik hari lain: pola relatif sama, tapi seluruh tempo bergeser serentak.
// Sebelum tambalan tempo-norm + lantai MAD 12%, ini divonis gagal (FRR ~64% terukur).
const base = { dwell: [91, 90, 92, 89, 93, 91, 90, 92, 90, 89, 92, 91],
               flight: [140, 143, 145, 138, 146, 142, 141, 144, 142, 143, 140] };
const scale = (s, f) => ({ dwell: s.dwell.map(x => x * f), flight: s.flight.map(x => x * f) });
check('C-20 pemilik lebih lambat 18% (drift tempo) -> lolos', verify(scale(base, 1.18), tmpl).ok === true);
check('C-20 pemilik lebih cepat 20% (drift tempo) -> lolos', verify(scale(base, 0.8), tmpl).ok === true);
// Penyusup dengan POLA RELATIF beda tidak boleh lolos walau tempo-norm aktif.
check('C-20 penyusup pola relatif beda -> tetap ditolak',
  verify({ dwell: [60, 130, 62, 128, 64, 126, 66, 124, 68, 122, 70, 120],
           flight: [90, 200, 92, 198, 94, 196, 96, 194, 98, 196, 90] }, tmpl).ok === false);

// --- Laporan ---
const failed = results.filter(r => !r.ok);
const lines = results.map(r => `  ${r.ok ? 'OK  ' : 'GAGAL'} ${r.name}`).join('\n');
const summary =
  `\nUJI STEP-UP (C-1)\n${lines}\n\n  lulus ${results.length - failed.length} / ${results.length}\n` +
  `  HASIL: ${failed.length ? 'ADA YANG GAGAL' : 'SESUAI'}\n`;

if (typeof window !== 'undefined') {
  window.BG_CHALLENGE_TEST = { total: results.length, failed: failed.length, results };
  const pre = document.createElement('pre');
  pre.textContent = summary;
  document.body.appendChild(pre);
} else {
  console.log(summary);
  if (failed.length) process.exit(1);
}
export { results };
