# BehaviorGuard — Pasang di Website Mana Pun (1 tag)

`dist/behaviorguard.js` = **satu file classic-script** (semua modul dibundel jadi 1).
Tanpa `type=module`, tanpa sub-file, tanpa path absolut. Host di mana saja (CDN, GitHub
Pages, folder situs), colok satu `<script>`. Selesai.

## Regenerasi bundle (tiap kali edit `sdk/`)
```
python tools/bundle.py     # atau: npm run bundle
```

## Cara pasang — pilih SATU

### 1. Paling gampang: data-attribute + event DOM
```html
<script src="https://cdn-kamu.com/behaviorguard.js" data-user="andi@contoh.id" defer></script>
<script>
  addEventListener('behaviorguard:risk', e => {
    // e.detail = {level, score, action, reasons, topFeatures, ...}
    if (e.detail.level === 'HIGH') tahanTransaksi();
  });
</script>
```

### 2. Callback bernama
```html
<script src="https://cdn-kamu.com/behaviorguard.js" data-user="andi@contoh.id" data-callback="onRisk" defer></script>
<script>function onRisk(e){ if(e.level==='HIGH') tahanTransaksi(); }</script>
```

### 3. Objek config (taruh SEBELUM tag)
```html
<script>window.BehaviorGuardConfig = { userId:"andi@contoh.id", onRisk:e=>{ /* ... */ } };</script>
<script src="https://cdn-kamu.com/behaviorguard.js" defer></script>
```

Semua otomatis: penangkapan mouse/ketik/scroll/navigasi, penilaian tiap 30 detik (vonis
jatuh begitu 150 event terkumpul), penyimpanan ekor bukti saat pindah halaman, dan popup
verifikasi ritme ketik bawaan. Huruf yang diketik tidak pernah disimpan.

## Punya OTP / WebAuthn sendiri?
```html
<script>window.BehaviorGuardConfig = { userId:"andi@contoh.id", mfa:{ enabled:false } };</script>
<script src="https://cdn-kamu.com/behaviorguard.js" defer></script>
<script>
  addEventListener('behaviorguard:risk', async e => {
    if (e.detail.action === 'REQUIRE_MFA' || e.detail.action === 'REQUIRE_STEPUP') {
      const lolos = await jalankanOtpSaya();          // diverifikasi di SERVER Anda
      BehaviorGuard.reportStepUp({ passed: lolos });  // WAJIB: tanpa ini pemilik bisa terblokir
    }
  });
</script>
```
Sesudah pemilik lolos, vonis MEDIUM tidak bertanya lagi selama 15 menit (HIGH tetap).

## Sebelum aksi sensitif (ganti email/sandi, transfer, tambah perangkat)
```js
const v = BehaviorGuard.assessNow();
const utuh = BehaviorGuard.status().model.mainDetector;   // pemeriksa utama sudah menyala?
if (v.level !== 'LOW' || !utuh) mintaVerifikasi();
```
- `UNKNOWN` = belum ada pembanding / bukti di halaman ini belum cukup. **Verifikasi, berapa pun
  nominalnya.** Batas nominal ("hanya >= Rp 1 juta") bukan pengaman: penyusup cukup memecah
  transfernya.
- `LOW` sebelum `mainDetector` menyala (kolam latih < 20 potong bukti) datang dari Isolation
  Forest sendirian. Jangan jadikan izin memindahkan uang.
- `v.verifiedRecently` = pemilik baru lolos verifikasi (15 menit): boleh tidak ditanya lagi.

## Kartu "Mengenali perangkat ini" (opsional, bawaan pustaka)
Tunjukkan ke pengguna sampai mana situs mengenalinya: lingkaran kemajuan, dua tahap
(profil dasar 10 -> pemeriksa utama 20), penghitung kejadian, latihan mengetik, dan tombol
atur verifikasi irama ketik. Tanpa satu baris CSS/HTML dari situs.
```js
// di dalam halaman (misal halaman "Mulai" atau "Keamanan")
const kartu = BehaviorGuard.mountEnrollment('#pengenalan', { brand: 'Toko Saya' });
// ... kartu.destroy() saat pindah rute SPA

// atau sebagai dialog, dari tombol mana pun
tombol.onclick = () => BehaviorGuard.openEnrollment();
```
Opsi: `lang` (`id`/`en`), `theme` (`auto`/`light`/`dark`), `accent`, `brand`, `practice:false`
(tanpa latihan mengetik), `mfaSetup:false` (tanpa kartu irama ketik), `sentences:[...]`,
`texts:{...}` (timpa teks), `onComplete(status)` (sekali, saat pemeriksa utama menyala).
Warna/merek/tema diambil dari `mfa` bila tidak diisi. Panel mengambang `data-panel` kini punya
tombol **Lihat detail** yang membuka kartu ini.

## Setel lanjut (opsional)
```js
window.BehaviorGuardConfig = {
  userId: "andi@contoh.id",
  calibration: { k_low: 1.75 },   // makin kecil makin ketat (tabel di README)
  mfa: { enabled: true, phrase: "frasa situs anda", graceSec: 900 },
};
```

## Catatan deploy
- **MIME / cross-origin:** classic script biasa; tidak perlu CORS khusus.
- **CSP:** izinkan origin host di `script-src`; popup bawaan & `data-panel` memakai style
  inline (`style-src 'unsafe-inline'`), atau matikan keduanya.
- **Data mentah tidak keluar perangkat** (IndexedDB -> localStorage -> memori).

---

## Mode server (opsional) — baseline lintas perangkat

Tanpa server, baseline hanya ada di perangkat itu: penyerang di laptopnya sendiri mulai dari
nol dan tidak punya pembanding. Dengan server, perangkat BARU menarik baseline akun dari
server, jadi penyerang langsung dibandingkan dengan pemilik asli.

```html
<script src="https://cdn-kamu.com/behaviorguard.js"
        data-user="andi@contoh.id"
        data-pk="pk_xxx"
        data-endpoint="https://bg.contoh.id"
        data-user-token="<dicetak backend Anda sesudah login>" defer></script>
```

`pk` publik dan **tidak membuka apa pun sendirian**. Token pengguna
(`HMAC-SHA256(sk, pk|userId|exp)`, berumur pendek) wajib, dan dicetak server Anda dengan
`sk` yang tidak pernah masuk ke halaman. Tanpa token, pustaka berjalan murni di perangkat.

**Yang keluar perangkat:** 34 angka fitur per jendela + vonis. Event mentah dan huruf
ketikan tidak pernah dikirim. Setup server, contoh cetak token (Node), dan dashboard:
`server/README.md`.
