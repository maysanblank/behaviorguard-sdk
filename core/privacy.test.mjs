/**
 * privacy.test.mjs - C-30: apa yang BOLEH dan TIDAK BOLEH tertangkap capture.js.
 *
 *  1. Karakter yang diketik tidak pernah tersimpan (termasuk kolom sandi); yang
 *     tersimpan hanya token urut-kemunculan.
 *  2. Tokenisasi tidak mengubah keystroke_transition_entropy SEDIKIT PUN.
 *  3. Ketikan, klik, fokus, dan tempel di popup MFA milik BG tidak ikut terekam.
 *  4. Auto-repeat tidak memalsukan waktu tahan; keydown yang hilang tidak meninggalkan
 *     t0 basi.
 *  5. C-44: kelas tangan (`kc`) dicatat dari posisi fisik tombol di kolom biasa, dan
 *     TIDAK PERNAH di kolom sandi (urutan kiri/kanan sandi mempersempit tebakan).
 *
 * DOM tiruan minimal - capture.js hanya butuh addEventListener dan target.closest.
 * Jalankan: node core/privacy.test.mjs
 */
import { createCapture } from '../sdk/core/capture.js';
import { extractF4 } from '../sdk/core/features.js';

const results = [];
const check = (name, cond, note) => results.push({ name, ok: !!cond, note });

// ---- DOM tiruan
const L = {};
const on = (t, f) => { (L[t] = L[t] || []).push(f); };
globalThis.window = { scrollY: 0, addEventListener: on };
globalThis.document = { addEventListener: on, removeEventListener() {} };
globalThis.location = { href: 'https://toko.contoh/login' };
let NOW = 1_700_000_000_000;
Date.now = () => NOW;
const fire = (t, e) => (L[t] || []).forEach(f => f(e));
const el = (inBg = false, type = 'text') => ({
  type, matches: sel => sel === 'input[type=password]' ? type === 'password' : true,
  closest: sel => (sel === '[data-bg-mfa]' && inBg) ? {} : null,
});
function type(str, target, dwell = 90, gap = 140) {
  for (const ch of str) {
    fire('keydown', { key: ch, code: 'K' + ch, target, repeat: false }); NOW += dwell;
    fire('keyup', { key: ch, code: 'K' + ch, target }); NOW += gap;
  }
}

const cap = createCapture(() => {});
cap.attach();

// ---- 1. sandi tidak tersimpan
const PASSWORD = 'Rahasia#2026';
const pw = el(false, 'password');
fire('focusin', { target: pw });
type(PASSWORD, pw);
fire('keydown', { key: 'Enter', code: 'Enter', target: pw }); NOW += 80;
fire('keyup', { key: 'Enter', code: 'Enter', target: pw });
const evs = cap.peek();
const blob = JSON.stringify(evs);
const leaked = [...new Set(PASSWORD)].filter(c => evs.some(e => e.key === c));
check('tidak satu pun karakter sandi tersimpan sebagai `key`', leaked.length === 0, leaked.join(''));
check('JSON event (yang dibank ke localStorage) tidak memuat sandinya', !blob.includes('Rahasia') && !blob.includes('2026'));
check('tombol bernama tetap terbaca (Enter bukan rahasia)', evs.some(e => e.key === 'Enter'));
const toks = evs.filter(e => e.event_type === 'KEYSTROKE' && e.key !== 'Enter').map(e => e.key);
check('token mempertahankan pola kesamaan (huruf yang sama -> token sama)',
  toks[1] === toks[3] && toks[3] === toks[6] && new Set(toks).size === new Set(PASSWORD).size,
  `${new Set(toks).size} token untuk ${new Set(PASSWORD).size} karakter berbeda`);

// ---- 2. entropi identik dengan versi karakter asli
const rawEvs = evs.map((e, i) => e.event_type === 'KEYSTROKE' && e.key !== 'Enter'
  ? { ...e, key: [...PASSWORD][evs.slice(0, i).filter(x => x.event_type === 'KEYSTROKE' && x.key !== 'Enter').length] } : e);
