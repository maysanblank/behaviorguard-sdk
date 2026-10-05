#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_tracker_maha.py - bikin Excel tracker progres sesi (L/M/H) pakai MODEL BARU
(Mahalanobis + shrinkage + kalibrasi parametrik) dan bandingkan dgn model lama
(centroid). Protokol identik: baseline 10, retrain tiap 6, konvergensi 6-LOW +
gerbang kohort. Vonis dihitung pada sesi PEMILIK sendiri sepanjang waktu (in-sample
self-progression) - sama seperti tracker_progres_sesi asli.
"""
import sqlite3, importlib.util, random, sys, math, pathlib
sys.path.insert(0, 'core'); import bg_core as bg
spec=importlib.util.spec_from_file_location("exp","research/experiment.py")
exp=importlib.util.module_from_spec(spec); spec.loader.exec_module(exp)
import os, tempfile
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

DB=os.environ.get("BG_RESEARCH_DB", "behavior_detection.db")  # the research database is not in the repository
F4=exp.F4
# subjek + urutan PERSIS tracker asli (nama -> id)
SUBJECTS=[('S07',7),('S02',2),('S18',18),('S12',12),('S09',9),
          ('S20',20),('S22',22),('S15',15),('S19',19),('S05',5),
          ('S13',13),('S25',25),('S08',8),('S24',24),('S06',6),('S11',11)]
ALL_IDS=[uid for _,uid in SUBJECTS]

# ---- konfigurasi dua model ----
CFG_NEW=dict(model='maha', weights={'isolation_forest':0.30,'S00': 0.70,'S00': 0},
             shrink=bg.DEFAULTS['mahalanobis']['shrink'],
             k_low=bg.DEFAULTS['k_low'], k_med_extra=bg.DEFAULTS['k_med_extra'])
CFG_OLD=dict(model='centroid', weights={'isolation_forest':0.70,'S00': 0.30,'S00': 0},
             q_low=0.10, q_med=0.033)

compute_stats=exp.compute_stats; standardize=exp.standardize; score_stats=exp.score_stats
IF=exp.IF; dedup=exp.dedup_behavioral; gatew=exp.gate_weights; to_risk=exp.to_risk

def per_session_verdicts(c, uid, cfg, cohort_ids):
    """Return list vonis (LOW/MEDIUM/HIGH) utk sesi 11.. (sesudah baseline 10)."""
    cols=','.join('f.'+f for f in F4)
    rows=c.execute(f"SELECT {cols} FROM features f JOIN sessions s USING(session_id) WHERE s.user_id=? ORDER BY s.session_id",(uid,)).fetchall()
    vecs=[list(r) for r in rows]
    baseline=10; step=6; window=6; MAXP=30; pool=vecs[:baseline]
    def build(pv):
        base=pv[:min(baseline,len(pv))]; low=pv[min(baseline,len(pv)):]
        if len(low)>MAXP-len(base): low=low[-(MAXP-len(base)):]
        low=dedup(low,F4); pv=base+low or vecs[:1]
        st=compute_stats(pv); Xs=[standardize(v,st) for v in pv]
        iff=IF(); iff.fit(Xs)
        if cfg['model']=='maha': md=bg.Mahalanobis(shrink=cfg['shrink']); md.fit(Xs)
        else: md=exp.Centroid(len(F4)); md.fit(Xs)
        gw=gatew(cfg['weights'],len(pv)); m1,s1=score_stats([iff.score_one(x) for x in Xs])
        if gw['svm']==0:
            def ens(v): return (iff.score_one(standardize(v,st))-m1)/s1
        else:
            m2,s2=score_stats([md.score_one(x) for x in Xs])
            def ens(v):
                xs=standardize(v,st); return gw['isolation_forest']*((iff.score_one(xs)-m1)/s1)+gw['svm']*((md.score_one(xs)-m2)/s2)
        bs=[ens(v) for v in pv]
        if cfg['model']=='maha':
            thr=bg.calibrate_thresholds_parametric(bs,cfg['k_low'],cfg['k_med_extra'])
        else:
            thr=exp.calibrate_thresholds(bs,cfg['q_low'],cfg['q_med'])
        return ens,thr
    ens,thr=build(pool); verdicts=[]
    for i in range(baseline,len(vecs)):
        if (len(pool)-baseline)%step==0 and len(pool)>baseline:
            recent=verdicts[-window:]
            windowLow=len(recent)==window and all(x=='LOW' for x in recent)
            if cohort_ids:
                rng_sub=random.Random(hash(tuple(sorted(cohort_ids)))+42); shuf=list(cohort_ids); rng_sub.shuffle(shuf)
                cid=set(shuf[:len(shuf)//2])
                q=','.join(str(x) for x in cid) if cid else ','.join(str(x) for x in cohort_ids)
                crows=c.execute(f"SELECT {cols} FROM features f JOIN sessions s USING(session_id) WHERE s.user_id IN ({q}) ORDER BY s.session_id").fetchall() if cid else []
                cs=[ens(list(r)) for r in crows]; lowRate=sum(1 for sc in cs if sc>thr['low'])/len(cs) if cs else 1
            else: lowRate=1
            isConv=windowLow and lowRate<=0.35
            if not isConv: ens,thr=build(pool)
        v=vecs[i]; sc=ens(v); lvl=to_risk(sc,thr); verdicts.append(lvl)
        if lvl=='LOW': pool.append(v)
    return verdicts

def conv_session(verds, window=6):
    for i in range(window-1,len(verds)):
        if all(verds[j]=='LOW' for j in range(i-window+1,i+1)): return i+11  # nomor sesi absolut
    return None

def fmt_batch(vs):
    l=vs.count('LOW'); m=vs.count('MEDIUM'); h=vs.count('HIGH')
    if len(vs)==6 and l==6: return '6L ✓'
    tail=f' (n={len(vs)})' if len(vs)<6 else ''
    return f'{l}L {m}M {h}H'+tail

def main():
    c=sqlite3.connect(DB)
    data={}  # name -> dict(new=[verds], old=[verds])
    for name,uid in SUBJECTS:
        cohort=[x for x in ALL_IDS if x!=uid]
        data[name]=dict(uid=uid,
            new=per_session_verdicts(c,uid,CFG_NEW,cohort),
            old=per_session_verdicts(c,uid,CFG_OLD,cohort))
        vn=data[name]['new']
        print(f"{name:10s} id{uid:2d}  NEW L{vn.count('LOW')} M{vn.count('MEDIUM')} H{vn.count('HIGH')}  conv@{conv_session(vn)}")

    wb=openpyxl.Workbook()
    thin=Side(style='thin',color='D0D0D0'); border=Border(left=thin,right=thin,top=thin,bottom=thin)
    hdrfill=PatternFill('solid',fgColor='1F3864'); hdrfont=Font(color='FFFFFF',bold=True,size=10)
    fL=PatternFill('solid',fgColor='C6EFCE'); fM=PatternFill('solid',fgColor='FFEB9C'); fH=PatternFill('solid',fgColor='FFC7CE')
    center=Alignment(horizontal='center',vertical='center')

    # ---------- Sheet 1: Progres Sesi (model baru) ----------
    ws=wb.active; ws.title='Progres Sesi (Maha)'
    ws['A1']='TRACKER PROGRES SESI - MODEL BARU (Mahalanobis + kalibrasi parametrik)'
    ws['A1'].font=Font(bold=True,size=13,color='1F3864')
    ws['A2']=f"Protokol: baseline 10 + retrain/6 + konvergensi 6-LOW & gerbang kohort. Vonis pd sesi pemilik sendiri. k_low={CFG_NEW['k_low']} shrink={CFG_NEW['shrink']} bobot IF.30/Maha.70"
    ws['A2'].font=Font(italic=True,size=9,color='606060')
    hdr=['Subjek','Total sesi','Baseline (1-10)']+[f'Sesi {i} ({11+(i-1)*6}-{10+i*6})' for i in range(1,10)]+['Konvergen di sesi']
    r0=4
    for j,h in enumerate(hdr,1):
        cell=ws.cell(r0,j,h); cell.fill=hdrfill; cell.font=hdrfont; cell.alignment=center; cell.border=border
    for ri,(name,uid) in enumerate(SUBJECTS, r0+1):
        vs=data[name]['new']; total=10+len(vs)
        ws.cell(ri,1,name).font=Font(bold=True); ws.cell(ri,2,total); ws.cell(ri,3,'10 sesi (enroll)')
        for b in range(9):
            batch=vs[b*6:(b+1)*6]
            if not batch: continue
            cell=ws.cell(ri,4+b,fmt_batch(batch)); cell.alignment=center
            l,m,h=batch.count('LOW'),batch.count('MEDIUM'),batch.count('HIGH')
            if l>=m and l>=h and l>0: cell.fill=fL
            elif h>=m and h>l: cell.fill=fH
            elif m>0: cell.fill=fM
        cs=conv_session(vs); ws.cell(ri,13, cs if cs else 'belum').alignment=center
        for j in range(1,14): ws.cell(ri,j).border=border
    ws.column_dimensions['A'].width=12; ws.column_dimensions['B'].width=9; ws.column_dimensions['C'].width=15
    for col in 'DEFGHIJKL': ws.column_dimensions[col].width=11
    ws.column_dimensions['M'].width=15; ws.freeze_panes='D5'

    # ---------- Sheet 2: Detail per Sesi ----------
    ws2=wb.create_sheet('Detail per Sesi')
    h2=['Subjek','user_id','Nomor sesi','Vonis (Maha baru)','Vonis (centroid lama)','Berubah?']
    for j,h in enumerate(h2,1):
        cell=ws2.cell(1,j,h); cell.fill=hdrfill; cell.font=hdrfont; cell.alignment=center; cell.border=border
    r=2
    for name,uid in SUBJECTS:
        vn=data[name]['new']; vo=data[name]['old']
        for i,lvl in enumerate(vn):
            old=vo[i] if i<len(vo) else ''
            ws2.cell(r,1,name); ws2.cell(r,2,uid); ws2.cell(r,3,11+i)
            cN=ws2.cell(r,4,lvl); cN.alignment=center
            cN.fill={'LOW':fL,'MEDIUM':fM,'HIGH':fH}.get(lvl)
            cO=ws2.cell(r,5,old); cO.alignment=center
            cO.fill={'LOW':fL,'MEDIUM':fM,'HIGH':fH}.get(old)
            ch='-' if lvl==old else f'{old}->{lvl}'
            cc=ws2.cell(r,6,ch); cc.alignment=center
            if lvl!=old: cc.font=Font(bold=True,color='1F3864')
            for j in range(1,7): ws2.cell(r,j).border=border
            r+=1
    for col,w in zip('ABCDEF',[12,9,11,17,20,13]): ws2.column_dimensions[col].width=w
    ws2.freeze_panes='A2'

    # ---------- Sheet 3: Perbandingan ringkas ----------
    ws3=wb.create_sheet('Perbandingan Model')
    ws3['A1']='PERBANDINGAN VONIS: centroid lama vs Mahalanobis baru (sesi pemilik)'
    ws3['A1'].font=Font(bold=True,size=12,color='1F3864')
    h3=['Subjek','Total sesi dinilai','LOW lama','MED lama','HIGH lama','LOW baru','MED baru','HIGH baru','Konv lama (sesi)','Konv baru (sesi)']
    r0=3
    for j,h in enumerate(h3,1):
        cell=ws3.cell(r0,j,h); cell.fill=hdrfill; cell.font=hdrfont; cell.alignment=center; cell.border=border; cell.font=Font(color='FFFFFF',bold=True,size=9)
    totO=[0,0,0]; totN=[0,0,0]
    for ri,(name,uid) in enumerate(SUBJECTS,r0+1):
        vo=data[name]['old']; vn=data[name]['new']
        oL,oM,oH=vo.count('LOW'),vo.count('MEDIUM'),vo.count('HIGH')
        nL,nM,nH=vn.count('LOW'),vn.count('MEDIUM'),vn.count('HIGH')
        totO[0]+=oL;totO[1]+=oM;totO[2]+=oH; totN[0]+=nL;totN[1]+=nM;totN[2]+=nH
        vals=[name,len(vn),oL,oM,oH,nL,nM,nH,conv_session(vo) or 'belum',conv_session(vn) or 'belum']
        for j,v in enumerate(vals,1):
            cell=ws3.cell(ri,j,v); cell.border=border
            if j==1: cell.font=Font(bold=True)
            else: cell.alignment=center
    rt=r0+1+len(SUBJECTS)
    tvals=['TOTAL',sum(len(data[n]['new']) for n,_ in SUBJECTS),totO[0],totO[1],totO[2],totN[0],totN[1],totN[2],'','']
    for j,v in enumerate(tvals,1):
        cell=ws3.cell(rt,j,v); cell.font=Font(bold=True); cell.fill=PatternFill('solid',fgColor='DDEBF7'); cell.border=border; cell.alignment=center
    for col,w in zip('ABCDEFGHIJ',[12,17,10,10,10,10,10,10,15,15]): ws3.column_dimensions[col].width=w

    out=os.path.join(tempfile.gettempdir(), 'tracker_progres_MAHA.xlsx')  # derived research data: never in the repo
    wb.save(out)
    print('\nTOTAL lama  L/M/H:',totO,'\nTOTAL baru  L/M/H:',totN)
    print('Saved:',out)

if __name__=='__main__': main()
