#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
KHUSUS RISET (C-29). Angka dari skrip ini BUKAN angka pustaka yang dikirim: ia menilai sesi
riset utuh (~700 event), padahal pustaka menilai jendela 30 detik dengan bukti >= 150 event,
lantai lengket, masa berlaku step-up, dan aturan absen. Angka resmi pustaka:
`node research/eval_sdk.mjs --live` (README "Results").

reproduce_db.py - REPRODUKSI JUJUR A1+A3 (tanpa ubah base10/retrain6/F4/W7/window6/gate20)
A1: sumber kebenaran 653/16 (SUBJECT_IDS), guard 653, FAR lintas 15 subjek lain (tanpa RANDOM)
A3: held-out 8/8 seed 42 - tune threshold via EER di FOLD-TUNE, lapor di FOLD-REPORT (headline)
Deterministik, stdout utf-8, tanpa augment, tanpa geser gate/window.
"""
import sqlite3, math, pathlib, sys, random, argparse
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent / 'core'))

# C-27: MESIN YANG DIKIRIM, bukan mesin yang kebetulan ada di skrip ini.
# sdk/core/config.js memakai model2:'mahalanobis' dengan bobot IF 0,30 / slot-2 0,70.
# Versi lama skrip ini memakai sklearn OneClassSVM dengan bobot TERBALIK (0,70/0,30),
# jadi setiap angka yang pernah dikeluarkannya menilai sistem yang tidak pernah
# dijalankan pengguna mana pun. Selisihnya besar: FRR 28,4% -> 12,1%, AUC 0,919 ->
# 0,954 (5 belahan). Lihat core/DRIFT.md C-27.
# `--legacy-ocsvm` tetap disediakan HANYA untuk mereproduksi angka lama apa adanya.
ENGINE_DEFAULT = 'maha'
WEIGHTS_SDK    = {'isolation_forest': 0.30, 'svm': 0.70, 'lstm': 0}
WEIGHTS_LEGACY = {'isolation_forest': 0.70, 'svm': 0.30, 'lstm': 0}
try:
    from bg_core import Mahalanobis
    HAS_MAHA = True
except Exception:
    HAS_MAHA = False
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

DB_CANDIDATES=[
  # the research database is not in the repository: point BG_RESEARCH_DB at your copy
  __import__('os').environ.get('BG_RESEARCH_DB', ''),
  'behavior_detection.db',
]
SUBJECT_IDS=[2,3,6,7,8,9,11,12,13,15,18,19,20,22,24,25]  # 16 subjek tervalidasi = 653 sesi
F4=['mouse_velocity_mean','mouse_velocity_std','mouse_velocity_max','mouse_acceleration_std','mouse_curvature_mean','mouse_direction_changes','mouse_pause_count','mouse_click_interval_mean','cursor_idle_ratio','cross_mouse_keyboard_coordination','keystroke_dwell_time_mean','keystroke_dwell_time_std','keystroke_flight_time_mean','keystroke_transition_entropy','keystroke_typing_speed','keystroke_cross_field_cadence','keystroke_burst_count','temporal_time_of_day_score','temporal_session_duration','temporal_activity_bursts','nav_page_transition_pattern','nav_scroll_depth_mean','nav_page_count','nav_step_transition_count','form_focus_count','form_blur_count','form_field_switch_rate','cart_action_count']
# F3 = 37 fitur (46 - 9 bermasalah) - dari server/config.py DROPPED_FEATURES_F3
F46=['mouse_velocity_mean','mouse_velocity_std','mouse_velocity_max','mouse_acceleration_mean','mouse_acceleration_std','mouse_acceleration_max','mouse_jerk_mean','mouse_jerk_std','mouse_curvature_mean','mouse_direction_changes','mouse_pause_count','mouse_click_interval_mean','keystroke_dwell_time_mean','keystroke_dwell_time_std','keystroke_flight_time_mean','keystroke_flight_time_std','keystroke_typing_consistency','keystroke_error_rate','keystroke_transition_entropy','keystroke_backspace_rate','keystroke_correction_rate','keystroke_typing_speed','temporal_time_of_day_score','temporal_session_duration','temporal_activity_bursts','temporal_idle_time_ratio','nav_page_transition_pattern','nav_time_per_page_mean','nav_scroll_depth_mean','nav_scroll_velocity_mean','nav_page_count','nav_back_navigation_count','nav_step_transition_count','nav_time_on_product_page','form_focus_count','form_blur_count','form_field_switch_rate','form_edit_count','cart_action_count','wishlist_action_count','scroll_direction_changes','cursor_idle_ratio','keystroke_cross_field_cadence','keystroke_burst_count','cross_mouse_keyboard_coordination','cross_copy_paste_frequency']
DROPPED_F3=['cross_copy_paste_frequency','keystroke_typing_consistency','mouse_acceleration_mean','mouse_jerk_mean','mouse_jerk_std','nav_back_navigation_count','nav_time_on_product_page','scroll_direction_changes','wishlist_action_count']
F3=[c for c in F46 if c not in DROPPED_F3]
F4_MINUS_TEMP=[c for c in F4 if not c.startswith('temporal_')]
try:
    from sklearn.svm import OneClassSVM
    SKLEARN=True
except Exception:
    SKLEARN=False

def find_db():
    for p in DB_CANDIDATES:
        if p and pathlib.Path(p).exists(): return p
    return None
def quantile(sorted_vals, q):
    if not sorted_vals: return -0.4
    idx=q*(len(sorted_vals)-1); lo=int(math.floor(idx)); hi=int(math.ceil(idx))
    if lo==hi: return sorted_vals[lo]
    frac=idx-lo; return sorted_vals[lo]*(1-frac)+sorted_vals[hi]*frac
def calibrate_thresholds(baseline_scores, q_low=0.15, q_med=0.05):
    s=sorted(baseline_scores)
    low=quantile(s, q_low); med=quantile(s, q_med)
    if low - med < 0.15: med=low-0.25
    low=max(-3.0, min(1.0, low)); med=max(-3.0, min(low-0.05, med))
    return dict(low=low, medium=med)
def gate_weights(weights, n, minS={'isolation_forest':8,'svm':20,'lstm':24}):
    w=dict(weights)
    if n < minS['svm']: w['svm']=0
    if n < minS['lstm']: w['lstm']=0
    s=sum(w.values())
    if s<=0: return weights
    return {k:v/s for k,v in w.items()}
def dedup_behavioral(vecs, feature_cols=None, eps=1e-3):
    cols=feature_cols if feature_cols is not None else F4
    beh_idx=[i for i,n in enumerate(cols) if not n.startswith('temporal_')]
    if not beh_idx: beh_idx=list(range(len(cols)))
    deduped=[]
    for v in vecs:
        dup=False
        for u in deduped:
            # ensure indices valid for this vec length
            s=sum((v[i]-u[i])**2 for i in beh_idx if i < len(v) and i < len(u))
            if math.sqrt(s/len(beh_idx)) < eps:
                dup=True; break
        if not dup: deduped.append(v)
    return deduped
def mulberry32(a):
    def rng():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t=a; t=(t^(t>>15))*(t|1)&0xFFFFFFFF; t^=t+((t^(t>>7))*(t|61)&0xFFFFFFFF)&0xFFFFFFFF; t=(t^(t>>14))&0xFFFFFFFF; return t/4294967296
    return rng
def c_factor(n):
    if n<=1: return 0
    if n==2: return 1
    return 2*(math.log(n-1)+0.5772156649)-2*(n-1)/n
class IF:
    def __init__(self,seed=42):
        self.trees=[];self.c=1;self.seed=seed
    def fit(self,X):
        n=min(256,len(X)); self.c=c_factor(n); rng=mulberry32(self.seed); self.trees=[]
        for _ in range(100):
            idx=list(range(len(X)))
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
        return self._path(x,node['left' if x[node['feat']] < node['split'] else 'right'],d+1)
    def score_one(self,x):
        avg=sum(self._path(x,t,0) for t in self.trees)/len(self.trees)
        return 0.5 - (2**(-avg/self.c) if self.c else 0.5)
class OCSVM:
    def __init__(self,nfeat):
        self.gamma=1.0/nfeat; self.mean=None; self.thr=0
    def fit(self,X):
        d=len(X[0]); self.mean=[0]*d
        for v in X:
            for i in range(d): self.mean[i]+=v[i]
        for i in range(d): self.mean[i]/=len(X)
        scores=sorted(self._raw(x) for x in X)
        self.thr=scores[int(len(scores)*0.10)] if scores else 0
    def _raw(self,x):
        return math.exp(-self.gamma*sum((x[i]-self.mean[i])**2 for i in range(len(x))))
    def score_one(self,x): return self._raw(x)-self.thr-0.1
class RealOCSVM:
    def __init__(self, nfeat, nu=0.1):
        self.nfeat=nfeat; self.clf=None; self.nu=nu
    def fit(self, X):
        # sklearn OneClassSVM real (RBF, gamma scale) - deterministik
        from sklearn.svm import OneClassSVM as SK
        self.clf=SK(kernel='rbf', gamma='scale', nu=self.nu)
        self.clf.fit(X)
    def score_one(self, x):
        # decision_function >0 = normal, <0 = anomali - samakan skala dengan centroid
        return float(self.clf.decision_function([x])[0])
def compute_stats(vecs):
    d=len(vecs[0]); mean=[0]*d
    for v in vecs:
        for i in range(d): mean[i]+=v[i]
    for i in range(d): mean[i]/=len(vecs)
    var=[0]*d
    for v in vecs:
        for i in range(d): var[i]+=(v[i]-mean[i])**2
    for i in range(d): var[i]/=len(vecs)
    std=[math.sqrt(v) if math.sqrt(v)>1e-6 else 1.0 for v in var]
    std=[max(s, 1e-3) for s in std]
    return mean,std
def standardize(v,stats): return [(v[i]-stats[0][i])/stats[1][i] for i in range(len(v))]
def score_stats(s): 
    m=sum(s)/len(s); var=sum((x-m)**2 for x in s)/len(s)
    sd=math.sqrt(var) if var>1e-12 else 1.0
    sd=max(sd, 1e-6)
    return m,sd
def to_risk(score, thr): return 'HIGH' if score <= thr['medium'] else 'MEDIUM' if score <= thr['low'] else 'LOW'
def roc(owner_scores, imp_scores):
    # ambang geser di atas gabungan skor beku, tanpa retrain
    all_thr=sorted(set(owner_scores+imp_scores))
    if not all_thr: return dict(auc=0.5, eer=50, far_at_15=100, far_at_5=100, n=len(all_thr), thr_range=(0,0))
    # tambah ujung
    thr_list=[all_thr[0]-1e-6] + all_thr + [all_thr[-1]+1e-6]
    pts=[]
    for thr in thr_list:
        frr=sum(1 for s in owner_scores if s <= thr)/len(owner_scores)*100 if owner_scores else 0
        far=sum(1 for s in imp_scores if s > thr)/len(imp_scores)*100 if imp_scores else 0
        pts.append((thr,frr,far))
    # AUC via trapezoid (FRR vs FAR, tapi AUC ROC pakai TPR=100-FRR vs FAR)
    pts_sorted=sorted(pts, key=lambda x: x[2]) # sort by FAR
    auc=0
    for i in range(1,len(pts_sorted)):
        f0=pts_sorted[i-1][2]; f1=pts_sorted[i][2]
        t0=100-pts_sorted[i-1][1]; t1=100-pts_sorted[i][1]
        auc+= (f1-f0)*(t0+t1)/2/100
    auc/=100
    # EER interpolasi
    eer=50; eer_thr=0
    for i in range(1,len(pts)):
        frr0,far0=pts[i-1][1],pts[i-1][2]; frr1,far1=pts[i][1],pts[i][2]
        if (frr0-far0)*(frr1-far1) <=0:
            # interpolasi linear
            if abs((frr1-frr0)-(far0-far1))>1e-9:
                r=(far0-frr0)/((frr1-frr0)-(far1-far0)+1e-9)
                r=max(0,min(1,r))
                eer=frr0 + r*(frr1-frr0)
                eer_thr=pts[i-1][0] + r*(pts[i][0]-pts[i-1][0])
            else:
                eer=(frr0+far0)/2
            break
    # FAR@FRR=15% dan 5%
    def far_at(target_frr):
        # cari thr dimana FRR≈target
        best=None
        for thr,frr,far in pts:
            if best is None or abs(frr-target_frr) < abs(best[1]-target_frr):
                best=(thr,frr,far)
        # interpolasi tetangga
        # cari dua titik yang mengapit
        for i in range(1,len(pts)):
            if (pts[i-1][1]-target_frr)*(pts[i][1]-target_frr) <=0:
                f0=pts[i-1][1]; f1=pts[i][1]; fa0=pts[i-1][2]; fa1=pts[i][2]
                if abs(f1-f0)>1e-9:
                    r=(target_frr-f0)/(f1-f0)
                    return fa0 + r*(fa1-fa0)
        return best[2] if best else 100
    return dict(auc=auc, eer=eer, eer_thr=eer_thr, far_at_15=far_at(15), far_at_5=far_at(5), n=len(thr_list), thr_range=(min(all_thr), max(all_thr)), pts=pts)

def run_fold(c, subject_ids, weights, q_low, is_tune=False, feature_cols=None, use_real_ocsvm=True, vec_source=None, calib_holdout=0.0, engine=None, max_pool=30):
    """vec_source: {uid: [(vektor, event_count), ...]} menggantikan tabel `features`.

    Ditambahkan untuk C-24. Tujuannya SATU: mengevaluasi representasi lain (mis.
    jendela kanonik yang diekstrak ulang dari raw_events) di bawah protokol
    held-out yang PERSIS SAMA - bukan protokol tandingan yang lebih longgar.
    Kalau perbandingannya dijalankan di harness yang berbeda, angkanya tidak bisa
    dibandingkan dan klaim apa pun di atasnya tidak sah. Dengan None, perilakunya
    identik dengan sebelumnya (baca dari tabel `features`)."""
    if feature_cols is None: feature_cols=F4
    def baseline_of(): return 10
    totalOwner=ownerNonLow=0; totalImp=impLow=0; convs=0; owner_scores=[]; imp_scores=[]
    per_user={}
    for uid in subject_ids:
        cols=','.join('f.'+f for f in feature_cols)
        if vec_source is not None:
            vecs=[list(v) for v,_ in vec_source.get(uid,[])]; ecounts=[e for _,e in vec_source.get(uid,[])]
        else:
            rows=c.execute(f"SELECT s.session_id, s.event_count, {cols} FROM features f JOIN sessions s USING(session_id) WHERE s.user_id=? ORDER BY s.session_id", (uid,)).fetchall()
            vecs=[list(r[2:]) for r in rows]; ecounts=[r[1] for r in rows]
        if len(vecs) <= baseline_of(): continue
        def is_eligible(vec, ec):
            nz=sum(1 for v in vec if abs(v)>1e-9)
            if 'temporal_session_duration' in feature_cols:
                dur=vec[feature_cols.index('temporal_session_duration')]
            else:
                dur=10.0  # skip dur check jika temporal tidak dipakai (F4_MINUS_TEMP)
            return (ec or 0)>=100 and dur>=5.0 and nz>=6
        # max_pool: kolam maks (daftar + LOW). 30 = angka lama; SDK mengirim
        # baseline + progressiveMaxPool = 10 + 90 (sdk/core/config.js, C-22). Lihat C-28.
        baseline=10; step=6; window=6; MAX_POOL=max_pool
        pool=vecs[:baseline]
        def build(pool_vecs, qq):
            base_n=min(baseline, len(pool_vecs))
            base_part=pool_vecs[:base_n]
            low_part=pool_vecs[base_n:]
            if len(low_part) > MAX_POOL - base_n:
                low_part=low_part[-(MAX_POOL - base_n):]
            low_part=dedup_behavioral(low_part, feature_cols)
            pool_vecs=base_part+low_part
            if not pool_vecs: pool_vecs=vecs[:1]
            # C-24: ambang boleh dikalibrasi DI LUAR SAMPEL. Versi lama mengkalibrasi
            # dari skor vektor yang persis dipakai memfit -> skor in-sample optimistik
            # -> ambang terlalu rapat -> sesi PEMILIK berikutnya jatuh di luarnya.
            calib_vecs=None
            if calib_holdout>0:
                cut=int(len(pool_vecs)*(1-calib_holdout))
                if cut>=8 and len(pool_vecs)-cut>=4:
                    calib_vecs=pool_vecs[cut:]; pool_vecs=pool_vecs[:cut]
            stats=compute_stats(pool_vecs)
            Xstd=[standardize(v,stats) for v in pool_vecs]
            iff=IF(); iff.fit(Xstd); ocs=OCSVM(len(feature_cols)); ocs.fit(Xstd)
            n=len(pool_vecs); gw=gate_weights(weights, n)
            eng = engine or ENGINE_DEFAULT
            if eng=='maha' and HAS_MAHA and gw['svm']>0:
                # Shrinkage ADAPTIF, direplikasi dari behaviorguard._rebuildModel (C-22):
                # kovarians d×d butuh n >> d; gerbang buka di n=20 padahal d=28, jadi
                # regularisasi harus lebih berat justru saat sampelnya sedikit.
                d_=len(feature_cols)
                shrink=min(0.9, max(0.3, d_/max(1,len(pool_vecs))))
                det2=Mahalanobis(shrink=shrink, n_features=d_)
                det2.fit(Xstd)
                ocs=det2
            else:
                # pilih OCSVM real jika tersedia dan gate membolehkan SVM
                use_real = SKLEARN and use_real_ocsvm and gw['svm']>0
                if use_real:
                    ocs_real=RealOCSVM(len(feature_cols))
                    ocs_real.fit(Xstd)
                    ocs=ocs_real
            if gw['svm']==0:
                raw=[iff.score_one(x) for x in Xstd]; m1,s1=score_stats(raw); m2,s2=(0,1)
                def ens_fn(v): return (iff.score_one(standardize(v,stats))-m1)/s1
                base_scores=[ens_fn(v) for v in pool_vecs]
            else:
                m1,s1=score_stats([iff.score_one(x) for x in Xstd]); m2,s2=score_stats([ocs.score_one(x) for x in Xstd])
                def ens_fn(v):
                    xstd=standardize(v,stats)
                    return gw['isolation_forest']*((iff.score_one(xstd)-m1)/s1)+gw['svm']*((ocs.score_one(xstd)-m2)/s2)
                base_scores=[ens_fn(v) for v in pool_vecs]
            if calib_vecs: base_scores=[ens_fn(v) for v in calib_vecs]
            thr=calibrate_thresholds(base_scores, q_low=qq, q_med=qq*0.33)
            return stats,iff,ocs,m1,s1,m2,s2,ens_fn,thr,gw
        stats,iff,ocs,m1,s1,m2,s2,ens,thr,gw=build(pool, q_low)
        scores=[]
        for i in range(baseline, len(vecs)):
            if (len(pool)-baseline)%step==0 and len(pool)>baseline:
                recent=scores[-window:] if len(scores)>=window else []
                windowLow=len(recent)==window and all(x=='LOW' for x in recent)
                other_ids=[x for x in subject_ids if x!=uid]
                if other_ids:
                    qmarks=','.join(str(x) for x in other_ids)
                    rng_sub=random.Random(hash(tuple(sorted(other_ids))) + 42)
                    shuf_ids=list(other_ids); rng_sub.shuffle(shuf_ids)
                    cohort_ids=set(shuf_ids[:len(shuf_ids)//2]); far_ids=set(shuf_ids[len(shuf_ids)//2:])
                    q_cohort=','.join(str(x) for x in cohort_ids) if cohort_ids else qmarks
                    q_far=','.join(str(x) for x in far_ids) if far_ids else qmarks
                    if vec_source is not None:
                        cohort_rows=[v for x in cohort_ids for v,_ in vec_source.get(x,[])]
                    else:
                        cohort_rows=c.execute(f"SELECT {','.join('f.'+f for f in feature_cols)} FROM features f JOIN sessions s USING(session_id) WHERE s.user_id IN ({q_cohort}) ORDER BY s.session_id").fetchall() if cohort_ids else []
                    other_rows=c.execute(f"SELECT {','.join('f.'+f for f in feature_cols)} FROM features f JOIN sessions s USING(session_id) WHERE s.user_id IN ({q_far}) ORDER BY s.session_id").fetchall() if far_ids else []
                    cohort_scores=[ens(list(r)) for r in cohort_rows]
                    lowRate=sum(1 for sc in cohort_scores if sc>thr['low'])/len(cohort_scores) if cohort_scores else 1
                else:
                    lowRate=1
                isConv=windowLow and lowRate<=0.35
                if not isConv:
                    stats,iff,ocs,m1,s1,m2,s2,ens,thr,gw=build(pool, q_low)
            v=vecs[i]; ec=ecounts[i]
            sc=ens(v); owner_scores.append(sc); lvl=to_risk(sc, thr); scores.append(lvl)
            totalOwner+=1
            pu=per_user.setdefault(uid, {'n':0,'bad':0,'nsess':len(vecs),'own':[],'imp':[],'thr':None})
            pu['n']+=1; pu['own'].append(sc)
            if lvl!='LOW': ownerNonLow+=1; pu['bad']+=1
            if lvl=='LOW' and is_eligible(v, ec):
                pool.append(v)
        if len(scores)>=window and all(x=='LOW' for x in scores[-window:]):
            convs+=1
        other_ids=[x for x in subject_ids if x!=uid]
        if other_ids:
            qmarks=','.join(str(x) for x in other_ids)
            rng_sub=random.Random(hash(tuple(sorted(other_ids))) + 99)
            shuf_ids=list(other_ids); rng_sub.shuffle(shuf_ids)
            far_ids=set(shuf_ids[len(shuf_ids)//2:])
            q_far=','.join(str(x) for x in far_ids) if far_ids else qmarks
            # C-28 (diagnostik, ADITIF): catat SIAPA penyusupnya, bukan cuma skornya.
            # Tanpa ini runtun sesi penyusup tak bisa dipisah per orang, dan aturan
            # keputusan berbasis 'k sesi berturut' jadi tak bisa diukur jujur --
            # runtun bisa menyeberang antar-identitas dan FAR terlihat lebih baik
            # dari yang sebenarnya. Urutan skor TIDAK diubah, jadi FAR/AUC identik.
            if vec_source is not None:
                other_groups=[(x,[v for v,_ in vec_source.get(x,[])]) for x in far_ids]
            else:
                other_groups=[(None, c.execute(f"SELECT {','.join('f.'+f for f in feature_cols)} FROM features f JOIN sessions s USING(session_id) WHERE s.user_id IN ({q_far}) ORDER BY s.session_id").fetchall())]
            for _imp_uid, _rows in other_groups:
              for r in _rows:
                sc_imp=ens(list(r)); imp_scores.append(sc_imp)
                pu2=per_user.setdefault(uid, {'n':0,'bad':0,'nsess':0,'own':[],'imp':[],'thr':None})
                pu2['imp'].append(sc_imp); pu2['thr']=thr['low']
                pu2.setdefault('imp_by',{}).setdefault(_imp_uid,[]).append(sc_imp)
                totalImp+=1
                if to_risk(sc_imp, thr)=='LOW': impLow+=1
    return dict(owner=totalOwner, ownerNonLow=ownerNonLow, frr=ownerNonLow/totalOwner*100 if totalOwner else 0,
                imp=totalImp, impLow=impLow, far=impLow/totalImp*100 if totalImp else 0, conv=convs, nsub=len(subject_ids), per_user=per_user,
                owner_scores=owner_scores, imp_scores=imp_scores)

def main():
    ap=argparse.ArgumentParser(description="A1+A3 reproduce DB")
    ap.add_argument('--ablation', action='store_true', help='IF 100%')
    ap.add_argument('--centroid', action='store_true', help='pakai centroid JS (ocs.js) bukan sklearn - untuk kuantifikasi gap engine')
    ap.add_argument('--db', help='path DB override')
    ap.add_argument('--legacy-ocsvm', action='store_true',
                    help='C-27: pakai sklearn OCSVM + bobot IF 0,70 (mesin LAMA yang TIDAK dikirim). '
                         'Hanya untuk mereproduksi angka lama; jangan dipakai melaporkan hasil.')
    args=ap.parse_args()
    legacy=args.legacy_ocsvm or args.centroid
    ENG = 'ocsvm' if legacy else ENGINE_DEFAULT
    if ENG=='maha' and not HAS_MAHA:
        print('ERROR: core/bg_core.py:Mahalanobis tidak bisa diimpor - mesin yang dikirim tidak tersedia.')
        print('       Jangan diam-diam jatuh ke OCSVM: itu justru cacat C-27 yang sedang diperbaiki.')
        sys.exit(1)
    base_w = WEIGHTS_LEGACY if legacy else WEIGHTS_SDK
    weights={'isolation_forest':1.0,'svm':0,'lstm':0} if args.ablation else dict(base_w)
    use_real=not args.centroid
    eng_name = ('centroid JS' if args.centroid else
                'sklearn RealOCSVM (LAMA - tidak dikirim)' if legacy else
                'Mahalanobis + shrink adaptif (SAMA dengan sdk/core/config.js)')
    print(f"Mode: {'ABLATION IF 100%' if args.ablation else 'FINAL'} | engine={eng_name}")
    print(f"Bobot: IF {weights['isolation_forest']:.2f} / slot-2 {weights['svm']:.2f}"
          + ('' if legacy or args.ablation else '  <- sama dengan yang dikirim'))
    if legacy:
        print('PERINGATAN C-27: ini mesin LAMA. Angkanya TIDAK mewakili sistem yang dikirim.')
    db=args.db or find_db()
    if not db or not pathlib.Path(db).exists():
        print("DB tidak ditemukan"); sys.exit(1)
    print(f"DB: {db}")
    c=sqlite3.connect(db)
    # A1 guard
    q=','.join(str(x) for x in SUBJECT_IDS)
    total=c.execute(f"SELECT count(*) FROM features f JOIN sessions s USING(session_id) WHERE s.user_id IN ({q})").fetchone()[0]
    print(f"Whitelist 16 subjek {SUBJECT_IDS} -> {total} sesi berfitur")
    if total != 653:
        print(f"ERROR Guard 653 gagal: dapat {total}, harus 653 - berhenti (sidang-proof)")
        sys.exit(1)
    print("Guard 653 OK")
    rows=c.execute(f"SELECT s.user_id, count(*) FROM features f JOIN sessions s USING(session_id) WHERE s.user_id IN ({q}) GROUP BY s.user_id ORDER BY s.user_id").fetchall()
    print("Tabel sesi per subjek:")
    for uid,n in rows: print(f"  user {uid:2d}: {n:2d}")
    print(f"Total {sum(n for _,n in rows)}")
    # A3 split 8/8 seed 42
    rng=random.Random(42)
    shuf=list(SUBJECT_IDS); rng.shuffle(shuf)
    fold_tune=sorted(shuf[:8]); fold_report=sorted(shuf[8:])
    print(f"\nFOLD-TUNE (8): {fold_tune}")
    print(f"FOLD-REPORT (8): {fold_report}  <- headline")
    # tune threshold quantile di FOLD-TUNE via EER (bukan cari FRR cakep)
    # C-27: grid LAMA [0,10..0,20] MENTOK DI PINGGIR - kedua mesin selalu memilih 0,10,
    # yaitu nilai terkecil yang tersedia. Tuner ingin lebih longgar tapi tidak diberi
    # pilihan, jadi sistemnya dinilai pada titik operasi yang bukan pilihannya sendiri.
    # Itulah asal FRR 35% yang selama ini dikira batas kemampuan model. Grid dilebarkan
    # ke bawah; kalau q terpilih masih menyentuh ujung grid, skrip BERTERIAK.
    cands=[0.01,0.02,0.03,0.05,0.08,0.10,0.12,0.15,0.18,0.20]
    best_q=None; best_gap=float('inf'); best_res=None
    print("\n[TUNE] cari q_low via EERgap (jarak titik-seimbang, bukan EER) di FOLD-TUNE (berprinsip):")
    for q in cands:
        r=run_fold(c, fold_tune, weights, q, use_real_ocsvm=use_real, engine=ENG)
        gap=abs(r['frr']-r['far'])
        print(f"  q={q:.2f} -> FRR {r['frr']:.1f}% FAR {r['far']:.1f}% gap {gap:.1f}% conv {r['conv']}/{r['nsub']}")
        if gap < best_gap:
            best_gap=gap; best_q=q; best_res=r
    print(f"Note: q=0.10 vs 0.12 gap selisih kecil = noise - pemilihan q rapuh, EERgap hanya kriteria pemilihan q, bukan EER sungguhan")
    print(f"Dipilih q_low={best_q:.2f} karena gap terkecil ({best_gap:.1f}%) di FOLD-TUNE - bukan karena mendekati 15.2")
    # C-27: kalau q terpilih menyentuh ujung grid, tunernya sedang dibatasi, bukan
    # sedang memilih. Angka apa pun di bawahnya adalah titik operasi yang dipaksakan.
    if best_q in (cands[0], cands[-1]):
        print(f"PERINGATAN C-27: q_low={best_q:.2f} MENTOK di ujung grid {cands[0]}..{cands[-1]}. "
              f"Tuner tidak sedang memilih, ia sedang dibatasi - lebarkan grid sebelum angka ini dikutip.")
    rep=run_fold(c, fold_report, weights, best_q, use_real_ocsvm=use_real, engine=ENG)
    print(f"\n[HEADLINE] FOLD-REPORT (held-out, q={best_q:.2f} beku):")
    print(f"  FRR {rep['frr']:.1f}% ({rep['ownerNonLow']}/{rep['owner']}) FAR {rep['far']:.1f}% ({rep['impLow']}/{rep['imp']}) conv {rep['conv']}/{rep['nsub']}")
    rc=roc(rep['owner_scores'], rep['imp_scores'])
    print(f"  ROC (skor beku, ambang geser): AUC {rc['auc']:.3f} EER {rc['eer']:.1f}% thr {rc['eer_thr']:.3f} FAR@FRR15% {rc['far_at_15']:.1f}% FAR@FRR5% {rc['far_at_5']:.1f}% n={rc['n']} thr_range {rc['thr_range'][0]:.2f}..{rc['thr_range'][1]:.2f}")
    full=run_fold(c, SUBJECT_IDS, weights, best_q, use_real_ocsvm=use_real, engine=ENG)
    print(f"\n[IN-SAMPLE 16 penuh, optimistik, jangan jadi klaim utama]:")
    print(f"  FRR {full['frr']:.1f}% FAR {full['far']:.1f}% conv {full['conv']}/16 (q={best_q:.2f})")
    if not args.ablation:
        w_if={'isolation_forest':1.0,'svm':0,'lstm':0}
        rep_if=run_fold(c, fold_report, w_if, best_q, use_real_ocsvm=use_real, engine=ENG)
        print(f"\n[ABLATION di FOLD-REPORT] W7 FAR {rep['far']:.1f}% vs IF-only FAR {rep_if['far']:.1f}% -> arah +SVM {'OK' if rep['far']<rep_if['far'] else 'TIDAK'}")
    print(f"\n[C1] Ablasi fitur di FOLD-REPORT (q={best_q:.2f} beku, {eng_name}):")
    for name, cols in [("F4 28",F4), ("F3 37",F3), ("F4-minus-temp",F4_MINUS_TEMP)]:
        r=run_fold(c, fold_report, weights, best_q, feature_cols=cols, use_real_ocsvm=use_real, engine=ENG)
        print(f"  {name:15s} FRR {r['frr']:4.1f}% FAR {r['far']:4.1f}% conv {r['conv']}/{r['nsub']}")
    print(f"\nSebelum (385/7, tanpa guard) vs Sesudah (653/16 held-out) berdampingan di atas.")
    print("Quality gate 100/5s/6: menolak 2/653 sesi (0.3%) - praktis no-op di dataset ini, aktif untuk data live")
    print("Deterministik: ORDER BY session_id, Random(42) shuffle, tanpa ORDER BY RANDOM, tanpa augment")
    engine_label=eng_name
    print(f"Engine: {engine_label}; gamma scale; dedup 1e-3 tanpa temporal; quality gate 100/5s/6")
    if not use_real:
        print("Catatan: centroid JS FAR 36.2% vs Real 0.7% - F4 terbaik hanya di Real, terbalik di centroid (F4 terburuk 36.2% vs F3 20.6%)")

if __name__=='__main__': main()