const eTok = extractF4(evs).keystroke_transition_entropy, eRaw = extractF4(rawEvs).keystroke_transition_entropy;
check('keystroke_transition_entropy IDENTIK token vs karakter asli', eTok === eRaw, `${eTok} vs ${eRaw}`);
const fT = extractF4(evs), fR = extractF4(rawEvs);
// C-44: dua fitur kelas-tangan SENGAJA tidak dihitung di kolom sandi (tak ada `kc` di sana);
// selain itu tokenisasi tidak boleh mengubah fitur apa pun.
const HANDS = ['keystroke_cross_hand_ratio', 'keystroke_shift_ratio'];
check('semua fitur identik token vs karakter asli (selain 2 fitur kelas-tangan)',
  Object.keys(fT).every(k => HANDS.includes(k) || fT[k] === fR[k]),
  Object.keys(fT).filter(k => !HANDS.includes(k) && fT[k] !== fR[k]).join(','));
check('kolom sandi: tidak ada kelas tangan (`kc`) yang tercatat', evs.every(e => !('kc' in e)));
check('kolom sandi: fitur kelas-tangan 0', HANDS.every(k => fT[k] === 0), HANDS.map(k => fT[k]).join('/'));

// ---- 3. popup MFA tidak terekam
cap.drain();
const pop = el(true);
fire('focusin', { target: pop });
type('kunci rahasia saya', pop);
fire('click', { target: pop, clientX: 10, clientY: 10 });
fire('paste', { target: pop, clipboardData: { getData: () => 'x' } });
fire('focusout', { target: pop });
check('ketikan/klik/fokus/tempel di popup MFA tidak terekam', cap.peek().length === 0, `${cap.peek().length} event`);
fire('mousemove', { target: pop, clientX: 50, clientY: 60 });
check('gerak mouse di atas popup TETAP terekam (gerakan tangan wajar)', cap.peek().some(e => e.event_type === 'MOUSE_MOVE'));

// ---- 4. auto-repeat & keydown hilang
cap.drain();
const f = el(false);
fire('keydown', { key: 'a', code: 'KeyA', target: f, repeat: false }); NOW += 100;
for (let i = 0; i < 5; i++) { fire('keydown', { key: 'a', code: 'KeyA', target: f, repeat: true }); NOW += 30; }
fire('keyup', { key: 'a', code: 'KeyA', target: f });
check('auto-repeat: waktu tahan dihitung dari tekanan pertama', cap.peek()[0].hold_time === 250, cap.peek()[0].hold_time + ' ms');
NOW += 600_000;
fire('keyup', { key: 'a', code: 'KeyA', target: f });   // keyup tanpa keydown (fokus masuk di tengah tekan)
check('keyup tanpa keydown tidak memakai t0 basi 10 menit', cap.peek()[1].hold_time < 1000, cap.peek()[1].hold_time + ' ms');

// ---- 5. C-44: kelas tangan di kolom biasa
cap.drain();
const txt = el(false, 'text');
for (const [key, code] of [['a', 'KeyA'], ['j', 'KeyJ'], ['7', 'Digit7'], [' ', 'Space'], ['.', 'Period']]) {
  fire('keydown', { key, code, target: txt, repeat: false }); NOW += 80;
  fire('keyup', { key, code, target: txt }); NOW += 120;
}
const kcs = cap.peek().map(e => e.kc ?? '-').join('');
check('kolom biasa: kelas dari posisi fisik (KeyA=L, KeyJ=R, Digit=D, Space=S, lain tak dicatat)', kcs === 'LRDS-', kcs);
check('kolom biasa: huruf tetap tidak tersimpan', cap.peek().every(e => e.key !== 'a' && e.key !== 'j'));

const failed = results.filter(r => !r.ok);
console.log(`\nPRIVASI CAPTURE (C-30)\n` +
  results.map(r => `  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.note ? '  [' + r.note + ']' : ''}`).join('\n') +
  `\n\n  passed ${results.length - failed.length} / ${results.length}\n  RESULT: ${failed.length ? 'FAIL' : 'PASS'}\n`);
if (failed.length) process.exit(1);
export { results };
