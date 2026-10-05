/**
 * enroll_ui.js - kartu "Mengenali perangkat ini" BAWAAN (opsional).
 *
 * Dulu kartu kemajuan pendaftaran hanya ada di demo Arunika (mulai.html), ditulis tangan
 * oleh situsnya. Integrator lain tidak punya apa-apa selain angka mentah status(), jadi
 * penggunanya tidak pernah tahu KENAPA situs "belum mengenalinya" atau sampai kapan.
 * Sekarang pustaka membawanya sendiri, dalam dua bentuk:
 *   BehaviorGuard.mountEnrollment(el | '#selektor', opsi)  -> kartu di dalam halaman
 *   BehaviorGuard.openEnrollment(opsi)                     -> kartu yang sama sebagai dialog
 *
 * Isinya dua tahap, bukan satu. `enrollment` berhenti di 10 potong bukti, padahal detektor
 * utama (Mahalanobis, bobot 0,70) baru bangun di 20 (C-46). Kartu yang berkata "selesai"
 * di 10 berbohong tentang kekuatan perlindungannya - dan situs yang percaya itu meloloskan
 * transfer yang dinilai mesin setengah jadi (uji penyusup 14 Sep 2026).
 *
 * Aturan yang sama dengan mfa.js: Shadow DOM (CSS situs tidak merembes), adoptedStyleSheets
 * (aman di CSP style-src ketat), teks integrator lewat textContent. Host SENGAJA tidak
 * diberi [data-bg-mfa]: ketikan di kotak latihan memang harus ikut terhitung sebagai bukti.
 */
import { pickLang } from './mfa.js';

