/**
 * background.js - MV3 service worker on-device scoring (module)
 * Menerima BG_EVENTS dari content, skor dengan engine yang sama, kirim BG_RISK balik + badge.
 * Anti-poisoning & gamma 1/n sudah konsisten dengan sdk/core.
 */
import { extractF4, featuresToVector, F4 } from './core/features.js';
import { computeStats, standardize } from './core/standardize.js';
import { IsolationForest } from './core/isolation_forest.js';
import { OCSVM } from './core/ocsvm.js';
import { Ensemble } from './core/ensemble.js';
import { toRisk, toAction, topFeatures, reasonsFrom, calibrateThresholds } from './core/risk.js';
import { DEFAULTS } from './core/config.js';

let state={
  sessions:[], // [{vector, risk, score}]
  stats:null, model:null,
  buffer:[]
};

async function load(){
  const d=await chrome.storage.local.get(['bg_state']);
  if(d.bg_state){
    state.sessions=d.bg_state.sessions||[];
    state.buffer=d.bg_state.buffer||[];
    state.thresholds=d.bg_state.thresholds||null;
    state.stats=d.bg_state.stats||null;
    // model tidak dipersist (prototype hilang) → rebuild di memori
    if(state.sessions.length >= DEFAULTS.baseline) rebuild();
  }
}
async function save(){
  // simpan hanya data murni, jangan model (Structured clone buang prototype)
  const {sessions, buffer, thresholds, stats}=state;
  await chrome.storage.local.set({bg_state: {sessions, buffer, thresholds, stats}});
}

function rebuild(){
  const base=state.sessions.slice(0, DEFAULTS.baseline).map(s=>s.vector);
  let lows=state.sessions.slice(DEFAULTS.baseline).filter(s=>s.risk==='LOW').map(s=>s.vector);
  if(lows.length > DEFAULTS.progressiveMaxPool) lows=lows.slice(-DEFAULTS.progressiveMaxPool);
  // dedup Euclid 1e-3 tanpa temporal
  const temporalIdx=new Set(); F4.forEach((n,i)=>{ if(n.startsWith('temporal_')) temporalIdx.add(i); });
  const behIdx=F4.map((_,i)=>i).filter(i=>!temporalIdx.has(i));
  const deduped=[];
  for(const v of lows){
    let dup=false;
    for(const u of deduped){
      let sum=0; for(const idx of behIdx){ const d=v[idx]-u[idx]; sum+=d*d; }
      const dist=Math.sqrt(sum/behIdx.length);
      if(dist < DEFAULTS.progressiveDupEps){ dup=true; break; }
    }
    if(!dup) deduped.push(v);
  }
  const vecs=[...base, ...deduped];
  if(vecs.length < DEFAULTS.baseline) return;
  const stats=computeStats(vecs);
  const Xstd=vecs.map(v=> standardize(v, stats));
  const iff=new IsolationForest(DEFAULTS.iforest); iff.fit(Xstd);
  const ocs=new OCSVM({n_features: F4.length}); ocs.fit(Xstd);
  const ens=new Ensemble(iff, ocs, {isolation_forest:0.70, svm:0.30, lstm:0}, vecs.length); ens.calibrate(Xstd, vecs.length);
  state.stats=stats; state.model=ens;
  const baseScores=Xstd.map(x=> ens.scoreOne(x));
  state.thresholds=calibrateThresholds(baseScores, DEFAULTS.q_low, DEFAULTS.q_med);
}

