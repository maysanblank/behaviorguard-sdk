/**
 * mfa.js - verifikasi step-up BAWAAN (dialog dari pustaka).
 *
 * Dipicu saat vonis MEDIUM/HIGH, atau dipanggil integrator lewat BehaviorGuard.stepUp().
 * Pengguna MENGETIK ULANG frasa yang tampil di layar; frasanya bukan rahasia - identitas
 * dibuktikan dari RITME ketik (dwell/flight per posisi) lewat challenge.js.
 * Nol dependensi, nol backend, murni di perangkat.
 *
 * CATATAN KEJUJURAN: verifikasi sisi-klien = re-autentikasi step-up yang nyaman, BUKAN
 * faktor kedua kelas-keamanan. Penyerang yang menguasai browser bisa melewati cek yang
 * seluruhnya di klien (THREAT-MODEL.md). Untuk aksi bernilai tinggi, sediakan jalur
 * `mfa.onFallback` (OTP/WebAuthn milik integrator yang diverifikasi di server).
 *
 * C-45 - dialog versi produksi. Yang berubah dari versi lama dan KENAPA:
 *  - Shadow DOM + stylesheet sendiri. Dulu gaya inline di dalam halaman integrator: CSS
 *    situs (`input{...}`, `button{...}`, reset framework) ikut mengubah tampilan dialog,
 *    dan id tetap (#bg-inp) bisa bertabrakan dengan id milik halaman. innerHTML dengan
 *    atribut style juga diblokir oleh CSP `style-src` yang ketat - justru kebijakan yang
 *    dipakai situs bank. Kini: adoptedStyleSheets (tak terkena CSP inline), nol atribut
 *    style di markup, teks dari integrator selalu lewat textContent (tak ada injeksi HTML).
 *  - Aksesibilitas: role=dialog, aria-modal, fokus terkunci di dalam dialog (Tab berputar),
 *    Esc = batal, pesan lewat aria-live, fokus dikembalikan ke elemen semula saat tutup.
 *  - Keyboard layar sentuh: keydown di Android/iOS memberi `Unidentified`/229 tanpa waktu
 *    tahan. Versi lama tak pernah bisa merekam sampel utuh di ponsel ("ritme tidak terekam
 *    utuh" selamanya) - pemilik yang memakai ponsel terkunci tanpa jalan keluar. Kini jeda
 *    antar-karakter diukur dari event `input` dan sampelnya bermode 'soft'.
 *  - Backspace dulu hanya mengosongkan rekaman tapi tidak isi kolom, jadi ketikan
 *    berikutnya pasti ditolak tanpa pengguna tahu kenapa. Kini kolom ikut dikosongkan dan
 *    alasannya ditulis.
 *  - Frasa tampil per huruf dan menyala sesuai ketikan; salah huruf langsung terlihat.
 *    Frasa lengkap dikirim otomatis (tanpa harus menekan Enter).
 *  - "Gunakan cara lain": jalur keluar untuk pemilik yang tidak bisa mengetik frasa
 *    (ponsel lain, cedera tangan, keyboard berbeda). Tanpa jalur ini pemilik yang gagal
 *    ritme tidak punya pilihan selain diblokir.
 *  - Ketikan di dialog tidak bocor ke pintasan keyboard halaman (propagasi dihentikan di
 *    host); penangkap perilaku sudah mengabaikannya lewat [data-bg-mfa].
 *
 * API: runMfaChallenge(opsi) -> Promise<{ passed, verified, enrolled?, template?, reasons?,
 *        cancelled?, timedOut?, attemptsExhausted?, fallback?, modeMismatch?, reason? }>
 *   - template null -> mode DAFTAR: ketik `rounds`x -> {enrolled:true, template}
 *   - template ada  -> mode VERIFIKASI: ketik 1x (maks 3 percobaan) -> {verified}
 */

