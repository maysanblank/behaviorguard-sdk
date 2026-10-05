/*
 * app.js - the Arunika application (demo site). Nothing here is BehaviorGuard: this is the
 * "existing site" before the library is installed. Accounts, balances and history live on
 * Arunika's server (server.py); no real money.
 */
(function () {
  'use strict';

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

  const baca = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
  const tulis = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  // ---------------- the account, from Arunika's server ----------------
  // The server puts the logged-in account into the page (window.ARUNIKA_ME) and is the only
  // place that changes it: balance, history, recipients and password all live there, so the
  // same account opens from any browser or laptop.
  const ME = window.ARUNIKA_ME || { session: null };
  const sesi = () => ME.session;
  const akun = () => ME.account || null;
  const setAkun = a => { if (a) ME.account = a; return a; };
  async function api(path, body, method) {
    try {
      const r = await fetch(path, { method: method || (body === undefined ? 'GET' : 'POST'), credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { ok: r.ok, status: r.status, body: await r.json().catch(() => ({})) };
    } catch { return { ok: false, status: 0, body: { error: 'Arunika could not be reached. Check the connection.' } }; }
  }
  // DEMO: the simulated phone. Only the browser that created the account holds its key, so a
  // second laptop that logs in with the stolen password does not receive the codes.
  const phoneKey = email => baca('arunika:phone:' + String(email || '').toLowerCase(), null);
  const setPhoneKey = (email, k) => { if (k) tulis('arunika:phone:' + String(email).toLowerCase(), k); };
  async function daftar({ email, nama, hp, password }) {
    const r = await api('/api/signup', { email, nama, hp, password });
    if (r.status === 409) return { ok: false, alasan: 'terdaftar' };
    if (!r.ok) return { ok: false, alasan: r.body.error || 'error' };
    setPhoneKey(email, r.body.phoneKey);
    return { ok: true, akun: r.body.account };
  }
  async function masuk(email, password) {
    const r = await api('/api/login', { email, password });
    if (r.status === 404) return { ok: false, alasan: 'tidak-terdaftar' };
    if (r.status === 401) return { ok: false, alasan: 'sandi' };
    if (!r.ok) return { ok: false, alasan: r.body.error || 'error' };
    return { ok: true };
  }
  // Sample account for presentations: history is pre-filled so the pages are not empty.
  // Its BEHAVIOR profile is whatever the server holds for it.
  async function akunContoh() {
    const r = await api('/api/sample', {});
    if (r.ok) setPhoneKey('nadia.putri@example.com', r.body.phoneKey);
    return r.ok;
  }
  async function keluar(alasan) {
    try { if (window.BehaviorGuard) await window.BehaviorGuard.stop(); } catch {}
    await api('/api/logout', {});
    try { sessionStorage.clear(); } catch {}
    location.href = 'index.html' + (alasan ? '?keluar=' + encodeURIComponent(alasan) : '');
  }

  // ---------------- page shell ----------------
  const NAV = [['home.html', 'Home'], ['transfer.html', 'Transfer'], ['pay.html', 'Pay'], ['history.html', 'History'], ['security.html', 'Security']];
  function shell(aktif) {
    const a = akun();
    if (!sesi() || !a) { location.replace('index.html' + (ME.ended ? '?keluar=diblokir' : '')); return null; }
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

  // DEMO: delete this account on the server (bank data and behavior profile) and the few
  // presenter settings in this browser, so the demo restarts at sign-up.
  async function resetDemo() {
    try { if (window.BehaviorGuard) await window.BehaviorGuard.stop(); } catch {}
    await api('/api/demo/reset', {});
    try {
      const buang = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && (k.startsWith('arunika:') || k.startsWith('bg:'))) buang.push(k); }
      buang.forEach(k => localStorage.removeItem(k));
      sessionStorage.clear();
    } catch {}
  }

  window.Arunika = { I, KAT, rupiah, tanggal, jam, esc, angka, salam, inisial, ME, sesi, akun, setAkun, api, phoneKey,
    daftar, masuk, akunContoh, keluar, resetDemo, shell, toast, dialog, konfirmasi, nominalInput, baca, tulis };
})();
