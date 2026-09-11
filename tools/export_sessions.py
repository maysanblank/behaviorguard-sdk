#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
export_sessions.py — ekspor event mentah 16 subjek ke JSON untuk tools/eval_sdk.mjs.

Kenapa ada: tiga harness sebelumnya (reproduce_db, experiment, frr_levers) masing-masing
MENIRU mesin SDK di Python, dan ketiganya meleset di tempat yang berbeda — ambang kuantil
lawan parametrik, z tak di-clamp, Mahalanobis tanpa shrink adaptif, kolam 30 lawan 100,
sesi lolos-MFA tak pernah masuk kolam (lihat core/DRIFT.md C-29). eval_sdk.mjs menjalankan
sdk/behaviorguard.js ITU SENDIRI, jadi yang diukur tidak mungkin berbeda dari yang dikirim.
Skrip ini hanya menyiapkan datanya.

PRIVASI: keluarannya berisi perilaku manusia sungguhan. Default ditulis ke direktori
sementara OS, BUKAN ke repo. Jangan pernah meng-commit berkas ini.

  python tools/export_sessions.py                 # sesi apa adanya
  python tools/export_sessions.py --afk           # + jeda AFK 2-20 mnt, RNG = C-28
"""
import argparse, json, os, pathlib, random, sqlite3, sys, tempfile

_HERE = pathlib.Path(__file__).parent
sys.path.insert(0, str(_HERE))
import reproduce_db as rdb          # noqa: E402  (SUBJECT_IDS, find_db)
import canonical_holdout as ch      # noqa: E402  (load_raw: urutan & filter yang sama)
import idle_ablation as abl         # noqa: E402  (pick_cut, inject_gap: RNG yang sama)

BASELINE = 10
GAP_MIN = [2, 5, 10, 20]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db')
    ap.add_argument('--afk', action='store_true',
                    help='suntik satu jeda AFK ke tiap sesi evaluasi (indeks >= 10), '
                         'urutan RNG identik dengan canonical_holdout.build_source')
    ap.add_argument('--seed', type=int, default=42)
    ap.add_argument('--out', help='default: <tmp>/bg_sessions[_afk].json')
    # session_id di DB adalah UUID acak, jadi ORDER BY session_id (load_raw) = urutan ACAK,
    # bukan urutan waktu. Pengguna nyata mendaftar dengan kunjungan PERTAMANYA lalu terus
    # memakai situs; 'time' meniru itu. 'id' = urutan lama semua harness sampai C-43.
    ap.add_argument('--order', choices=['time', 'id'], default='time')
    a = ap.parse_args()
    db = a.db or rdb.find_db()
    if not db:
        print('DB tidak ditemukan'); return 1
    conn = sqlite3.connect(db)
    out = {'subjects': {}, 'afk': a.afk, 'seed': a.seed, 'order': a.order}
    n = 0
    for uid in rdb.SUBJECT_IDS:
        sessions = ch.load_raw(conn, uid)
        if a.order == 'time':
            sessions.sort(key=lambda evs: evs[0]['timestamp'])
        rng = random.Random(a.seed + uid)
        res = []
        for i, evs in enumerate(sessions):
            if a.afk and i >= BASELINE:
                cut = abl.pick_cut(evs, rng)                     # urutan: cut dulu
                evs = abl.inject_gap(evs, rng.choice(GAP_MIN) * 60_000, cut)
            # buang kolom null supaya berkasnya kecil; extractF4 memperlakukan
            # kunci yang tak ada sama dengan null
            res.append([{k: v for k, v in e.items() if v is not None} for e in evs])
        out['subjects'][str(uid)] = res
        n += len(res)
    path = a.out or os.path.join(tempfile.gettempdir(),
                                 'bg_sessions_afk.json' if a.afk else 'bg_sessions.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'))
    print(f'{n} sesi, {len(out["subjects"])} subjek -> {path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
