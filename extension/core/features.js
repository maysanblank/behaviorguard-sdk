/**
 * features.js - ekstraksi 28 fitur F4 dari event mentah (on-device, deterministik)
 * Input: event[] {event_type, timestamp, x,y, key, hold_time, page_url, scroll_delta, ...}
 * Output: {featureName: float} lengkap 28, selalu finite
 */
import { DEFAULTS } from './config.js';

export const F4 = DEFAULTS.features;

// helper
const mean = a => a.length ? a.reduce((s,v)=>s+v,0)/a.length : 0;
const std  = a => { if(!a.length) return 0; const m=mean(a); return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length); };
const safe = v => (Number.isFinite(v) ? v : 0);

export function extractF4(events, sessionStartTs){
  if(!events || !events.length){
    const o={}; F4.forEach(k=>o[k]=0); return o;
  }
  // pisah per tipe
  const is = (e,t) => e.event_type===t;
  const mouseMove = events.filter(e=> is(e,'MOUSE_MOVE'));
  const mouseClick= events.filter(e=> is(e,'MOUSE_CLICK'));
  const mouseEv   = [...mouseMove, ...mouseClick, ...events.filter(e=> is(e,'MOUSE_SCROLL'))];
  const keyEv     = events.filter(e=> is(e,'KEYSTROKE'));
  const scrollEv  = events.filter(e=> is(e,'MOUSE_SCROLL'));
  const focusEv   = events.filter(e=> is(e,'FORM_FOCUS'));
  const blurEv    = events.filter(e=> is(e,'FORM_BLUR'));
  const navEv     = events.filter(e=> is(e,'NAVIGATION')||is(e,'PAGE_STEP'));

  // --- mouse velocity / acceleration / curvature ---
  let velocities=[], accelerations=[], pauses=0, directionChanges=0, lastDir=null, curvatures=[];
  for(let i=1;i<mouseEv.length;i++){
    const p=mouseEv[i-1], c=mouseEv[i];
    const dt=(c.timestamp||0)-(p.timestamp||0); if(dt<=0) continue;
    const dx=(c.x||0)-(p.x||0), dy=(c.y||0)-(p.y||0);
    const dist=Math.hypot(dx,dy);
    const v=dist/dt; velocities.push(v);
    if(dist>0){
      const dir=Math.atan2(dy,dx);
      // SPEC 1.3 (C-34): toleransi 1e-9 di atas pi/4. Gerakan piksel bulat sangat sering
      // berselisih arah TEPAT pi/4 (482 pasangan di 192 sesi riset), dan atan2 V8 vs libm
      // Python berbeda 1-2 ulp di sana -> perbandingan berbalik di satu bahasa saja.
      if(lastDir!==null && Math.abs(dir-lastDir)>Math.PI/4+1e-9) directionChanges++;
      lastDir=dir;
    }
    if(velocities.length>1){
      const a=(v-velocities[velocities.length-2])/dt; accelerations.push(a);
    }
    if(i>=2){
      const p2=mouseEv[i-2];
      const x0=p2.x||0,y0=p2.y||0,x1=p.x||0,y1=p.y||0,x2=c.x||0,y2=c.y||0;
      const area=x0*(y1-y2)+x1*(y2-y0)+x2*(y0-y1);
      const sa=Math.hypot(x1-x0,y1-y0), sb=Math.hypot(x2-x1,y2-y1), sc=Math.hypot(x2-x0,y2-y0);
      if(sa*sb*sc>0) curvatures.push(Math.abs(4*area/(sa*sb*sc)));
    }
    if(dt>100) pauses++; // jeda dianggap pause
  }
  const clickIntervals=[];
  for(let i=1;i<mouseClick.length;i++) clickIntervals.push((mouseClick[i].timestamp||0)-(mouseClick[i-1].timestamp||0));

  // cursor_idle_ratio
  let cursorIdle=0;
  if(mouseMove.length){
    let idle=0; for(const e of mouseMove) if((e.velocity||0)<0.5) idle++;
    cursorIdle=idle/mouseMove.length;
    // fallback kalau velocity tidak ada: hitung dari jarak kecil
    if(cursorIdle===0 && velocities.length){
      const slow=velocities.filter(v=>v<0.05).length;
      cursorIdle=slow/velocities.length;
    }
  }

  // cross_mouse_keyboard_coordination
  let alternations=0, lastType=null;
  const allMK=[...mouseEv, ...keyEv].sort((a,b)=>(a.timestamp||0)-(b.timestamp||0));
  for(const e of allMK){
    const cur = (e.event_type||'').includes('MOUSE')?'mouse':'keyboard';
    if(lastType && lastType!==cur) alternations++;
    lastType=cur;
  }
  const crossCoord = allMK.length ? alternations/allMK.length : 0;

  // keystroke
  const holdTimes = keyEv.map(e=>e.hold_time).filter(v=>v!=null);
  const flightTimes=[];
  for(let i=1;i<keyEv.length;i++) flightTimes.push((keyEv[i].timestamp||0)-(keyEv[i-1].timestamp||0));
  const keyEntropy = (()=>{
    if(keyEv.length<2) return 0;
    const trans={}; for(let i=1;i<keyEv.length;i++){ const k=(keyEv[i-1].key||'')+'->'+(keyEv[i].key||''); trans[k]=(trans[k]||0)+1; }
    const total=keyEv.length-1; let h=0; for(const c of Object.values(trans)){ const p=c/total; h-=p*Math.log(p+1e-9); } return h;
  })();
  const burstCount = (()=>{
    let c=0,inBurst=false;
    for(let i=1;i<keyEv.length;i++){ const dt=(keyEv[i].timestamp||0)-(keyEv[i-1].timestamp||0); if(dt<333){ if(!inBurst){c++; inBurst=true;} } else inBurst=false; }
    return c;
  })();
  const focusTimes = focusEv.map(e=>e.timestamp||0).sort((a,b)=>a-b);
  const ksTimes = keyEv.map(e=>e.timestamp||0).sort((a,b)=>a-b);
  const crossGaps=[];
  for(const ft of focusTimes){
    const before=ksTimes.filter(t=>t<ft).pop();
    const after=ksTimes.find(t=>t>=ft);
    if(before!=null && after!=null) crossGaps.push(after-before);
  }

  // temporal
  const firstTs=events[0].timestamp||sessionStartTs||Date.now();
  const lastTs=events[events.length-1].timestamp||firstTs;
  const duration=(lastTs-firstTs)/1000;
  const d=new Date(firstTs);
  // SPEC v1.1 D-3: pakai UTC (bukan waktu lokal) supaya vektor identik lintas zona waktu.
  const timeOfDay=(d.getUTCHours()+d.getUTCMinutes()/60)/24;
  const perSec={}; events.forEach(e=>{ const s=Math.floor((e.timestamp||0)/1000); perSec[s]=(perSec[s]||0)+1; });
  const counts=Object.values(perSec);
  const mAct=mean(counts), sAct=std(counts);
  const bursts=counts.filter(c=>c>mAct+2*sAct).length;

  // navigasi & form
  const pageUrls=navEv.map(e=>e.page_url).filter(Boolean);
  const uniquePages=new Set(pageUrls).size;
  // page count dari semua event yang punya page_url (lebih akurat)
  const allPages=new Set(events.map(e=>e.page_url).filter(Boolean)).size;
  const pageTrans = pageUrls.length ? uniquePages/pageUrls.length : 0;
  const scrollDeltas=scrollEv.map(e=>Math.abs(e.scroll_delta||0));
  // time per page (dari nav event)
  const pageMap={};
  for(const e of navEv){ const u=e.page_url||''; if(!u) continue; const ts=e.timestamp||0; if(!pageMap[u]) pageMap[u]={first:ts,last:ts}; else pageMap[u].last=ts; }
  const perPageTimes=Object.values(pageMap).map(p=>(p.last-p.first)/1000).filter(v=>v>0);
  const focusTimesSorted=focusEv.map(e=>e.timestamp||0).sort((a,b)=>a-b);
  const fieldGaps=[];
  for(let i=1;i<focusTimesSorted.length;i++){ const g=focusTimesSorted[i]-focusTimesSorted[i-1]; if(g>0) fieldGaps.push(g); }

  // aman untuk sesi panjang: hindari spread + stack overflow
  const vmax=velocities.length ? velocities.reduce((m,v)=>v>m?v:m, -Infinity) : 0;
  const out={
    mouse_velocity_mean: safe(mean(velocities)),
    mouse_velocity_std: safe(std(velocities)),
    mouse_velocity_max: safe(vmax),
    mouse_acceleration_std: safe(std(accelerations)),
    mouse_curvature_mean: safe(mean(curvatures)),
    mouse_direction_changes: safe(directionChanges),
    mouse_pause_count: safe(pauses),
    mouse_click_interval_mean: safe(mean(clickIntervals)),
    cursor_idle_ratio: safe(cursorIdle),
    cross_mouse_keyboard_coordination: safe(crossCoord),
    keystroke_dwell_time_mean: safe(mean(holdTimes)),
    keystroke_dwell_time_std: safe(std(holdTimes)),
    keystroke_flight_time_mean: safe(mean(flightTimes)),
    keystroke_transition_entropy: safe(keyEntropy),
    keystroke_typing_speed: safe(duration>0? keyEv.length/(duration):0),
    keystroke_cross_field_cadence: safe(mean(crossGaps)),
    keystroke_burst_count: safe(burstCount),
    temporal_time_of_day_score: safe(timeOfDay),
    temporal_session_duration: safe(duration),
    temporal_activity_bursts: safe(bursts),
    nav_page_transition_pattern: safe(pageTrans),
    nav_scroll_depth_mean: safe(mean(scrollDeltas)),
    nav_page_count: safe(allPages),
    nav_step_transition_count: safe(navEv.length),
    form_focus_count: safe(focusEv.length),
    form_blur_count: safe(blurEv.length),
    form_field_switch_rate: safe(mean(fieldGaps)),
    cart_action_count: safe(events.filter(e=>e.event_type==='CART_ACTION').length)
  };
  // pastikan semua 28 ada & finite, urutan deterministik
  const res={}; F4.forEach(k=>res[k]=safe(out[k]||0));
  return res;
}

export function featuresToVector(featObj){
  return F4.map(k=> featObj[k]||0);
}