const TEXT = {
  id: {
    title: 'Mengenali perangkat ini',
    sub: b => `${b || 'Situs ini'} perlu beberapa potong pemakaian normal sebelum bisa membedakan kamu dari orang lain.`,
    off: 'Perlindungan belum menyala di halaman ini.',
    none: 'Belum ada bukti yang terkumpul',
    some: (k, n) => `Sudah ${k} dari ${n} potong bukti`,
    base: 'Profil dasar sudah terbentuk',
    full: 'Perlindungan penuh aktif',
    hint: s => `Pakai saja situsnya seperti biasa - mengetik, menggulir, berpindah halaman. Setiap ±${s} detik pemakaian jadi satu potong bukti.`,
    hintBase: (p, n) => `Profilmu sudah bisa dipakai, tapi pemeriksa utamanya baru menyala di ${n} potong bukti (sekarang ${p}). Sampai itu, aksi bernilai sebaiknya tetap diverifikasi.`,
    hintFull: 'Aktivitas di perangkat ini dinilai terhadap kebiasaanmu. Profilnya terus menyesuaikan diri selama kamu memakai akunmu.',
    pieces: 'Potong bukti',
    collecting: 'Sedang dikumpulkan',
    events: 'kejadian',
    stage1: 'Tahap 1 · Profil dasar',
    stage2: 'Tahap 2 · Pemeriksa utama',
    tiles: [
      ['keys', 'Irama ketik', 'Berapa lama tiap tombol ditekan dan jeda antar-tombol. Isi ketikanmu tidak pernah disimpan.'],
      ['cursor', 'Gerak kursor', 'Kecepatan, kelengkungan lintasan, dan jeda sebelum mengeklik.'],
      ['flow', 'Alur pemakaian', 'Halaman yang dibuka, seberapa dalam menggulir, urutan mengisi kolom.'],
    ],
    privLocal: 'Semua perhitungan terjadi di browser ini. Tidak ada rekaman layar, tidak ada isi ketikan, dan tidak ada yang dikirim ke server.',
    privServer: 'Halaman ini hanya mengirim 34 angka ringkasan per 30 detik ke server situs, yang menyimpan profil akunmu dan memutuskan. Tidak ada rekaman layar dan tidak ada isi ketikan yang keluar dari halaman.',
    hintFullServer: 'Aktivitas di akun ini dinilai terhadap kebiasaanmu, dari perangkat mana pun. Profilnya terus menyesuaikan diri selama kamu memakai akunmu.',
    practiceT: 'Cara tercepat: ketik sesuatu',
    practiceS: 'Mengetik memberi bukti paling banyak per detik. Salin kalimat di bawah dengan kecepatan biasamu.',
    practiceDone: 'Sudah cukup. Kamu boleh berhenti mengetik.',
    typed: 'Huruf diketik', speed: 'Kecepatan', wpm: 'kpm', change: 'ganti kalimat',
    inputLabel: 'Salin kalimat di atas', placeholder: 'Ketik di sini...',
    sentences: [
      'Saya menabung sedikit demi sedikit supaya bisa membeli sepeda baru tahun depan.',
      'Kopi pagi ini terasa lebih pahit dari biasanya, tapi hujannya enak sekali dilihat.',
      'Tolong ingatkan saya membayar tagihan listrik sebelum tanggal dua puluh bulan ini.',
      'Perjalanan ke Bandung memakan waktu tiga jam kalau berangkat sebelum matahari terbit.',
    ],
    mfaT: 'Verifikasi kalau ada yang janggal',
    mfaOn: 'Irama ketik sudah diatur',
    mfaOnSub: 'Kalau ada aktivitas janggal, kamu cukup mengetik ulang satu frasa pendek - tidak perlu menunggu kode.',
    mfaIntro: 'Kalau ada yang tidak biasa, kamu akan diminta membuktikan diri dengan mengetik satu frasa pendek. Yang dicocokkan iramanya, bukan hurufnya.',
    mfaBtn: 'Atur verifikasi irama ketik',
    mfaReady: 'Kamu akan diminta mengetik frasa itu 3 kali.',
    mfaWait: 'Tersedia setelah penilaian terakhir kembali wajar.',
    mfaErr: r => `Belum berhasil: ${r}`,
    close: 'Tutup',
  },
  en: {
    title: 'Getting to know this device',
    sub: b => `${b || 'This site'} needs a few pieces of normal use before it can tell you apart from someone else.`,
    off: 'Protection is not running on this page yet.',
    none: 'No evidence collected yet',
    some: (k, n) => `${k} of ${n} pieces of evidence`,
    base: 'Basic profile is ready',
    full: 'Full protection is on',
    hint: s => `Just use the site as usual - type, scroll, move between pages. Every ~${s} seconds of use becomes one piece of evidence.`,
    hintBase: (p, n) => `Your profile is usable, but the main checker only switches on at ${n} pieces (now ${p}). Until then, valuable actions should still be verified.`,
    hintFull: 'Activity on this device is compared against your habits. The profile keeps adapting as you use your account.',
    pieces: 'Pieces', collecting: 'Collecting', events: 'events',
    stage1: 'Stage 1 · Basic profile',
    stage2: 'Stage 2 · Main checker',
    tiles: [
      ['keys', 'Typing rhythm', 'How long each key is held and the gaps between keys. What you type is never stored.'],
      ['cursor', 'Cursor movement', 'Speed, path curvature, and the pause before clicking.'],
      ['flow', 'Usage flow', 'Pages opened, scroll depth, the order you fill in fields.'],
    ],
    privLocal: 'Everything is computed in this browser. No screen recording, no typed text, and nothing is sent to a server.',
    privServer: 'This page only sends 34 summary numbers per 30 seconds to the site’s server, which keeps your account’s profile and decides. No screen recording and no typed text leave the page.',
    hintFullServer: 'Activity on this account is compared against your habits, from any device. The profile keeps adapting as you use your account.',
    practiceT: 'Fastest way: type something',
    practiceS: 'Typing gives the most evidence per second. Copy the sentence below at your normal speed.',
    practiceDone: 'That’s enough. You can stop typing.',
    typed: 'Characters', speed: 'Speed', wpm: 'wpm', change: 'another sentence',
    inputLabel: 'Copy the sentence above', placeholder: 'Type here...',
    sentences: [
      'I save a little at a time so I can buy a new bicycle next year.',
      'The morning coffee tasted more bitter than usual, but the rain was lovely to watch.',
      'Please remind me to pay the electricity bill before the twentieth of this month.',
      'The drive to the coast takes three hours if you leave before sunrise.',
    ],
    mfaT: 'Verification when something looks off',
    mfaOn: 'Typing rhythm is set up',
    mfaOnSub: 'If something looks off, you just retype one short phrase - no waiting for a code.',
    mfaIntro: 'If something looks unusual, you will be asked to prove it is you by typing one short phrase. The rhythm is matched, not the letters.',
    mfaBtn: 'Set up typing-rhythm verification',
    mfaReady: 'You will type the phrase 3 times.',
    mfaWait: 'Available once the latest assessment looks normal again.',
    mfaErr: r => `Not yet: ${r}`,
    close: 'Close',
  },
};

