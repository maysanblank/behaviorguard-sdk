/**
 * integrity.js - bot/replay guard (copy server/integrity.py logic)
 * Cek: interval konstan (std<3ms), hold identik (std<1.5ms), velocity konstan, rate>80/s, timestamp non-monoton
 * Return {suspected: bool, reasons: string[]}
 */
export function checkIntegrity(events, opts={}){
  // T5: hitung hanya dari event non-throttled (KEYSTROKE/CLICK) agar throttle 50ms tidak flag bot
  const filtered = opts.throttled ? events.filter(e=> e.event_type==='KEYSTROKE' || e.event_type==='MOUSE_CLICK') : events;
  const evs = filtered.length>=10 ? filtered : events;
  if(evs.length < 20) return {suspected:false, reasons:[]};
  const reasons=[];
  const ts = evs.map(e=>e.timestamp||0);
  // non-monoton
  for(let i=1;i<ts.length;i++) if(ts[i] < ts[i-1]-5){ reasons.push('timestamp non-monoton'); break; }
  const intervals=[];
  for(let i=1;i<ts.length;i++) intervals.push(ts[i]-ts[i-1]);
  const mean = intervals.reduce((a,b)=>a+b,0)/intervals.length;
  const std = Math.sqrt(intervals.reduce((a,b)=>a+(b-mean)**2,0)/intervals.length);
  if(std < 3) reasons.push(`interval konstan std=${std.toFixed(2)}ms`);
  const holds = evs.filter(e=>e.hold_time!=null).map(e=>e.hold_time);
  if(holds.length>=10){
    const hm = holds.reduce((a,b)=>a+b,0)/holds.length;
    const hs = Math.sqrt(holds.reduce((a,b)=>a+(b-hm)**2,0)/holds.length);
    if(hs < 1.5) reasons.push(`hold identik std=${hs.toFixed(2)}ms`);
  }
  // C-16: hanya nilai event yang BENAR-BENAR membawa velocity. Memakai
  // `e.velocity||0` pada event tanpa field itu menghasilkan deret nol -> std 0 ->
  // "velocity konstan" untuk sesi manusia yang sah.
  const vels = evs.filter(e=>e.x!=null && Number.isFinite(e.velocity)).map(e=>e.velocity);
  if(vels.length>=10){
    const vs = Math.sqrt(vels.reduce((a,b)=>a+(b-vels.reduce((x,y)=>x+y,0)/vels.length)**2,0)/vels.length);
    if(vs < 0.01) reasons.push('velocity konstan');
  }
  const dur = (ts[ts.length-1]-ts[0])/1000;
  const rate = dur>0 ? evs.length/dur : 0;
  if(rate > 80) reasons.push(`rate ${rate.toFixed(1)}/s > human`);
  // replay: selisih timestamp duplikat persis
  const seen=new Set(); let dup=0;
  for(const t of ts){ if(seen.has(t)) dup++; seen.add(t); }
  if(dup>5) reasons.push(`timestamp duplikat ${dup}`);
  return {suspected: reasons.length>0, reasons};
}
