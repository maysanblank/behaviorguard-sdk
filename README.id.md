# BehaviorGuard

**Mendeteksi pengambilalihan akun dari cara seseorang menggerakkan mouse, mengetik, dan
berpindah halaman — seluruhnya di perangkat pengguna, lengkap dengan verifikasi tambahan
(step-up). Satu tag script. Tanpa backend.**

> English version: [README.md](README.md)

---

## Masalahnya

Login itu **pemeriksaan di pintu**, bukan **penjaga di dalam**. Password, OTP, sidik
perangkat — semuanya diperiksa sekali saat masuk. Sesudah itu semua dipercaya.

Justru di situ celahnya. Password bocor, cookie sesi dicuri, ekstensi browser jahat,
penipuan remote-access, laptop yang ditinggal terbuka: hasilnya sama — sesi yang **sudah
lolos pintu** tapi kini dipakai orang lain.

**BehaviorGuard membuat sesi itu terus diperiksa.** Ia mempelajari cara *pemilik akun ini*
memakai komputer — dinamika mouse, ritme ketikan, pola navigasi — lalu menilai ulang sesi
setiap 30 detik. Kalau perilakunya berhenti mirip pemilik, ia meminta verifikasi: tantangan
ritme-ketik bawaan, atau OTP/WebAuthn milik situs Anda.

Data interaksi mentah tidak pernah keluar dari browser. Huruf yang diketik tidak pernah
disimpan, bahkan di perangkat itu sendiri.

---

## Pasang dalam 30 detik

```html
<script src="dist/behaviorguard.js" data-user="andi@contoh.id" defer></script>
<script>
  addEventListener('behaviorguard:risk', e => {
    // e.detail = { level, score, action, reasons, topFeatures, ... }
    if (e.detail.level === 'HIGH') kunciCheckout();
  });
</script>
```

Itu seluruh integrasinya. Penangkapan event, penilaian, pendaftaran, latih ulang, dan popup
verifikasi berjalan sendiri.

**Sudah punya OTP / WebAuthn?** Matikan popup bawaan dan laporkan hasil verifikasi Anda:

```js
window.BehaviorGuardConfig = { mfa: { enabled: false } };
// ...saat vonis MEDIUM/HIGH, jalankan OTP Anda, lalu:
BehaviorGuard.reportStepUp({ passed: true });
```

**Sebelum aksi sensitif** (ganti email/sandi, transfer, tambah perangkat), minta vonis saat
itu juga:

```js
const v = BehaviorGuard.assessNow();
if (v.level !== 'LOW') mintaVerifikasi();   // UNKNOWN = bukti belum cukup -> tetap minta verifikasi
```

Panduan lengkap (modul ES, objek konfigurasi, server opsional):
[docs/QUICKSTART.md](docs/QUICKSTART.md). Panduan pasang berbahasa Indonesia:
[dist/PASANG.md](dist/PASANG.md).

---

## Yang terlihat

```
sesi 1-10      pendaftaran     belum ada vonis - model sedang mengenal pemilik
sesi 11+       LOW             ALLOW_SESSION
               MEDIUM          REQUIRE_MFA       -> minta verifikasi
               HIGH            REQUIRE_STEPUP    -> minta verifikasi
               HIGH 2x         BLOCK_SESSION     -> berturut-turut, bukan sekadar hari yang beda
               UNKNOWN         ABSTAIN           -> bukti belum cukup (TIDAK berarti aman)
```

Satu vonis butuh 150 event bukti. Sesudah pemilik lolos verifikasi, vonis MEDIUM tidak
bertanya lagi selama 15 menit (HIGH tetap bertanya, dan meninggalkan kursi 5 menit
membatalkannya).

---

## Hasil

Diukur pada **653 sesi dari 16 relawan** dengan menjalankan **pustaka yang dikirim itu
sendiri** (`node tools/eval_sdk.mjs --live`): tiap sesi riset diputar ulang lewat jalur
asli dari penangkapan sampai vonis, per jendela 30 detik persis seperti di browser. Tiap sesi
riset = satu kunjungan (muat halaman, status dibaca ulang dari penyimpanan). Pemilik
menjawab verifikasi lewat API publik `reportStepUp`. Penyusup = 15 relawan lain, masing-masing
datang lewat kunjungan baru ke akun pemilik.

