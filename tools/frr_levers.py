#!/usr/bin/env python3
"""frr_levers.py - mengukur tuas-tuas yang bisa menurunkan FRR, di bawah protokol
held-out yang sama dengan reproduce_db.py.

Latar: 5-belahan memberi FRR 23% pada FAR 2% (core/DRIFT.md). Itu tidak layak kirim.
Diagnosis dua langkah lebih dulu:
  (1) FRR menyebar rata di semua subjek (11%..56%), bukan segelintir subjek rusak
      -> ini masalah sistemik, bukan data kotor.
  (2) Dengan ambang ORACLE (dipilih setelah melihat jawabannya), FRR pada FAR<=2%
      masih 20,6%. Jadi kalibrasi ambang menyumbang ~13 poin (33,9->20,6) dan
      GRATIS, tapi 20,6% sisanya adalah batas SKOR-nya - perlu skor yang lebih baik.

Tuas yang diuji, masing-masing bisa dinyalakan sendiri:

  znorm   Normalisasi kohort (z-norm). Skor mentah tiap orang punya skala sendiri -
          terlihat dari selisih oracle global (28,6%) vs oracle per-pengguna (20,6%):
          8 poin hilang HANYA karena satu ambang dipaksa muat untuk semua skala.
          z-norm membagi skor dengan sebaran skor KOHORT (subjek lain, DISJOIN dari
          subjek FAR supaya tidak bocor), jadi skor jadi sebanding antar orang.
          Praktik baku di verifikasi pembicara; di sini gratis karena kohortnya sudah
          dihitung protokolnya untuk cek konvergensi.

  loo     Kalibrasi leave-one-out. Ambang lama dihitung dari skor vektor yang PERSIS
          dipakai memfit model -> skor in-sample optimistik -> ambang ketat -> sesi
          pemilik berikutnya jatuh di luar. LOO menilai tiap vektor kolam dengan model
          yang difit TANPA vektor itu. Bedanya dengan `calib_holdout` yang dicoba
          sebelumnya: holdout MENGECILKAN kolam fit (fatal saat n=10..30), LOO tidak -
          model akhir tetap memakai seluruh kolam.

  topk    Pengurangan dimensi. d=28 fitur dengan n=10..30 sampel: kovarians tidak
          pernah stabil. Fitur dipilih di FOLD-TUNE saja (rasio sebaran antar-subjek
          lawan dalam-subjek), lalu dipakai apa adanya di FOLD-REPORT.

  agg     Agregasi beberapa jendela. Saat ini satu sesi = satu vektor = satu vonis.
          Merata-ratakan skor k jendela menurunkan sebaran skor pemilik ~1/sqrt(k)
          sementara jarak ke penyusup tetap. Tuas paling baku di autentikasi kontinu,
          dan knob-nya SUDAH ada di sdk (`aggregateWindows`, default 1).

Jalankan: python tools/frr_levers.py --levers none znorm loo znorm+loo
"""
import argparse, math, random, sqlite3, sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'core'))
import reproduce_db as rdb

BASELINE, STEP, WINDOW, MAX_POOL = 10, 6, 6, 30


def _signed_log(v):
    """Kompresi ekor. Fitur seperti kecepatan, jeda klik dan durasi berekor sangat
    panjang: satu sesi ekstrem menggeser mean/std kolam yang cuma 10..30 sampel, dan
    seluruh penggaris ikut melenceng. sign(x)*log1p(|x|) itu monoton, jadi tidak ada
    informasi urutan yang hilang - hanya skalanya yang dijinakkan."""
    return [math.copysign(math.log1p(abs(x)), x) for x in v]


