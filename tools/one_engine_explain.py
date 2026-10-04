# -*- coding: utf-8 -*-
"""Alasan per sesi untuk setelan kirim (IF30+Maha70, 28 fitur), mesin yang sama dgn engine1.
Per sesi pemilik: z IF, z Maha, bobot, 4 fitur |z| terbesar (bg_core.top_features = yang dipakai SDK
untuk 'reasons'), dan pangsa tiap fitur di jarak Mahalanobis (dv_i*(S^-1 dv)_i / d^2).
Per pasangan pemilik-penyusup: fitur yang paling membongkar penyusup (rata2 |z| di model akhir)."""
import json, math, pathlib
import one_engine_replay as E
B = E.B

def parts(g, v):
    m = g.model; ens = m['ens']; x = B.standardize(v, m['st'])
    ri = ens.iforest.score_one(x); rm = ens.ocsvm.score_one(x)
    zi = B.z_score(ri, ens.if_stats, ens.cfg); zm = B.z_score(rm, ens.svm_stats, ens.cfg)
    w = ens.gated_weights; mh = ens.ocsvm
    dv = [x[i] - mh.mean[i] for i in range(len(x))]
    tmp = [sum(mh.inv[i][j] * dv[j] for j in range(len(x))) for i in range(len(x))]
    c = [dv[i] * tmp[i] for i in range(len(x))]; tot = sum(c) or 1.0
    top = B.top_features(x, list(range(len(x))), k=4)
    mc = sorted(range(len(x)), key=lambda i: -c[i])[:4]
    return x, dict(zi=round(zi, 2), zm=round(zm, 2), wi=round(w['isolation_forest'], 2), wm=round(w['svm'], 2),
                   n=m['n'], tf=[[t['name'], round(t['z'], 2)] for t in top],
                   mc=[[i, round(100 * c[i] / tot)] for i in mc], z=[round(t, 1) for t in x],
                   d=round(math.sqrt(max(tot, 0)), 2))

def main():
    F = E.PROD28; w = E.W(.3, .7); data = E.load(F); out = {}; guards = {}
    for nm, (ts, V) in data.items():
        g = E.Guard(F, w, 'mahalanobis'); rows = []
        for i, v in enumerate(V):
            pre = parts(g, v)[1] if g.model else None
            r = g.feed(v)
            if r:
                pre.update(s=i + 1, v=r['lv'][0], sc=round(r['sc'], 3), lo=round(r['lo'], 3), me=round(r['me'], 3))
                rows.append(pre)
        guards[nm] = g; out[nm] = dict(rows=rows)
    for nm, g in guards.items():
        lo = g.model['th']['low']; pairs = []
        for on, (_, V) in data.items():
            if on == nm: continue
            acc = [0.0] * len(F); ok = 0
            for v in V:
                x, p = parts(g, v); ok += g.score(v)[1] == 'LOW'
                for i in range(len(F)): acc[i] += abs(x[i])
            acc = [a / len(V) for a in acc]
            top = sorted(range(len(F)), key=lambda i: -acc[i])[:3]
            near = sorted(range(len(F)), key=lambda i: acc[i])[:3]
            pairs.append(dict(o=on, ok=ok, n=len(V), top=[[i, round(acc[i], 1)] for i in top], near=[[i, round(acc[i], 2)] for i in near]))
        st = g.model['st']
        out[nm].update(pairs=pairs, pool=g.model['n'], lo=round(lo, 3), me=round(g.model['th']['medium'], 3),
                       sd=[round(s, 3) for s in st['std']], mu=[round(s, 3) for s in st['mean']])
    out['_F'] = F
    import tempfile
    dst = pathlib.Path(tempfile.gettempdir()) / 'one_engine_explain.json'   # data turunan riset: jangan ke repo
    dst.write_text(json.dumps(out, ensure_ascii=False), encoding='utf-8'); print('SAVED', dst, dst.stat().st_size)

if __name__ == '__main__':
    main()
