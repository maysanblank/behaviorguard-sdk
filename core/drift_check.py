#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
drift_check.py - ukur selisih antara MESIN YANG DIKIRIM dan MESIN YANG DIVALIDASI.

Repo ini punya dua salinan mesin yang ditulis tangan terpisah:

  A. sdk/core/*.js        -> yang benar-benar dipasang di situs orang
  B. tools/reproduce_db.py -> yang menghasilkan angka headline di README

Berkas ini menjalankan primitif dari (B) di atas kasus core/golden.json yang
sama, dengan struktur pipeline identik, lalu melaporkan di mana keduanya
berpisah. Tujuannya bukan menyalahkan salah satu - tapi memastikan tidak ada
selisih yang tidak diketahui.

  python core/drift_check.py
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, 'tools'))

import bg_core as bg          # noqa: E402  (A) implementasi acuan == SDK JS
import reproduce_db as rdb    # noqa: E402  (B) mesin validasi


def build_with_rdb(vectors, cfg):
    """Pipeline yang sama persis dengan bg_core.build_model, tapi memakai
    primitif dari reproduce_db.py. Hanya primitifnya yang berbeda."""
    stats = rdb.compute_stats(vectors)
    Xstd = [rdb.standardize(v, stats) for v in vectors]
    iff = rdb.IF()
    iff.fit(Xstd)
    ocs = rdb.OCSVM(len(cfg['features']))
    ocs.fit(Xstd)
    gw = rdb.gate_weights(cfg['weights'], len(vectors))
    m1, s1 = rdb.score_stats([iff.score_one(x) for x in Xstd])
    m2, s2 = rdb.score_stats([ocs.score_one(x) for x in Xstd])

    def ens(v):
        xs = rdb.standardize(v, stats)
        z_if = (iff.score_one(xs) - m1) / s1
        if gw['svm'] == 0:
            return z_if
        z_svm = (ocs.score_one(xs) - m2) / s2
        return gw['isolation_forest'] * z_if + gw['svm'] * z_svm

    thr = rdb.calibrate_thresholds([ens(v) for v in vectors],
                                   q_low=cfg['q_low'], q_med=cfg['q_med'])
    return {'stats': stats, 'ens': ens, 'thr': thr, 'gw': gw}


def report(title, rows):
    print()
    print(title)
    print('-' * len(title))
    for r in rows:
        print('  ' + r)


def main():
    with open(os.path.join(HERE, 'golden.json'), encoding='utf-8') as f:
        g = json.load(f)
    cfg = bg.DEFAULTS

    # --- D-1 & D-2: beda primitif, mesin OC-SVM disamakan (centroid) ---
    rows = []
    max_dscore = 0.0
    level_flips = 0
    total = 0
    for case in g['cases']:
        m = build_with_rdb(case['baseline'], cfg)
        exp = case['expect']
        dl = abs(m['thr']['low'] - exp['thresholds']['low'])
        dm = abs(m['thr']['medium'] - exp['thresholds']['medium'])
        rows.append('%-20s selisih ambang: low %.3e  medium %.3e' % (case['id'], dl, dm))
        for i, p in enumerate(case['probes']):
            s = m['ens'](p)
            lv = rdb.to_risk(s, m['thr'])
            w = exp['verdicts'][i]
            d = abs(s - w['score'])
            max_dscore = max(max_dscore, d)
            total += 1
            if lv != w['level']:
                level_flips += 1
                rows.append('   probe[%d] VONIS BEDA: validasi=%s  SDK=%s  (skor %+.6f vs %+.6f)'
                            % (i, lv, w['level'], s, w['score']))
    rows.append('')
    rows.append('selisih skor maksimum: %.3e   vonis berbeda: %d/%d' % (max_dscore, level_flips, total))
    same = max_dscore <= g['tolerance'] and level_flips == 0
    rows.append('KESIMPULAN: primitif %s' % ('IDENTIK' if same else 'BERBEDA'))
    report('D-1/D-2  primitif numerik (rumus SVM sama-sama ocsvm.js)', rows)

    # --- D-3: uji langsung apakah clamp benar-benar beda perilakunya ---
    rows = []
    probe_scores = [-40.0, -3.0, 0.0, 3.0, 40.0]
    st_sdk = bg.score_stats(probe_scores)
    st_rdb = rdb.score_stats(probe_scores)
    rows.append('score_stats(std)  SDK=%.6f  validasi=%.6f  %s'
                % (st_sdk['std'], st_rdb[1],
                   'sama' if abs(st_sdk['std'] - st_rdb[1]) < 1e-12 else 'BEDA (SDK meng-clamp di 10)'))
    z_sdk = bg.z_score(1000.0, st_sdk)
    z_rdb = (1000.0 - st_rdb[0]) / st_rdb[1]
    rows.append('z untuk skor ekstrem 1000  SDK=%.3f  validasi=%.3f  %s'
                % (z_sdk, z_rdb,
                   'sama' if abs(z_sdk - z_rdb) < 1e-9 else 'BEDA (SDK meng-clamp z di +-6)'))
    tiny = [[1e-7] * 28, [2e-7] * 28, [1.5e-7] * 28]
    rows.append('std lantai untuk fitur nyaris-konstan  SDK=%.3e  validasi=%.3e  %s'
                % (bg.compute_stats(tiny)['std'][0], rdb.compute_stats(tiny)[1][0],
                   'sama' if abs(bg.compute_stats(tiny)['std'][0] - rdb.compute_stats(tiny)[1][0]) < 1e-12
                   else 'BEDA (epsilon lantai tidak sama)'))
    report('D-3  perilaku pengaman di kasus ekstrem (bukan di data biasa)', rows)


if __name__ == '__main__':
    main()
