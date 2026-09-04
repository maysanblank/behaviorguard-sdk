/**
 * challenge.js - step-up kata kunci + ritme ketik per-posisi.
 *
 * KONTRAK KEAMANAN (v2): fungsi ini GAGAL-TERTUTUP.
 * Sample yang tidak lengkap, tidak finit, atau panjangnya tidak sama dengan
 * template = DITOLAK. Versi v1 mengiterasi panjang TEMPLATE dan membaca
 * `sample.dwell[i]` yang `undefined` -> `NaN` -> `NaN > x` selalu false ->
 * nol pelanggaran -> LOLOS. Akibatnya menempel frasa (nol event ketik)
 * melewati seluruh lapisan ritme. Lihat core/DRIFT.md C-1.
 *
 * Di luar cakupan core/SPEC.md (§1: challenge bukan bagian jalur numerik),
 * jadi berkas ini tidak terikat core/golden.json.
 */

// Ambang bentuk template. Frasa terlalu pendek = terlalu sedikit titik ukur
// untuk membedakan orang; tolak daripada memberi rasa aman palsu.
export const MIN_DWELL_POINTS = 8;      // ~8 karakter tampak
const MAD_FLOOR_MS = 3;                 // di bawah ini = derau timer, bukan sinyal
const MAD_FLOOR_REL = 0.08;             // jitter manusia wajar: 8% dari median
const MAD_CEIL_REL = 0.50;              // pendaftaran kacau tak boleh bikin toleransi tak terbatas
const MISS_BUDGET_REL = 0.12;           // porsi posisi yang boleh meleset
const K_DEFAULT = 2.5;

function isFiniteArray(a, n) {
  if (!Array.isArray(a) || a.length !== n) return false;
  for (let i = 0; i < n; i++) if (!Number.isFinite(a[i])) return false;
  return true;
}

function medianOf(sorted) {
  const n = sorted.length;
  if (!n) return 0;
  const mid = n >> 1;
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// MAD dijepit: lantai (absolut + relatif) supaya pemilik yang konsisten tidak
// ditolak oleh derau; langit-langit supaya pendaftaran yang berantakan tidak
// melebarkan toleransi sampai menerima siapa pun.
function clampedMad(vals, med) {
  const raw = vals.reduce((a, v) => a + Math.abs(v - med), 0) / vals.length;
  const floor = Math.max(MAD_FLOOR_MS, MAD_FLOOR_REL * med);
  const ceil = Math.max(floor, MAD_CEIL_REL * med);
  return Math.min(Math.max(raw, floor), ceil);
}

function axis(samples, key) {
  const n = samples[0][key].length;
  const med = [], mad = [];
  for (let i = 0; i < n; i++) {
    const vals = samples.map(s => s[key][i]).sort((a, b) => a - b);
    const m = medianOf(vals);
    med.push(m);
    mad.push(clampedMad(vals, m));
  }
  return { med, mad };
}

/**
 * Bangun template dari beberapa sampel pendaftaran.
 * Menolak (mengembalikan null) bila sampel tidak konsisten bentuknya atau
 * frasanya terlalu pendek — lebih baik tanpa template daripada template lemah.
 */
export function buildTemplate(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const nD = samples[0] && Array.isArray(samples[0].dwell) ? samples[0].dwell.length : 0;
  const nF = samples[0] && Array.isArray(samples[0].flight) ? samples[0].flight.length : 0;
  if (nD < MIN_DWELL_POINTS) return null;
  // setiap sampel harus berbentuk sama & finit — kalau tidak, pendaftarannya cacat
  for (const s of samples) {
    if (!s || !isFiniteArray(s.dwell, nD) || !isFiniteArray(s.flight, nF)) return null;
  }
  const d = axis(samples, 'dwell');
  const f = axis(samples, 'flight');
  return {
    v: 2,
    dwell: d.med, dwellMad: d.mad,
    flight: f.med, flightMad: f.mad,
    k: K_DEFAULT,
    rounds: samples.length,
  };
}

/**
 * Verifikasi satu sampel terhadap template.
 * @returns {{ok:boolean, reasons:string[], checks:number, misses:number, budget:number}}
 */
export function verify(sample, tmpl) {
  if (!tmpl || !Array.isArray(tmpl.dwell) || !Array.isArray(tmpl.flight)) {
    return { ok: false, reasons: ['no template'], checks: 0, misses: 0, budget: 0 };
  }
  const nD = tmpl.dwell.length, nF = tmpl.flight.length;

  // GERBANG BENTUK — inilah tambalan intinya. Sample harus lengkap dan finit.
  // Tempel / autofill / isi sebagian menghasilkan array pendek dan berhenti DI SINI,
  // bukan lolos diam-diam lewat perbandingan NaN.
  if (!sample || !isFiniteArray(sample.dwell, nD) || !isFiniteArray(sample.flight, nF)) {
    const gotD = sample && Array.isArray(sample.dwell) ? sample.dwell.length : 0;
    const gotF = sample && Array.isArray(sample.flight) ? sample.flight.length : 0;
    return {
      ok: false,
      reasons: [`ritme tidak lengkap: dwell ${gotD}/${nD}, flight ${gotF}/${nF} (tempel/autofill tidak diterima)`],
      checks: nD + nF, misses: nD + nF, budget: 0,
    };
  }

  const k = Number.isFinite(tmpl.k) ? tmpl.k : K_DEFAULT;
  const reasons = [];
  const push = (label, i, d, lim) =>
    reasons.push(`${label} ${i} ${d.toFixed(1)}>${lim.toFixed(1)}`);

  for (let i = 0; i < nD; i++) {
    const lim = k * tmpl.dwellMad[i];
    const d = Math.abs(sample.dwell[i] - tmpl.dwell[i]);
    if (d > lim) push('dwell', i, d, lim);
  }
  for (let i = 0; i < nF; i++) {
    const lim = k * tmpl.flightMad[i];
    const d = Math.abs(sample.flight[i] - tmpl.flight[i]);
    if (d > lim) push('flight', i, d, lim);
  }

  // Anggaran meleset PROPORSIONAL, bukan angka tetap 2. Pada frasa pendek
  // "2 posisi bebas" adalah celah besar; pada frasa panjang justru terlalu galak.
  const checks = nD + nF;
  const budget = Math.max(1, Math.floor(MISS_BUDGET_REL * checks));
  return { ok: reasons.length <= budget, reasons, checks, misses: reasons.length, budget };
}
