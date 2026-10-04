# -*- coding: utf-8 -*-
"""SATU MESIN untuk seluruh angka artifact.

Primitif  : core/bg_core.py  (identik sdk/core/*.js, 115/115 cek golden @1e-9)
Siklus    : port 1:1 sdk/behaviorguard.js (_trainingVectors, _rebuildModel,
            gerbang ensemble n>=20, retrain tiap 6 LOW baru kecuali konvergen,
            trust-loop: sesi non-LOW yang lolos MFA pemilik ikut kolam + rebuild).
Yang boleh beda antar-percobaan HANYA: daftar fitur, bobot, jenis detektor-2.
"""
import sys, math, json, sqlite3, pathlib
from multiprocessing import Pool
SDK = pathlib.Path(r"C:\Users\USER\OneDrive\Documents\skripsi\BEHAVIORGUARD-SDK")
sys.path.insert(0, str(SDK / 'core'))
import bg_core as B

DB = r"C:\Users\USER\OneDrive\Documents\skripsi\database\05 08 2026\behavior_detection_20260805_085856.db"
SUBJ = {'kapioo': 2, 'denzel': 3, 'cencen': 6, 'kezia': 7, 'kevin': 8, 'andika': 9, 'erni': 11, 'teddy': 12,
        'delon': 13, 'diani': 15, 'mikhael': 18, 'maysan': 19, 'dodi': 20, 'Tutel': 22, 'Frans': 24, 'kelin': 25}
CFG = B.DEFAULTS

_c = sqlite3.connect(DB)
ALL46 = [r[1] for r in _c.execute('pragma table_info(features)')][2:-1]
_c.close()

PROD28 = [f for f in B.F4 if f in ALL46]           # 28 fitur prod yang terekam di DB
def _feats_from_xlsx():
    """Daftar fitur F1..F9 diambil HARFIAH dari baris 'Fitur yang dimatikan' tiap blok."""
    import openpyxl
    ws = openpyxl.load_workbook(str(pathlib.Path(DB).with_name('PERCOBAAN_PER_SESI.xlsx')), data_only=True)['PERCOBAAN FITUR']
    out = {}; k = None
    for r in ws.iter_rows(values_only=True):
        t = str(r[0] or '')
        m = re.match(r'PERCOBAAN FITUR (\d+)', t)
        if m: k = 'F' + m.group(1); continue
        if k and 'dimatikan:' in t:
            off = t.split('dimatikan:', 1)[1]
            off = set() if 'tidak ada' in off else {x.strip() for x in off.split(',')}
            out[k] = [f for f in ALL46 if f not in off]; k = None
    return out
import re
FEATS = _feats_from_xlsx()
assert [len(FEATS[f'F{i}']) for i in range(1, 10)] == [46, 41, 37, 28, 16, 41, 35, 29, 21], {k: len(v) for k, v in FEATS.items()}
assert set(FEATS['F4']) == set(PROD28), 'F4 riset != 28 fitur prod'

def load(feats):
    c = sqlite3.connect(DB); cols = ','.join('f.' + f for f in feats); out = {}
    for nm, uid in SUBJ.items():
        rr = c.execute(f"SELECT s.start_time,{cols} FROM features f JOIN sessions s USING(session_id) "
                       f"WHERE s.user_id=? ORDER BY s.start_time", (uid,)).fetchall()
        out[nm] = ([r[0] for r in rr], [[float(x or 0) for x in r[1:]] for r in rr])
    c.close(); return out

# ------------------------------------------------------------------ mesin
class Guard:
    """Padanan sdk/behaviorguard.js pada satuan sesi."""
    def __init__(self, feats, weights, model2):
        self.feats, self.w, self.m2 = feats, weights, model2
        self.sess = []; self.model = None; self.new_since = 0
        tmp = {i for i, f in enumerate(feats) if f.startswith('temporal_')}
        self.beh = [i for i in range(len(feats)) if i not in tmp]
        # detektor tunggal (IF=0): gerbang n>=20 akan membuang satu-satunya detektor ->
        # bg_core.normalize_weights jatuh ke bobot default. Untuk uji detektor-tunggal
        # gerbang dibuka sejak baseline supaya yang diukur memang detektor itu sendirian.
        self.gate = dict(CFG['ensembleMinSamples'])
        if not weights.get('isolation_forest'): self.gate['svm'] = 0

    def train_vecs(self):
        base = [s['v'] for s in self.sess[:10]]
        lows = [s['v'] for s in self.sess[10:] if s['r'] == 'LOW' or s['mfa']][-CFG['progressiveMaxPool']:]
        ded = []
        for v in lows:
            if not any(math.sqrt(sum((v[i] - u[i]) ** 2 for i in self.beh) / len(self.beh)) < CFG['progressiveDupEps'] for u in ded):
                ded.append(v)
        return base + ded

    def rebuild(self):
        V = self.train_vecs(); self.new_since = 0; n = len(V)
        st = B.compute_stats(V); X = B.standardize_batch(V, st)
        iff = B.IsolationForest(**CFG['iforest']); iff.fit(X)
        nf = len(self.feats)
        if self.m2 == 'mahalanobis':
            d2 = B.Mahalanobis(shrink=min(0.9, max(CFG['mahalanobis']['shrink'], nf / max(1, n))), n_features=nf)
        else:
            d2 = B.OCSVM(n_features=nf)
        d2.fit(X)
        cfg = dict(CFG); cfg['ensembleMinSamples'] = self.gate
        ens = B.Ensemble(iff, d2, self.w, n, cfg); ens.calibrate(X, n)
        th = B.calibrate_thresholds_parametric([ens.score_one(x) for x in X], CFG['k_low'], CFG['k_med_extra'])
        self.model = dict(st=st, ens=ens, th=th, n=n)

    def score(self, v):
        m = self.model; s = m['ens'].score_one(B.standardize(v, m['st']))
        return s, B.to_risk(s, m['th']), m['th']

    def feed(self, v):
        if len(self.sess) < 10:
            self.sess.append(dict(v=v, r='LOW', mfa=False))
            if len(self.sess) == 10: self.rebuild()
            return None
        s, lv, th = self.score(v)
        self.sess.append(dict(v=v, r=lv, mfa=False))
        tv = len(self.train_vecs())
        if self.model['n'] < self.gate['svm'] <= tv:             # C-15 gerbang dibuka
            self.rebuild()
        if lv == 'LOW':
            self.new_since += 1
            if self.new_since >= CFG['retrainEvery']:
                rec = [x['r'] for x in self.sess[-CFG['convergence']['window']:]]
                if not all(r == 'LOW' for r in rec): self.rebuild()
        else:                                                     # pemilik lolos step-up
            self.sess[-1]['mfa'] = True; self.rebuild()
        return dict(sc=s, lv=lv, lo=th['low'], me=th['medium'])

