#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
idle_ablation.py - mengukur berapa besar kerusakan yang ditimbulkan waktu idle,
dan berapa yang dipulihkan oleh segmentasi C-23. Memakai basis data riset yang
sama dengan reproduce_db.py, tetapi meng-ekstrak ulang fitur dari `raw_events`
supaya jeda idle bisa DISUNTIKKAN secara terkendali.

Kenapa perlu disuntikkan: sesi di basis data dikumpulkan lewat skenario bertugas,
jadi hampir tidak ada jeda panjang di dalamnya. Justru itu inti masalahnya -
model dilatih pada dunia yang padat, lalu dipakai di dunia yang penuh jeda.
Suntikan ini mensimulasikan dunia pemakaian, bukan mengarang data latih.

Tiga lengan, model dan ambang IDENTIK di ketiganya (hanya sesi UJI yang berbeda):
  BERSIH            sesi apa adanya                       - batas atas
  BERGAP (lama)     satu jeda AFK, dinilai sebagai 1 sesi - perilaku hari ini
  BERGAP + SEGMEN   jeda yang sama, dipecah per C-23      - perilaku sesudah tambalan

Jalankan:
  python research/idle_ablation.py
  python research/idle_ablation.py --gap-min 2 5 10 20 --afk-rate 1.0