const ICON = {
  keys: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>',
  cursor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3l6 17 2.5-7L21 10.5z"/></svg>',
  flow: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.3-2.9 8.1-7 9.5-4.1-1.4-7-5.2-7-9.5V6l7-3z"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};

const CSS = `
:host{all:initial;display:block}
*{box-sizing:border-box}
.w{font:14px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;color:var(--fg);-webkit-font-smoothing:antialiased;
  text-align:left;letter-spacing:normal;text-transform:none;white-space:normal;direction:ltr;
  --bg:#ffffff;--fg:#141a24;--mut:#5b6573;--line:#e3e6eb;--soft:#f4f6f8;--ok:#1a7f4b;--warn:#b35c00;--bad:#c4312b;--accent:#1f5fd6;--on-accent:#fff}
@media (prefers-color-scheme:dark){.w.auto{--bg:#171b22;--fg:#e8ebf0;--mut:#9aa3af;--line:#2c323c;--soft:#1f242d;--ok:#4cc38a;--warn:#e3a14a;--bad:#ff7b72}}
.w.dark{--bg:#171b22;--fg:#e8ebf0;--mut:#9aa3af;--line:#2c323c;--soft:#1f242d;--ok:#4cc38a;--warn:#e3a14a;--bad:#ff7b72}
.bd{position:fixed;top:0;right:0;bottom:0;left:0;display:flex;align-items:flex-start;justify-content:center;padding:24px 16px;overflow:auto;background:rgba(12,16,24,.52)}
.card{position:relative;width:100%;background:var(--bg);border:1px solid var(--line);border-radius:14px;box-shadow:0 1px 2px rgba(0,0,0,.04)}
.bd .card{max-width:640px;margin:auto 0;box-shadow:0 24px 64px rgba(0,0,0,.28)}
.sec{padding:18px 20px}
.sec+.sec{border-top:1px solid var(--line)}
h2{margin:0;font-size:16px;font-weight:650;line-height:1.3;padding-right:34px}
h3{margin:0;font-size:14px;font-weight:650}
.sub{margin:3px 0 0;color:var(--mut);font-size:13.5px}
.x{position:absolute;top:12px;right:12px;width:30px;height:30px;border-radius:8px;border:0;background:transparent;color:var(--mut);cursor:pointer;display:grid;place-items:center}
.x:hover{background:var(--soft);color:var(--fg)}
.ring{display:flex;gap:18px;align-items:center;margin-top:14px}
.dial{position:relative;flex:none;width:96px;height:96px}
.dial svg{width:96px;height:96px;transform:rotate(-90deg)}
.dial circle{fill:none;stroke-width:9;stroke-linecap:round}
.dial .bgc{stroke:var(--line)}
.dial .fg{stroke:var(--accent);transition:stroke-dasharray .5s ease}
.dial.done .fg{stroke:var(--ok)}
.dial b{position:absolute;top:0;right:0;bottom:0;left:0;display:grid;place-items:center;font-size:19px;font-weight:700;font-variant-numeric:tabular-nums}
.txt{min-width:0;flex:1}
.st{font-weight:650;font-size:15px}
.sd{color:var(--mut);font-size:13.5px;margin-top:3px}
.bar{height:6px;border-radius:9px;background:var(--line);margin-top:10px;overflow:hidden}
.bar i{display:block;height:100%;width:0;background:var(--accent);transition:width .4s}
.meter{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:12.5px;color:var(--mut);margin-top:8px}
.meter b{color:var(--fg);font-variant-numeric:tabular-nums;font-weight:650}
.stages{display:grid;gap:8px;margin-top:16px}
.stg{display:grid;grid-template-columns:18px minmax(0,1fr) auto;gap:10px;align-items:center;font-size:13px}
.stg .dot{width:18px;height:18px;border-radius:50%;border:2px solid var(--line);display:grid;place-items:center;color:var(--on-accent)}
.stg .dot svg{width:11px;height:11px}
.stg.on .dot{border-color:var(--accent)}
.stg.done .dot{background:var(--ok);border-color:var(--ok)}
.stg .n{color:var(--mut);font-variant-numeric:tabular-nums;font-size:12.5px}
.tiles{display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-top:16px}
.tile{background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:11px 12px}
.tile .t{display:flex;gap:7px;align-items:center;font-weight:650;font-size:13px}
.tile .t svg{width:15px;height:15px;color:var(--accent);flex:none}
.tile .d{font-size:12.5px;color:var(--mut);margin-top:4px}
.priv{font-size:12.5px;color:var(--mut);margin:12px 0 0}
.sample{background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:11px 13px;font-size:14.5px;line-height:1.6;margin-top:12px;user-select:none;-webkit-user-select:none}
textarea{display:block;width:100%;min-height:96px;margin-top:10px;resize:vertical;font:inherit;font-size:14.5px;line-height:1.6;color:var(--fg);background:var(--bg);border:1.5px solid var(--line);border-radius:10px;padding:10px 12px;outline:none}
textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(31,95,214,.2);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 22%,transparent)}
.ok{display:flex;gap:10px;align-items:flex-start;background:var(--soft);border:1px solid var(--line);border-radius:10px;padding:11px 13px;margin-top:12px;font-size:13.5px}
.ok svg{width:18px;height:18px;color:var(--ok);flex:none;margin-top:1px}
.ok b{display:block;font-weight:650}
.ok span{color:var(--mut)}
p.m{margin:10px 0 0;font-size:13.5px;color:var(--mut)}
button{font:inherit}
button.pri{margin-top:12px;font-size:14px;font-weight:600;border-radius:9px;padding:8px 15px;cursor:pointer;border:1px solid var(--accent);background:var(--accent);color:var(--on-accent)}
button.pri:disabled{opacity:.5;cursor:not-allowed}
button.lnk{border:0;background:none;padding:0;color:var(--accent);font-weight:600;cursor:pointer;font-size:12.5px}
button:focus-visible,textarea:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:460px){.sec{padding:16px}.ring{gap:14px}.dial,.dial svg{width:80px;height:80px}}
`;

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
  if (html != null) e.innerHTML = html;      // hanya ikon SVG konstan di atas
  return e;
}
const txt = (tag, cls, s) => { const e = el(tag, cls); e.textContent = s; return e; };

