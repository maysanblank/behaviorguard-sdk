/* Toko Kopi Nusantara — logika toko. Vanilla JS, tanpa dependensi.
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
    document.title = p.nama + ' — Toko Kopi Nusantara';
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
        '<p style="margin-top:20px"><a href="index.html">← kembali ke katalog</a></p>' +
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
    el.querySelector('#ringkasan').textContent = ringkas + ' — ' + rupiah(total);
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
    hitungBadge();
    var el;
    if ((el = document.getElementById('katalog'))) renderKatalog(el);
    if ((el = document.getElementById('detail'))) renderDetail(el);
    if ((el = document.getElementById('isi-keranjang'))) renderKeranjang(el);
    if ((el = document.getElementById('isi-checkout'))) renderCheckout(el);
  });
})();
