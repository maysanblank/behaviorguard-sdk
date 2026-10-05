"""
reproduce.py - ILUSTRASI SINTETIS BLOB (bukan reproduksi DB)
DEPRECATED: pakai reproduce_simple.py untuk ilustrasi rumus,
atau reproduce_db.py untuk bukti atas DB asli.
Blob acak ini tidak mereplikasi sebaran 653 sesi nyata.
"""
import math, random
from collections import defaultdict

DEFAULTS = dict(baseline=10, retrainEvery=6, thresholds=dict(low=-0.4, medium=-0.8), convergence=dict(window=3, cohortLowRate=0.35))

def mulberry32(a):
    def rng():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = (t ^ (t >> 15)) * (t | 1) & 0xFFFFFFFF
        t = (t ^ (t + ((t ^ (t >> 7)) * (t | 61) & 0xFFFFFFFF) & 0xFFFFFFFF)) & 0xFFFFFFFF
        t = (t ^ (t >> 14)) & 0xFFFFFFFF
        return t / 4294967296
    return rng

def c_factor(n):
    if n<=1: return 0
    if n==2: return 1
    return 2*(math.log(n-1)+0.5772156649) - 2*(n-1)/n

class IsolationForest:
    def __init__(self, n_estimators=100, max_samples=256, seed=42):
        self.n_estimators=n_estimators; self.max_samples=max_samples; self.seed=seed; self.trees=[]; self.c=1
    def fit(self,X):
        if not X: return
        n=min(self.max_samples,len(X)); self.c=c_factor(n)
        rng=mulberry32(self.seed); self.trees=[]
        for _ in range(self.n_estimators):
            idx=list(range(len(X))); 
            for i in range(len(idx)-1,0,-1):
                j=int(rng()*(i+1)); idx[i],idx[j]=idx[j],idx[i]
            sample=[X[i] for i in idx[:n]]
            self.trees.append(self._build(sample,0,math.ceil(math.log2(n)),rng))
    def _build(self,pts,depth,maxD,rng):
        if depth>=maxD or len(pts)<=1: return dict(leaf=True,size=len(pts))
        feat=int(rng()*len(pts[0])); vals=[p[feat] for p in pts]; mn=min(vals); mx=max(vals)
        if mn==mx: return dict(leaf=True,size=len(pts))
        split=mn+rng()*(mx-mn); left=[p for p in pts if p[feat]<split]; right=[p for p in pts if p[feat]>=split]
        if not left or not right: return dict(leaf=True,size=len(pts))
        return dict(feat=feat,split=split,left=self._build(left,depth+1,maxD,rng),right=self._build(right,depth+1,maxD,rng))
    def _path(self,x,node,d):
        if node.get('leaf'): return d+c_factor(node['size'])
        if x[node['feat']] < node['split']: return self._path(x,node['left'],d+1)
        return self._path(x,node['right'],d+1)
    def score_one(self,x):
        if not self.trees: return 0
        avg=sum(self._path(x,t,0) for t in self.trees)/len(self.trees)
        anom=2**(-avg/self.c) if self.c else 0.5
        return 0.5-anom
    def predict(self,X): return [self.score_one(x) for x in X]

class OCSVM:
    def __init__(self,gamma=0.5): self.gamma=gamma; self.mean=None; self.thr=0
    def fit(self,X):
        if not X: return
        d=len(X[0]); self.mean=[0]*d
        for v in X:
            for i in range(d): self.mean[i]+=v[i]
        for i in range(d): self.mean[i]/=len(X)
        scores=sorted(self._raw(x) for x in X)
        self.thr=scores[int(len(scores)*0.10)] if scores else 0
    def _raw(self,x):
        return math.exp(-self.gamma*sum((x[i]-self.mean[i])**2 for i in range(len(x))))
    def score_one(self,x):
        if self.mean is None: return 0
        return self._raw(x)-self.thr-0.1
    def predict(self,X): return [self.score_one(x) for x in X]

def compute_stats(vecs):
    d=len(vecs[0]); mean=[0]*d
    for v in vecs:
        for i in range(d): mean[i]+=v[i]
    for i in range(d): mean[i]/=len(vecs)
    var=[0]*d
    for v in vecs:
        for i in range(d): var[i]+=(v[i]-mean[i])**2
    for i in range(d): var[i]/=len(vecs)
    std=[math.sqrt(v) if math.sqrt(v)>1e-9 else 1 for v in var]
    return mean,std

def standardize(v,stats): return [(v[i]-stats[0][i])/stats[1][i] for i in range(len(v))]
def score_stats(scores):
    m=sum(scores)/len(scores); s=math.sqrt(sum((x-m)**2 for x in scores)/len(scores)) or 1; return m,s
def zscore(val, st): return (val-st[0])/st[1]

class Ensemble:
    def __init__(self,iff,ocs,weights):
        s=sum(weights.values()); self.w={k:v/s for k,v in weights.items()} if s else weights
        self.iff=iff; self.ocs=ocs; self.ifS=None; self.svmS=None
    def calibrate(self,Xstd):
        self.ifS=score_stats(self.iff.predict(Xstd)); self.svmS=score_stats(self.ocs.predict(Xstd))
    def score_one(self,xstd):
        rawIF=self.iff.score_one(xstd); rawSVM=self.ocs.score_one(xstd)
        zIF=zscore(rawIF,self.ifS) if self.ifS else rawIF
        zSVM=zscore(rawSVM,self.svmS) if self.svmS else rawSVM
        if not self.svmS: return zIF
        return self.w['isolation_forest']*zIF + self.w['svm']*zSVM

