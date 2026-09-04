# BehaviorGuard — Pasang di Website Mana Pun (1 tag)

`dist/behaviorguard.js` = **satu file classic-script** (16 modul dibundel jadi 1).
Nol `type=module`, nol sub-file `core/*.js`, nol path absolut `/sdk/`. Host di mana saja
(CDN / GitHub Pages / jsDelivr / folder mana pun), colok satu `<script>`. Selesai.

## Regenerasi bundle (tiap kali edit `sdk/`)
```
python tools/bundle.py     # atau: npm run bundle
```

## Cara pasang — pilih SATU

### 1. Paling gampang: data-attribute + event DOM (tanpa callback global)
```html
<script src="https://cdn-kamu.com/behaviorguard.js" data-user="andi@example.com" defer></script>
<script>
  addEventListener('behaviorguard:risk', e => {
    if (e.detail.level === 'HIGH') showMFA();   // e.detail = {level,score,action,reasons,topFeatures}
  });
</script>
```

### 2. Callback bernama (kompatibel gaya loader lama)
```html
<script src="https://cdn-kamu.com/behaviorguard.js" data-user="andi@example.com" data-callback="onRisk" defer></script>
<script>function onRisk(e){ if(e.level==='HIGH') showMFA(); }</script>
```

### 3. Objek config (gaya Google Analytics — taruh SEBELUM tag)
```html
<script>window.BehaviorGuardConfig = { userId:"andi@example.com", onRisk:e=>{ /* ... */ } };</script>
<script src="https://cdn-kamu.com/behaviorguard.js" defer></script>
```

Semua auto-capture (mouse/ketik/scroll/navigasi) + auto-skor tiap 30 dtk + saat halaman ditutup.
Default = konfig final tervalidasi (F4 28 fitur, W7 70/30, base10 retrain6). Tanpa setel apa pun.

## Setel lanjut (opsional, lewat objek config)
`window.BehaviorGuardConfig = { userId, weights, baseline, retrainEvery, thresholds }`

## Catatan deploy
- **MIME:** host cukup kirim `.js` biasa (classic script tak rewel soal MIME seperti modul).
- **Cross-origin:** aman lintas-domain; tak perlu CORS khusus untuk classic `<script>`.
- **CSP:** kalau situs target punya Content-Security-Policy ketat, izinkan origin host di `script-src`.
- **Data mentah tak keluar perangkat** (on-device; IndexedDB→localStorage→memory).

## Situs pihak ketiga yang TIDAK kamu kontrol
Kalau kamu tak bisa menyunting HTML situs, pakai `extension/` (MV3) — bukan tag ini.

---

## Mode HYBRID — deteksi ATO LINTAS-DEVICE (butuh VPS)

**Tanpa VPS** (mode default): baseline cuma tersimpan di device → hanya nangkap "device
sama, perilaku beda". **ATO asli (penyerang di laptop/HP-nya sendiri) TIDAK kedeteksi**,
karena device penyerang localStorage-nya kosong → SDK malah enroll ulang perilaku penyerang.

**Dengan VPS** (hybrid): baseline akun (per `userId`) hidup di server. Siapa pun login
sebagai `andi@tokonya.com` di device mana pun → SDK **tarik baseline Andi dari VPS** →
perilaku penyerang dibandingkan ke baseline pemilik → skor **HIGH**. Verdict `{pk,userId,
level}` mengalir ke VPS buat dashboard per akun.

```html
<script src="https://cdn-kamu.com/behaviorguard.js"
        data-user="andi@tokonya.com"
        data-pk="pk_xxx"
        data-endpoint="https://api.kamu.com" defer></script>
```

Atau via config object:
```html
<script>window.BehaviorGuardConfig={ userId:"andi@tokonya.com", pk:"pk_xxx", endpoint:"https://api.kamu.com" };</script>
<script src="https://cdn-kamu.com/behaviorguard.js" defer></script>
```

**Yang KELUAR device:** vektor fitur teragregasi (28 angka/sesi) + verdict (level/score).
**Event mentah (timing ketik & koordinat mouse) TIDAK pernah dikirim** — tetap on-device.
Klaim privasi skripsi yg jujur: *"fitur teragregasi keluar, keystroke/mouse mentah tidak."*

Backend contoh siap-pakai ada di `server/` (lihat `server/README.md`).
