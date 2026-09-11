/**
 * integrity.js - bot/replay guard (copy server/integrity.py logic)
 * Cek: interval konstan (std<3ms), hold identik (std<1.5ms), velocity konstan, rate>80/s, timestamp non-monoton
 * Return {suspected: bool, reasons: string[]}
 */
export function checkIntegrity(events, opts={}){
  // T5: hitung hanya dari event non-throttled (KEYSTROKE/CLICK) agar throttle 50ms tidak flag bot
  const filtered = opts.throttled ? events.filter(e=> e.event_type==='KEYSTROKE' || e.event_type==='MOUSE_CLICK') : events;
  // A1: fallback `: events` DULU MEMBATALKAN seluruh maksud T5. Saat keystroke+klik
  // < 10 — yaitu sesi yang isinya menelusuri/membaca — ia jatuh ke SELURUH event,
  // yang isinya hampir semua MOUSE_MOVE hasil throttle 50 ms kita sendiri. Interval
  // hasil throttle itu bukan cuma mirip-mirip, tapi PERSIS konstan:
  //   mousemove  60Hz -> 50,0 ms std 0,00    100Hz -> 50,0 ms std 0,00
  //   mousemove 125Hz -> 56,0 ms std 0,00    144Hz -> 55,6 ms std 0,50
  // Semuanya < 3 ms -> "interval konstan" -> BLOCK_SESSION untuk manusia yang cuma
  // membaca artikel sambil menggerakkan mouse. Rapuh pula: satu klik nyasar di ujung
  // sesi menaikkan std di atas ambang dan membuatnya lolos, sehingga gejalanya
  // muncul "kadang-kadang" dan nyaris mustahil dilacak dari laporan pengguna.
  // Kerabat langsung C-16, dihidupkan lagi oleh fallback-nya sendiri.
  //
  // Aturan yang benar: JANGAN PERNAH menilai keteraturan interval pada aliran yang
  // kita throttle sendiri. Kalau buktinya kurang, lewati cek itu — bukan ganti sumber.
  const throttledStream = opts.throttled && filtered.length < 10;
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
  // A1: cek interval hanya sahih pada aliran yang TIDAK kita throttle.
  if(!throttledStream && std < 3) reasons.push(`interval konstan std=${std.toFixed(2)}ms`);
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
  // Aman dari artefak throttle: 50 ms -> maksimum 20/s, jauh di bawah 80.
  if(rate > 80) reasons.push(`rate ${rate.toFixed(1)}/s > human`);
  // replay: selisih timestamp duplikat persis
  const seen=new Set(); let dup=0;
  for(const t of ts){ if(seen.has(t)) dup++; seen.add(t); }
  // C-29: ambang dulu mutlak (>5). Sesudah kembaran identik dibuang, manusia mencapai
  // maksimum 4 ketikan/klik BERBEDA di milidetik yang sama per sesi riset (~230 event).
  // Ambang mutlak itu menyempit seiring panjang batch (pending bisa 800 event), jadi
  // dibuat relatif: > 5 DAN > 5% event yang diperiksa. Bot yang menyuntik event sintetis
  // bertumpuk di milidetik yang sama jauh di atas keduanya.
  if(dup>Math.max(5, 0.05*evs.length)) reasons.push(`timestamp duplikat ${dup}`);
  return {suspected: reasons.length>0, reasons};
}