def to_risk(score, thr=dict(low=-0.4,medium=-0.8)):
    if score <= thr['medium']: return 'HIGH'
    if score <= thr['low']: return 'MEDIUM'
    return 'LOW'

def gen_sessions(nSubj=16,nPer=41,nFeat=28,seed=42):
    r=random.Random(seed)
    subs=[]
    for _ in range(nSubj):
        center=[(r.random()*2-1)*1.2 for _ in range(nFeat)]
        sess=[[c + r.gauss(0,0.45) for c in center] for _ in range(nPer)]
        subs.append(sess)
    return subs

def prequential(subjects, weights):
    base=10; step=6
    totalOwner=ownerNonLow=0
    totalImp=impLow=0
    convSubj=0
    allVecs=[v for s in subjects for v in s]
    for s_idx, sess in enumerate(subjects):
        vecs=sess[:base]
        def build():
            stats=compute_stats(vecs); Xstd=[standardize(v,stats) for v in vecs]
            iff=IsolationForest(seed=42); iff.fit(Xstd); ocs=OCSVM(gamma=0.5); ocs.fit(Xstd); ens=Ensemble(iff,ocs,weights); ens.calibrate(Xstd); return stats,ens
        stats,model=build()
        scores=[]
        for i in range(base, len(sess)):
            if (len(vecs)-base)%step==0 and len(vecs)>base:
                recent=scores[-3:] if len(scores)>=3 else []
                windowLow=len(recent)==3 and all(x=='LOW' for x in recent)
                cohort=allVecs[::11][:60]  # sample
                # filter out same subject
                cohortScores=[]
                for v in allVecs:
                    # crude: skip same subject's vectors
                    if v in sess: continue
                    if len(cohortScores)>=60: break
                    cohortScores.append(model.score_one(standardize(v,stats)))
                lowRate=sum(1 for sc in cohortScores if sc>-0.4)/len(cohortScores) if cohortScores else 0
                isConv=windowLow and lowRate<=0.35
                if not isConv:
                    stats,model=build()
                else:
                    convSubj+=0  # will count later
            v=sess[i]
            xstd=standardize(v,stats)
            sc=model.score_one(xstd); lvl=to_risk(sc)
            scores.append(lvl); totalOwner+=1; 
            if lvl!='LOW': ownerNonLow+=1
            vecs.append(v)
        # konvergen if last 6 LOW
        if len(scores)>=6 and all(x=='LOW' for x in scores[-6:]):
            convSubj+=1
        # FAR: final model vs other subjects
        if model is None:
            stats,model=build()
        for t_idx, other in enumerate(subjects):
            if t_idx==s_idx: continue
            for v in other:
                totalImp+=1
                xstd=standardize(v,stats)
                if to_risk(model.score_one(xstd))=='LOW': impLow+=1
    return totalOwner,ownerNonLow,totalImp,impLow,convSubj

def run(weights,label):
    subs=gen_sessions()
    to, on, ti, il, conv = prequential(subs, weights)
    frr=on/to*100 if to else 0; far=il/ti*100 if ti else 0
    print(f"\n[{label}] {weights}")
    print(f"  Owner: {on}/{to} bukan-LOW -> FRR {frr:.1f}%")
    print(f"  Impostor: {il}/{ti} lolos LOW -> FAR {far:.1f}%")
    print(f"  Error {(frr+far)/2:.1f}% | Konvergen {conv}/16")
    return frr,far

print("BehaviorGuard - Reproduksi Prequential (Python, deterministik seed 42)")
print("Dataset sintetis 16x41~653 sesi, 28 fitur F4")
print("------------------------------------------------------------")
w7=dict(isolation_forest=0.70, svm=0.30, lstm=0)
w_if=dict(isolation_forest=1.0, svm=0, lstm=0)
r1=run(w7,"FINAL F4·W7 base10/retrain6")
r2=run(w_if,"ABLATION tanpa SVM (IF 100%)")
print("\n--- Determinisme cek ---")
r3=run(w7,"RE-RUN W7")
print(f"Deterministik: {'YA ✓' if r1==r3 else 'TIDAK ✗'}")
print(f"Ablation: FAR tanpa SVM {r2[1]:.1f}% vs dengan SVM {r1[1]:.1f}% -> {r2[1]/r1[1]:.1f}x (harus ~2x) {'✓' if r2[1] > r1[1]*1.6 else '✗'}")
is_close = abs(r1[0]-15.2)<3 and abs(r1[1]-12.1)<3
print(f"Kriteria FINAL FRR~15.2 FAR~12.1 -> got {r1[0]:.1f}/{r1[1]:.1f} {'✓ dalam toleransi' if is_close else '✗ MELenceng - jangan klaim lulus, ini sintetis'}")
if not is_close:
    print("CATATAN: ini sintetis blob, bukan bukti validasi. Jalankan research/reproduce_db.py untuk angka DB asli.")