| Pemilik | |
| --- | --- |
| Vonis yang meminta pemilik verifikasi | **14,5%** |
| Pemilik diblokir | **0%** |

| Penyusup (password curian, perangkat sendiri) | |
| --- | --- |
| Lolos vonis pertama tanpa gangguan | **13,3%** |
| Lolos **seluruh** sesinya tanpa gangguan | **9,2%** |
| Tidak pernah dinilai (sesinya terlalu pendek) | 0,6% |

| Ambil-alih (penyusup terus memakai akun, 6 sesi) | |
| --- | --- |
| Ketahuan di sesi pertama | **89,6%** |
| Ketahuan dalam 3 sesi | 98,3% |
| Tidak pernah ketahuan dalam 6 sesi | **0%** |

Daya pisah tanpa ambang, per pemilik: AUC **0,927**, EER **12,3%**.

### Memilih titik operasi

Satu knob: `init({ calibration: { k_low } })`. Makin kecil makin ketat.

| `k_low` | pemilik diminta verifikasi | penyusup lolos vonis-1 | penyusup lolos seluruh sesi | ambil-alih tak ketahuan |
| --- | ---: | ---: | ---: | ---: |
| 1,25 | 19,3% | 8,5% | 5,4% | 0% |
| 1,5 | 16,5% | 11,1% | 7,4% | 0% |
| **1,75 (default)** | **14,5%** | **13,3%** | **9,2%** | **0%** |
| 2,0 | 13,0% | 15,6% | 11,2% | 0,4% |
| 2,5 | 10,9% | 19,8% | 15,4% | 1,7% |

Default dipilih di 8 subjek dan diperiksa di 8 subjek lain (5 belahan acak), bukan
dipas-paskan ke tabel ini.

**Mode ketat (opt-in):** `session: { contextEvents: 450 }` — vonis berikutnya dalam satu
kunjungan ikut memakai bukti yang baru dinilai. Penyusup lolos vonis pertama 10,1% dan
seluruh sesi 8,2% dengan gesekan pemilik yang sama, tapi satu penyusup (dari 15) lolos 6
sesi di 3 akun, jadi tidak dijadikan default. Lihat [core/DRIFT.md](core/DRIFT.md) C-42.

### Membaca angka ini dengan jujur

- **Sekitar 1 dari 8 penyusup lolos pemeriksaan pertama.** Ini lapisan verifikasi tambahan,
  bukan gembok. HIGH artinya "suruh buktikan", bukan bukti penipuan. Aksi sensitif wajib
  `assessNow()`.
- **Penyusupnya 15 pengguna biasa, bukan penyerang yang sengaja meniru korban.** Peniruan
  terarah **belum diuji** — lihat [THREAT-MODEL.md](THREAT-MODEL.md).
- **Gesekan pemilik bukan derau acak.** Ia rata di semua jendela dalam satu kunjungan:
  pemilik ditandai pada *hari* ketika perilakunya memang beda, di semua jendela hari itu.
  Itu tidak bisa dirata-rata; itulah tugas verifikasi tambahan — dan karena itu lolos
  verifikasi kini memberi 15 menit tenang.
- **16 relawan itu sampel kecil.** Di populasi dan situs lain angka bisa bergeser beberapa
  poin.
- **Angka lama di repo ini mengukur mesin lain.** FRR 16,1% / FAR 5,4% berasal dari harness
  Python yang menilai sesi riset utuh (~700 event), satuan yang tak pernah dinilai pustaka;
  FRR 35,1% / FAR 0,9% berasal dari One-Class SVM scikit-learn yang tidak dikirim. Tabel di
  atas adalah pengukuran pertama atas pustaka yang benar-benar dipakai
  ([core/DRIFT.md](core/DRIFT.md) C-27, C-29).

---

## Satu otak, lima bahasa

