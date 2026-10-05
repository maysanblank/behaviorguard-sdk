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
// C-20: 8% terlalu ketat. Pendaftaran 3-ronde yang konsisten bikin MAD kecil ->
// toleransi 2.5*8%*median. Variasi ritme pemilik ANTAR-SESI (capek, mood, keyboard
// lain) gampang tembus itu -> pemilik asli ditolak ~64% (terukur). 12% = jitter
// manusia antar-sesi yang wajar; FRR turun drastis, FAR tetap ~0 (lihat C-20 DRIFT.md).
const MAD_FLOOR_REL = 0.12;             // jitter manusia antar-sesi yang wajar
const MAD_CEIL_REL = 0.50;              // pendaftaran kacau tak boleh bikin toleransi tak terbatas
const MISS_BUDGET_REL = 0.12;           // porsi posisi yang boleh meleset
const K_DEFAULT = 2.5;
// C-20: tempo GLOBAL pemilik geser tiap hari (semua tombol serentak lebih lambat/cepat).
// Yang membedakan ORANG adalah pola RELATIF antar-posisi, bukan kecepatan absolut.
// Sebelum banding per-posisi, skala sampel ke tempo template (rasio median). Rasio
// dijepit [0.5,2.0]: drift pemilik (±20%) terkoreksi penuh, tapi sampel ekstrem
// (robot/tempel-datar 300ms) tidak bisa "diskalakan pas" jadi tetap ketolak.
const TEMPO_RATIO_LO = 0.5, TEMPO_RATIO_HI = 2.0;

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
 * frasanya terlalu pendek - lebih baik tanpa template daripada template lemah.
 */
// C-45: keyboard layar sentuh (Android/iOS) menembakkan keydown `Unidentified` / 229 tanpa
// waktu tahan yang bermakna, jadi dwell tidak bisa diukur di sana. Sampel dari keyboard
// seperti itu bermode 'soft': hanya jeda antar-karakter (flight) yang dinilai. Template
// menyimpan modenya; sampel dengan mode berbeda DITOLAK (gagal-tertutup), bukan
// diterjemahkan - ritme keyboard fisik dan layar sentuh bukan besaran yang sama.
const modeOf = s => (s && s.mode === 'soft') ? 'soft' : 'hard';

export function buildTemplate(samples) {
  if (!Array.isArray(samples) || samples.length < 2) return null;
  const nD = samples[0] && Array.isArray(samples[0].dwell) ? samples[0].dwell.length : 0;
  const nF = samples[0] && Array.isArray(samples[0].flight) ? samples[0].flight.length : 0;
  if (nD < MIN_DWELL_POINTS) return null;
  const mode = modeOf(samples[0]);
  // setiap sampel harus berbentuk sama & finit - kalau tidak, pendaftarannya cacat
  for (const s of samples) {
    if (!s || !isFiniteArray(s.dwell, nD) || !isFiniteArray(s.flight, nF)) return null;
    if (modeOf(s) !== mode) return null;
  }
  const d = axis(samples, 'dwell');
  const f = axis(samples, 'flight');
  return {
    v: 2,
    mode,
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

  // GERBANG BENTUK - inilah tambalan intinya. Sample harus lengkap dan finit.
  // Tempel / autofill / isi sebagian menghasilkan array pendek dan berhenti DI SINI,
  // bukan lolos diam-diam lewat perbandingan NaN.
  if (!sample || !isFiniteArray(sample.dwell, nD) || !isFiniteArray(sample.flight, nF)) {
    const gotD = sample && Array.isArray(sample.dwell) ? sample.dwell.length : 0;
    const gotF = sample && Array.isArray(sample.flight) ? sample.flight.length : 0;
    return {
      ok: false,
      reasons: [`incomplete rhythm: dwell ${gotD}/${nD}, flight ${gotF}/${nF} (paste/autofill is not accepted)`],
      checks: nD + nF, misses: nD + nF, budget: 0,
    };
  }

  if (modeOf(sample) !== modeOf(tmpl)) {
    return {
      ok: false, modeMismatch: true,
      reasons: [`different keyboard type than at enrollment (${modeOf(tmpl)} vs ${modeOf(sample)})`],
      checks: nD + nF, misses: nD + nF, budget: 0,
    };
  }
  const soft = modeOf(tmpl) === 'soft';
  const k = Number.isFinite(tmpl.k) ? tmpl.k : K_DEFAULT;
  const reasons = [];
  const push = (label, i, d, lim) =>
    reasons.push(`${label} ${i} ${d.toFixed(1)}>${lim.toFixed(1)}`);

  // C-20: koreksi tempo global sebelum banding per-posisi. Rasio = median template
  // / median sampel, dijepit [0.5,2.0]. Ini membuang geseran kecepatan antar-sesi
  // pemilik (penyebab utama FRR tinggi) tanpa menghapus pola relatif yang membedakan
  // orang. Dijepit supaya sampel bertempo ekstrem tidak bisa diskalakan agar cocok.
  const clampRatio = (num, den) => {
    if (!(den > 0) || !Number.isFinite(num)) return 1;
    return Math.min(Math.max(num / den, TEMPO_RATIO_LO), TEMPO_RATIO_HI);
  };
  const rD = clampRatio(medianOf([...tmpl.dwell].sort((a, b) => a - b)),
                        medianOf([...sample.dwell].sort((a, b) => a - b)));
  const rF = clampRatio(medianOf([...tmpl.flight].sort((a, b) => a - b)),
                        medianOf([...sample.flight].sort((a, b) => a - b)));

  // Mode soft: dwell tidak terukur, jadi tidak dinilai SAMA SEKALI - kalau dihitung sebagai
  // "lolos", anggaran meleset di bawah ikut membengkak dan melonggarkan cek flight.
  if (!soft) for (let i = 0; i < nD; i++) {
    const lim = k * tmpl.dwellMad[i];
    const d = Math.abs(sample.dwell[i] * rD - tmpl.dwell[i]);
    if (d > lim) push('dwell', i, d, lim);
  }
  for (let i = 0; i < nF; i++) {
    const lim = k * tmpl.flightMad[i];
    const d = Math.abs(sample.flight[i] * rF - tmpl.flight[i]);
    if (d > lim) push('flight', i, d, lim);
  }

  // Anggaran meleset PROPORSIONAL, bukan angka tetap 2. Pada frasa pendek
  // "2 posisi bebas" adalah celah besar; pada frasa panjang justru terlalu galak.
  const checks = soft ? nF : nD + nF;
  const budget = Math.max(1, Math.floor(MISS_BUDGET_REL * checks));
  return { ok: reasons.length <= budget, reasons, checks, misses: reasons.length, budget };
}