def conv_at(vs):
    n = len(vs)
    for i in range(n - 5):
        if all(x == 'L' for x in vs[i:]): return i + 11
    return None

def run(args):
    key, feats, w, m2 = args
    data = load(feats); res = {}; guards = {}
    for nm, (ts, V) in data.items():
        g = Guard(feats, w, m2); rows = []
        for i, v in enumerate(V):
            r = g.feed(v)
            if r: rows.append(dict(s=i + 1, t=ts[i][:16].replace('T', ' '), v=r['lv'][0],
                                   m=round(r['sc'] - r['lo'], 3), f=round(r['me'] - r['lo'], 3)))
        guards[nm] = g
        vs = [x['v'] for x in rows]; non = sum(1 for x in vs if x != 'L')
        res[nm] = dict(n=len(vs), non=non, frr=round(100 * non / len(vs), 1), med=vs.count('M'), high=vs.count('H'),
                       conv=conv_at(vs), rows=rows)
    tl = tt = 0
    for nm, g in guards.items():
        imps = []; dots = []
        lo = g.model['th']['low']
        for on, (_, V) in data.items():
            if on == nm: continue
            ok = 0
            for v in V:
                s, lv, th = g.score(v); ok += lv == 'LOW'
                dots.append(round(s - lo, 3))
            imps.append(dict(name=on, n=len(V), low=ok, pct=round(100 * ok / len(V), 1)))
        imps.sort(key=lambda d: -d['pct'])
        a = sum(d['low'] for d in imps); b = sum(d['n'] for d in imps); tl += a; tt += b
        own = [round(g.score(s['v'])[0] - lo, 3) for s in g.sess[10:]]
        res[nm].update(far=round(100 * a / b, 1), far_low=a, far_tot=b, imps=imps,
                       fmed=round(g.model['th']['medium'] - lo, 3), idots=dots[::3], odots=own)
    N = sum(r['non'] for r in res.values()); D = sum(r['n'] for r in res.values())
    return key, dict(frr=round(100 * N / D, 1), far=round(100 * tl / tt, 1), non=N, n=D, fl=tl, ft=tt,
                     nconv=sum(1 for r in res.values() if r['conv']), nfeat=len(feats), w=w, m2=m2, subj=res)

def W(i, s): return {'isolation_forest': i, 'svm': s, 'lstm': 0}
JOBS = []
for k, f in FEATS.items(): JOBS.append((k, f, W(1, 0), 'centroid'))
# W1-W10 = persentase riset IF/SVM/LSTM. Mesin prod tak punya LSTM -> porsi LSTM
# dibuang lalu dinormalisasi (persis normalize_weights). W4 (LSTM 100%) tak bisa jalan.
WP = {'W1': (40, 30, 30), 'W2': (100, 0, 0), 'W3': (0, 100, 0), 'W5': (50, 50, 0), 'W6': (60, 40, 0),
      'W7': (70, 30, 0), 'W8': (34, 33, 33), 'W9': (50, 25, 25), 'W10': (20, 40, 40)}
for k, (a, b, _) in WP.items(): JOBS.append((k, FEATS['F3'], W(a / 100, b / 100), 'centroid'))
# sapuan IF<->Maha pada fitur prod
for m in range(0, 101, 10): JOBS.append((f'M{m}', PROD28, W((100 - m) / 100, m / 100), 'mahalanobis'))
# duel detektor pada fitur prod
JOBS += [('D_IF', PROD28, W(1, 0), 'mahalanobis'), ('D_MAHA', PROD28, W(0, 1), 'mahalanobis'),
         ('D_OCSVM', PROD28, W(0, 1), 'centroid'), ('D_IFOC', PROD28, W(.3, .7), 'centroid')]

if __name__ == '__main__':
    only = sys.argv[1:]
    jobs = [j for j in JOBS if not only or j[0] in only]
    with Pool(min(8, len(jobs))) as p:
        out = dict(p.map(run, jobs))
    for k, v in out.items():
        print(f"{k:8s} nfeat={v['nfeat']:2d}  FRR {v['frr']:5.1f}%  FAR {v['far']:5.1f}%  conv {v['nconv']}/16")
    dst = pathlib.Path(__import__('tempfile').gettempdir()) / 'one_engine.json'  # data turunan riset: jangan ke repo
    prev = json.loads(dst.read_text(encoding='utf-8')) if dst.exists() and only else {}
    prev.update(out); dst.write_text(json.dumps(prev, ensure_ascii=False), encoding='utf-8')
    print('SAVED', dst)
