#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KHUSUS RISET (C-29). Angka dari skrip ini BUKAN angka pustaka yang dikirim: ia menilai sesi
riset utuh (~700 event), padahal pustaka menilai jendela 30 detik dengan bukti >= 150 event,
lantai lengket, masa berlaku step-up, dan aturan absen. Angka resmi pustaka:
`node research/eval_sdk.mjs --live` (README "Results").

experiment.py - cari rumus PENGGANTI centroid yang LEBIH AKURAT tapi tetap
browser-trainable & nol-dependensi (portabel ke 5 runtime). Protokol held-out
8/8 IDENTIK dengan reproduce_db.py (tune q di FOLD-TUNE, lapor di FOLD-REPORT).

Model yang diuji semuanya bisa diimplement di JS murni tanpa sklearn:
  - centroid  : baseline yang dikirim sekarang (RBF ke rata-rata pool)
  - knn       : skor = -mean jarak ke k tetangga terdekat di pool baseline
  - maha      : Mahalanobis + shrinkage diagonal (Ledoit-Wolf sederhana)
  - iforest   : isolation forest saja (sudah ada di JS)
  - ens_*     : ensemble bobot dgn IF
"""
import sqlite3, math, pathlib, sys, random, argparse
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

# --- reuse mesin dari reproduce_db ---
import importlib.util
_here=pathlib.Path(__file__).parent
spec=importlib.util.spec_from_file_location("rdb", str(_here/"reproduce_db.py"))
rdb=importlib.util.module_from_spec(spec); spec.loader.exec_module(rdb)

def calibrate_thresholds_parametric(baseline_scores, k_low=3.3, k_med_extra=2.0):
    """Padanan PERSIS bg_core.py:calibrate_thresholds_parametric / risk.js.
    Ditambahkan 2026-09-04: konfigurasi TERKIRIM memakai calibrationMode='parametric',
    tetapi berkas ini dulu hanya bisa mengukur mode 'quantile'. Akibatnya angka
    headline parametrik di config.js TIDAK bisa direproduksi oleh skrip mana pun
    di repo ini. Sekarang bisa: `python research/experiment.py --calib parametric`."""
    n=len(baseline_scores)
    if n==0: return {'low':-0.4,'medium':-0.8}
    m=sum(baseline_scores)/n
    v=sum((x-m)**2 for x in baseline_scores)/n
    sd=math.sqrt(v) if v>1e-12 else 1.0
    return {'low': m-k_low*sd, 'medium': m-(k_low+k_med_extra)*sd}

F4=rdb.F4
IF=rdb.IF
compute_stats=rdb.compute_stats
standardize=rdb.standardize
score_stats=rdb.score_stats
calibrate_thresholds=rdb.calibrate_thresholds
gate_weights=rdb.gate_weights
dedup_behavioral=rdb.dedup_behavioral
to_risk=rdb.to_risk
roc=rdb.roc
find_db=rdb.find_db
SUBJECT_IDS=rdb.SUBJECT_IDS

# ---------------- MODEL PENGGANTI (semua browser-trainable) ----------------
class Centroid:
    """RBF ke rata-rata pool - SAMA dgn ocsvm.js yang dikirim."""
    def __init__(self, nfeat): self.gamma=1.0/nfeat; self.mean=None
    def fit(self, X):
        d=len(X[0]); self.mean=[sum(v[i] for v in X)/len(X) for i in range(d)]
    def score_one(self, x):
        return math.exp(-self.gamma*sum((x[i]-self.mean[i])**2 for i in range(len(x))))

class KNN:
    """skor = -rata-rata jarak Euclidean ke k tetangga terdekat di pool.
    Higher=normal. Simpan seluruh pool (di JS: array kecil, <=30 vektor)."""
    def __init__(self, k=5): self.k=k; self.pool=[]
    def fit(self, X): self.pool=[list(v) for v in X]
    def score_one(self, x):
        if not self.pool: return 0.0
        ds=sorted(math.sqrt(sum((x[i]-p[i])**2 for i in range(len(x)))) for p in self.pool)
        k=min(self.k, len(ds))
        return -sum(ds[:k])/k

class Mahalanobis:
    """Mahalanobis + shrinkage diagonal. Cov diestimasi dari pool (dgn shrink
    ke diagonal biar non-singular di 28 dim / <=30 sampel). Inversi via
    solve gauss-jordan. Semua bisa diport ke JS (aljabar linear ~60 baris)."""
    def __init__(self, shrink=0.3): self.shrink=shrink; self.mean=None; self.inv=None
    def fit(self, X):
        n=len(X); d=len(X[0])
        mean=[sum(v[i] for v in X)/n for i in range(d)]
        # covariance
        cov=[[0.0]*d for _ in range(d)]
        for v in X:
            dv=[v[i]-mean[i] for i in range(d)]
            for i in range(d):
                for j in range(d):
                    cov[i][j]+=dv[i]*dv[j]
        denom=max(1,n-1)
        for i in range(d):
            for j in range(d): cov[i][j]/=denom
        # shrinkage: (1-a)S + a*mu*I  (mu = rata2 diagonal)
        mu=sum(cov[i][i] for i in range(d))/d
        a=self.shrink
        for i in range(d):
            for j in range(d):
                cov[i][j]=(1-a)*cov[i][j] + (a*mu if i==j else 0.0)
            cov[i][i]+=1e-6
        self.mean=mean; self.inv=self._inv(cov, d)
    def _inv(self, A, d):
        # gauss-jordan
        M=[row[:]+[1.0 if i==j else 0.0 for j in range(d)] for i,row in enumerate(A)]
        for col in range(d):
            piv=max(range(col,d), key=lambda r: abs(M[r][col]))
            if abs(M[piv][col])<1e-12: M[piv][col]=1e-12
            M[col],M[piv]=M[piv],M[col]
            pv=M[col][col]
            M[col]=[x/pv for x in M[col]]
            for r in range(d):
                if r!=col and M[r][col]!=0:
                    f=M[r][col]; M[r]=[M[r][k]-f*M[col][k] for k in range(2*d)]
        return [row[d:] for row in M]
    def score_one(self, x):
        d=len(x); dv=[x[i]-self.mean[i] for i in range(d)]
        # dv^T inv dv
        tmp=[sum(self.inv[i][j]*dv[j] for j in range(d)) for i in range(d)]
        m2=sum(dv[i]*tmp[i] for i in range(d))
        return -math.sqrt(max(0.0,m2))

def make_model(kind, nfeat, **kw):
    if kind=='centroid': return Centroid(nfeat)
    if kind=='knn': return KNN(k=kw.get('k',5))
    if kind=='maha': return Mahalanobis(shrink=kw.get('shrink',0.3))
    raise ValueError(kind)

# ---------------- run_fold general (port dari reproduce_db, model pluggable) --
def run_fold(c, subject_ids, weights, q_low, model_kind='centroid', model_kw=None,
             feature_cols=None, calib='quantile', k_low=3.3, k_med_extra=2.0):
    if feature_cols is None: feature_cols=F4
    if model_kw is None: model_kw={}
    nfeat=len(feature_cols)
    totalOwner=ownerNonLow=ownerHigh=0; totalImp=impLow=0; convs=0
    owner_scores=[]; imp_scores=[]
    for uid in subject_ids:
        cols=','.join('f.'+f for f in feature_cols)
        rows=c.execute(f"SELECT s.session_id, s.event_count, {cols} FROM features f JOIN sessions s USING(session_id) WHERE s.user_id=? ORDER BY s.session_id",(uid,)).fetchall()
        vecs=[list(r[2:]) for r in rows]; ecounts=[r[1] for r in rows]
        def is_eligible(vec, ec):
            nz=sum(1 for v in vec if abs(v)>1e-9)
            dur=vec[feature_cols.index('temporal_session_duration')] if 'temporal_session_duration' in feature_cols else 10.0
            return (ec or 0)>=100 and dur>=5.0 and nz>=6
        baseline=10; step=6; window=6; MAX_POOL=30
        pool=vecs[:baseline]
        def build(pool_vecs, qq):
            base_n=min(baseline,len(pool_vecs)); base_part=pool_vecs[:base_n]; low_part=pool_vecs[base_n:]
            if len(low_part)>MAX_POOL-base_n: low_part=low_part[-(MAX_POOL-base_n):]
            low_part=dedup_behavioral(low_part, feature_cols)
            pool_vecs=base_part+low_part
            if not pool_vecs: pool_vecs=vecs[:1]
            stats=compute_stats(pool_vecs); Xstd=[standardize(v,stats) for v in pool_vecs]
            iff=IF(); iff.fit(Xstd)
            mdl=make_model(model_kind,nfeat,**model_kw); mdl.fit(Xstd)
            n=len(pool_vecs); gw=gate_weights(weights,n)
            if gw['svm']==0:
                m1,s1=score_stats([iff.score_one(x) for x in Xstd])
                def ens_fn(v): return (iff.score_one(standardize(v,stats))-m1)/s1
            else:
                m1,s1=score_stats([iff.score_one(x) for x in Xstd])
                m2,s2=score_stats([mdl.score_one(x) for x in Xstd])
                def ens_fn(v):
                    xs=standardize(v,stats)
                    return gw['isolation_forest']*((iff.score_one(xs)-m1)/s1)+gw['svm']*((mdl.score_one(xs)-m2)/s2)
            base_scores=[ens_fn(v) for v in pool_vecs]
            if calib=='parametric':
                thr=calibrate_thresholds_parametric(base_scores,k_low,k_med_extra)
            else:
                thr=calibrate_thresholds(base_scores,q_low=qq,q_med=qq*0.33)
            return ens_fn,thr
        ens,thr=build(pool,q_low)
        scores=[]
        for i in range(baseline,len(vecs)):
            if (len(pool)-baseline)%step==0 and len(pool)>baseline:
                recent=scores[-window:] if len(scores)>=window else []
                windowLow=len(recent)==window and all(x=='LOW' for x in recent)
                other_ids=[x for x in subject_ids if x!=uid]
                if other_ids:
                    rng_sub=random.Random(hash(tuple(sorted(other_ids)))+42)
                    shuf=list(other_ids); rng_sub.shuffle(shuf)
                    cohort_ids=set(shuf[:len(shuf)//2])
                    q_cohort=','.join(str(x) for x in cohort_ids) if cohort_ids else ','.join(str(x) for x in other_ids)
                    cohort_rows=c.execute(f"SELECT {','.join('f.'+f for f in feature_cols)} FROM features f JOIN sessions s USING(session_id) WHERE s.user_id IN ({q_cohort}) ORDER BY s.session_id").fetchall() if cohort_ids else []
                    cohort_scores=[ens(list(r)) for r in cohort_rows]
                    lowRate=sum(1 for sc in cohort_scores if sc>thr['low'])/len(cohort_scores) if cohort_scores else 1
                else: lowRate=1
                isConv=windowLow and lowRate<=0.35
                if not isConv: ens,thr=build(pool,q_low)
            v=vecs[i]; ec=ecounts[i]; sc=ens(v); owner_scores.append(sc)
            lvl=to_risk(sc,thr); scores.append(lvl); totalOwner+=1
            if lvl!='LOW': ownerNonLow+=1
            if lvl=='HIGH': ownerHigh+=1
            if lvl=='LOW' and is_eligible(v,ec): pool.append(v)
        if len(scores)>=window and all(x=='LOW' for x in scores[-window:]): convs+=1
        other_ids=[x for x in subject_ids if x!=uid]
        if other_ids:
            rng_sub=random.Random(hash(tuple(sorted(other_ids)))+99)
            shuf=list(other_ids); rng_sub.shuffle(shuf)
            far_ids=set(shuf[len(shuf)//2:])
            q_far=','.join(str(x) for x in far_ids) if far_ids else ','.join(str(x) for x in other_ids)
            other_rows=c.execute(f"SELECT {','.join('f.'+f for f in feature_cols)} FROM features f JOIN sessions s USING(session_id) WHERE s.user_id IN ({q_far}) ORDER BY s.session_id").fetchall()
            for r in other_rows:
                sc_imp=ens(list(r)); imp_scores.append(sc_imp); totalImp+=1
                if to_risk(sc_imp,thr)=='LOW': impLow+=1
    return dict(frr=ownerNonLow/totalOwner*100 if totalOwner else 0, ownerHigh=ownerHigh, blockPct=ownerHigh/totalOwner*100 if totalOwner else 0,
                far=impLow/totalImp*100 if totalImp else 0, conv=convs, nsub=len(subject_ids),
                ownerNonLow=ownerNonLow, owner=totalOwner, impLow=impLow, imp=totalImp,
                owner_scores=owner_scores, imp_scores=imp_scores)

def evaluate(c, model_kind, weights, model_kw=None, cands=(0.10,0.12,0.15,0.18,0.20), calib='quantile'):
    rng=random.Random(42); shuf=list(SUBJECT_IDS); rng.shuffle(shuf)
    fold_tune=sorted(shuf[:8]); fold_report=sorted(shuf[8:])
    best_q=None; best_gap=1e9
    for q in cands:
        r=run_fold(c,fold_tune,weights,q,model_kind,model_kw,calib=calib)
        gap=abs(r['frr']-r['far'])
        if gap<best_gap: best_gap=gap; best_q=q
    rep=run_fold(c,fold_report,weights,best_q,model_kind,model_kw,calib=calib)
    rc=roc(rep['owner_scores'],rep['imp_scores'])
    return best_q, rep, rc

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--db'); ap.add_argument('--quick',action='store_true')
    ap.add_argument('--calib', choices=['quantile','parametric'], default='quantile',
                    help="mode kalibrasi ambang; 'parametric' = yang BENAR-BENAR dikirim di config.js")
    args=ap.parse_args()
    db=args.db or find_db(); c=sqlite3.connect(db)
    print(f"DB: {db}\nProtokol: held-out 8/8 seed42, tune q di FOLD-TUNE, lapor FOLD-REPORT\n")
    W73={'isolation_forest':0.70,'svm':0.30,'lstm':0}
    W55={'isolation_forest':0.50,'svm':0.50,'lstm':0}
    W37={'isolation_forest':0.30,'svm':0.70,'lstm':0}
    W_ONLY={'isolation_forest':0.0,'svm':1.0,'lstm':0}
    configs=[
        ("centroid W7 (DIKIRIM skrg)", 'centroid', W73, {}),
        ("knn k=5 W7",   'knn',  W73, {'k':5}),
        ("knn k=5 5/5",  'knn',  W55, {'k':5}),
        ("knn k=5 3/7",  'knn',  W37, {'k':5}),
        ("knn k=5 ONLY", 'knn',  W_ONLY, {'k':5}),
        ("knn k=3 3/7",  'knn',  W37, {'k':3}),
        ("knn k=8 3/7",  'knn',  W37, {'k':8}),
        ("maha s.3 W7",  'maha', W73, {'shrink':0.3}),
        ("maha s.3 3/7", 'maha', W37, {'shrink':0.3}),
        ("maha s.5 3/7", 'maha', W37, {'shrink':0.5}),
        ("maha s.5 ONLY",'maha', W_ONLY, {'shrink':0.5}),
    ]
    if args.quick: configs=configs[:5]
    print(f"{'config':24s} {'q':>4s} {'FRR':>6s} {'FAR':>6s} {'AUC':>6s} {'EER':>6s} {'conv':>5s}")
    print("-"*64)
    results=[]
    for name,kind,w,kw in configs:
        q,rep,rc=evaluate(c,kind,w,kw,calib=args.calib)
        results.append((name,rep,rc))
        print(f"{name:24s} {q:4.2f} {rep['frr']:5.1f}% {rep['far']:5.1f}% {rc['auc']:.3f} {rc['eer']:5.1f}% {rep['conv']:2d}/{rep['nsub']}")
    print("-"*64)
    # ranking by EER (model quality, threshold-independent)
    results.sort(key=lambda t:t[2]['eer'])
    print("\nRanking by EER (kualitas model, bebas-threshold):")
    for name,rep,rc in results[:5]:
        print(f"  {name:24s} EER {rc['eer']:5.1f}% AUC {rc['auc']:.3f} | FRR {rep['frr']:.1f}% FAR {rep['far']:.1f}% FAR@FRR15% {rc['far_at_15']:.1f}%")

if __name__=='__main__': main()