"""
import argparse
import importlib.util
import math
import pathlib
import random
import sqlite3
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

_HERE = pathlib.Path(__file__).parent
_ROOT = _HERE.parent


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


bg = _load("bg_core", _ROOT / "core" / "bg_core.py")
rdb = _load("rdb", _HERE / "reproduce_db.py")

F4 = bg.F4
BASELINE = bg.DEFAULTS['baseline']
GAP_MS = 30_000   # = sdk/core/config.js session.idleGapSec (bg_core tak memuat kunci sesi)

EVENT_COLS = ['event_type', 'timestamp', 'x', 'y', 'velocity',
              'key', 'hold_time', 'scroll_delta', 'page_url']


# ---------------------------------------------------------------- pemuatan
def load_sessions(conn, uid):
    """[(session_id, [event...])] urut waktu, hanya sesi yang punya event."""
    sids = [r[0] for r in conn.execute(
        "SELECT session_id FROM sessions WHERE user_id=? ORDER BY start_time, session_id", (uid,))]
    out = []
    for sid in sids:
        rows = conn.execute(
            f"SELECT {','.join(EVENT_COLS)} FROM raw_events WHERE session_id=? ORDER BY timestamp, id",
            (sid,)).fetchall()
        if len(rows) < 30:
            continue
        evs = [dict(zip(EVENT_COLS, r)) for r in rows]
        for e in evs:
            e['timestamp'] = float(e['timestamp'] or 0)
        out.append((sid, evs))
    return out


# ------------------------------------------------- suntikan jeda + segmentasi
def pick_cut(events, rng):
    n = len(events)
    return rng.randint(int(n * 0.3), int(n * 0.7))


def inject_gap(events, gap_ms, cut):
    """Sisipkan SATU jeda AFK di indeks `cut`: pengguna berhenti di tengah, pergi,
    lalu kembali dan melanjutkan persis seperti sebelumnya. Semua event sesudahnya
    digeser maju; tidak ada event yang ditambah atau dibuang, jadi satu-satunya
    yang berubah adalah WAKTU - persis variabel yang dipersoalkan."""
    out = []
    for i, e in enumerate(events):
        e2 = dict(e)
        if i >= cut:
            e2['timestamp'] = e['timestamp'] + gap_ms
        out.append(e2)
    return out


def longest_half(events, cut):
    """Potongan yang akan dipilih segmentasi, TANPA jeda apa pun. Ini kontrol
    yang memisahkan dua efek yang gampang tertukar: (a) hilangnya jeda, dan
    (b) sesi jadi lebih pendek. Tanpa kontrol ini, kerugian karena sesi memendek
    bisa salah dibaca sebagai kerugian karena segmentasi."""
    a, b = events[:cut], events[cut:]
    return a if len(a) >= len(b) else b


def segment_by_idle(events, gap_ms=GAP_MS):
    """Padanan Python dari sdk/core/idle.js:segmentByIdle."""
    if not events:
        return []
    ev = sorted(events, key=lambda e: e.get('timestamp') or 0)
    segs, cur = [], [ev[0]]
    for i in range(1, len(ev)):
        if (ev[i]['timestamp'] - ev[i - 1]['timestamp']) >= gap_ms:
            segs.append(cur)
            cur = [ev[i]]
        else:
            cur.append(ev[i])
    segs.append(cur)
    return segs


def compress_idle(events, gap_ms):
    """Padanan Python dari sdk/core/idle.js:compressIdle (C-28).

    Tiap jeda >= gap_ms DIPENDEKKAN jadi gap_ms; tidak ada event yang dibuang dan
    sesi tidak dipecah. Beda dengan segment_by_idle: segmentasi memendekkan SESI
    (fitur-cacah ikut mengecil, C-24), kompresi hanya memendekkan WAKTU KOSONG."""
    ev = sorted(events, key=lambda e: e.get('timestamp') or 0)
    out, shift, prev = [], 0, None
    for e in ev:
        t = e.get('timestamp') or 0
        if prev is not None and t - prev >= gap_ms:
            shift += (t - prev) - gap_ms
        prev = t
        e2 = dict(e)
        e2['timestamp'] = t - shift
        out.append(e2)
    return out


def vec_of(events):
    return bg.features_to_vector(bg.extract_features(events))


def canonical_windows(events, k):
    """USULAN TAHAP 2 - jendela KANONIK: tiap segmen kontigu dipotong jadi jendela
    berukuran TETAP k event. Sisa di ekor dibuang (di SDK: dikembalikan ke buffer).

    Kenapa ini menyelesaikan masalah fitur-CACAH tanpa menyentuh SPEC. Sembilan
    fitur adalah hitungan mentah yang membesar bersama panjang sesi, jadi setiap
    perubahan panjang terbaca sebagai perubahan identitas. Ada dua cara memperbaiki:
      (a) ubah rumusnya jadi laju (cacah/durasi) -> SPEC v1.3, regenerasi golden,
          sinkron 4 port, dan semua angka lama kehilangan reprodusibilitas;
      (b) buat panjangnya KONSTAN, sehingga cacahan otomatis sebanding.
    (b) tidak menyentuh satu baris pun rumus fitur. Cacahan berubah makna jadi
    KOMPOSISI ("dari k event, berapa yang klik") dan `temporal_session_duration`
    berubah makna jadi KECEPATAN ("berapa lama menghasilkan k event") - yang justru
    lebih biometrik daripada "sesinya kebetulan sepanjang apa".

    Syarat mutlak: kanonikalisasi harus dipakai di PENDAFTARAN dan PENILAIAN.
    Kalau cuma di salah satu, kita cuma menukar satu ketidakcocokan dengan yang lain.
    """
    out = []
    for seg in segment_by_idle(events):
        out.extend(plain_windows(seg, k))
    return out


def plain_windows(events, k):
    """Jendela kanonik TANPA sadar-idle: dipotong lurus tiap k event. Dipakai
    lengan 'bergap tanpa segmentasi' supaya yang dibandingkan benar-benar cuma
    segmentasinya, bukan segmentasi + kanonikalisasi sekaligus."""
    return [events[i:i + k] for i in range(0, len(events) - k + 1, k)]


def vec_segmented(events, min_events=30):
    """C-23 di jalur evaluasi: nilai segmen kontigu TERPANJANG yang layak.
    (SDK menilai SEMUA segmen layak; di sini satu vonis per sesi supaya bisa
    dibandingkan satu-lawan-satu dengan lengan lain.)"""
    segs = [s for s in segment_by_idle(events) if len(s) >= min_events]
    if not segs:
        return None
    return vec_of(max(segs, key=len))


# Kelompok fitur menurut CARA fitur itu bisa dirusak waktu. Dipakai untuk
# mendiagnosis lengan mana merusak apa (bukan untuk skoring).
G_WAKTU  = ['mouse_click_interval_mean', 'keystroke_flight_time_mean',
            'keystroke_typing_speed', 'temporal_session_duration',
            'keystroke_cross_field_cadence', 'form_field_switch_rate']
G_CACAH  = ['mouse_direction_changes', 'mouse_pause_count', 'keystroke_burst_count',
            'temporal_activity_bursts', 'nav_page_count', 'nav_step_transition_count',
            'form_focus_count', 'form_blur_count', 'cart_action_count']
G_BENTUK = [f for f in F4 if f not in G_WAKTU and f not in G_CACAH]


def mean_abs_z(model, vec, cols):
    xs = bg.standardize(vec, model['stats'])
    idx = [F4.index(c) for c in cols]
    return sum(abs(xs[i]) for i in idx) / len(idx)


# ---------------------------------------------------------------- evaluasi
def build_owner_model(train_vecs, holdout=0.0):
    """holdout>0: ambang dikalibrasi pada bagian kolam yang TIDAK dipakai memfit.

    Kenapa ini penting. `build_model` mengkalibrasi ambang dari skor vektor yang
    persis dipakai memfit detektornya. Skor in-sample selalu optimistik - model
    memang dipas-paskan ke titik-titik itu - sehingga ambangnya terlalu rapat, dan
    sesi PEMILIK berikutnya (yang di luar sampel) jatuh di luar ambang. Itu bukan
    teori: pola yang sama sudah pernah menghantam proyek ini di C-22, di mana
    kovarians Mahalanobis yang overfit membuat pemilik divonis MEDIUM selamanya.

    Menyisihkan sebagian kolam khusus untuk kalibrasi membuat ambang mencerminkan
    sebaran skor PEMILIK DI LUAR SAMPEL - yaitu persis populasi yang akan dinilai."""
    cfg = dict(bg.DEFAULTS)
    n = len(train_vecs)
    # shrink adaptif, sama dengan behaviorguard._rebuildModel (C-22)
    cfg = {**cfg, 'mahalanobis': {'shrink': min(0.9, max(bg.DEFAULTS['mahalanobis']['shrink'],
                                                         len(F4) / max(1, n)))}}
    cut = int(len(train_vecs) * (1 - holdout)) if holdout > 0 else len(train_vecs)
    fit_part = train_vecs[:cut] if cut >= 8 else train_vecs
    calib_part = train_vecs[cut:] if cut >= 8 and len(train_vecs) - cut >= 4 else None
    m = bg.build_model(fit_part, cfg)
    if calib_part:
        oos = [m['ensemble'].score_one(bg.standardize(v, m['stats'])) for v in calib_part]
        m['thresholds'] = bg.calibrate_thresholds_parametric(
            oos, bg.DEFAULTS['k_low'], bg.DEFAULTS['k_med_extra'])
    # skor kolam (URUT) untuk kalibrasi ambang agregat
    sc = [m['ensemble'].score_one(bg.standardize(v, m['stats'])) for v in (calib_part or train_vecs)]
    mu = sum(sc) / len(sc)
    var = sum((x - mu) ** 2 for x in sc) / len(sc)
    m['train_mu'] = mu
    m['train_sd'] = math.sqrt(var) if var > 1e-12 else 1.0
    m['train_scores'] = sc          # URUT: dipakai kalibrasi ambang agregat
    return m


def agg_thresholds(model, M):
    """Ambang untuk vonis atas RATA-RATA M jendela - dikalibrasi EMPIRIS.

    Godaannya adalah memakai jalan pintas analitik: rata-rata M skor bebas punya
    simpangan baku std/sqrt(M), jadi rapatkan ambang dengan faktor itu. Jalan
    pintas itu SALAH di sini, dan salahnya searah: jendela berurutan dari sesi yang
    sama berkorelasi, jadi simpangan baku sesungguhnya lebih besar dari std/sqrt(M).
    Ambang jadi terlalu rapat dan pemilik ditolak - persis pola C-22, yaitu ambang
    yang dikalibrasi optimistik lalu meledak di luar sampel.

    Yang benar: agregasikan skor LATIH dengan cara yang persis sama seperti skor
    uji akan diagregasi, lalu kalibrasi parametrik di atas hasilnya. Korelasi apa
    pun yang ada ikut terbawa dengan sendirinya, tanpa perlu diasumsikan."""
    sc = model['train_scores']
    if M <= 1 or len(sc) < M:
        return model['thresholds']
    agg = [sum(sc[i:i + M]) / M for i in range(0, len(sc) - M + 1)]
    return bg.calibrate_thresholds_parametric(agg, bg.DEFAULTS['k_low'],
                                              bg.DEFAULTS['k_med_extra'])


def verdicts(model, vecs, M):
    """[(skor, level)] - satu vonis per M jendela berturut (M=1: per jendela)."""
    scores = [model['ensemble'].score_one(bg.standardize(v, model['stats'])) for v in vecs]
    if M <= 1:
        return [(sc, bg.to_risk(sc, model['thresholds'])) for sc in scores]
    thr = agg_thresholds(model, M)
    out = []
    for i in range(0, len(scores) - M + 1, M):
        avg = sum(scores[i:i + M]) / M
        out.append((avg, bg.to_risk(avg, thr)))
    return out


def main():
    ap = argparse.ArgumentParser(description="Ablasi waktu idle (C-23)")
    ap.add_argument('--db', help='override path DB')
    ap.add_argument('--gap-min', type=float, nargs='+', default=[2, 5, 10, 20],
                    help='panjang jeda AFK yang disimulasikan, dalam menit')
    ap.add_argument('--afk-rate', type=float, default=1.0,
                    help='porsi sesi uji yang kena jeda (1.0 = semua)')
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--min-sessions', type=int, default=14)
    ap.add_argument('--canonical', type=int, default=0, metavar='K',
                    help='jendela kanonik K event, dipakai di pendaftaran DAN penilaian '
                         '(0 = mati, perilaku hari ini)')
    ap.add_argument('--holdout-calib', type=float, default=0.0, metavar='FRAC',
                    help='porsi kolam yang disisihkan untuk kalibrasi ambang di luar sampel')
    ap.add_argument('--aggregate', type=int, default=1, metavar='M',
                    help='satu vonis per M jendela berturut (1 = per jendela)')
    ap.add_argument('--max-train-win', type=int, default=3,
                    help='maks jendela kanonik per sesi pendaftaran (jaga ukuran kolam)')
    args = ap.parse_args()

    db = args.db or rdb.find_db()
    if not db:
        print("DB tidak ditemukan. Beri --db /path/ke/behavior_detection.db")
        return 1
    conn = sqlite3.connect(db)
    print(f"DB: {db}")
    print(f"Jeda AFK disimulasikan: {args.gap_min} menit | porsi sesi kena jeda: {args.afk_rate:.0%}")
    print(f"Ambang segmentasi: idleGapSec = {GAP_MS // 1000} dtk | baseline = {BASELINE} sesi\n")

    uids = [r[0] for r in conn.execute("SELECT id FROM users ORDER BY id")]
    subjects = []
    for uid in uids:
        s = load_sessions(conn, uid)
        if len(s) >= args.min_sessions:
            subjects.append((uid, s))
    print(f"Subjek terpakai: {len(subjects)} (≥{args.min_sessions} sesi berevent)\n")

    arms = ['bersih', 'potong_saja', 'bergap_lama', 'bergap_segmen']
    owner_tot = {a: 0 for a in arms}
    owner_nonlow = {a: 0 for a in arms}
    owner_scores = {a: [] for a in arms}
    imp_tot = {a: 0 for a in arms}
    imp_low = {a: 0 for a in arms}
    imp_scores = {a: [] for a in arms}
    no_segment = 0   # sesi yang setelah dipecah tak punya segmen layak -> ABSTAIN
    zsum = {a: {'waktu': 0.0, 'cacah': 0.0, 'bentuk': 0.0, 'n': 0} for a in arms}

    # cache vektor bersih per sesi (dipakai juga sebagai penyusup untuk subjek lain)
    clean_cache = {}

    def train_vecs_for(sess):
        if not args.canonical:
            return [vec_of(evs) for _, evs in sess[:BASELINE]]
        out = []
        for _, evs in sess[:BASELINE]:
            for w in canonical_windows(evs, args.canonical)[:args.max_train_win]:
                out.append(vec_of(w))
        return out or [vec_of(sess[0][1])]

    def vecs_whole(events):
        """Tanpa sadar-idle: satu vektor untuk seluruh aliran (mode lama), atau
        jendela kanonik yang dipotong lurus menembus jeda (mode kanonik)."""
        if not args.canonical:
            return [vec_of(events)]
        return [vec_of(w) for w in plain_windows(events, args.canonical)]

    def vecs_idle_aware(events):
        """Sadar-idle: segmen terpanjang (mode lama), atau jendela kanonik yang
        tidak pernah menembus jeda (mode kanonik)."""
        if not args.canonical:
            v = vec_segmented(events)
            return [v] if v is not None else []
        return [vec_of(w) for w in canonical_windows(events, args.canonical)]

    for uid, sess in subjects:
        train = train_vecs_for(sess)
        model = build_owner_model(train, args.holdout_calib)
        rng = random.Random(args.seed + uid)

        for sid, evs in sess[BASELINE:]:
            gap_ms = rng.choice(args.gap_min) * 60_000 if rng.random() < args.afk_rate else 0
            # SATU titik potong dan SATU panjang jeda dipakai semua lengan; kalau
            # tidak, yang dibandingkan bukan lagi perlakuannya melainkan suntikannya.
            cut = pick_cut(evs, rng)
            gapped = inject_gap(evs, gap_ms, cut) if gap_ms else evs
            variants = {
                'bersih': vecs_idle_aware(evs),
                'potong_saja': vecs_idle_aware(longest_half(evs, cut)),
                'bergap_lama': vecs_whole(gapped),
                'bergap_segmen': vecs_idle_aware(gapped),
            }
            clean_cache[sid] = (uid, variants['bersih'])
            for a in arms:
                vs = [v for v in variants[a] if v is not None]
                if not vs:
                    no_segment += 1
                    continue        # ABSTAIN: tidak dihitung sebagai vonis salah
                for sc, lvl in verdicts(model, vs, args.aggregate):
                    owner_tot[a] += 1
                    owner_scores[a].append(sc)
                    if lvl != 'LOW':
                        owner_nonlow[a] += 1
                for v in vs:
                    zsum[a]['waktu'] += mean_abs_z(model, v, G_WAKTU)
                    zsum[a]['cacah'] += mean_abs_z(model, v, G_CACAH)
                    zsum[a]['bentuk'] += mean_abs_z(model, v, G_BENTUK)
                    zsum[a]['n'] += 1

    # --- FAR: penyusup = sesi subjek lain, DIUJI dengan lengan yang sama --------
    for uid, sess in subjects:
        model = build_owner_model(train_vecs_for(sess), args.holdout_calib)
        rng = random.Random(args.seed * 7 + uid)
        for other_uid, other_sess in subjects:
            if other_uid == uid:
                continue
            for sid, evs in other_sess[BASELINE:][:4]:      # 4 sesi/penyusup, jaga waktu
                gap_ms = rng.choice(args.gap_min) * 60_000 if rng.random() < args.afk_rate else 0
                cut = pick_cut(evs, rng)
                gapped = inject_gap(evs, gap_ms, cut) if gap_ms else evs
                variants = {
                    'bersih': clean_cache.get(sid, (None, None))[1] or vecs_idle_aware(evs),
                    'potong_saja': vecs_idle_aware(longest_half(evs, cut)),
                    'bergap_lama': vecs_whole(gapped),
                    'bergap_segmen': vecs_idle_aware(gapped),
                }
                for a in arms:
                    vs = [v for v in variants[a] if v is not None]
                    for sc, lvl in verdicts(model, vs, args.aggregate):
                        imp_tot[a] += 1
                        imp_scores[a].append(sc)
                        if lvl == 'LOW':
                            imp_low[a] += 1

    # --- laporan ---------------------------------------------------------------
    label = {'bersih': 'BERSIH (sesi utuh, tanpa jeda)',
             'potong_saja': 'KONTROL: dipotong saja, tanpa jeda',
             'bergap_lama': 'BERGAP, tanpa segmentasi (hari ini)',
             'bergap_segmen': 'BERGAP, dengan segmentasi (C-23)'}
    print(f"{'Lengan':38} {'FRR':>8} {'FAR':>8} {'AUC':>7} {'EER':>7}   n_own  n_imp")
    print("-" * 90)
    for a in arms:
        frr = owner_nonlow[a] / owner_tot[a] * 100 if owner_tot[a] else float('nan')
        far = imp_low[a] / imp_tot[a] * 100 if imp_tot[a] else float('nan')
        m = rdb.roc(owner_scores[a], imp_scores[a])
        auc, eer = m['auc'], m['eer']
        print(f"{label[a]:38} {frr:7.1f}% {far:7.1f}% {auc:7.3f} {eer:6.1f}%  "
              f"{owner_tot[a]:5d}  {imp_tot[a]:5d}")

    print()
    print("Diagnosis: rata-rata |z| terhadap baseline pemilik, per kelompok fitur")
    print(f"{'Lengan':38} {'fitur-WAKTU':>12} {'fitur-CACAH':>12} {'fitur-BENTUK':>13}")
    print("-" * 90)
    for a in arms:
        n = max(1, zsum[a]['n'])
        print(f"{label[a]:38} {zsum[a]['waktu']/n:12.2f} {zsum[a]['cacah']/n:12.2f} "
              f"{zsum[a]['bentuk']/n:13.2f}")
    print()
    print("  fitur-WAKTU  = selisih/durasi (interval klik, flight, kecepatan ketik, durasi, ...)")
    print("  fitur-CACAH  = hitungan mentah yang ikut membesar bersama panjang sesi")
    print("  fitur-BENTUK = bentuk gerakan/ritme, tidak bergantung panjang sesi")
    print()
    print(f"Sesi tanpa segmen layak setelah dipecah: {no_segment} (di SDK -> ABSTAIN, bukan vonis)")
    print()
    print("CARA MEMBACA")
    print("  * BERGAP vs BERSIH pada kolom fitur-WAKTU = kerusakan yang dipersoalkan.")
    print("  * BERGAP+SEGMEN vs KONTROL = ongkos segmentasi itu sendiri. Kalau dua baris")
    print("    ini berhimpit, segmentasi memulihkan jeda TANPA menambah kerusakan baru;")
    print("    selisih KONTROL vs BERSIH adalah efek 'sesi jadi lebih pendek', yang ada")
    print("    dengan atau tanpa idle dan harus ditangani terpisah (normalisasi laju).")
    print()
    print("BATAS SKRIP INI (wajib disebut kalau angkanya dikutip)")
    print("  Angka FRR/FAR absolut di sini BUKAN angka headline skripsi: model dibangun")
    print("  dari 10 sesi baseline tanpa protokol held-out/prequential reproduce_db.py,")
    print("  jadi titik operasinya jauh lebih longgar. Yang sahih dibaca dari tabel ini")
    print("  hanya SELISIH ANTAR-LENGAN, karena keempatnya memakai model & ambang yang")
    print("  persis sama. Jeda juga disuntik sintetis dengan asumsi pengguna melanjutkan")
    print("  perilaku yang sama sesudah kembali; ini mengisolasi efek WAKTU, bukan")
    print("  pengganti uji lapangan.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
