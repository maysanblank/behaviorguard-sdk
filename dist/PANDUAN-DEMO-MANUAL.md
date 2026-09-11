# Panduan Demo Manual — 3 Situs, 3 Tenant

Skema: 3 e-commerce polos, masing-masing tenant sendiri, pendaftaran manual.

---

## 0. Setup sekali

```bash
python server/app.py          # biarkan jalan di localhost:5055
```

Daftar 3 tenant. **Catat `pk` DAN `sk`** — `sk` hanya tampil sekali:
```
curl -X POST http://localhost:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"Toko A\"}"
curl -X POST http://localhost:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"Toko B\"}"
curl -X POST http://localhost:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"Toko C\"}"
```

Cetak token untuk akun demo (di produksi ini dikerjakan backend toko sesudah login):
```
python server/app.py mint pk_TOKO_INI sk_TOKO_INI AKUN_YANG_LOGIN 604800
```

Tempel di tiap situs:
```html
<script src="/behaviorguard.js"
        data-user="AKUN_YANG_LOGIN"
        data-pk="pk_TOKO_INI"
        data-endpoint="http://localhost:5055"
        data-user-token="TOKEN_HASIL_MINT" defer></script>
```

Tanpa `data-user-token`, pustaka tetap jalan tapi murni di perangkat (tidak ada log ke
dashboard, tidak ada baseline lintas perangkat).

---

## 1. Berapa lama pendaftaran?

- 10 langkah pertama = **pendaftaran** (selalu LOW, belum dinilai — normal, bukan gagal).
- Tiap langkah butuh **± 150 kejadian** (gerak mouse, ketik, scroll, klik). Jendela tetap
  berdetak tiap 30 detik; kalau belum 150, bukti dikumpulkan sampai cukup.
- Perkiraan: 5–10 menit aktivitas nyata per situs.

---

## 2. Aturan main tiap langkah (biar lolos gate)

Gate: **≥ 100 event, ≥ 5 detik, ≥ 6 fitur non-nol, dan ketikan asli** (bukan tempel/autofill).

- [ ] Gerakkan mouse (jangan diam).
- [ ] **Ketik di kotak search / form** — WAJIB. Ritme ketik adalah pembeda terkuat, dan
      langkah yang ketikannya ditempel tidak dihitung ke pendaftaran.
- [ ] Scroll naik-turun, klik 1–2 produk, pindah halaman.

Cek progres: panel (`data-panel`) atau console menampilkan `enrollment N/10`, atau lihat
dashboard.

---

## 3. Cara tes deteksi

**A. Pemilik (kamu, gaya normal)** — sesudah pendaftaran, lanjut beberapa langkah normal.
   → Harusnya mayoritas LOW. Wajar sekitar 1 dari 7 vonis minta verifikasi (14,5% di
   pengukuran); sesudah lolos verifikasi, MEDIUM tidak ditanya lagi 15 menit.

**B. Penyusup (orang lain, gaya beda)**:
   1. Buka **browser lain / incognito** (simulasi perangkat penyusup).
   2. Pakai akun & token yang sama.
   3. Pustaka menarik baseline pemilik dari server (perangkat baru, belum punya pendaftaran).
   4. Minta **orang lain** yang memakai.
   → Harusnya MEDIUM/HIGH, dan HIGH dua kali berturut = BLOCK_SESSION.

> **Jujur:** di pengukuran, 13,3% penyusup lolos vonis pertamanya dan 9,2% lolos seluruh
> sesinya; tidak ada penyusup yang lolos 6 sesi berturut. Jangan bertaruh pada satu sesi —
> jalankan 3–5 sesi penyusup dan laporkan rasionya.

---

## 4. Ekspektasi hasil

| Fase | Yang muncul | Normal? |
|---|---|---|
| Pendaftaran | LOW semua, `enrollment N/10` | ✅ belum dinilai |
| Pemilik sesudah daftar | Mayoritas LOW, sesekali MEDIUM | ✅ ~1 dari 7 vonis |
| Penyusup (perangkat lain) | Mayoritas MEDIUM/HIGH, kadang lolos LOW | ✅ ~1 dari 8 di vonis pertama |
| Bukti belum cukup | `UNKNOWN` / `ABSTAIN` | ✅ bukan "aman" |

Dashboard: buka `http://localhost:5055/dashboard`, tempel **`sk`** toko itu (bukan `pk`).

---

## 5. Checklist sebelum demo
- [ ] 3 situs punya kotak search / form input.
- [ ] Server jalan, 3 tenant terdaftar, `pk` + `sk` tercatat.
- [ ] Tag terpasang dengan `pk` + `userId` + `endpoint` + token (cek Network: ada POST /log 200).
- [ ] Sudah latihan: daftar → 1 langkah pemilik LOW → 1 sesi penyusup MEDIUM/HIGH.
- [ ] Perangkat/incognito kedua untuk peran penyusup.
- [ ] Kalimat limitasi: "lapisan verifikasi tambahan, bukan kunci absolut; ~1 dari 8
      penyusup lolos pemeriksaan pertama; peniruan terarah belum diuji."