def _robust_stats(vecs):
    """Median + MAD, pengganti mean + std. Dengan n=10..30, SATU sesi menyimpang
    sudah cukup menggelembungkan std sehingga penyusup ikut terlihat wajar, atau
    menggeser mean sehingga pemilik terlihat menyimpang. Median/MAD tahan itu."""
    d = len(vecs[0])
    med, mad = [0.0] * d, [1.0] * d
    for i in range(d):
        col = sorted(v[i] for v in vecs)
        n = len(col)
        m = col[n // 2] if n % 2 else (col[n // 2 - 1] + col[n // 2]) / 2
        dev = sorted(abs(v[i] - m) for v in vecs)
        a = dev[n // 2] if n % 2 else (dev[n // 2 - 1] + dev[n // 2]) / 2
        med[i] = m
        mad[i] = max(a * 1.4826, 1e-3)
    return med, mad


def _fit(pool_vecs, feature_cols, weights, use_real, robust=False, scorer='ens',
         cohort_vecs=None):
    """Kembalikan ens_fn mentah untuk satu kolam. Disalin dari build() di
    reproduce_db.run_fold - dipisah supaya LOO bisa memanggilnya berulang.

    scorer:
      'ens'    IsolationForest + OCSVM, persis acuan.
      'knn'    jarak ke k tetangga terdekat di kolam. Dengan n=10..30 dan d=28,
               model kepadatan tidak punya cukup sampel untuk menaksir bentuk;
               jarak ke tetangga tidak menaksir bentuk apa pun.
      'cohort' PEMBEDA dua kelas: kolam pemilik lawan kohort orang lain. Selama ini
               sistemnya satu-kelas - hanya melihat contoh pemilik, tidak pernah
               contoh 'bukan pemilik' - padahal datanya ADA. Ini yang membuat
               verifikasi suara dan wajah bekerja, dan belum pernah dicoba di sini.
               Kohortnya WAJIB disjoin dari subjek pengukur FAR.
    """
    if robust:
        pool_vecs = [_signed_log(v) for v in pool_vecs]
        if cohort_vecs:
            cohort_vecs = [_signed_log(v) for v in cohort_vecs]
    pre = _signed_log if robust else (lambda v: v)

    if scorer == 'maha':
        # MESIN YANG SEBENARNYA DIKIRIM. reproduce_db.py memakai sklearn OneClassSVM,
        # tapi sdk/core/config.js memakai model2:'mahalanobis' DAN bobot terbalik
        # (IF 0.30 / slot-svm 0.70, bukan 0.70/0.30). Jadi seluruh angka yang diukur
        # lewat reproduce_db mengukur mesin yang TIDAK dikirim ke pengguna.
        # bg_core.Mahalanobis adalah padanan bit-per-bit dari mahalanobis.js, jadi di
        # sini dipakai kelas itu langsung, bukan tiruan.
        # Shrinkage ADAPTIF direplikasi dari behaviorguard._rebuildModel (C-22):
        #   min(0.9, max(0.3, d/n)) — makin sedikit sampel, makin berat regularisasi.
        from bg_core import Mahalanobis
        stats = _robust_stats(pool_vecs) if robust else rdb.compute_stats(pool_vecs)
        Xs = [rdb.standardize(v, stats) for v in pool_vecs]
        d = len(feature_cols)
        shrink = min(0.9, max(0.3, d / max(1, len(pool_vecs))))
        det2 = Mahalanobis(shrink=shrink, n_features=d)
        det2.fit(Xs)
        iff = rdb.IF()
        iff.fit(Xs)
        gw = rdb.gate_weights(weights, len(pool_vecs))
        m1, s1 = rdb.score_stats([iff.score_one(x) for x in Xs])
        if gw['svm'] == 0:
            return lambda v: (iff.score_one(rdb.standardize(pre(v), stats)) - m1) / s1
        m2, s2 = rdb.score_stats([det2.score_one(x) for x in Xs])

        def maha(v):
            x = rdb.standardize(pre(v), stats)
            return gw['isolation_forest'] * ((iff.score_one(x) - m1) / s1) + \
                   gw['svm'] * ((det2.score_one(x) - m2) / s2)
        return maha

    if scorer == 'knn':
        stats = _robust_stats(pool_vecs) if robust else rdb.compute_stats(pool_vecs)
        P = [rdb.standardize(v, stats) for v in pool_vecs]
        k = max(1, min(3, len(P) - 1))

        def knn(v):
            x = rdb.standardize(pre(v), stats)
            d = sorted(sum((x[i] - p[i]) ** 2 for i in range(len(x))) ** 0.5 for p in P)
            return -sum(d[:k]) / k          # makin dekat = makin normal
        return knn

    if scorer == 'cohort':
        if not cohort_vecs or not rdb.SKLEARN:
            scorer = 'ens'
        else:
            from sklearn.linear_model import LogisticRegression
            stats = _robust_stats(pool_vecs) if robust else rdb.compute_stats(pool_vecs)
            X = [rdb.standardize(v, stats) for v in pool_vecs] + \
                [rdb.standardize(v, stats) for v in cohort_vecs]
            y = [1] * len(pool_vecs) + [0] * len(cohort_vecs)
            # C kecil + class_weight seimbang: positifnya cuma 10..30 lawan ratusan
            # negatif, dan tanpa regularisasi kuat d=28 bisa dipisahkan sempurna
            # (overfit total).
            clf = LogisticRegression(C=0.05, class_weight='balanced', max_iter=2000)
            clf.fit(X, y)

            def coh(v):
                return float(clf.decision_function([rdb.standardize(pre(v), stats)])[0])
            return coh

    stats = _robust_stats(pool_vecs) if robust else rdb.compute_stats(pool_vecs)
    _std0 = rdb.standardize
    Xstd = [_std0(v, stats) for v in pool_vecs]
    iff = rdb.IF()
    iff.fit(Xstd)
    gw = rdb.gate_weights(weights, len(pool_vecs))
    if gw['svm'] == 0:
        m1, s1 = rdb.score_stats([iff.score_one(x) for x in Xstd])
        return lambda v: (iff.score_one(_std0(pre(v), stats)) - m1) / s1
    ocs = rdb.RealOCSVM(len(feature_cols)) if (rdb.SKLEARN and use_real) else rdb.OCSVM(len(feature_cols))
    ocs.fit(Xstd)
    m1, s1 = rdb.score_stats([iff.score_one(x) for x in Xstd])
    m2, s2 = rdb.score_stats([ocs.score_one(x) for x in Xstd])

    def ens(v):
        x = _std0(pre(v), stats)
        return gw['isolation_forest'] * ((iff.score_one(x) - m1) / s1) + \
               gw['svm'] * ((ocs.score_one(x) - m2) / s2)
    return ens


def _msd(xs):
    if not xs:
        return 0.0, 1.0
    m = sum(xs) / len(xs)
    var = sum((x - m) ** 2 for x in xs) / max(len(xs) - 1, 1)
    return m, math.sqrt(var) or 1.0


def _halves(subject_ids, uid, salt):
    other = [x for x in subject_ids if x != uid]
    if not other:
        return set(), set()
    r = random.Random(hash(tuple(sorted(other))) + salt)
    sh = list(other)
    r.shuffle(sh)
    return set(sh[:len(sh) // 2]), set(sh[len(sh) // 2:])


def _cohort_split(subject_ids, uid):
    """Tiga himpunan, dan pemisahannya PENTING supaya angkanya sah.

    - far_ids     : penyusup pengukur FAR. Belahan seed-99 paruh KEDUA, PERSIS seperti
                    reproduce_db - supaya baseline di sini bisa diadu langsung dengan
                    angka acuan dan harness-nya terbukti benar sebelum tuas dipasang.
    - conv_ids    : kohort pengecek konvergensi. Belahan seed-42 paruh PERTAMA, juga
                    persis reproduce_db.
    - znorm_ids   : kohort penormal skor = paruh PERTAMA dari belahan seed-99, yaitu
                    KOMPLEMEN far_ids. Harus disjoin dari far_ids: menormalkan skor
                    dengan subjek yang sama yang dipakai mengukur FAR itu kebocoran,
                    dan angkanya jadi tidak berarti.
    """
    conv_ids, _ = _halves(subject_ids, uid, 42)
    znorm_ids, far_ids = _halves(subject_ids, uid, 99)
    return conv_ids, znorm_ids, far_ids


def pick_features(conn, tune_ids, k, vec_source=None):
    """F-ratio: sebaran antar-subjek / sebaran dalam-subjek. Dihitung HANYA di
    FOLD-TUNE, jadi FOLD-REPORT tetap held-out."""
    cols = rdb.F4
    per = {}
    for uid in tune_ids:
        if vec_source is not None:
            per[uid] = [list(v) for v, _ in vec_source.get(uid, [])]
        else:
            q = ','.join('f.' + f for f in cols)
            per[uid] = [list(r) for r in conn.execute(
                f"SELECT {q} FROM features f JOIN sessions s USING(session_id) WHERE s.user_id=?", (uid,))]
    scored = []
    for j, name in enumerate(cols):
        mus, withins = [], []
        for uid, vs in per.items():
            if len(vs) < 3:
                continue
            m, sd = _msd([v[j] for v in vs])
            mus.append(m)
            withins.append(sd)
        if len(mus) < 3:
            continue
        _, between = _msd(mus)
        within = sum(withins) / len(withins) or 1e-9
        scored.append((between / within, name))
    scored.sort(reverse=True)
    return [n for _, n in scored[:k]]


def run_fold(conn, subject_ids, weights, q_low, feature_cols=None, use_real=True,
             vec_source=None, znorm=False, loo=False, agg=1, eval_from=0,
             robust=False, scorer='ens'):
    """eval_from: indeks sesi paling awal yang BOLEH masuk hitungan FRR.

    Wajib dipakai saat membandingkan panjang pendaftaran. Menaikkan BASELINE dari 10
    ke 16 memindahkan sesi 10..15 dari 'diuji' ke 'mendaftar' — jadi himpunan ujinya
    ikut berubah, dan sesi-sesi awal itu justru yang paling sulit (model masih naif,
    pengguna belum mapan). Tanpa eval_from, sebagian 'perbaikan' hanyalah efek
    membuang soal tersulit dari ujian. Sesi sebelum eval_from tetap dinilai dan tetap
    boleh menumbuhkan kolam — hanya tidak dihitung."""
    if feature_cols is None:
        feature_cols = rdb.F4
    idx = [rdb.F4.index(f) for f in feature_cols]
    sel = lambda v: [v[i] for i in idx]

    totalOwner = ownerNonLow = ownerHigh = totalImp = impLow = convs = 0
    owner_scores, imp_scores = [], []

    for uid in subject_ids:
        if vec_source is not None:
            vecs = [sel(list(v)) for v, _ in vec_source.get(uid, [])]
            ecounts = [e for _, e in vec_source.get(uid, [])]
        else:
            q = ','.join('f.' + f for f in rdb.F4)
            rows = conn.execute(
                f"SELECT s.event_count, {q} FROM features f JOIN sessions s USING(session_id) "
                f"WHERE s.user_id=? ORDER BY s.session_id", (uid,)).fetchall()
            vecs = [sel(list(r[1:])) for r in rows]
            ecounts = [r[0] for r in rows]
        if len(vecs) <= BASELINE:
            continue

        conv_ids, znorm_ids, far_ids = _cohort_split(subject_ids, uid)

        def fetch(ids):
            if not ids:
                return []
            if vec_source is not None:
                return [sel(list(v)) for x in ids for v, _ in vec_source.get(x, [])]
            q = ','.join('f.' + f for f in rdb.F4)
            ql = ','.join(str(x) for x in ids)
            return [sel(list(r)) for r in conn.execute(
                f"SELECT {q} FROM features f JOIN sessions s USING(session_id) WHERE s.user_id IN ({ql})")]
        conv_vecs = fetch(conv_ids)
        cohort_vecs = fetch(znorm_ids)

        def is_eligible(vec, ec):
            nz = sum(1 for v in vec if abs(v) > 1e-9)
            dur = vec[feature_cols.index('temporal_session_duration')] \
                if 'temporal_session_duration' in feature_cols else 10.0
            return (ec or 0) >= 100 and dur >= 5.0 and nz >= 6

        def build(pool_vecs, qq):
            base_n = min(BASELINE, len(pool_vecs))
            low_part = pool_vecs[base_n:]
            if len(low_part) > MAX_POOL - base_n:
                low_part = low_part[-(MAX_POOL - base_n):]
            pv = pool_vecs[:base_n] + rdb.dedup_behavioral(low_part, feature_cols)
            if not pv:
                pv = vecs[:1]
            ens = _fit(pv, feature_cols, weights, use_real,
                       robust=robust, scorer=scorer, cohort_vecs=cohort_vecs)
            if znorm and cohort_vecs:
                cm, cs = _msd([ens(v) for v in cohort_vecs])
                ens = (lambda _r, _m, _s: (lambda v: (_r(v) - _m) / _s))(ens, cm, cs)
            if loo and len(pv) >= 12:
                base = []
                for i in range(len(pv)):
                    e2 = _fit(pv[:i] + pv[i + 1:], feature_cols, weights, use_real,
                              robust=robust, scorer=scorer, cohort_vecs=cohort_vecs)
                    if znorm and cohort_vecs:
                        m2, s2 = _msd([e2(v) for v in cohort_vecs])
                        base.append((e2(pv[i]) - m2) / s2)
                    else:
                        base.append(e2(pv[i]))
            else:
                base = [ens(v) for v in pv]
            # agg>1: vonis diambil dari RERATA k skor, jadi ambangnya HARUS dikalibrasi
            # pada sebaran rerata-k juga. Versi pertama saya mengkalibrasi pada skor
            # tunggal lalu memutuskan pada rerata — sebaran rerata jauh lebih sempit,
            # jadi ambangnya jatuh di tempat yang salah dan FAR meledak ke 35%. Itu
            # persis kelas cacat train-vs-serve yang sudah dua kali menggigit repo ini
            # (C-16, C-17): yang dilatih dan yang dipakai bukan besaran yang sama.
            if agg > 1 and len(base) >= 2:
                rb = random.Random(1234)
                base = [sum(rb.choice(base) for _ in range(agg)) / agg for _ in range(500)]
            return ens, rdb.calibrate_thresholds(base, q_low=qq, q_med=qq * 0.33)

        pool = vecs[:BASELINE]
        ens, thr = build(pool, q_low)
        levels = []
        buf = []
        for i in range(BASELINE, len(vecs)):
            if len(pool) > BASELINE and (len(pool) - BASELINE) % STEP == 0:
                recent = levels[-WINDOW:] if len(levels) >= WINDOW else []
                window_low = len(recent) == WINDOW and all(x == 'LOW' for x in recent)
                # konvergensi butuh DUA syarat, persis reproduce_db: rentetan LOW
                # DAN kohort yang tidak ikut lolos. Menghilangkan syarat kedua
                # membekukan model pada kolam kecil dan menjatuhkan AUC 0,92 -> 0,81.
                cs = [ens(v) for v in conv_vecs]
                low_rate = sum(1 for x in cs if x > thr['low']) / len(cs) if cs else 1
                if not (window_low and low_rate <= 0.35):
                    ens, thr = build(pool, q_low)
                    # skor dari model LAMA tidak sebanding dengan skor model BARU;
                    # merata-ratakan lintas pembangunan ulang menambah derau, bukan
                    # menguranginya. Buang ekor yang belum penuh.
                    buf = []
            buf.append(ens(vecs[i]))
            if len(buf) < agg:
                continue
            sc = sum(buf) / len(buf)
            buf = []
            lvl = rdb.to_risk(sc, thr)
            levels.append(lvl)
            counted = i >= eval_from
            if counted:
                owner_scores.append(sc)
                totalOwner += 1
            if lvl != 'LOW' and counted:
                ownerNonLow += 1
            # FRR menggabungkan dua konsekuensi yang SANGAT berbeda: MEDIUM memicu
            # verifikasi tambahan (pemilik lanjut, dengan satu langkah ekstra),
            # HIGH memblokir. Melaporkan keduanya sebagai satu angka membuat sistem
            # berlapis terlihat seburuk sistem yang memang menendang orang keluar.
            if lvl == 'HIGH' and counted:
                ownerHigh += 1
            if lvl == 'LOW' and is_eligible(vecs[i], ecounts[i]):
                pool.append(vecs[i])
        if len(levels) >= WINDOW and all(x == 'LOW' for x in levels[-WINDOW:]):
            convs += 1

        # Agregasi HARUS di dalam satu identitas. Merata-ratakan skor beberapa
        # penyusup BERBEDA menghasilkan "orang rata-rata" yang tidak pernah ada, dan
        # orang rata-rata itu justru lebih dekat ke pusat model pemilik -> FAR naik
        # palsu. Jadi penyusup dikelompokkan per subjek dulu, baru dirata-ratakan.
        for x in sorted(far_ids):
            ibuf = []
            for v in fetch({x}):
                ibuf.append(ens(v))
                if len(ibuf) < agg:
                    continue
                s = sum(ibuf) / len(ibuf)
                ibuf = []
                imp_scores.append(s)
                totalImp += 1
                if rdb.to_risk(s, thr) == 'LOW':
                    impLow += 1

    return dict(frr=ownerNonLow / totalOwner * 100 if totalOwner else 0,
                block=ownerHigh / totalOwner * 100 if totalOwner else 0,
                far=impLow / totalImp * 100 if totalImp else 0,
                conv=convs, owner_scores=owner_scores, imp_scores=imp_scores,
                n_own=totalOwner, n_imp=totalImp)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--levers', nargs='+', default=['none', 'znorm', 'loo', 'znorm+loo'])
    ap.add_argument('--seeds', nargs='+', type=int, default=[42])
    ap.add_argument('--q-grid', nargs='+', type=float,
                    default=[0.01, 0.02, 0.03, 0.05, 0.08, 0.10, 0.12, 0.15])
    ap.add_argument('--topk', type=int, default=0, help='pakai k fitur terbaik (0 = semua 28)')
    ap.add_argument('--agg', type=int, default=1)
    ap.add_argument('--scorer', default='ens', choices=['ens', 'maha', 'knn', 'cohort'],
                    help="mesin penilai: 'ens' (acuan), 'knn', atau 'cohort'")
    ap.add_argument('--w-if', type=float, default=0.70,
                    help='bobot IsolationForest. reproduce_db pakai 0.70; sdk/core/config.js pakai 0.30')
    ap.add_argument('--robust', action='store_true',
                    help='log bertanda + median/MAD, pengganti mean/std')
    ap.add_argument('--eval-from', type=int, default=0,
                    help='hitung FRR hanya dari indeks sesi ini ke atas (adil saat membandingkan panjang pendaftaran)')
    ap.add_argument('--baseline', type=int, default=10,
                    help='jumlah sesi pendaftaran sebelum penilaian dimulai (default 10)')
    a = ap.parse_args()
    global BASELINE
    BASELINE = a.baseline

    conn = sqlite3.connect(rdb.find_db())
    W = {'isolation_forest': a.w_if, 'svm': round(1.0 - a.w_if, 4), 'lstm': 0}
    print(f"Protokol reproduce_db (belah 8/8, q dituning di FOLD-TUNE) | "
          f"benih {a.seeds} | topk={a.topk or 28} | agg={a.agg} | daftar={a.baseline} | "
          f"mesin={a.scorer}{' +robust' if a.robust else ''} | bobot IF={a.w_if}\n")

    acc = {}
    for seed in a.seeds:
        r = random.Random(seed)
        sh = list(rdb.SUBJECT_IDS)
        r.shuffle(sh)
        tune, report = sorted(sh[:8]), sorted(sh[8:])
        cols = pick_features(conn, tune, a.topk) if a.topk else None
        if cols:
            print(f"  [benih {seed}] fitur terpilih: {', '.join(cols)}")
        for lv in a.levers:
            zn, lo = 'znorm' in lv, 'loo' in lv
            best_q, best_gap = None, float('inf')
            for q in a.q_grid:
                t = run_fold(conn, tune, W, q, cols, znorm=zn, loo=lo, agg=a.agg, eval_from=a.eval_from,
                         robust=a.robust, scorer=a.scorer)
                g = abs(t['frr'] - t['far'])
                if g < best_gap:
                    best_gap, best_q = g, q
            rep = run_fold(conn, report, W, best_q, cols, znorm=zn, loo=lo, agg=a.agg, eval_from=a.eval_from,
                         robust=a.robust, scorer=a.scorer)
            rc = rdb.roc(rep['owner_scores'], rep['imp_scores'])
            acc.setdefault(lv, []).append((rep['frr'], rep['far'], rc['auc'], rc['eer'],
                                           rc['far_at_15'], rep['block']))
            print(f"  [benih {seed}] {lv:12s} q*={best_q:.2f} "
                  f"FRR {rep['frr']:5.1f}% (blokir {rep['block']:4.1f}%) FAR {rep['far']:4.1f}% "
                  f"AUC {rc['auc']:.3f} EER {rc['eer']:5.1f}%")

    print(f"\nRerata atas {len(a.seeds)} belahan")
    print(f"{'Tuas':14s} {'FRR':>7s} {'blokir':>7s} {'FAR':>7s} {'AUC':>7s} {'EER':>7s} {'FAR@FRR15':>10s}")
    print('-' * 64)
    for lv, rows in acc.items():
        n = len(rows)
        f = lambda j: sum(x[j] for x in rows) / n
        rng_ = lambda j: f"[{min(x[j] for x in rows):.0f}..{max(x[j] for x in rows):.0f}]"
        print(f"{lv:14s} {f(0):6.1f}% {f(5):6.1f}% {f(1):6.1f}% {f(2):7.3f} {f(3):6.1f}% {f(4):9.1f}%")
        if n > 1:
            print(f"{'':14s} {rng_(0):>7s} {rng_(5):>7s} {rng_(1):>7s} {'':>7s} {rng_(3):>7s}")


if __name__ == '__main__':
    main()