const TEXT = {
  id: {
    verifyTitleMedium: 'Konfirmasi bahwa ini kamu',
    verifyTitleHigh: 'Kami perlu memastikan ini kamu',
    verifySubMedium: 'Cara kamu memakai akun ini sedikit berbeda dari biasanya.',
    verifySubHigh: 'Aktivitas di sesi ini sangat berbeda dari kebiasaanmu.',
    verifyPrompt: 'Ketik frasa di bawah dengan irama biasamu.',
    verifySubAction: r => `Sebelum ${r}, pastikan ini memang kamu.`,
    verifySubGeneric: 'Pastikan ini memang kamu sebelum melanjutkan.',
    enrollTitle: 'Atur verifikasi irama ketik',
    enrollSub: 'Saat aktivitasmu terlihat tidak biasa, kami akan memintamu mengetik frasa ini. Yang dicocokkan adalah irama ketikanmu, bukan hurufnya.',
    enrollPrompt: n => `Ketik frasa di bawah ${n} kali seperti biasa.`,
    enrollRound: (i, n) => `Putaran ${i} dari ${n}`,
    placeholder: 'Ketik frasa di atas',
    phraseLabel: 'Frasa yang harus diketik',
    inputLabel: 'Ketik frasa',
    cancel: 'Batal',
    later: 'Nanti saja',
    submit: 'Lanjut',
    fallback: 'Gunakan cara lain',
    close: 'Tutup',
    wrongChar: 'Ada huruf yang tidak cocok. Tekan Backspace untuk mengulang.',
    restarted: 'Diulang dari awal. Irama dihitung dari ketikan utuh.',
    pasteBlocked: 'Menempel tidak bisa dipakai. Ketik frasanya.',
    suggestion: 'Saran kata dari keyboard terdeteksi. Ketik per huruf.',
    incomplete: 'Irama tidak terekam utuh. Ketik ulang dari awal tanpa menempel.',
    synthetic: 'Ketikan tidak berasal dari keyboard perangkat ini. Ketik langsung dengan tanganmu.',
    mismatchText: 'Teks belum sama dengan frasa.',
    again: 'Bagus. Sekali lagi.',
    tryAgain: (i, n) => `Iramanya belum cocok. Coba lagi (${i} dari ${n}).`,
    otherKeyboard: 'Keyboard ini berbeda dari saat kamu mengatur verifikasi.',
    capsLock: 'Caps Lock menyala.',
    verified: 'Terverifikasi',
    verifiedSub: 'Terima kasih. Kamu bisa melanjutkan.',
    enrolled: 'Verifikasi siap dipakai',
    enrolledSub: 'Irama ketikmu tersimpan di perangkat ini.',
    failed: 'Verifikasi tidak berhasil',
    failedSub: 'Irama ketikan tidak cocok dengan pemilik akun.',
    enrollFailed: 'Irama belum konsisten',
    enrollFailedSub: 'Coba lagi lain kali di tempat yang nyaman.',
    timeLeft: s => `Sisa waktu ${s} detik`,
    footer: 'Irama ketik dicocokkan di perangkat ini dan tidak dikirim ke mana pun.',
  },
  en: {
    verifyTitleMedium: 'Confirm it’s you',
    verifyTitleHigh: 'We need to make sure it’s you',
    verifySubMedium: 'The way this account is being used looks a little different from usual.',
    verifySubHigh: 'Activity in this session is very different from your usual pattern.',
    verifyPrompt: 'Type the phrase below at your normal pace.',
    verifySubAction: r => `Before you ${r}, confirm it’s really you.`,
    verifySubGeneric: 'Confirm it’s really you before continuing.',
    enrollTitle: 'Set up typing-rhythm verification',
    enrollSub: 'When your activity looks unusual we will ask you to type this phrase. What is matched is your typing rhythm, not the letters.',
    enrollPrompt: n => `Type the phrase below ${n} times as you normally would.`,
    enrollRound: (i, n) => `Round ${i} of ${n}`,
    placeholder: 'Type the phrase above',
    phraseLabel: 'Phrase to type',
    inputLabel: 'Type the phrase',
    cancel: 'Cancel',
    later: 'Not now',
    submit: 'Continue',
    fallback: 'Use another method',
    close: 'Close',
    wrongChar: 'A character does not match. Press Backspace to start over.',
    restarted: 'Started over. Rhythm is measured on a complete entry.',
    pasteBlocked: 'Pasting is not accepted. Please type the phrase.',
    suggestion: 'Keyboard word suggestion detected. Type one letter at a time.',
    incomplete: 'Rhythm was not fully recorded. Type it again without pasting.',
    synthetic: 'The input did not come from this device’s keyboard. Please type it yourself.',
    mismatchText: 'The text does not match the phrase yet.',
    again: 'Good. Once more.',
    tryAgain: (i, n) => `The rhythm did not match. Try again (${i} of ${n}).`,
    otherKeyboard: 'This keyboard differs from the one used during setup.',
    capsLock: 'Caps Lock is on.',
    verified: 'Verified',
    verifiedSub: 'Thanks. You can continue.',
    enrolled: 'Verification is ready',
    enrolledSub: 'Your typing rhythm is stored on this device.',
    failed: 'Verification failed',
    failedSub: 'The typing rhythm does not match the account owner.',
    enrollFailed: 'Rhythm was not consistent',
    enrollFailedSub: 'Try again later somewhere comfortable.',
    timeLeft: s => `${s} seconds left`,
    footer: 'Typing rhythm is matched on this device and never sent anywhere.',
  },
};

