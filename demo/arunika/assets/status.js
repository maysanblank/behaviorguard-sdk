/*
 * status.js - kartu "Perlindungan perilaku" milik situs, dibangun dari BehaviorGuard.status().
 * Contoh bagaimana integrator menampilkan keadaan pustaka dengan bahasa situsnya sendiri.
 */
(function () {
  'use strict';
  const A = window.Arunika;
  function isi(el, st, { ringkas }) {
    if (!window.BehaviorGuard) {
      el.innerHTML = `<div class="guard warn"><div class="ico">${A.I.alert}</div><div><h3>Perlindungan perilaku tidak aktif</h3>
        <p class="small muted" style="margin-top:3px">Komponen keamanan tidak termuat di browser ini. Transfer dan perubahan keamanan memakai kode sekali pakai.</p></div></div>`;
      return;
    }
    if (!st || !st.ready) {
      el.innerHTML = `<div class="guard"><div class="ico">${A.I.shield}</div><div><h3>Menyalakan perlindungan...</h3></div></div>`;
      return;
    }
    const e = st.lastVerdict;
    const waktu = e && e.at ? A.jam(e.at) : null;
    if (st.terkunci) {
      el.innerHTML = `<div class="guard warn"><div class="ico">${A.I.alert}</div><div style="flex:1">
        <h3>Verifikasi diperlukan</h3>
        <p class="small muted" style="margin-top:3px">Aktivitas di sesi ini tidak biasa. Aksi sensitif dikunci sampai kamu memverifikasi.</p></div></div>`;
      return;
    }
    if (st.phase === 'learning') {
      const k = st.enrollment.done, n = st.enrollment.need;
      el.innerHTML = `<div class="guard"><div class="ico">${A.I.shield}</div><div style="flex:1;min-width:0">
        <h3>Mengenali cara kamu memakai Arunika</h3>
        <p class="small muted" style="margin:3px 0 10px">Pakai seperti biasa. Selama masa pengenalan, setiap transfer dan pembayaran diminta verifikasi dulu.</p>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${k}"><i style="width:${Math.round(k / n * 100)}%"></i></div>
        <p class="small muted num" style="margin-top:6px">${k} dari ${n} aktivitas${st.cepat ? ' · mode presentasi' : ''}</p></div></div>`;
      return;
    }
    const grace = st.mfa.graceLeftSec > 0;
    const lv = e ? e.level : 'LOW';
    const baris = grace ? `Terverifikasi ${Math.max(1, Math.round((Date.now() - st.mfa.verifiedAt) / 60000))} menit lalu.`
      : waktu ? `Aktivitas terakhir ${Guard.keteranganLevel(lv)} · dinilai ${waktu}.` : 'Menunggu aktivitas pertama di kunjungan ini.';
    const mfa = st.mfa.enrolled ? '' : `<p class="small" style="margin-top:8px"><a href="keamanan.html#irama">Atur verifikasi irama ketik</a> supaya verifikasi cukup dengan ritme ketikmu, tanpa menunggu kode.</p>`;
    el.innerHTML = `<div class="guard ok"><div class="ico">${A.I.shield}</div><div style="flex:1">
      <h3>Perlindungan perilaku aktif</h3>
      <p class="small muted" style="margin-top:3px">${baris}</p>${ringkas ? mfa : ''}</div></div>`;
  }
  window.StatusGuard = {
    mount(el, opt = {}) {
      if (!el || !window.Guard) return;
      isi(el, null, opt);
      Guard.onChange(st => isi(el, st, opt));
      setInterval(() => isi(el, Guard.status(), opt), 3000);
    },
  };
})();