function scoreVec(vec){
  if(!state.model || !state.stats) return {score:0, level:'LOW', reasons:[]};
  const thr=state.thresholds || DEFAULTS.thresholds;
  const xstd=standardize(vec, state.stats);
  const score=state.model.scoreOne(xstd);
  const level=toRisk(score, thr);
  const top=topFeatures(xstd, F4, 3);
  return {score, level, reasons: reasonsFrom(top), top, action: toAction(level), thresholds: thr};
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  (async()=>{
    await load();
    if(msg.type==='BG_EVENTS' && msg.events && msg.events.length){
      state.buffer.push(...msg.events);
      // T2: satu sumber - minEventsAssess dari DEFAULTS.session
      if(state.buffer.length >= DEFAULTS.session.minEventsAssess){
        const events=state.buffer.splice(0, state.buffer.length);
        const feat=extractF4(events);
        const vec=featuresToVector(feat);
        const duration=(events[events.length-1]?.timestamp||0)-(events[0]?.timestamp||0);
        const nonZero=Object.values(feat).filter(v=> Math.abs(v)>1e-9).length;
        const passesTrain=events.length>=DEFAULTS.session.minEventsTrain && duration/1000>=DEFAULTS.session.minDurationSec && nonZero>=DEFAULTS.session.minNonZeroFeatures;
        // enrollment: gate juga berlaku (T1)
        if(state.sessions.length < DEFAULTS.baseline){
          if(!passesTrain){
            await save();
            sendResponse({ok:true, evt:{level:'LOW', score:0, reasons:['sesi tidak layak latih (butuh >=100 event, >=5s, >=6 fitur)'], gated:false}});
            return;
          }
          state.sessions.push({vector: vec, risk:'LOW', score:0});
          if(state.sessions.length >= DEFAULTS.baseline) rebuild();
          await save();
          sendResponse({ok:true, evt:{level:'LOW', score:0, reasons:['enrollment '+state.sessions.length+'/'+DEFAULTS.baseline]}});
          return;
        }
        if(!state.model) rebuild();
        let {score, level, reasons, top, action}=scoreVec(vec);
        // T1+T9: gagal gate -> LOW tetap LOW tapi gated=false, tidak masuk kolam (jangan paksa MEDIUM mengotori risiko)
        let gated=true;
        if(!passesTrain && level==='LOW'){ gated=false; reasons=['gagal quality gate - tidak masuk kolam']; }
        const evt={level, score, action, reasons, topFeatures: top, gated};
        state.sessions.push({vector: vec, risk: level, score, gated});
        // retrain tiap 6 LOW baru + guard window 6
        const trainVecs=[...state.sessions.slice(0,DEFAULTS.baseline).map(s=>s.vector), ...state.sessions.slice(DEFAULTS.baseline).filter(s=>s.risk==='LOW').map(s=>s.vector)];
        const lowsCount=trainVecs.length - DEFAULTS.baseline;
        if(lowsCount>0 && lowsCount % DEFAULTS.retrainEvery===0){
          const recent=state.sessions.slice(-DEFAULTS.convergence.window).map(s=>s.risk);
          const windowLow=recent.length>=DEFAULTS.convergence.window && recent.every(r=>r==='LOW');
          if(!windowLow) rebuild();
        }
        await save();
        // badge
        try{
          const text=level==='LOW'?'OK':level==='MEDIUM'?'!':'X';
          const color=level==='LOW'?'#16a34a':level==='MEDIUM'?'#d97706':'#dc2626';
          chrome.action.setBadgeText({text});
          chrome.action.setBadgeBackgroundColor({color});
          if(level==='HIGH'){
            try{ chrome.notifications.create({type:'basic', iconUrl:'icons/icon128.png', title:'BehaviorGuard HIGH', message: `Skor ${score.toFixed(2)} - ${reasons.join(', ')}`, priority:2}); }catch(e){ console.debug('notif', e.message); }
          }
        }catch{}
        // kirim balik ke content untuk overlay
        try{ chrome.tabs.sendMessage(sender.tab.id, {type:'BG_RISK', evt}); }catch{}
        sendResponse({ok:true, evt});
      } else {
        sendResponse({ok:true});
      }
    } else {
      sendResponse({ok:false});
    }
  })();
  return true;
});

// alarm health
chrome.alarms.create('health', {periodInMinutes:1});
chrome.alarms.onAlarm.addListener(async a=>{
  if(a.name==='health'){
    // keep alive, nothing else
  }
});
load();