function pickLang(lang) {
  if (lang && TEXT[lang]) return lang;
  try {
    const l = (document.documentElement.getAttribute('lang') || navigator.language || 'id').toLowerCase();
    return l.startsWith('en') ? 'en' : 'id';
  } catch { return 'id'; }
}

const norm = s => (s || '').replace(/\s+/g, ' ').trim().toLowerCase();

const CSS = `
:host{all:initial}
*{box-sizing:border-box}
.bd{position:fixed;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;padding:16px;
  background:rgba(12,16,24,.52);font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
  color:var(--fg);-webkit-font-smoothing:antialiased;
  letter-spacing:normal;word-spacing:normal;text-transform:none;text-indent:0;text-align:left;text-shadow:none;
  font-style:normal;font-variant:normal;white-space:normal;direction:ltr;visibility:visible;cursor:auto;
  pointer-events:auto;user-select:auto;-webkit-user-select:auto;
  --bg:#ffffff;--fg:#141a24;--mut:#5b6573;--line:#e3e6eb;--soft:#f4f6f8;--ok:#1a7f4b;--bad:#c4312b;--warn:#b35c00;--accent:#1f5fd6;--on-accent:#fff}
@media (prefers-color-scheme:dark){.bd.auto{--bg:#171b22;--fg:#e8ebf0;--mut:#9aa3af;--line:#2c323c;--soft:#1f242d;--ok:#4cc38a;--bad:#ff7b72;--warn:#e3a14a}}
.bd.dark{--bg:#171b22;--fg:#e8ebf0;--mut:#9aa3af;--line:#2c323c;--soft:#1f242d;--ok:#4cc38a;--bad:#ff7b72;--warn:#e3a14a}
.card{position:relative;width:100%;max-width:400px;background:var(--bg);border:1px solid var(--line);border-radius:14px;
  box-shadow:0 24px 64px rgba(0,0,0,.28),0 2px 6px rgba(0,0,0,.08);padding:22px 22px 0;outline:none}
.hd{display:flex;gap:12px;align-items:flex-start;margin-bottom:14px}
.ic{flex:none;width:36px;height:36px;border-radius:10px;display:grid;place-items:center;background:var(--soft);color:var(--accent)}
.ic.high{color:var(--warn)}
.ic svg{width:20px;height:20px}
.tt{margin:0;font-size:16px;font-weight:650;line-height:1.3;letter-spacing:-.005em}
.st{margin:3px 0 0;color:var(--mut);font-size:13.5px}
.x{position:absolute;top:12px;right:12px;width:30px;height:30px;border-radius:8px;border:0;background:transparent;color:var(--mut);cursor:pointer;display:grid;place-items:center}
.x:hover{background:var(--soft);color:var(--fg)}
.pr{margin:0 0 8px;font-size:13px;color:var(--mut);display:flex;justify-content:space-between;gap:8px}
.ph{font:600 17px/1.35 ui-monospace,"SF Mono","Cascadia Mono",Consolas,monospace;letter-spacing:.02em;padding:11px 12px;border-radius:10px;
  background:var(--soft);border:1px solid var(--line);margin-bottom:10px;user-select:none;-webkit-user-select:none;word-break:break-word}
.ph span{color:var(--mut);transition:color .08s}
.ph span.ok{color:var(--fg)}
.ph span.bad{color:var(--bad);text-decoration:underline;text-decoration-thickness:2px;text-underline-offset:3px}
.ph span.cur{box-shadow:inset 0 -2px 0 var(--accent)}
input{width:100%;font:inherit;font-size:15px;color:var(--fg);background:var(--bg);border:1.5px solid var(--line);border-radius:10px;padding:10px 12px;outline:none}
input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(31,95,214,.2);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.msg{min-height:20px;margin:7px 1px 0;font-size:13px;color:var(--mut)}
.msg.err{color:var(--bad)}.msg.good{color:var(--ok)}
.dots{display:flex;gap:6px;align-items:center}
.dots i{width:22px;height:4px;border-radius:4px;background:var(--line)}
.dots i.on{background:var(--accent)}
.ft{display:flex;align-items:center;gap:8px;margin:16px 0 0;padding:0 0 18px}
.sp{flex:1}
button.b{font:inherit;font-size:14px;font-weight:600;border-radius:9px;padding:8px 15px;cursor:pointer;border:1px solid var(--line);background:var(--bg);color:var(--fg)}
button.b:hover{background:var(--soft)}
button.pri{background:var(--accent);border-color:var(--accent);color:var(--on-accent)}
button.pri:hover{filter:brightness(1.07);background:var(--accent)}
button.lnk{border:0;background:none;padding:8px 2px;color:var(--accent);font-weight:600;cursor:pointer;font:inherit;font-size:13.5px}
button:focus-visible,.x:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.foot{margin:0 -22px;padding:10px 22px 12px;border-top:1px solid var(--line);color:var(--mut);font-size:12px;display:flex;gap:6px;align-items:center}
.foot svg{width:13px;height:13px;flex:none}
.res{text-align:center;padding:10px 0 24px}
.res .big{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;margin:4px auto 12px}
.res .big svg{width:26px;height:26px}
.res.ok .big{background:var(--soft);background:color-mix(in srgb,var(--ok) 14%,transparent);color:var(--ok)}
.res.bad .big{background:var(--soft);background:color-mix(in srgb,var(--bad) 14%,transparent);color:var(--bad)}
.res h2{margin:0;font-size:16px;font-weight:650}
.res p{margin:4px 0 0;color:var(--mut);font-size:13.5px}
.tl{font-size:12px;color:var(--mut)}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:420px){.card{padding:18px 16px 0}.foot{margin:0 -16px;padding:10px 16px 12px}}
`;

