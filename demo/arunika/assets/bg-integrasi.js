/*
 * bg-integrasi.js — SATU-SATUNYA berkas yang ditulis pemilik situs untuk memasang BehaviorGuard.
 *
 * Situs Arunika (app.js + halaman-halamannya) sudah jadi sebelum pustaka dipasang. Berkas ini
 * menambahkan empat hal, dan tidak ada baris kode aplikasi lain yang diubah:
 *   1. menyalakan pustaka sesudah login          -> BehaviorGuard.init({ userId })
 *   2. menanggapi vonis                          -> onRisk: catat, kunci, atau hentikan sesi
 *   3. gerbang aksi sensitif (transfer, sandi)   -> assessNow() lalu stepUp() bila perlu
 *   4. jalur verifikasi CADANGAN (kode sekali pakai)  -> mfa.onFallback
 *
 * URUTANNYA PENTING, dan sering disalahpahami. Cara verifikasi UTAMA di sini bukan kode
 * sekali pakai melainkan PERILAKU: dialog "ketik frasa" milik PUSTAKA, yang mencocokkan
 * irama ketik (berapa lama tiap tombol ditekan, jeda antar-tombol) dengan irama pemilik
 * yang tersimpan di perangkat ini. Kode sekali pakai hanya muncul kalau jalur itu tidak
 * bisa dipakai: pemiliknya belum mengatur irama, memakai keyboard yang berbeda dari saat
 * mendaftar, atau menekan "Gunakan cara lain". Ia jalan KELUAR, bukan pintu depan —
 * tanpanya, pemilik yang gagal ritme tidak punya pilihan selain diblokir.
 *
 * Dialog kode di bawah milik SITUS. Di produksi, kodenya dikirim DAN dicek oleh server-mu;
 * `onFallback` hanya boleh mengembalikan true kalau server sudah bilang kodenya benar.
 */
