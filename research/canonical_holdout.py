#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
canonical_holdout.py - menjawab satu pertanyaan yang `idle_ablation.py` TIDAK bisa
jawab: pada titik operasi yang SAH, representasi mana yang lebih baik?

`idle_ablation.py` membangun model dari 10 sesi baseline tanpa protokol held-out,
jadi titik operasinya longgar dan hanya selisih antar-lengannya yang sahih dibaca.
Skrip ini memakai protokol yang PERSIS sama dengan reproduce_db.py - whitelist 16
subjek, belah 8/8 seed 42, tuning q di FOLD-TUNE, lapor di FOLD-REPORT - lalu
menyetirnya dengan vektor yang diekstrak ulang dari `raw_events`. Satu-satunya
yang berubah adalah REPRESENTASInya; protokolnya identik, jadi angkanya bisa
dibandingkan.

Empat kondisi:
  1. sesi utuh, tanpa AFK        kontrol; harus mendekati angka reproduce_db,
                                 yang sekaligus memvalidasi ekstraksi ulang
  2. sesi utuh, dengan AFK       dunia nyata hari ini
  3. kanonik K, tanpa AFK        ongkos murni kanonikalisasi
  4. kanonik K, dengan AFK       usulan C-23 + C-24 utuh
     + segmentasi

Jeda AFK hanya disuntik ke sesi EVALUASI, tidak ke 10 sesi pendaftaran: pendaftaran
biasanya terjadi sekali, terarah, dan relatif bersih, sedangkan pemakaian sehari-hari
tidak. Menyuntik ke dua-duanya akan menyembunyikan persoalannya.

Jalankan:
  python research/canonical_holdout.py
  python research/canonical_holdout.py --canonical 120 --gap-min 2 5 10 20