const ICON = {
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.3-2.9 8.1-7 9.5-4.1-1.4-7-5.2-7-9.5V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
  alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.3-2.9 8.1-7 9.5-4.1-1.4-7-5.2-7-9.5V6l7-3z"/><path d="M12 8v4.5M12 16h.01"/></svg>',
  keys: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  cross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
};

let sheetCache = null;
function applyStyles(root) {
  try {
    if (root.adoptedStyleSheets !== undefined && typeof CSSStyleSheet === 'function') {
      if (!sheetCache) { sheetCache = new CSSStyleSheet(); sheetCache.replaceSync(CSS); }
      root.adoptedStyleSheets = [sheetCache];
      return;
    }
  } catch {}
  const st = document.createElement('style'); st.textContent = CSS; root.appendChild(st);
}

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;      // hanya dipakai untuk ikon SVG konstan di atas
  return e;
}

/**
 * Perekam ritme untuk satu kolom input. Merekam DUA jalur sekaligus:
 *  - hard: keydown->keyup (dwell) dan keyup->keydown berikut (flight) - keyboard fisik;
 *  - soft: waktu tiap karakter bertambah di event `input` - keyboard layar sentuh.
 * Mode dipilih di akhir: soft hanya bila keyboard memang melaporkan tombol `Unidentified`.
 */