const KEL = 2 * Math.PI * 42;

/**
 * api = { status(), enrollMfa(), subscribe(fn) -> berhenti }  (disuntik oleh behaviorguard.js)
 * opsi: lang, texts, theme ('auto'|'light'|'dark'), accent, brand,
 *       practice (kotak latihan mengetik, default true), mfaSetup (kartu irama ketik, default true),
 *       onComplete(status) - dipanggil sekali saat pemeriksa utama menyala
 */
function build(api, root, o, onClose) {
  const L = { ...TEXT[pickLang(o.lang)], ...(o.texts || {}) };
  const w = el('div', 'w ' + (o.theme === 'light' || o.theme === 'dark' ? o.theme : 'auto'));
  if (o.accent) w.style.setProperty('--accent', o.accent);
  const card = el('div', 'card');

  // ---- kemajuan ----
  const s1 = el('div', 'sec');
  const h = txt('h2', null, L.title); h.id = 'bg-en-t';
  s1.append(h, txt('p', 'sub', L.sub(o.brand)));
  const ring = el('div', 'ring');
  const dial = el('div', 'dial', `<svg viewBox="0 0 96 96" aria-hidden="true"><circle class="bgc" cx="48" cy="48" r="42"></circle><circle class="fg" cx="48" cy="48" r="42" stroke-dasharray="0 ${KEL.toFixed(1)}"></circle></svg>`);
  const arc = dial.querySelector('.fg');
  const pct = el('b'); dial.appendChild(pct);
  const tx = el('div', 'txt');
  const st = el('div', 'st'); st.setAttribute('role', 'status'); st.setAttribute('aria-live', 'polite');
  const sd = el('div', 'sd');
  const bar = el('div', 'bar'); bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuemin', '0');
  const fill = el('i'); bar.appendChild(fill);
  const meter = el('div', 'meter');
  const mWin = el('b'), mEv = el('b');
  const m1 = el('span'); m1.append(document.createTextNode(L.pieces + ' '), mWin);
  const m2 = el('span'); m2.append(document.createTextNode(L.collecting + ' '), mEv, document.createTextNode(' ' + L.events));
  meter.append(m1, m2);
  tx.append(st, sd, bar, meter);
  ring.append(dial, tx);

  const stages = el('div', 'stages');
  const stage = label => {
    const r = el('div', 'stg'); const dot = el('span', 'dot'); const n = el('span', 'n');
    r.append(dot, txt('span', null, label), n); stages.appendChild(r);
    return { r, dot, n };
  };
  const g1 = stage(L.stage1), g2 = stage(L.stage2);

  const tiles = el('div', 'tiles');
  for (const [ic, t, d] of L.tiles) {
    const tl = el('div', 'tile'); const tt = el('div', 't', ICON[ic] || ''); tt.appendChild(document.createTextNode(t));
    tl.append(tt, txt('div', 'd', d)); tiles.appendChild(tl);
  }
  const priv = el('p', 'priv');
  s1.append(ring, stages, tiles, priv);
  card.appendChild(s1);

  // ---- latihan mengetik ----
  let pSub = null, sample = null, ta = null, mChar = null, mWpm = null, ki = 0, t0 = 0;
  if (o.practice !== false) {
    const s2 = el('div', 'sec');
    pSub = txt('p', 'sub', L.practiceS);
    sample = el('div', 'sample');
    const sentences = (o.sentences && o.sentences.length) ? o.sentences : L.sentences;
    ki = Math.floor(Math.random() * sentences.length);
    const setSample = () => { sample.textContent = sentences[ki % sentences.length]; };
    setSample();
    ta = document.createElement('textarea');
    for (const [k, v] of Object.entries({ spellcheck: 'false', autocomplete: 'off', autocapitalize: 'none', autocorrect: 'off', 'aria-label': L.inputLabel, 'data-lpignore': 'true', 'data-1p-ignore': '' })) ta.setAttribute(k, v);
    ta.placeholder = L.placeholder;
    const pm = el('div', 'meter');
    mChar = el('b'); mChar.textContent = '0'; mWpm = el('b'); mWpm.textContent = '-';
    const c1 = el('span'); c1.append(document.createTextNode(L.typed + ' '), mChar);
    const c2 = el('span'); c2.append(document.createTextNode(L.speed + ' '), mWpm);
    const swap = txt('button', 'lnk', L.change); swap.type = 'button';
    pm.append(c1, c2, swap);
    const count = () => {
      const n = ta.value.length;
      mChar.textContent = String(n);
      if (!n) { t0 = 0; mWpm.textContent = '-'; return; }
      if (!t0) t0 = Date.now();
      const min = (Date.now() - t0) / 60000;
      mWpm.textContent = min > 0.08 ? Math.round((n / 5) / min) + ' ' + L.wpm : '-';
    };
    ta.addEventListener('input', () => {
      count();
      // kalimat selesai -> ganti otomatis, supaya orang terus mengetik tanpa berpikir
      if (ta.value.trim().length >= sentences[ki % sentences.length].length) { ki++; setSample(); ta.value = ''; t0 = 0; count(); }
    });
    swap.onclick = () => { ki++; setSample(); ta.value = ''; count(); ta.focus(); };
    s2.append(txt('h3', null, L.practiceT), pSub, sample, ta, pm);
    card.appendChild(s2);
  }

  // ---- verifikasi irama ----
  let s3 = null;
  if (o.mfaSetup !== false) { s3 = el('div', 'sec'); card.appendChild(s3); }
  let mfaSig = '', mfaBusy = false, mfaMsg = '';
  function drawMfa(s) {
    if (!s3) return;
    const on = !!(s && s.mfa && s.mfa.enabled);
    const sig = !s ? 'off' : `${on}|${s.mfa.enrolled}|${s.mfa.canEnroll}|${mfaBusy}|${mfaMsg}`;
    if (sig === mfaSig) return;           // bangun ulang HANYA saat keadaan berubah (fokus tombol tidak hilang)
    mfaSig = sig;
    s3.hidden = !on;
    s3.textContent = '';
    if (!on) return;
    s3.appendChild(txt('h3', null, L.mfaT));
    if (s.mfa.enrolled) {
      const b = el('div', 'ok', ICON.check); const d = el('div');
      d.append(txt('b', null, L.mfaOn), txt('span', null, L.mfaOnSub)); b.appendChild(d); s3.appendChild(b);
      return;
    }
    s3.appendChild(txt('p', 'm', L.mfaIntro));
    const btn = txt('button', 'pri', L.mfaBtn); btn.type = 'button';
    btn.disabled = mfaBusy || !s.mfa.canEnroll;
    btn.onclick = async () => {
      mfaBusy = true; mfaMsg = ''; render();
      let r = null;
      try { r = await api.enrollMfa(); } catch (e) { r = { enrolled: false, reason: String(e && e.message || e) }; }
      mfaBusy = false;
      if (r && !r.enrolled && r.reason && !/dibatalkan|waktu|cancel|time/i.test(r.reason)) mfaMsg = L.mfaErr(r.reason);
      render();
    };
    s3.append(btn, txt('p', 'm', mfaMsg || (s.mfa.canEnroll ? L.mfaReady : L.mfaWait)));
  }

  if (onClose) {
    const x = el('button', 'x', ICON.x); x.type = 'button'; x.setAttribute('aria-label', L.close);
    x.onclick = onClose; card.appendChild(x);
  }
  w.appendChild(card);
  root.appendChild(w);

  let completed = false;
  function render() {
    let s = null;
    try { s = api.status(); } catch {}
    if (!s || !s.ready) {
      st.textContent = L.off; sd.textContent = ''; stages.hidden = true; meter.hidden = true; bar.hidden = true;
      pct.textContent = '-'; priv.textContent = L.privLocal; drawMfa(null);
      return;
    }
    stages.hidden = false; meter.hidden = false; bar.hidden = false;
    const done = s.enrollment.done, need = s.enrollment.need;
    const pool = (s.model && s.model.pool) || 0, poolNeed = (s.model && s.model.mainDetectorNeeds) || need;
    const base = done >= need, full = !!(s.model && s.model.mainDetector);
    // satu lingkaran untuk seluruh jalan sampai pemeriksa utama; angka "potong bukti" tetap
    // milik tahap yang sedang berjalan supaya cocok dengan penghitung situs lain
    const p = full ? 1 : base ? Math.min(1, Math.max(done, pool) / poolNeed) : Math.min(1, done / poolNeed);
    arc.setAttribute('stroke-dasharray', `${(p * KEL).toFixed(1)} ${KEL.toFixed(1)}`);
    dial.classList.toggle('done', full);
    pct.textContent = Math.round(p * 100) + '%';
    fill.style.width = (p * 100).toFixed(1) + '%';
    bar.setAttribute('aria-valuemax', String(poolNeed)); bar.setAttribute('aria-valuenow', String(base ? Math.max(done, pool) : done));
    st.textContent = full ? L.full : base ? L.base : done ? L.some(done, need) : L.none;
    sd.textContent = full ? (s.mode === 'backend' ? L.hintFullServer : L.hintFull) : base ? L.hintBase(pool, poolNeed) : L.hint((s.evidence && s.evidence.windowSec) || 30);
    mWin.textContent = base ? `${Math.min(pool, poolNeed)} / ${poolNeed}` : `${done} / ${need}`;
    mEv.textContent = `${s.evidence.buffered} / ${s.evidence.need}`;
    m2.hidden = full;

    g1.r.className = 'stg ' + (base ? 'done' : 'on'); g1.dot.innerHTML = base ? ICON.check : ''; g1.n.textContent = `${done}/${need}`;
    g2.r.className = 'stg ' + (full ? 'done' : base ? 'on' : ''); g2.dot.innerHTML = full ? ICON.check : ''; g2.n.textContent = `${Math.min(pool, poolNeed)}/${poolNeed}`;

    priv.textContent = s.mode === 'backend' ? L.privServer : L.privLocal;
    if (pSub) pSub.textContent = full ? L.practiceDone : L.practiceS;
    drawMfa(s);
    if (full && !completed) {
      completed = true;
      if (typeof o.onComplete === 'function') { try { o.onComplete(s); } catch (e) { try { console.error(e); } catch {} } }
    }
  }

  render();
  const iv = setInterval(render, 1000);   // penghitung kejadian bergerak tiap detik, bukan tiap vonis
  const unsub = api.subscribe ? api.subscribe(() => setTimeout(render, 0)) : () => {};
  return { card, focusTarget: ta, render, stop() { clearInterval(iv); try { unsub(); } catch {} } };
}