| Runtime | Jangkauan | Konformansi |
| --- | --- | --- |
| JavaScript | browser, Node, edge | 255/255 |
| Python | server, data, ML | 255/255 |
| Rust | sistem, CLI, embedded | 255/255 |
| Java | JVM, **Android**, Kotlin | 255/255 |
| WASM | host WASM mana pun | 255/255 |

Algoritmanya ditulis sebagai spesifikasi yang lepas dari bahasa ([core/SPEC.md](core/SPEC.md)
v1.3.0), dan setiap implementasi dicek terhadap [core/golden.json](core/golden.json) yang
sama: 255 pemeriksaan, toleransi 1e-9. Nol dependensi di semua bahasa.

---

## Coba demonya

```bash
python -m http.server 8080
```

Buka <http://localhost:8080/demo/pemantau/>. Panel kiri adalah toko biasa **tanpa satu baris
kode BehaviorGuard pun**; panel kanan menempel dari luar dan menampilkan skor langsung.
Panduan lengkap: [demo/CARA-DEMO-PLUG-AND-PLAY.md](demo/CARA-DEMO-PLUG-AND-PLAY.md).

```bash
python core/conformance.py         # mesin vs golden.json            -> 255/255
node   core/lifecycle.test.mjs     # siklus hidup & API integrator   -> 49/49
node   core/privacy.test.mjs       # huruf ketikan tidak tersimpan   -> 10/10
python server/test_app.py          # server opsional: auth, XSS      -> 35/35
node   tools/eval_sdk.mjs --live   # ukur pustaka yang dikirim (butuh ekspor data riset lokal)
```

---

## Cara kerja singkat

```
event DOM -> buang kembar -> pendekkan jeda idle -> kumpulkan 150 event
         -> 28 fitur -> z-score vs pemilik -> IF 0,30 + Mahalanobis 0,70
         -> ambang per pemilik (mean - k*std) -> LOW / MEDIUM / HIGH + alasan
         -> cek rekam-ulang, lantai lengket, aturan HIGH berturut, absen, masa berlaku
         -> verifikasi (ritme ketik bawaan, atau OTP Anda lewat reportStepUp)
```

- **Pendaftaran** — 10 sesi layak pertama menjadi jangkar profil pemilik dan tidak pernah
  tergeser.
- **Hanya belajar dari yang tepercaya** — hanya jendela LOW atau yang lolos verifikasi yang
  boleh melatih model, supaya penyusup tidak bisa pelan-pelan "mengajari" sistem.
- **AFK** — jeda >= 15 detik dipendekkan, bukan dipotong. Absen 5 menit mereset
  kepercayaan; 15 menit meminta verifikasi ulang (serangan jam makan siang).
- **Rekam-ulang** — sesi yang hampir identik dengan sesi tersimpan divonis HIGH.

Detail: [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Privasi

Event mentah tidak pernah keluar perangkat, dan huruf yang diketik tidak pernah disimpan.
Profil disimpan lokal (IndexedDB -> localStorage -> memori). Tidak ada telemetri.

Server opsional ([server/README.md](server/README.md)) hanya menerima **28 angka fitur per
jendela** + vonis, dan hanya aktif kalau Anda memberi kunci publik, endpoint, **dan** token
pengguna berumur pendek yang dicetak backend Anda sendiri.

---

## Dokumentasi

| Dokumen | Isi |
| --- | --- |
| [docs/QUICKSTART.md](docs/QUICKSTART.md) | Semua cara integrasi dan konfigurasi |
| [dist/PASANG.md](dist/PASANG.md) | Panduan pasang satu tag (Indonesia) |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Pipeline, peta modul, keputusan desain |
| [THREAT-MODEL.md](THREAT-MODEL.md) | Batas kepercayaan, serangan yang belum tertutup |
| [core/DRIFT.md](core/DRIFT.md) | Audit C-1..C-43: tiap cacat, buktinya, dan ujinya |
| [core/SPEC.id.md](core/SPEC.id.md) | Spesifikasi mesin |

---

## Lisensi

MIT — lihat [LICENSE](LICENSE).