export function createRecorder(input, hooks) {
  // Per tombol, bukan "tombol terakhir": pengetik cepat menekan huruf berikut SEBELUM
  // melepas huruf sebelumnya (rollover). Versi lama menyimpan satu `downAt`, sehingga
  // rollover mengacaukan pasangan tekan/lepas dan sampel sering tidak utuh.
  // C-46: `synth` = ada event ketik yang DIBUAT SKRIP (isTrusted false). Ini bukan soal
  // kenyamanan melainkan pintu belakang: template irama tersimpan di perangkat, jadi skrip
  // yang bisa membacanya (XSS, ekstensi jahat) dulu tinggal menembakkan keydown/keyup dengan
  // jeda persis median template itu untuk LOLOS verifikasi tanpa satu pun jari menyentuh
  // keyboard. Sampel yang tersentuh event tiruan ditolak seluruhnya - gagal-tertutup.
  let tainted = false, sawSoft = false, prevLen = 0, synth = false;
  const downs = [], ups = [], open = new Map(), softT = [];
  const reset = () => { tainted = false; synth = false; prevLen = 0; downs.length = 0; ups.length = 0; open.clear(); softT.length = 0; };
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const isSoftKey = e => e.isComposing || e.keyCode === 229 || e.key === 'Unidentified' || e.key === 'Process';

  const clearAll = why => { input.value = ''; reset(); hooks.onRestart(why); };

  for (const t of ['paste', 'drop']) {
    input.addEventListener(t, e => { e.preventDefault(); clearAll('paste'); });
  }
  input.addEventListener('beforeinput', e => {
    const it = e.inputType || '';
    if (it === 'insertFromPaste' || it === 'insertFromDrop' || it === 'insertFromYank' || it === 'insertReplacementText') {
      e.preventDefault(); clearAll(it === 'insertReplacementText' ? 'suggestion' : 'paste');
    }
  });
  input.addEventListener('keydown', e => {
    if (e.isTrusted === false) { synth = true; return; }
    if (e.key === 'CapsLock' || (e.getModifierState && e.getModifierState('CapsLock'))) hooks.onCaps(!!(e.getModifierState && e.getModifierState('CapsLock')));
    if (isSoftKey(e)) { sawSoft = true; return; }
    if (e.key === 'Enter') return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); if (input.value) clearAll('backspace'); return; }
    if (e.key.length !== 1 || e.repeat) return;
    // spasi ganda/di depan tidak mengubah teks (dinormalisasi) tapi menambah satu posisi
    // ritme -> sampel tak sebentuk dengan template. Dicegah di sumbernya.
    if (e.key === ' ' && (!input.value || input.value.endsWith(' '))) { e.preventDefault(); return; }
    open.set(e.code || e.key, downs.length);
    downs.push(now());
  });
  input.addEventListener('keyup', e => {
    if (e.isTrusted === false) { synth = true; return; }
    if (isSoftKey(e)) return;
    const id = e.code || e.key;
    const i = open.get(id);
    if (i == null) return;
    open.delete(id);
    ups[i] = now();
    hooks.onKeyup();
  });
  input.addEventListener('input', e => {
    const len = input.value.length;
    const it = e.inputType || '';
    if (it.startsWith('delete') || len < prevLen) {
      // Backspace di keyboard layar sentuh tidak lewat keydown yang bisa dicegah
      if (input.value) { clearAll('backspace'); return; }
      reset(); hooks.onChange(); return;
    }
    if (len === prevLen + 1) softT.push(now());
    else if (len > prevLen + 1) tainted = true;         // saran kata / isi otomatis beberapa huruf
    prevLen = len;
    hooks.onChange();
  });

  return {
    reset,
    sample() {
      const n = input.value.length;
      if (synth) return { error: 'synthetic' };
      if (tainted) return { error: 'suggestion' };
      if (sawSoft) {
        if (softT.length !== n || n < 2) return { error: 'incomplete' };
        const fl = []; for (let i = 1; i < n; i++) fl.push(softT[i] - softT[i - 1]);
        return { mode: 'soft', dwell: new Array(n).fill(0), flight: fl };
      }
      if (n === 0 || downs.length !== n || open.size) return { error: 'incomplete' };
      const dwell = [], flight = [];
      for (let i = 0; i < n; i++) {
        if (!Number.isFinite(ups[i])) return { error: 'incomplete' };
        dwell.push(ups[i] - downs[i]);
        if (i > 0) flight.push(downs[i] - ups[i - 1]);   // negatif = rollover, itu juga ciri orang
      }
      return { mode: 'hard', dwell, flight };
    },
    pendingKey: () => open.size > 0,
  };
}

/**
 * @param {object} o
 *   phrase, template|null, rounds, buildTemplate, verify
 *   level: 'MEDIUM'|'HIGH' (verifikasi) - menentukan nada teks
 *   timeoutMs, lang ('id'|'en'), texts (timpa sebagian teks), accent (warna CSS), brand (nama situs)
 *   allowFallback: tampilkan "Gunakan cara lain" (hanya mode verifikasi)
 *   title/subtitle: timpa judul/subjudul (kompatibel dengan versi lama)
 */