export function mountEnrollment(api, target, o = {}) {
  if (typeof document === 'undefined') return { el: null, refresh() {}, destroy() {} };
  const parent = typeof target === 'string' ? document.querySelector(target) : target;
  if (!parent || typeof parent.appendChild !== 'function') throw new Error('BehaviorGuard.mountEnrollment: elemen tujuan tidak ditemukan');
  const host = document.createElement('bg-guard-enroll');
  host.style.cssText = 'display:block !important';
  const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
  applyStyles(root);
  const v = build(api, root, o || {}, null);
  parent.appendChild(host);
  return { el: host, refresh: v.render, destroy() { v.stop(); host.remove(); } };
}

export function openEnrollment(api, o = {}) {
  if (typeof document === 'undefined' || !document.documentElement) return Promise.resolve({ closed: true, reason: 'no-dom' });
  const existing = document.querySelector('bg-guard-enroll[data-modal]');
  if (existing) { try { existing.remove(); } catch {} }
  return new Promise(resolve => {
    const prevFocus = document.activeElement;
    const host = document.createElement('bg-guard-enroll');
    host.setAttribute('data-modal', '');
    host.style.cssText = ['position:fixed', 'top:0', 'right:0', 'bottom:0', 'left:0', 'z-index:2147483646', 'display:block',
      'margin:0', 'padding:0', 'border:0', 'background:transparent', 'opacity:1', 'visibility:visible', 'transform:none']
      .map(d => d + ' !important').join(';');
    const root = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;
    applyStyles(root);
    let v = null;
    const close = () => {
      if (!v) return;
      v.stop(); v = null;
      document.removeEventListener('keydown', onKey, true);
      host.remove();
      try { if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true }); } catch {}
      resolve({ closed: true });
    };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    v = build(api, root, o || {}, close);
    const w = root.querySelector('.w');
    const bd = el('div', 'bd');
    bd.appendChild(v.card);
    w.appendChild(bd);
    v.card.setAttribute('role', 'dialog');
    v.card.setAttribute('aria-modal', 'true');
    v.card.setAttribute('aria-labelledby', 'bg-en-t');
    v.card.tabIndex = -1;
    bd.addEventListener('mousedown', e => { if (e.target === bd) close(); });
    document.addEventListener('keydown', onKey, true);
    (document.body || document.documentElement).appendChild(host);
    try { (v.focusTarget || v.card).focus({ preventScroll: true }); } catch {}
  });
}