(function () {
  'use strict';
  const A = window.Arunika;
  const s = A && A.sesi();
  const BG = window.BehaviorGuard;
  const LOG_KEY = s ? 'arunika:log:' + s.email : '';
  const KUNCI = 'arunika:terkunci';          // per tab: aksi sensitif dikunci sampai verifikasi
  const CEPAT = localStorage.getItem('arunika:mode-cepat') === '1';

  if (!s || !BG) {
    // Pustaka gagal dimuat (diblokir ekstensi, CDN mati, salah alamat): GAGAL-TERTUTUP.
    // Tanpa penilaian perilaku, setiap aksi sensitif diperlakukan "belum terverifikasi"
    // dan memakai kode sekali pakai. Jangan pernah membiarkan aksi sensitif lolos hanya karena skrip
    // keamanan tidak ada.
    if (s && !BG) console.warn('[Arunika] BehaviorGuard tidak termuat - aksi sensitif memakai kode sekali pakai');
    window.Guard = {
      ready: Promise.resolve(),
      gerbang: async () => (s ? { ok: await verifikasiKode({ why: 'pustaka-tidak-termuat' }), penilaian: { level: 'UNKNOWN' } } : { ok: false }),
      status: () => null, onChange: () => {}, log: () => [], jelaskan: () => [], catat: () => {},
      keteranganLevel: lv => lv,
    };
    return;
  }

  // ------------------------------------------------------------------ 1. init
  const opsi = {
    userId: s.email,
    onRisk: tanganiVonis,
    mfa: {
      phrase: 'arunika jaga akunku',   // frasa yang diketik ulang saat verifikasi (bukan rahasia)
      brand: 'Arunika',
      accent: '#b4501a',
      theme: 'light',                    // situs selalu terang
      onFallback: verifikasiKode,        // "Gunakan cara lain" -> kode sekali pakai milik situs
    },
  };
  // Mode presentasi: bukti per vonis lebih kecil supaya pendaftaran selesai ~2x lebih cepat.
  // Angka akurasi resmi TIDAK berlaku di mode ini (diukur dengan 150 event per vonis).
  if (CEPAT) opsi.session = { minEventsAssess: 60, minEventsTrain: 60, windowSec: 15 };
  const ready = BG.init(opsi).catch(e => { console.error('[Arunika] BehaviorGuard gagal dinyalakan', e); });

  // ------------------------------------------------------------------ 2. vonis
  const NAMA = {
    mouse_velocity_mean: 'kecepatan gerak mouse', mouse_velocity_std: 'variasi kecepatan mouse', mouse_velocity_max: 'kecepatan mouse tertinggi',
    mouse_acceleration_std: 'variasi percepatan mouse', mouse_curvature_mean: 'kelengkungan lintasan mouse', mouse_direction_changes: 'jumlah belokan mouse',
    mouse_pause_count: 'jeda gerakan mouse', mouse_click_interval_mean: 'jarak waktu antar-klik', cursor_idle_ratio: 'porsi kursor diam',
    cross_mouse_keyboard_coordination: 'perpindahan mouse ke keyboard', keystroke_dwell_time_mean: 'lama menekan tombol',
    keystroke_dwell_time_std: 'variasi lama menekan tombol', keystroke_flight_time_mean: 'jeda antar-tombol', keystroke_transition_entropy: 'keragaman urutan tombol',
    keystroke_typing_speed: 'kecepatan mengetik', keystroke_cross_field_cadence: 'irama pindah kolom isian', keystroke_burst_count: 'rentetan ketikan',
    temporal_time_of_day_score: 'jam pemakaian', temporal_session_duration: 'lama aktivitas', temporal_activity_bursts: 'lonjakan aktivitas',
    nav_page_transition_pattern: 'pola pindah halaman', nav_scroll_depth_mean: 'kedalaman gulir', nav_page_count: 'jumlah halaman dibuka',
    nav_step_transition_count: 'langkah alur', form_focus_count: 'masuk ke kolom isian', form_blur_count: 'keluar dari kolom isian',
    form_field_switch_rate: 'laju pindah kolom isian', cart_action_count: 'aksi keranjang',
    keystroke_flight_median: 'jeda khas antar-tombol', keystroke_flight_iqr: 'kerapatan irama ketik', keystroke_backspace_ratio: 'kebiasaan menghapus ketikan',
    keystroke_cross_hand_ratio: 'pola tangan kiri-kanan', keystroke_dwell_median: 'lama tekan khas', keystroke_shift_ratio: 'pemakaian huruf besar',
  };
  // topFeatures -> kalimat biasa ("jeda antar-tombol jauh lebih lama dari biasanya")
  function jelaskan(e) {
    if (!e) return [];
    const out = [];
    if (e.replay) out.push('perilaku identik dengan sesi lama, ciri rekaman yang diputar ulang');
    if (e.integrity) out.push('pola input terlalu teratur untuk manusia (skrip/bot)');
    if (e.reverifyAfterAway) out.push('kembali setelah lama tidak aktif');
    for (const f of (e.topFeatures || [])) {
      if (!NAMA[f.name] || !Number.isFinite(f.z) || Math.abs(f.z) < 1.5) continue;
      const a = Math.abs(f.z), arah = f.z > 0 ? 'lebih tinggi' : 'lebih rendah';
      out.push(`${NAMA[f.name]} ${a > 4 ? 'jauh ' : ''}${arah} dari biasanya`);
    }
    return out.slice(0, 3);
  }

  function catat(entri) {
    const log = A.baca(LOG_KEY, []);
    log.unshift({ t: Date.now(), ...entri });
    A.tulis(LOG_KEY, log.slice(0, 60));
  }
  const terkunci = () => sessionStorage.getItem(KUNCI) === '1';
  function kunci(on) {
    if (on) sessionStorage.setItem(KUNCI, '1'); else sessionStorage.removeItem(KUNCI);
    tampilkanBanner();
  }

  let selesaiBelajar = false;
  function tanganiVonis(e) {
    if (e.enrollment) {
      if (e.enrollment.siap && !selesaiBelajar) {
        selesaiBelajar = true;
        catat({ lv: 'info', t1: 'Profil perilaku selesai dibangun', t2: 'Mulai sekarang, aktivitas di perangkat ini dinilai terhadap kebiasaanmu.' });
        A.toast('Profil perilakumu selesai dibangun. Perlindungan aktif.', { label: 'Keamanan' });
      }
      return;
    }
    if (e.abstain || e.action === 'PENDING') return;
    // Dialog verifikasi sedang/akan tampil: aksi belum final. Event berikutnya (id yang
    // sama, stage 'final') membawa hasilnya. mfa.busy = vonis lain jatuh saat dialog
    // terbuka; hasil dialog itulah yang menentukan, jadi jangan bertindak sendiri.
    if (e.mfa && (e.mfa.awaiting || e.mfa.busy)) return;
    const alasan = jelaskan(e);
    const kalimat = (daftar, cadangan) => daftar.length ? daftar.join('; ').replace(/^./, c => c.toUpperCase()) + '.' : cadangan;
    const lv = e.level;
    if (e.action === 'MFA_PASSED') {
      kunci(false);
      catat({ lv: 'ok', t1: 'Verifikasi berhasil', t2: (e.mfa && e.mfa.fallback ? 'Lewat kode sekali pakai. ' : 'Lewat irama ketik. ') + (alasan[0] ? 'Pemicu: ' + alasan[0] + '.' : '') });
      return;
    }
    if (e.action === 'BLOCK_SESSION' || (e.action === 'MFA_FAILED' && lv === 'HIGH')) {
      catat({ lv: 'bad', t1: 'Sesi dihentikan', t2: kalimat(alasan, 'Aktivitas tidak cocok dengan pemilik akun.') });
      hentikanSesi(alasan);
      return;
    }
    if (lv === 'MEDIUM' || lv === 'HIGH') {
      // dialog ditutup/gagal, atau tak ada jalur verifikasi -> kunci aksi sensitif di tab ini
      kunci(true);
      catat({ lv: 'warn', t1: lv === 'HIGH' ? 'Aktivitas sangat tidak biasa' : 'Aktivitas tidak biasa', t2: kalimat(alasan, 'Pola pemakaian berbeda dari kebiasaan.') + ' Verifikasi belum diselesaikan.' });
      return;
    }
    if (e.stepUpGrace) return;      // MEDIUM yang diredam karena baru saja terverifikasi
  }

  function hentikanSesi(alasan) {
    const bd = document.createElement('div');
    bd.className = 'dlg-bd';
    bd.innerHTML = `<div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="blk-t">
      <h2 id="blk-t">Sesi dihentikan demi keamanan</h2>
      <p class="sub">Cara akun ini dipakai tidak cocok dengan pemiliknya dan verifikasi tidak berhasil. Kamu akan dikeluarkan. Kalau ini memang kamu, masuk kembali lalu verifikasi dengan kode sekali pakai.</p>
      <div class="acts"><button class="btn btn-pri" data-ok>Keluar sekarang</button></div></div>`;
    document.body.appendChild(bd);
    const go = () => A.keluar('diblokir');
    bd.querySelector('[data-ok]').onclick = go;
    bd.querySelector('[data-ok]').focus();
    setTimeout(go, 6000);
  }

  function tampilkanBanner() {
    const wrap = document.querySelector('main.wrap');
    if (!wrap) return;
    let b = document.getElementById('bn-kunci');
    if (!terkunci()) { if (b) b.remove(); return; }
    if (b) return;
    b = document.createElement('div');
    b.id = 'bn-kunci'; b.className = 'banner bn-warn'; b.setAttribute('role', 'status');
    b.innerHTML = `${A.I.alert}<div class="grow"><div class="t">Verifikasi diperlukan</div>
      <div>Aktivitas di sesi ini tidak biasa. Transfer, pembayaran, dan perubahan keamanan dikunci sampai kamu memverifikasi.</div></div>
      <button class="btn btn-sm" type="button">Verifikasi sekarang</button>`;
    b.querySelector('button').onclick = async () => {
      const v = await BG.stepUp({ level: 'MEDIUM', reason: 'membuka kunci sesi' });
      if (v.verified) { kunci(false); catat({ lv: 'ok', t1: 'Verifikasi berhasil', t2: 'Kunci sesi dibuka.' }); A.toast('Terverifikasi. Semua fitur terbuka lagi.'); }
    };
    wrap.prepend(b);
  }

  // ------------------------------------------------------------------ 3. gerbang aksi sensitif
  /**
   * Kebijakan Arunika (contoh kebijakan berbasis risiko; tiap situs menentukan sendiri):
   *   ganti kata sandi            -> SELALU verifikasi
   *   LOW                         -> lanjut
   *   MEDIUM / HIGH / terkunci    -> verifikasi dulu
   *   UNKNOWN (bukti belum cukup, atau perangkat masih dikenali)
   *                               -> verifikasi untuk nominal >= Rp 1 juta; nominal kecil lanjut
   *   baru lolos verifikasi (<= 15 menit, assessNow().verifiedRecently)
   *                               -> tidak ditanya lagi, kecuali HIGH atau ganti sandi
   */
  async function gerbang(aksi, { nominal = 0, label = aksi } = {}) {
    await ready;
    const r = BG.assessNow();
    const selalu = aksi === 'ganti-sandi';
    let perlu = selalu || terkunci() || r.level === 'MEDIUM' || r.level === 'HIGH';
    if (r.level === 'UNKNOWN' && nominal >= 1_000_000) perlu = true;
    if (perlu && !selalu && r.verifiedRecently && r.level !== 'HIGH' && !terkunci()) perlu = false;
    if (!perlu) return { ok: true, penilaian: r };
    const v = await BG.stepUp({ level: r.level === 'HIGH' ? 'HIGH' : 'MEDIUM', reason: label });
    if (v.verified) {
      kunci(false);
      catat({ lv: 'ok', t1: 'Verifikasi sebelum ' + label, t2: (v.method === 'fallback' ? 'Lewat kode sekali pakai.' : 'Lewat irama ketik.') + ' Penilaian saat itu: ' + keteranganLevel(r.level) + '.' });
      return { ok: true, penilaian: r, verifikasi: v };
    }
    catat({ lv: 'warn', t1: label[0].toUpperCase() + label.slice(1) + ' dibatalkan', t2: 'Verifikasi tidak diselesaikan. Penilaian saat itu: ' + keteranganLevel(r.level) + '.' });
    return { ok: false, penilaian: r, verifikasi: v };
  }
  const keteranganLevel = lv => ({ LOW: 'wajar', MEDIUM: 'tidak biasa', HIGH: 'sangat tidak biasa', UNKNOWN: 'belum cukup bukti' }[lv] || lv);

  // ------------------------------------------------------------------ 4. kode cadangan
  // Di produksi: server mengirim kode (SMS/email/authenticator) DAN memeriksanya, lalu
  // mengembalikan true/false. Di demo: kodenya "dikirim" sebagai notifikasi di pojok layar.
  // Perhatikan `ctx.why` — pustaka memberi tahu KENAPA jalur cadangan dipakai, dan alasan
  // itu ditampilkan ke pengguna. Tanpa itu, dialog kode muncul seakan-akan tanpa sebab.
  const ALASAN_CADANGAN = {
    'no-template': 'Verifikasi irama ketik belum diatur di perangkat ini.',
    'rhythm-locked': 'Irama ketik gagal beberapa kali berturut-turut, jadi jalur itu dikunci sementara.',
    'user-choice': 'Kamu memilih cara lain.',
    'pustaka-tidak-termuat': 'Pemeriksaan perilaku tidak aktif di halaman ini.',
  };
  function verifikasiKode(ctx) {
    return new Promise(resolve => {
      const a = A.akun();
      const hp = a ? a.hp.replace(/(\+62 \d{3})-(\d{4})-(\d{2})(\d{2})/, '$1-••••-••$4') : 'nomor terdaftar';
      let kode = '', salah = 0, sms = null, timer = null, sisa = 0;
      const d = A.dialog(`<div data-bg-mfa>
        <h2>Masukkan kode verifikasi</h2>
        <p class="sub">${A.esc(ALASAN_CADANGAN[(ctx && ctx.why) || ''] || 'Kami perlu memastikan ini kamu.')}
        Kami mengirim kode 6 digit ke <b style="white-space:nowrap">${A.esc(hp)}</b>. Kode berlaku 5 menit.</p>
        <div class="otp" role="group" aria-label="Kode 6 digit">${'<input inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="digit">'.repeat(6)}</div>
        <div class="err" id="otp-err" role="alert"></div>
        <div class="acts"><button class="btn btn-ghost btn-sm" data-ulang disabled>Kirim ulang</button><span style="flex:1"></span>
          <button class="btn" data-x>Batal</button><button class="btn btn-pri" data-y>Verifikasi</button></div></div>`);
      const box = [...d.el.querySelectorAll('.otp input')];
      const err = d.el.querySelector('#otp-err');
      const ulang = d.el.querySelector('[data-ulang]');
      const kirim = () => {
        kode = String(Math.floor(100000 + Math.random() * 900000));
        if (sms) sms.remove();
        setTimeout(() => { sms = A.toast(`ARUNIKA: Kode verifikasi <span class="code">${kode}</span>. Jangan berikan kode ini kepada siapa pun, termasuk petugas Arunika.`, { kind: 'sms', label: 'Pesan masuk · baru saja', ms: 60000 }); }, 900);
        sisa = 30; ulang.disabled = true;
        clearInterval(timer);
        timer = setInterval(() => { sisa--; ulang.textContent = sisa > 0 ? `Kirim ulang (${sisa})` : 'Kirim ulang'; if (sisa <= 0) { ulang.disabled = false; clearInterval(timer); } }, 1000);
      };
      const selesai = ok => { clearInterval(timer); if (sms) sms.remove(); d.close(); resolve(ok); };
      const nilai = () => box.map(i => i.value).join('');
      const periksa = () => {
        if (nilai().length < 6) { err.textContent = 'Lengkapi 6 digit kode.'; return; }
        if (nilai() === kode) return selesai(true);
        salah++;
        if (salah >= 3) { err.textContent = 'Kode salah 3 kali.'; setTimeout(() => selesai(false), 900); return; }
        err.textContent = `Kode tidak cocok. Sisa ${3 - salah} percobaan.`;
        box.forEach(i => { i.value = ''; }); box[0].focus();
      };
      box.forEach((inp, i) => {
        inp.addEventListener('input', () => {
          inp.value = inp.value.replace(/\D/g, '').slice(-1);
          if (inp.value && i < 5) box[i + 1].focus();
          if (nilai().length === 6) periksa();
        });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Backspace' && !inp.value && i > 0) box[i - 1].focus();
          if (e.key === 'Enter') periksa();
          if (e.key === 'Escape') selesai(false);
        });
        inp.addEventListener('paste', e => {
          const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
          if (!t) return;
          e.preventDefault();
          t.split('').forEach((c, j) => { if (box[j]) box[j].value = c; });
          if (t.length === 6) periksa();
        });
      });
      d.el.querySelector('[data-x]').onclick = () => selesai(false);
      d.el.querySelector('[data-y]').onclick = periksa;
      ulang.onclick = kirim;
      kirim();
      box[0].focus();
    });
  }

  // ------------------------------------------------------------------ status untuk halaman
  function status() {
    const st = BG.status();
    return st ? { ...st, terkunci: terkunci(), cepat: CEPAT } : null;
  }
  function onChange(fn) {
    const run = () => { try { fn(status()); } catch (e) { console.error(e); } };
    ready.then(run);
    BG.on('risk', () => setTimeout(run, 0));
  }

  document.addEventListener('DOMContentLoaded', tampilkanBanner);
  if (document.readyState !== 'loading') tampilkanBanner();

  window.Guard = { ready, gerbang, status, onChange, jelaskan, log: () => A.baca(LOG_KEY, []), catat, keteranganLevel, verifikasiKode };
})();
