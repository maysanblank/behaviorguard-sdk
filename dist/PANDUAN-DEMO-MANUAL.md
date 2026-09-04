# Panduan Demo Manual — 3 Situs, 3 Tenant (pk terpisah)

Skema pilihanmu: 3 e-commerce polos, masing-masing tenant sendiri (pk beda), enroll manual.

---

## 0. Setup sekali (per situs)

Daftar 3 tenant → dapat 3 pk:
```
python server/app.py          # biarkan jalan di VPS/localhost:5055
```
```
curl -X POST http://localhost:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"Toko A\"}"
curl -X POST http://localhost:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"Toko B\"}"
curl -X POST http://localhost:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"Toko C\"}"
```
Tempel di tiap situs (pk sesuai tokonya, userId = akun yang login):
```html
<script src="/behaviorguard.js"
        data-user="AKUN_YANG_LOGIN"
        data-pk="pk_TOKO_INI"
        data-endpoint="http://localhost:5055" defer></script>
```

---

## 1. Berapa sesi? → 10-12 cukup (bukan wajib 30)

- Sesi 1-10 = **enrollment** (selalu LOW, belum dinilai — ini normal, JANGAN dikira gagal).
- Isi **12** biar ada buffer kalau ada sesi gagal gate. 30 boleh, cuma buang waktu.
- **1 sesi = otomatis tiap 30 detik** selama tab aktif. Jadi 12 sesi ≈ 6 menit aktivitas/situs.

---

## 2. Aturan main tiap sesi (WAJIB, biar lolos gate)

Gate: **≥100 event, ≥5 detik, ≥6 fitur non-nol**. Kalau diem → sesi dibuang (tidak masuk baseline).
Tiap jendela 30 detik lakukan campuran ini:

- [ ] Gerakkan mouse muter-muter (jangan diem) — ini gampang tembus 100 event.
- [ ] **Ketik di kotak search / form** (min 1-2 kata) — WAJIB, ini sumber fitur ketik (dwell/flight) yang jadi pembeda terkuat. Tanpa ngetik, deteksi cuma ngandelin mouse → lemah.
- [ ] Scroll naik-turun.
- [ ] Klik 1-2 produk.
- [ ] Pindah 1 halaman (produk → keranjang / halaman lain).

Jaga tab tetap **fokus** (pindah tab = sesi keburu ditutup).

Cek progress: buka console (F12) → tiap sesi muncul log `enrollment N/10`. Atau lihat dashboard.

---

## 3. Cara tes deteksi (ini inti "ke-detect apa engga")

Kamu butuh **2 peran**, bukan cuma pemilik:

**A. Pemilik (kamu, gaya normal)** — setelah 10 enrollment, lanjut beberapa sesi normal.
   → Harusnya **mayoritas LOW**. Tapi wajar ~1 dari 3 naik MEDIUM (FRR ~18-35%) — itu bukan bug, jelaskan sbg lapisan step-up.

**B. Penyusup (device/incognito LAIN, login akun sama, gaya beda)**:
   1. Buka **incognito / browser lain** (storage kosong = simulasi HP penyusup).
   2. Login akun yang sama di situs itu.
   3. SDK auto-tarik baseline pemilik dari VPS (`hasModel=true` langsung).
   4. Berperilaku **beda jelas**: ketik jauh lebih cepat/lambat, mouse kaku/lurus, ritme lain. Idealnya minta **orang lain** yang ngetik.
   → Harusnya **HIGH → BLOCK_SESSION**.

> ⚠️ **Jujur & penting:** engine di browser = centroid (bukan sklearn Python), **FAR ~36%**
> → penyusup bisa lolos ~1 dari 3. JANGAN taruhan 1 sesi. Jalankan **3-5 sesi penyusup**,
> laporkan rasio (mis. "4 dari 5 kena HIGH"). Ini malah lebih ilmiah daripada 1 sesi mujur.

---

## 4. Ekspektasi hasil (biar nggak kaget di depan dosen)

| Fase | Yang muncul | Normal? |
|---|---|---|
| Sesi 1-10 (enroll) | LOW semua, `convergence: enrollment` | ✅ ya, belum dinilai |
| Pemilik pasca-enroll | Mayoritas LOW, sesekali MEDIUM | ✅ FRR ~1/3 |
| Penyusup (device lain) | Mayoritas HIGH, kadang bocor LOW | ✅ FAR ~1/3 di engine JS |

Dashboard per tenant: `http://localhost:5055/dashboard?pk=pk_TOKO`

---

## 5. Checklist kesiapan sebelum demo
- [ ] 3 situs punya kotak search / form input (ada yang bisa diketik).
- [ ] VPS jalan & 3 pk terdaftar.
- [ ] Tag terpasang dengan pk+userId+endpoint benar (cek Network: ada POST /log).
- [ ] Sudah latihan sekali: enroll 12 → 1 sesi pemilik LOW → 1 sesi penyusup HIGH.
- [ ] Siapkan device/incognito ke-2 untuk peran penyusup.
- [ ] Siapkan kalimat limitasi: "FAR/FRR engine JS lebih tinggi dari angka Python; ini step-up, bukan kunci absolut; mimicry belum diuji."