"""
import argparse
import importlib.util
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
abl = _load("abl", _HERE / "idle_ablation.py")

BASELINE = 10
EVENT_COLS = abl.EVENT_COLS


def load_raw(conn, uid):
    sids = [r[0] for r in conn.execute(
        "SELECT session_id FROM sessions WHERE user_id=? ORDER BY session_id", (uid,))]
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
        out.append(evs)
    return out


def build_source(raw_by_uid, mode, K, afk, gap_min, seed, gap_ms_override=0, compress_ms=15_000):
    """{uid: [(vektor, event_count)]} menurut satu kondisi.

    mode: 'utuh'      satu vektor per sesi, apa adanya (perilaku sebelum C-23)
          'segmen'    C-23: dipecah di tiap jeda idle, satu vektor per segmen
          'kanonik'   C-24: segmen dipotong lagi jadi jendela K event
          'kompres'   C-28: sesi utuh, tiap jeda >= compress_ms dipendekkan jadi
                      compress_ms (DEFAULT yang dikirim sekarang)
    """
    src = {}
    for uid, sessions in raw_by_uid.items():
        rng = random.Random(seed + uid)
        vecs = []
        for i, evs in enumerate(sessions):
            # AFK hanya ke sesi EVALUASI; pendaftaran dianggap terarah & bersih
            if afk and i >= BASELINE:
                cut = abl.pick_cut(evs, rng)
                evs = abl.inject_gap(evs, rng.choice(gap_min) * 60_000, cut)
            if mode == 'utuh':
                vecs.append((abl.vec_of(evs), len(evs)))
            elif mode == 'kompres':
                evs = abl.compress_idle(evs, compress_ms)
                vecs.append((abl.vec_of(evs), len(evs)))
            elif mode == 'segmen':
                for seg in abl.segment_by_idle(evs, gap_ms_override or abl.GAP_MS):
                    if len(seg) >= 30:                 # session.minEventsAssess
                        vecs.append((abl.vec_of(seg), len(seg)))
            else:
                for w in abl.canonical_windows(evs, K):
                    vecs.append((abl.vec_of(w), len(w)))
        src[uid] = vecs
    return src


def run_protocol(conn, src, weights, label, use_real=True, q_grid=None, holdout=0.0,
                 split_seed=42):
    """Protokol held-out reproduce_db.py, disetir `src`. Tuning q di FOLD-TUNE,
    lapor di FOLD-REPORT - persis seperti angka headline skripsi dihasilkan.

    `split_seed` MENGACAK belahan 8/8. Satu belahan tunggal (seed 42) memberi satu
    angka tanpa sebaran, dan dengan hanya 8 subjek pelapor sebarannya besar - cukup
    besar untuk membalik urutan peringkat antar-representasi. Karena itu skrip ini
    mengulang beberapa belahan dan melaporkan rerata plus rentangnya.
    """
    rng = random.Random(split_seed)
    shuf = list(rdb.SUBJECT_IDS)
    rng.shuffle(shuf)
    fold_tune, fold_report = sorted(shuf[:8]), sorted(shuf[8:])

    best_q, best_gap = None, float('inf')
    for q in (q_grid or [0.10, 0.12, 0.15, 0.18, 0.20]):
        r = rdb.run_fold(conn, fold_tune, weights, q, use_real_ocsvm=use_real, vec_source=src, calib_holdout=holdout)
        gap = abs(r['frr'] - r['far'])
        if gap < best_gap:
            best_gap, best_q = gap, q
    rep = rdb.run_fold(conn, fold_report, weights, best_q, use_real_ocsvm=use_real, vec_source=src, calib_holdout=holdout)
    rc = rdb.roc(rep['owner_scores'], rep['imp_scores'])
    return dict(label=label, q=best_q, frr=rep['frr'], far=rep['far'],
                auc=rc['auc'], eer=rc['eer'], far15=rc['far_at_15'],
                conv=rep['conv'], nsub=rep['nsub'],
                n_own=rep['owner'], n_imp=rep['imp'])


def main():
    ap = argparse.ArgumentParser(description="Kanonik vs sesi utuh, protokol held-out")
    ap.add_argument('--db')
    ap.add_argument('--canonical', type=int, default=120, metavar='K')
    ap.add_argument('--gap-min', type=float, nargs='+', default=[2, 5, 10, 20])
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--ablation', action='store_true', help='IF 100%%')
    ap.add_argument('--q-grid', type=float, nargs='+', default=None,
                    help='kandidat q_low. Default [0.10..0.20] MENTOK di pinggir: tuner '
                         'selalu memilih 0.10, tanda ia mau lebih longgar tapi tak dikasih pilihan.')
    ap.add_argument('--holdout-calib', type=float, default=0.0, metavar='FRAC',
                    help='porsi kolam yang disisihkan untuk kalibrasi ambang di luar sampel')
    ap.add_argument('--seeds', type=int, nargs='+', default=[42],
                    help='benih belahan 8/8. Beri beberapa untuk melihat SEBARAN; satu '
                         'belahan tunggal tidak cukup untuk memeringkat representasi.')
    ap.add_argument('--idle-gap-sec', type=float, nargs='+', default=None,
                    help='sapu beberapa nilai session.idleGapSec untuk mode segmen. '
                         'Memotong di 30 dtk juga memotong JEDA BERPIKIR biasa, dan sesi '
                         'yang lebih pendek membawa bukti lebih sedikit - ongkos yang '
                         'sama persis dengan yang menenggelamkan C-24.')
    ap.add_argument('--compress-sec', type=float, default=15,
                    help='C-28: ambang kompresi jeda (= sdk/core/config.js session.idleCompressSec)')
    ap.add_argument('--only', type=int, nargs='+', default=None,
                    help='jalankan hanya kondisi bernomor ini (hemat waktu)')
    args = ap.parse_args()

    db = args.db or rdb.find_db()
    if not db:
        print("DB tidak ditemukan"); return 1
    conn = sqlite3.connect(db)
    # C-27: bobot mengikuti sdk/core/config.js (IF 0,30 / slot-2 0,70), dan mesinnya
    # mengikuti rdb.ENGINE_DEFAULT ('maha'). Versi lama file ini memakai 0,70/0,30 di
    # atas OCSVM - mengukur sistem yang tidak dikirim.
    weights = ({'isolation_forest': 1.0, 'svm': 0, 'lstm': 0} if args.ablation
               else dict(rdb.WEIGHTS_SDK))

    print(f"DB: {db}")
    print(f"Protokol: reproduce_db.py - whitelist 16 subjek, belah 8/8 seed 42, "
          f"q dituning di FOLD-TUNE, dilaporkan di FOLD-REPORT")
    print(f"Engine  : {'IF 100%' if args.ablation else 'IF 0,30 / slot-2 0,70'}, "
          f"{'Mahalanobis (sama dgn SDK)' if rdb.ENGINE_DEFAULT == 'maha' else rdb.ENGINE_DEFAULT}")
    print(f"Kanonik : K={args.canonical} event | AFK: {args.gap_min} menit, "
          f"hanya ke sesi evaluasi\n")

    print("Memuat raw_events untuk 16 subjek ...", flush=True)
    raw = {uid: load_raw(conn, uid) for uid in rdb.SUBJECT_IDS}
    tot = sum(len(v) for v in raw.values())
    print(f"  {tot} sesi berevent\n", flush=True)

    K = args.canonical
    conds = [
        ("1. utuh, tanpa AFK          (kontrol)",   'utuh',    False),
        ("2. utuh, dengan AFK         (hari ini)",  'utuh',    True),
        ("3. utuh + segmentasi C-23,  dgn AFK",     'segmen',  True),   # <- yang DIKIRIM
        ("4. utuh + segmentasi C-23,  tanpa AFK",   'segmen',  False),  # ongkos C-23 sendiri
        (f"5. kanonik {K} (C-24),        tanpa AFK", 'kanonik', False),
        (f"6. kanonik {K} + segmentasi,  dgn AFK",   'kanonik', True),
        ("7. utuh + kompresi C-28,     dgn AFK",     'kompres', True),   # <- DIKIRIM (C-28)
        ("8. utuh + kompresi C-28,     tanpa AFK",   'kompres', False),  # ongkos C-28 sendiri
    ]
    if args.only:
        conds = [c for i, c in enumerate(conds, 1) if i in args.only]
    if args.idle_gap_sec:
        conds = [c for c in conds if c[1] != 'segmen'] + [
            (f"3.{int(g)}s utuh + segmentasi @{int(g)} dtk, dgn AFK", 'segmen', True)
            for g in args.idle_gap_sec]
    rows = []
    for label, mode, afk in conds:
        gms = 0
        if args.idle_gap_sec and mode == 'segmen':
            gms = float(label.split('@')[1].split()[0]) * 1000
        src = build_source(raw, mode, K, afk, args.gap_min, args.seed, gms,
                           compress_ms=args.compress_sec * 1000)
        runs = []
        for sd in args.seeds:
            print(f"menjalankan: {label} | benih belahan {sd} ...", flush=True)
            runs.append(run_protocol(conn, src, weights, label, q_grid=args.q_grid,
                                     holdout=args.holdout_calib, split_seed=sd))
        agg = {'label': label, 'n': len(runs)}
        for k in ('frr', 'far', 'auc', 'eer', 'far15'):
            vals = [r[k] for r in runs]
            agg[k] = sum(vals) / len(vals)
            agg[k + '_lo'], agg[k + '_hi'] = min(vals), max(vals)
        agg['q'] = runs[0]['q']
        agg['conv'] = sum(r['conv'] for r in runs) / len(runs)
        agg['nsub'] = runs[0]['nsub']
        rows.append(agg)

    print()
    n = rows[0]['n'] if rows else 1
    print(f"Rerata atas {n} belahan 8/8; [min..maks] di baris kedua tiap kondisi.")
    print(f"{'Kondisi':40} {'FRR':>7} {'FAR':>7} {'AUC':>7} {'EER':>7} {'FAR@FRR15':>10}")
    print("-" * 92)
    for r in rows:
        print(f"{r['label']:40} {r['frr']:6.1f}% {r['far']:6.1f}% "
              f"{r['auc']:7.3f} {r['eer']:6.1f}% {r['far15']:9.1f}%")
        if n > 1:
            print(f"{'':40} [{r['frr_lo']:.0f}..{r['frr_hi']:.0f}] "
                  f"[{r['far_lo']:.0f}..{r['far_hi']:.0f}] "
                  f"[{r['auc_lo']:.3f}..{r['auc_hi']:.3f}] "
                  f"[{r['eer_lo']:.0f}..{r['eer_hi']:.0f}] "
                  f"[{r['far15_lo']:.0f}..{r['far15_hi']:.0f}]")

    print()
    print("CARA MEMBACA")
    print("  Baris 1 adalah kontrol: kalau ia jauh dari angka `python research/reproduce_db.py`,")
    print("  yang salah ekstraksi ulangnya, bukan representasinya - periksa itu dulu.")
    print("  Baris 2 vs 1  = kerusakan idle di dunia nyata, pada titik operasi yang sah.")
    print("  Baris 3 vs 2  = APAKAH C-23 (yang dikirim, default nyala) benar-benar menolong.")
    print("               Ini pertanyaan terpenting di tabel ini.")
    print("  Baris 3 vs 1  = seberapa dekat C-23 mengembalikan keadaan ke sebelum ada idle.")
    print("  Baris 4 vs 1  = ongkos C-23 ketika idle TIDAK ada sama sekali (harus ~nol).")
    print("  Baris 5 vs 1  = ongkos murni kanonikalisasi C-24 (default MATI).")
    print("  Baris 7 vs 2  = apakah kompresi C-28 (default NYALA) memperbaiki idle.")
    print("  Baris 8 vs 1  = ongkos C-28 ketika idle TIDAK ada (harus ~nol).")
    print()
    print("  Perhatikan EER dan AUC lebih dulu: keduanya bebas titik-operasi. FRR/FAR")
    print("  bergantung pada q yang dituning per kondisi, jadi keduanya bisa saling tukar")
    print("  tanpa ada yang benar-benar membaik.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
