/* Toko Kopi Nusantara - logika toko. Vanilla JS, tanpa dependensi.
   Keranjang disimpan di localStorage supaya bertahan antar-halaman. */
(function () {
  'use strict';

  var PRODUK = [
    { id: 'gayo',    nama: 'Arabika Gayo',        asal: 'Aceh Tengah',      harga: 92000,  emoji: '☕',
      catatan: 'Aroma rempah, asam jeruk yang bersih, badan sedang. Proses semi-washed.' },
    { id: 'toraja',  nama: 'Arabika Toraja',      asal: 'Tana Toraja',      harga: 105000, emoji: '🫘',
      catatan: 'Cokelat gelap dan tanah basah, asam rendah, aftertaste panjang.' },
    { id: 'kintamani', nama: 'Arabika Kintamani', asal: 'Bangli, Bali',     harga: 98000,  emoji: '🌋',
      catatan: 'Jeruk dan bunga, ditanam berdampingan dengan kebun jeruk warga.' },
    { id: 'flores',  nama: 'Arabika Flores Bajawa', asal: 'Ngada, NTT',     harga: 112000, emoji: '🏔️',
      catatan: 'Karamel dan tembakau manis, badan tebal, tumbuh di tanah vulkanik.' },
    { id: 'lampung', nama: 'Robusta Lampung',     asal: 'Lampung Barat',    harga: 68000,  emoji: '🌱',
      catatan: 'Pahit tegas, cocok untuk kopi susu. Kafein tinggi.' },
    { id: 'wamena',  nama: 'Arabika Wamena',      asal: 'Jayawijaya, Papua', harga: 128000, emoji: '❄️',
      catatan: 'Ditanam di 1.600 mdpl tanpa pupuk kimia. Manis bersih, asam lembut.' }
  ];


  /* ---------- akun pengguna ----------
     Situs nyata selalu tahu siapa yang sedang masuk. Di sini akun disimpan di
     localStorage, dan yang sedang aktif diumumkan lewat `window.penggunaAktif`
     supaya skrip pihak ketiga bisa memakainya tanpa menebak-nebak. */
  var AKUN_KEY = 'toko-kopi-akun';       // daftar akun terdaftar
  var SESI_KEY = 'toko-kopi-sesi';       // email yang sedang masuk

  function semuaAkun() {
    try { return JSON.parse(localStorage.getItem(AKUN_KEY) || '{}'); } catch (e) { return {}; }
  }
  function simpanAkun(a) { try { localStorage.setItem(AKUN_KEY, JSON.stringify(a)); } catch (e) {} }
  function emailAktif() { try { return localStorage.getItem(SESI_KEY) || null; } catch (e) { return null; } }
  function masuk(email) { try { localStorage.setItem(SESI_KEY, email); } catch (e) {} }
  function keluar() { try { localStorage.removeItem(SESI_KEY); } catch (e) {} }

  function penggunaAktif() {
    var e = emailAktif(); if (!e) return null;
    var a = semuaAkun()[e]; if (!a) return null;
    return { email: e, nama: a.nama };
  }
  // diumumkan sebelum apa pun yang lain berjalan
  window.penggunaAktif = penggunaAktif();

  function renderBilahAkun() {
    var el = document.getElementById('bilah-akun');
    if (!el) return;
    var u = window.penggunaAktif;
    if (u) {
      el.innerHTML = '<span class="halo">Halo, <strong>' + u.nama + '</strong></span>' +
        '<button class="btn ghost kecil" id="btn-keluar">Keluar</button>';
      document.getElementById('btn-keluar').onclick = function () {
        keluar(); location.href = 'masuk.html';
      };
    } else {
      el.innerHTML = '<a class="btn kecil" href="masuk.html" style="text-decoration:none">Masuk / Daftar</a>';
    }
  }

  function wajibMasuk() {
    if (!window.penggunaAktif) { location.href = 'masuk.html'; return false; }
    return true;
  }

  function renderMasuk() {
    var mode = 'daftar';
    var kotak = document.getElementById('kotak-akun');
    if (!kotak) return;
    function gambar() {
      kotak.innerHTML =
        '<div class="tab-akun">' +
          '<button type="button" data-mode="daftar" class="' + (mode==='daftar'?'on':'') + '">Daftar akun baru</button>' +
          '<button type="button" data-mode="masuk" class="' + (mode==='masuk'?'on':'') + '">Sudah punya akun</button>' +
        '</div>' +
        '<form id="form-akun">' +
          (mode==='daftar' ? '<label for="nama">Nama lengkap</label><input id="nama" required autocomplete="off">' : '') +
          '<label for="email">Alamat surel</label><input id="email" type="email" required autocomplete="off">' +
          '<label for="sandi">Kata sandi</label><input id="sandi" type="password" required autocomplete="off">' +
          '<p id="pesan-akun" class="pesan"></p>' +
          '<button class="btn wide" type="submit" style="margin-top:6px;padding:11px">' +
            (mode==='daftar' ? 'Buat akun' : 'Masuk') + '</button>' +
        '</form>';
      [].forEach.call(kotak.querySelectorAll('[data-mode]'), function (b) {
        b.onclick = function () { mode = b.getAttribute('data-mode'); gambar(); };
      });
      document.getElementById('form-akun').onsubmit = function (ev) {
        ev.preventDefault();
        var email = document.getElementById('email').value.trim().toLowerCase();
        var sandi = document.getElementById('sandi').value;
        var pesan = document.getElementById('pesan-akun');
        var daftar = semuaAkun();
        if (mode === 'daftar') {
          if (daftar[email]) { pesan.textContent = 'Surel itu sudah terdaftar. Pilih "Sudah punya akun".'; return; }
          daftar[email] = { nama: document.getElementById('nama').value.trim() || 'Pelanggan', sandi: sandi };
          simpanAkun(daftar);
        } else {
          if (!daftar[email]) { pesan.textContent = 'Akun tidak ditemukan. Daftar dulu.'; return; }
          if (daftar[email].sandi !== sandi) { pesan.textContent = 'Kata sandi salah.'; return; }
        }
        masuk(email);
        location.href = 'index.html';
      };
    }
    gambar();
  }

  var KEY = 'toko-kopi-keranjang';

  function baca() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function tulis(k) {
    try { localStorage.setItem(KEY, JSON.stringify(k)); } catch (e) {}
    hitungBadge();
  }
  function jumlahItem() {
    var k = baca(), n = 0;
    for (var id in k) n += k[id];
    return n;
  }
  function rupiah(n) { return 'Rp' + n.toLocaleString('id-ID'); }
  function cari(id) {
    for (var i = 0; i < PRODUK.length; i++) if (PRODUK[i].id === id) return PRODUK[i];
    return null;
  }

  function hitungBadge() {
    var el = document.getElementById('jml-keranjang');
    if (el) el.textContent = jumlahItem();
  }

  function tambah(id, banyak) {
    var k = baca();
    k[id] = (k[id] || 0) + (banyak || 1);
    if (k[id] < 1) delete k[id];
    tulis(k);
  }
  function setJumlah(id, n) {
    var k = baca();
    if (n < 1) delete k[id]; else k[id] = n;
    tulis(k);
  }

  /* ---------- halaman katalog ---------- */
  function renderKatalog(el) {
    el.innerHTML = PRODUK.map(function (p) {
      return '<article class="card">' +
        '<div class="thumb" style="background:#F3EADC">' + p.emoji + '</div>' +
        '<div class="body">' +
          '<h3><a href="produk.html?id=' + p.id + '">' + p.nama + '</a></h3>' +
          '<div class="asal">' + p.asal + '</div>' +
          '<div class="harga">' + rupiah(p.harga) + ' <span style="font-weight:400;font-size:13px;color:var(--ink-2)">/ 200g</span></div>' +
          '<button class="btn wide" data-tambah="' + p.id + '">Masukkan keranjang</button>' +
        '</div></article>';
    }).join('');
  }

  /* ---------- halaman detail ---------- */
  function renderDetail(el) {
    var id = new URLSearchParams(location.search).get('id');
    var p = cari(id) || PRODUK[0];
    document.title = p.nama + ' - Toko Kopi Nusantara';
    el.innerHTML =
      '<div class="foto" style="background:#F3EADC">' + p.emoji + '</div>' +
      '<div>' +
        '<span class="badge">' + p.asal + '</span>' +
        '<h1 style="margin:4px 0 8px">' + p.nama + '</h1>' +
        '<p class="sub">' + p.catatan + '</p>' +
        '<p style="font-size:26px;font-weight:800;margin:6px 0 4px">' + rupiah(p.harga) + '</p>' +
        '<p style="color:var(--ink-2);font-size:14px;margin:0 0 18px">Biji utuh, 200 gram. Disangrai mingguan.</p>' +
        '<label for="jml">Jumlah</label>' +
        '<div class="qty" style="margin-bottom:16px">' +
          '<button type="button" id="kurang">−</button><span id="jml">1</span>' +
          '<button type="button" id="tambah">+</button></div>' +
        '<button class="btn" id="ke-keranjang" style="padding:12px 22px">Masukkan keranjang</button>' +
        '<p style="margin-top:20px"><a href="index.html">&lsaquo; kembali ke katalog</a></p>' +
      '</div>';
    var n = 1;
    var span = document.getElementById('jml');
    document.getElementById('kurang').onclick = function () { if (n > 1) { n--; span.textContent = n; } };
    document.getElementById('tambah').onclick = function () { n++; span.textContent = n; };
    document.getElementById('ke-keranjang').onclick = function () {
      tambah(p.id, n);
      location.href = 'keranjang.html';
    };
  }

  /* ---------- halaman keranjang ---------- */
  function renderKeranjang(el) {
    var k = baca(), ids = Object.keys(k);
    if (!ids.length) {
      el.innerHTML = '<div class="kosong"><p>Keranjangmu masih kosong.</p>' +
        '<p><a class="btn" href="index.html" style="text-decoration:none;display:inline-block">Lihat katalog</a></p></div>';
      return;
    }
    var total = 0;
    var baris = ids.map(function (id) {
      var p = cari(id); if (!p) return '';
      var sub = p.harga * k[id]; total += sub;
      return '<tr>' +
        '<td><strong>' + p.nama + '</strong><br><span style="color:var(--ink-2);font-size:13px">' + p.asal + '</span></td>' +
        '<td>' + rupiah(p.harga) + '</td>' +
        '<td><div class="qty"><button type="button" data-kurang="' + id + '">−</button>' +
            '<span>' + k[id] + '</span><button type="button" data-tambahi="' + id + '">+</button></div></td>' +
        '<td style="font-weight:700">' + rupiah(sub) + '</td>' +
        '<td><button class="btn danger" data-hapus="' + id + '">hapus</button></td></tr>';
    }).join('');
    el.innerHTML =
      '<table><thead><tr><th>Produk</th><th>Harga</th><th>Jumlah</th><th>Subtotal</th><th></th></tr></thead>' +
      '<tbody>' + baris + '</tbody></table>' +
      '<div class="total"><span>Total</span><span>' + rupiah(total) + '</span></div>' +
      '<p style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">' +
        '<a class="btn ghost" href="index.html" style="text-decoration:none">Lanjut belanja</a>' +
        '<a class="btn" href="checkout.html" style="text-decoration:none">Lanjut ke pembayaran</a></p>';
  }

  /* ---------- halaman checkout ---------- */
  function renderCheckout(el) {
    var k = baca(), ids = Object.keys(k), total = 0;
    ids.forEach(function (id) { var p = cari(id); if (p) total += p.harga * k[id]; });
    var ringkas = ids.length
      ? ids.map(function (id) { var p = cari(id); return p ? p.nama + ' × ' + k[id] : ''; }).join(', ')
      : 'keranjang kosong';
    el.querySelector('#ringkasan').textContent = ringkas + ' - ' + rupiah(total);
    el.querySelector('form').addEventListener('submit', function (e) {
      e.preventDefault();
      var nama = document.getElementById('nama').value || 'Pelanggan';
      try { localStorage.removeItem(KEY); } catch (err) {}
      hitungBadge();
      document.getElementById('isi-checkout').innerHTML =
        '<div class="ok"><strong>Pesanan diterima, ' + nama + '.</strong><br>' +
        'Nomor pesanan <code>TKN-' + Date.now().toString().slice(-6) + '</code>. ' +
        'Kami kirim konfirmasi lewat surel.</div>' +
        '<p><a class="btn" href="index.html" style="text-decoration:none;display:inline-block">Belanja lagi</a></p>';
    });
  }

  /* ---------- pemasangan ---------- */
  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.getAttribute) return;
    var id;
    if ((id = t.getAttribute('data-tambah'))) {
      tambah(id, 1);
      t.textContent = 'Ditambahkan ✓';
      setTimeout(function () { t.textContent = 'Masukkan keranjang'; }, 1100);
    } else if ((id = t.getAttribute('data-tambahi'))) {
      setJumlah(id, baca()[id] + 1); renderKeranjang(document.getElementById('isi-keranjang'));
    } else if ((id = t.getAttribute('data-kurang'))) {
      setJumlah(id, baca()[id] - 1); renderKeranjang(document.getElementById('isi-keranjang'));
    } else if ((id = t.getAttribute('data-hapus'))) {
      setJumlah(id, 0); renderKeranjang(document.getElementById('isi-keranjang'));
    }
  });

  document.addEventListener('DOMContentLoaded', function () {
    renderBilahAkun();
    hitungBadge();
    var el;
    if ((el = document.getElementById('kotak-akun'))) { renderMasuk(); return; }
    if (!wajibMasuk()) return;
    if ((el = document.getElementById('katalog'))) renderKatalog(el);
    if ((el = document.getElementById('detail'))) renderDetail(el);
    if ((el = document.getElementById('isi-keranjang'))) renderKeranjang(el);
    if ((el = document.getElementById('isi-checkout'))) renderCheckout(el);
  });
})();
