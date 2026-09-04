# BehaviorGuard VPS — backend minimal (mode HYBRID)

Backend multi-tenant untuk deteksi ATO **lintas-device**. Yang disimpan: **vektor fitur
teragregasi** (baseline akun) + **verdict** (log). Event mentah TIDAK pernah masuk server.

Per **tenant** (kunci `pk`) + per **akun** (`userId`), **bukan** per device.

## Jalankan
```
pip install flask          # sqlite3 sudah bawaan Python
python server/app.py       # http://0.0.0.0:5055
```

## Alur pakai
1. **Daftar tenant** → dapat `pk`:
   ```
   curl -X POST http://localhost:5055/tenant -H "Content-Type: application/json" -d "{\"name\":\"Toko Andi\"}"
   ```
2. **Pasang SDK** di situs vendor dengan `data-pk` + `data-endpoint` (lihat `dist/PASANG.md`).
3. **Lihat dashboard** per akun: `http://localhost:5055/dashboard?pk=pk_xxx`

## Endpoint
| Method | Path | Auth | Fungsi |
|---|---|---|---|
| POST | `/tenant` | - | Daftar tenant → `{pk}` |
| GET | `/baseline?u=<userId>` | Bearer `pk` | Tarik baseline akun (dipanggil SDK saat login) |
| POST | `/baseline` `{userId,vectors}` | `pk` | Sync baseline akun (SDK unggah tiap enroll/retrain) |
| POST | `/log` `{pk,userId,level,score,...}` | `pk` | Kirim verdict |
| GET | `/dashboard?pk=<pk>` | - | Dashboard HTML per akun |

## Skema (sqlite `bg_server.db`)
- `tenants(pk, name, created_at)`
- `baselines(pk, user_id, vectors_json, updated_at)` — 1 baris per akun
- `logs(id, pk, user_id, level, score, action, reasons, ts, ip)`

## Catatan keamanan (jujur, demo-grade)
- **`pk` = publishable key** (kelihatan di klien). Siapa pun yg punya `pk` bisa tulis
  `/log` dan `/baseline` tenant itu → **risiko peracunan baseline**. Untuk produksi:
  gerbang tulis-baseline via **secret key sisi server aplikasi vendor** (server-to-server),
  bukan `pk` klien. `pk` cukup untuk kirim verdict + tarik baseline (read).
- Belum ada rate-limit/auth admin di `/tenant` & `/dashboard` — tambah sebelum publik.
- CORS `*` sengaja terbuka (SDK jalan di origin vendor mana pun); persempit bila perlu.

## Deploy VPS
Di belakang nginx + gunicorn: `gunicorn -w 2 -b 127.0.0.1:5055 app:app` (jalankan
`init_db()` sekali). Simpan `bg_server.db` di volume persisten atau ganti ke Postgres.