export function runMfaChallenge(o) {
  const {
    phrase: rawPhrase, template = null, rounds = 3, buildTemplate, verify,
    level = 'MEDIUM', timeoutMs = 120000, lang, texts, accent, brand,
    allowFallback = false, title, subtitle, theme = 'auto', trigger = 'verdict', reason = null,
  } = o || {};
  if (typeof document === 'undefined' || !document.documentElement) {
    return Promise.resolve({ passed: false, verified: false, cancelled: true, reason: 'no-dom' });
  }
  const L = { ...TEXT[pickLang(lang)], ...(texts || {}) };
  const phrase = String(rawPhrase || '').replace(/\s+/g, ' ').trim();
  const enrollMode = !template;
  const need = enrollMode ? Math.max(2, rounds | 0) : 1;
  const MAX_ATTEMPTS = 3;
  const samples = [];
  const prevFocus = document.activeElement;

  return new Promise(resolve => {
    // Host = elemen khusus (bukan <div>) supaya aturan `div{...}` situs tidak mengenainya, dan
    // gaya inline-nya !important supaya aturan `*{...}` situs yang !important pun kalah. Yang
    // masih bisa merembes dari host hanyalah properti WARISAN; semuanya diset ulang di .bd.
    const host = document.createElement('bg-guard-dialog');
    host.setAttribute('data-bg-mfa', '');
    host.style.cssText = ['position:fixed', 'top:0', 'right:0', 'bottom:0', 'left:0', 'z-index:2147483647', 'display:block',
      'margin:0', 'padding:0', 'border:0', 'background:transparent', 'opacity:1', 'visibility:visible', 'transform:none',
      'filter:none', 'pointer-events:auto', 'width:auto', 'height:auto', 'clip-path:none', 'contain:none']
      .map(d => d + ' !important').join(';');
    const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    applyStyles(root);

    // tema: 'auto' mengikuti OS; situs yang selalu terang/gelap memaksanya supaya dialog
    // tidak tampil gelap di atas halaman terang (atau sebaliknya)
    const bd = el('div', 'bd ' + (theme === 'light' || theme === 'dark' ? theme : 'auto'));
    if (accent) { bd.style.setProperty('--accent', accent); }
    const card = el('div', 'card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'bg-t');
    card.setAttribute('aria-describedby', 'bg-s');
    card.tabIndex = -1;
    bd.appendChild(card);
    root.appendChild(bd);

    // ---------- kerangka ----------
    const hd = el('div', 'hd');
    const ic = el('div', 'ic' + (level === 'HIGH' && !enrollMode ? ' high' : ''), enrollMode ? ICON.keys : (level === 'HIGH' ? ICON.alert : ICON.shield));
    const hx = el('div');
    const tt = el('h2', 'tt'); tt.id = 'bg-t';
    tt.textContent = title || (enrollMode ? L.enrollTitle : (level === 'HIGH' ? L.verifyTitleHigh : L.verifyTitleMedium));
    const st = el('p', 'st'); st.id = 'bg-s';
    // Vonis otomatis menjelaskan PENYIMPANGAN; step-up dari integrator (sebelum transfer,
    // ganti sandi) belum tentu karena penyimpangan - jangan menuduh "perilakumu berbeda".
    st.textContent = subtitle || (enrollMode ? L.enrollSub
      : trigger === 'integrator' ? (reason ? L.verifySubAction(reason) : L.verifySubGeneric)
      : (level === 'HIGH' ? L.verifySubHigh : L.verifySubMedium));
    if (brand && !subtitle) st.textContent = `${brand} · ${st.textContent}`;
    hx.append(tt, st); hd.append(ic, hx);
    const x = el('button', 'x', ICON.x); x.type = 'button'; x.setAttribute('aria-label', L.close);

    const body = el('div');
    const pr = el('div', 'pr');
    const prL = el('span'); prL.textContent = enrollMode ? L.enrollPrompt(need) : L.verifyPrompt;
    const prR = el('span', 'dots');
    if (enrollMode) for (let i = 0; i < need; i++) prR.appendChild(el('i'));
    pr.append(prL, prR);

    const ph = el('div', 'ph'); ph.setAttribute('aria-hidden', 'true');
    const chars = [...phrase];
    const spans = chars.map(c => { const s = el('span'); s.textContent = c; ph.appendChild(s); return s; });
    const phSr = el('span', 'sr'); phSr.textContent = `${L.phraseLabel}: ${phrase}`;

    const inp = document.createElement('input');
    inp.type = 'text';
    for (const [k, v] of Object.entries({ autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false',
      inputmode: 'text', enterkeyhint: 'done', 'aria-label': L.inputLabel, 'data-lpignore': 'true', 'data-1p-ignore': '', 'data-form-type': 'other' })) inp.setAttribute(k, v);
    inp.placeholder = L.placeholder;

    const msg = el('div', 'msg'); msg.setAttribute('role', 'status'); msg.setAttribute('aria-live', 'polite');
    body.append(pr, phSr, ph, inp, msg);

    const ft = el('div', 'ft');
    const fb = el('button', 'lnk'); fb.type = 'button'; fb.textContent = L.fallback;
    const tl = el('span', 'tl');
    const sp = el('span', 'sp');
    const cancel = el('button', 'b'); cancel.type = 'button'; cancel.textContent = enrollMode ? L.later : L.cancel;
    const ok = el('button', 'b pri'); ok.type = 'button'; ok.textContent = L.submit;
    if (allowFallback && !enrollMode) ft.append(fb);
    ft.append(tl, sp, cancel, ok);

    const foot = el('div', 'foot', ICON.lock);
    const footT = el('span'); footT.textContent = L.footer; foot.appendChild(footT);

    card.append(hd, x, body, ft, foot);

    // ---------- keadaan ----------
    let done = false, failed = 0, capsOn = false, autoT = null, killT = null, tickT = null;
    let deadline = Date.now() + timeoutMs;
    const say = (text, kind) => { msg.textContent = text || ''; msg.className = 'msg' + (kind ? ' ' + kind : ''); };
    const paintDots = () => { [...prR.children].forEach((d, i) => d.classList.toggle('on', i < samples.length)); };

    const paint = () => {
      const v = inp.value.toLowerCase(), p = phrase.toLowerCase();
      let bad = -1;
      for (let i = 0; i < chars.length; i++) {
        const s = spans[i];
        s.className = '';
        if (i < v.length) {
          if (bad < 0 && v[i] === p[i]) s.className = 'ok';
          else { if (bad < 0) bad = i; s.className = 'bad'; }
        } else if (i === v.length) s.className = 'cur';
      }
      if (v.length > p.length && bad < 0) bad = p.length;
      return bad;
    };

    const rec = createRecorder(inp, {
      onRestart(why) {
        paint();
        say(why === 'paste' ? L.pasteBlocked : why === 'suggestion' ? L.suggestion : L.restarted, why === 'backspace' ? '' : 'err');
      },
      onCaps(on) { capsOn = on; },
      onKeyup() { scheduleAuto(); },
      onChange() {
        const bad = paint();
        if (bad >= 0) say(L.wrongChar, 'err');
        else if (capsOn) say(L.capsLock, '');
        else if (msg.classList.contains('err')) say('');
        scheduleAuto();
      },
    });

    function scheduleAuto() {
      if (autoT) { clearTimeout(autoT); autoT = null; }
      if (norm(inp.value) !== norm(phrase)) return;
      // tunggu keyup huruf terakhir, lalu beri jeda singkat supaya terasa disengaja
      autoT = setTimeout(() => { autoT = null; if (!rec.pendingKey()) submit(); }, 220);
    }

    function cleanup() {
      done = true;
      [autoT, killT].forEach(t => t && clearTimeout(t));
      if (tickT) clearInterval(tickT);
      document.removeEventListener('focusin', keepFocus, true);
      host.remove();
      try { if (prevFocus && prevFocus.focus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); } catch {}
    }
    function finish(result, screen) {
      if (done) return;
      if (!screen) { cleanup(); resolve(result); return; }
      // layar hasil singkat: pengguna melihat apa yang terjadi sebelum dialog hilang
      done = true;
      [autoT, killT].forEach(t => t && clearTimeout(t));
      if (tickT) clearInterval(tickT);
      const r = el('div', 'res ' + screen.kind, `<div class="big">${screen.kind === 'ok' ? ICON.check : ICON.cross}</div>`);
      const h = el('h2'); h.textContent = screen.title;
      const p = el('p'); p.textContent = screen.sub;
      r.append(h, p);
      body.replaceWith(r); ft.remove(); x.remove();
      r.setAttribute('role', 'status'); r.setAttribute('aria-live', 'assertive');
      setTimeout(() => { done = false; cleanup(); resolve(result); }, screen.kind === 'ok' ? 900 : 1600);
    }

    // C-46: mengosongkan kolom dari KODE (sesudah sampel ditolak / satu putaran selesai) tidak
    // menerbitkan event `input`, jadi timer kirim-otomatis yang sudah dijadwalkan tetap hidup
    // dan menembak ~200 ms kemudian pada kolom yang sudah kosong. Akibatnya pesan yang baru
    // saja menjelaskan KENAPA ketikan ditolak langsung tertimpa "Teks belum sama dengan
    // frasa." - pengguna melihat keluhan yang salah dan tidak tahu harus berbuat apa.
    const clearInput = () => {
      if (autoT) { clearTimeout(autoT); autoT = null; }
      inp.value = ''; rec.reset(); paint();
    };
    function submit() {
      if (done) return;
      if (norm(inp.value) !== norm(phrase)) { say(L.mismatchText, 'err'); inp.focus(); return; }
      const s = rec.sample();
      if (s.error) {
        clearInput();
        say(s.error === 'suggestion' ? L.suggestion : s.error === 'synthetic' ? L.synthetic : L.incomplete, 'err');
        inp.focus(); return;
      }
      clearInput();
      if (enrollMode) {
        samples.push(s); paintDots();
        if (samples.length < need) {
          say(`${L.again} ${L.enrollRound(samples.length + 1, need)}`, 'good'); inp.focus(); return;
        }
        const tmpl = buildTemplate(samples);
        if (!tmpl) {
          finish({ passed: false, enrolled: false, verified: false, reason: 'template-ditolak' },
                 { kind: 'bad', title: L.enrollFailed, sub: L.enrollFailedSub });
          return;
        }
        // PENDAFTARAN BUKAN BUKTI IDENTITAS: verified sengaja false.
        finish({ passed: true, enrolled: true, verified: false, template: tmpl },
               { kind: 'ok', title: L.enrolled, sub: L.enrolledSub });
        return;
      }
      const res = verify(s, template);
      if (res.ok) {
        finish({ passed: true, enrolled: false, verified: true, reasons: res.reasons || [] },
               { kind: 'ok', title: L.verified, sub: L.verifiedSub });
        return;
      }
      if (res.modeMismatch) {
        // keyboard lain dari saat pendaftaran: mencoba lagi tidak akan pernah cocok
        say(L.otherKeyboard, 'err');
        if (allowFallback) { fb.focus(); return; }
        finish({ passed: false, verified: false, modeMismatch: true, reasons: res.reasons || [] },
               { kind: 'bad', title: L.failed, sub: L.otherKeyboard });
        return;
      }
      failed++;
      if (failed >= MAX_ATTEMPTS) {
        finish({ passed: false, enrolled: false, verified: false, reasons: res.reasons || [], attemptsExhausted: true },
               { kind: 'bad', title: L.failed, sub: L.failedSub });
        return;
      }
      say(L.tryAgain(failed + 1, MAX_ATTEMPTS), 'err'); inp.focus();
    }

    const cancelNow = () => finish({ passed: false, enrolled: false, verified: false, cancelled: true });
    ok.addEventListener('click', submit);
    cancel.addEventListener('click', cancelNow);
    x.addEventListener('click', cancelNow);
    fb.addEventListener('click', () => finish({ passed: false, enrolled: false, verified: false, fallback: true }));

    // fokus terkunci + Esc + Enter; propagasi dihentikan supaya pintasan halaman diam
    const focusables = () => [...card.querySelectorAll('button,input')].filter(e => !e.disabled && e.isConnected);
    card.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); cancelNow(); return; }
      if (e.key === 'Enter' && e.target === inp) { e.preventDefault(); submit(); return; }
      if (e.key === 'Tab') {
        const f = focusables(); if (!f.length) return;
        const cur = root.activeElement || document.activeElement;
        const i = f.indexOf(cur);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === f.length - 1)) { e.preventDefault(); f[0].focus(); }
      }
    });
    for (const t of ['keydown', 'keyup', 'keypress', 'input', 'paste', 'beforeinput']) host.addEventListener(t, e => e.stopPropagation());
    function keepFocus(e) { if (!done && e.target !== host && !host.contains(e.target)) { try { inp.focus(); } catch {} } }
    document.addEventListener('focusin', keepFocus, true);

    if (timeoutMs > 0) {
      // C-18: popup yang diabaikan menutup sendiri - kalau tidak, Promise tak pernah
      // selesai dan seluruh lapisan step-up macet untuk sisa hidup halaman.
      // Batas waktu dihitung dari KETIDAKAKTIFAN, bukan sejak dialog dibuka: pendaftaran
      // 3 putaran plus membaca petunjuk bisa melewati 60 detik bagi orang yang mengetik
      // pelan, dan menutup dialog di tengah ketikan adalah hukuman untuk orang yang patuh.
      const arm = () => {
        if (killT) clearTimeout(killT);
        deadline = Date.now() + timeoutMs;
        killT = setTimeout(() => finish({ passed: false, enrolled: false, verified: false, cancelled: true, timedOut: true }), timeoutMs);
      };
      arm();
      inp.addEventListener('keydown', () => { if (!done) arm(); });
      inp.addEventListener('input', () => { if (!done) arm(); });
      tickT = setInterval(() => {
        const left = Math.ceil((deadline - Date.now()) / 1000);
        tl.textContent = left <= 30 && left > 0 ? L.timeLeft(left) : '';
      }, 1000);
    }

    (document.body || document.documentElement).appendChild(host);
    paint();
    if (enrollMode) say(L.enrollRound(1, need));
    setTimeout(() => { try { inp.focus({ preventScroll: true }); } catch { inp.focus(); } }, 30);
  });
}
