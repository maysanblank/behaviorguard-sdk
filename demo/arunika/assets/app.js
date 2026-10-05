/*
 * app.js - the Arunika application (demo site). Nothing here is BehaviorGuard: this is the
 * "existing site" before the library is installed. All data lives in this browser's
 * localStorage; no server, no real money.
 */
(function () {
  'use strict';
  const KEY_SESI = 'arunika:sesi';
  const keyAkun = email => 'arunika:akun:' + email.toLowerCase();

  // ---------------- formatting ----------------
  const fmtRp = new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 });
  const rupiah = n => fmtRp.format(Math.round(n)).replace(/ /g, ' ');
  const tanggal = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const jam = t => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const inisial = nama => nama.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || 'A';
  const angka = s => Number(String(s || '').replace(/[^\d]/g, '')) || 0;
  const salam = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

  // ---------------- icons (line, 24px) ----------------
  const I = {
    logo: '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5 22a11 11 0 0122 0" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M2 26h28" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M16 5v3M7.5 9.5l2 2M24.5 9.5l-2 2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    in: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg>',
    bill: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z"/><path d="M9 8h6M9 12h6"/></svg>',
    food: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 3v8M5 3v5a2 2 0 004 0V3M7 11v10M17 3c-2 0-3 2-3 5s1 4 3 4v9"/></svg>',
    bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1 13H6L5 8z"/><path d="M9 8V6a3 3 0 016 0v2"/></svg>',
    car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 16V11l2-5h10l2 5v5M5 16h14M5 16v2M19 16v2"/><circle cx="8" cy="13.5" r=".8"/><circle cx="16" cy="13.5" r=".8"/></svg>',
    phone: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M11 18h2"/></svg>',
    bolt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z"/></svg>',
    drop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z"/></svg>',
    wifi: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9a12 12 0 0116 0M7 12.5a7.5 7.5 0 0110 0M10 16a3 3 0 014 0"/><circle cx="12" cy="19" r=".8"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5.5c0 4.3-2.9 8.1-7 9.5-4.1-1.4-7-5.2-7-9.5V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>',
    alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4l9 16H3l9-16z"/><path d="M12 10v4M12 17h.01"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
    eyeoff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3l18 18M10.6 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.5 7 10 7a9.6 9.6 0 004.4-1.1"/><path d="M9.9 9.9a3 3 0 004.2 4.2"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 16l4-4-4-4M14 12H4"/></svg>',
    key: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3"/></svg>',
    keys: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/></svg>',
    device: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="11" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
    msg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h16v11H8l-4 4V5z"/></svg>',
  };
  const KAT = {
    'Food & drink': { ic: 'food', c: '#b4501a' }, 'Shopping': { ic: 'bag', c: '#2563eb' },
    'Bills': { ic: 'bill', c: '#7c3aed' }, 'Transport': { ic: 'car', c: '#0f766e' },
    'Transfer': { ic: 'send', c: '#475569' }, 'Income': { ic: 'in', c: '#15803d' },
  };

  // ---------------- sample data ----------------
  function contohTransaksi() {
    const now = Date.now(), D = 86400000;
    const list = [
      [0.2, 'Warung Makan Sederhana', 'Food & drink', -38000],
      [0.9, 'Ride-hailing to the office', 'Transport', -24500],
      [1.3, 'Transfer from Rina Wulandari', 'Income', 250000],
      [1.8, 'Apotek Sehat Selalu', 'Shopping', -67500],
      [2.4, 'Prepaid electricity token', 'Bills', -202500],
      [3.1, 'Toko Buku Pelita', 'Shopping', -129000],
      [4.2, 'Kedai Kopi Senja Pagi', 'Food & drink', -31000],
      [5.0, 'Transfer to Budi Santoso', 'Transfer', -500000],
      [6.3, 'Phone credit & data 50,000', 'Bills', -51500],
      [7.1, 'Laundry Bersih Kilat', 'Shopping', -45000],
      [8.6, 'Monthly groceries, Pasar Segar', 'Shopping', -412300],
      [9.4, 'September salary - PT Kencana Abadi', 'Income', 8750000],
      [10.2, 'Water bill', 'Bills', -96000],
      [12.5, 'Bakso Pak Kumis', 'Food & drink', -28000],
      [13.9, 'Transfer to Mum', 'Transfer', -1500000],
      [15.2, 'Parking & tolls', 'Transport', -36000],
      [17.8, 'Home internet subscription', 'Bills', -335000],
      [19.4, 'Martabak Bangka 88', 'Food & drink', -55000],
      [22.0, 'Train ticket Jakarta-Bandung', 'Transport', -150000],
      [24.6, 'Transfer from Dimas Pratama', 'Income', 120000],
      [27.3, 'Running shoes', 'Shopping', -489000],
      [30.1, 'Sate Madura Cak Mat', 'Food & drink', -42000],
    ];
    return list.map(([hari, ket, kat, jml], i) => ({ id: 'TX' + (900100 + i), t: now - hari * D, ket, kat, jml }));
  }
  function akunBaru(email, namaDiisi) {
    const nm = email.split('@')[0].replace(/[._-]+/g, ' ').replace(/\d+/g, '').trim() || 'Customer';
    const nama = namaDiisi && namaDiisi.trim()
      ? namaDiisi.trim().replace(/\s+/g, ' ')
      : nm.split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1) : w).join(' ');
    let h = 0; for (const c of email) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    const rek = String(1000000000 + (h % 8999999999)).slice(0, 10);
    return {
      email: email.toLowerCase(), nama, rekening: rek, hp: '+62 812-' + String(1000 + h % 9000) + '-' + String(1000 + (h >>> 7) % 9000),
      saldo: 12847300, dibuat: Date.now(), tx: contohTransaksi(),
      penerima: [
        { nama: 'Budi Santoso', bank: 'Arunika', rek: '2203419876' },
        { nama: 'Rina Wulandari', bank: 'Other bank', rek: '0081223344' },
        { nama: 'Mum', bank: 'Arunika', rek: '1900345671' },
      ],
    };
  }

  // ---------------- storage ----------------
  const baca = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const tulis = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const sesi = () => baca(KEY_SESI, null);
  function akun() { const s = sesi(); return s ? baca(keyAkun(s.email), null) : null; }
  function simpanAkun(a) { tulis(keyAkun(a.email), a); }
  // Sign-up and log-in are SEPARATE, as on a real site. `masuk()` used to create an account
  // for any email silently, so the demo never had the "new account, empty behavior profile"
  // moment - which is exactly what it is meant to show.
  const adaAkun = email => !!baca(keyAkun(String(email || '').trim().toLowerCase()), null);
  function daftar({ email, nama }) {
    email = String(email || '').trim().toLowerCase();
    if (adaAkun(email)) return { ok: false, alasan: 'terdaftar' };
    const a = akunBaru(email, nama);
    a.tx = [];                       // NEW account: empty history, opening deposit only
    a.saldo = SALDO_DEMO;
    a.tx.unshift({ id: 'TX000001', t: Date.now(), ket: 'Opening deposit', kat: 'Income', jml: SALDO_DEMO });
    a.penerima = [];
    a.baruDaftar = true;
    simpanAkun(a);
    tulis(KEY_SESI, { email, masukPada: Date.now(), baru: true });
    return { ok: true, akun: a };
  }
  function masuk(email) {
    email = String(email || '').trim().toLowerCase();
    const a = baca(keyAkun(email), null);
    if (!a) return { ok: false, alasan: 'tidak-terdaftar' };
    tulis(KEY_SESI, { email, masukPada: Date.now() });
    return { ok: true, akun: a };
  }
  // Sample account for presentations: history is pre-filled so the pages are not empty
  // when showing transfer/history. Its BEHAVIOR profile still starts from zero.
  function akunContoh(email, nama) {
    const a = akunBaru(email, nama);
    a.tx = contohTransaksi(); a.saldo = 12847300;
    a.penerima = [
      { nama: 'Budi Santoso', bank: 'Arunika', rek: '2203419876' },
      { nama: 'Rina Wulandari', bank: 'Other bank', rek: '0081223344' },
      { nama: 'Mum', bank: 'Arunika', rek: '1900345671' },
    ];
    simpanAkun(a);
    tulis(KEY_SESI, { email: a.email, masukPada: Date.now() });
    return a;
  }
  async function keluar(alasan) {
    try { if (window.BehaviorGuard) await window.BehaviorGuard.stop(); } catch {}
    try { localStorage.removeItem(KEY_SESI); sessionStorage.clear(); } catch {}
    location.href = 'index.html' + (alasan ? '?keluar=' + encodeURIComponent(alasan) : '');
  }
  function catatTx(a, tx) { a.tx.unshift(tx); a.saldo += tx.jml; simpanAkun(a); }
  // Demo site: a balance drained by practice transfers refills itself, so the demo (and the
  // impostor test) never stops at "insufficient balance". The behavior profile is untouched.
  const SALDO_DEMO = 25000000, SALDO_BATAS = 1000000;
  function isiUlangDemo(a) {
    if (!a || a.saldo >= SALDO_BATAS) return a;
    catatTx(a, { id: 'TOPUP' + Date.now().toString().slice(-8), t: Date.now(), ket: 'Demo balance top-up', kat: 'Income', jml: SALDO_DEMO - a.saldo });
    return a;
  }

  // ---------------- page shell ----------------
  const NAV = [['home.html', 'Home'], ['transfer.html', 'Transfer'], ['pay.html', 'Pay'], ['history.html', 'History'], ['security.html', 'Security']];
  function shell(aktif) {
    const s = sesi();
    if (!s) { location.replace('index.html'); return null; }
    const a = isiUlangDemo(akun());
    if (!a) { localStorage.removeItem(KEY_SESI); location.replace('index.html'); return null; }
    const top = document.getElementById('top');
    top.className = 'top';
    top.innerHTML = `<div class="top-in">
      <a class="logo" href="home.html">${I.logo}<span>arunika</span></a>
      <nav class="nav" aria-label="Main menu">${NAV.map(([h, t]) => `<a href="${h}"${h === aktif ? ' aria-current="page"' : ''}>${t}</a>`).join('')}</nav>
      <div class="user"><div class="avatar" aria-hidden="true">${esc(inisial(a.nama))}</div>
        <div><div class="nm">${esc(a.nama)}</div><div class="em">${esc(a.email)}</div></div>
        <button class="btn btn-ghost btn-sm" id="btn-keluar" title="Log out">${I.out}<span class="sr">Log out</span></button></div></div>`;
    document.getElementById('btn-keluar').addEventListener('click', () => keluar());
    const f = document.getElementById('foot');
    if (f) { f.className = 'foot'; f.innerHTML = '<span>Arunika is a demo site for BehaviorGuard. Not a real financial service; no money moves.</span>'; }
    return a;
  }

  // ---------------- site toasts & dialogs ----------------
  function toast(html, { kind = '', ms = 4200, label = '' } = {}) {
    let box = document.querySelector('.toasts');
    if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.innerHTML = `<div>${label ? `<div class="k">${esc(label)}</div>` : ''}<div>${html}</div></div>`;
    box.appendChild(t);
    if (ms) setTimeout(() => t.remove(), ms);
    return t;
  }
  function dialog(html) {
    const bd = document.createElement('div');
    bd.className = 'dlg-bd';
    bd.innerHTML = `<div class="dlg" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(bd);
    return { el: bd.firstElementChild, close: () => bd.remove() };
  }
  function konfirmasi({ judul, isi, ya = 'Yes', tidak = 'Cancel', bahaya = false }) {
    return new Promise(res => {
      const d = dialog(`<h2>${esc(judul)}</h2><p class="sub">${esc(isi)}</p><div class="acts"><button class="btn" data-x>${esc(tidak)}</button><button class="btn ${bahaya ? 'btn-danger' : 'btn-pri'}" data-y>${esc(ya)}</button></div>`);
      d.el.querySelector('[data-x]').onclick = () => { d.close(); res(false); };
      d.el.querySelector('[data-y]').onclick = () => { d.close(); res(true); };
      d.el.querySelector('[data-y]').focus();
    });
  }

  // amount input: shows "1.250.000" while typing
  function nominalInput(el) {
    el.addEventListener('input', () => {
      const n = angka(el.value);
      el.value = n ? n.toLocaleString('id-ID') : '';
    });
  }

  // Wipe EVERY trace of the demo in this browser (accounts, session, log, the library's
  // behavior profile), so the demo restarts at sign-up without an incognito window.
  async function resetDemo() {
    try { if (window.BehaviorGuard) { await window.BehaviorGuard.forget(); await window.BehaviorGuard.stop(); } } catch {}
    try {
      const buang = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (k.startsWith('arunika:') || k.startsWith('bg:'))) buang.push(k);
      }
      buang.forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
      if (window.indexedDB && indexedDB.deleteDatabase) indexedDB.deleteDatabase('bg_store');
    } catch {}
  }

  window.Arunika = { I, KAT, rupiah, tanggal, jam, esc, angka, salam, inisial, sesi, akun, simpanAkun,
    daftar, masuk, adaAkun, akunContoh, keluar, resetDemo, catatTx, shell, toast, dialog, konfirmasi, nominalInput, baca, tulis };
})();
