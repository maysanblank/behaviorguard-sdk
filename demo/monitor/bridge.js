/**
 * bridge.js - cara mencolok SDK dari LUAR tanpa ubah situs polos
 * Dipakai pemantau: 1 baris di parent, situs polos tetap NOL BG
 * <iframe id="toko" src="../plain-site/index.html"></iframe>
 * <script type="module">import './bridge.js'</script>
 * Bridge otomatis capture event iframe same-origin + postMessage untuk cross-origin
 */
export function attachExternalCapture(iframe, onEvent){
  const buf=[];
  function push(e){ e.timestamp=Date.now(); buf.push(e); onEvent&&onEvent(e); }
  iframe.addEventListener('load', ()=>{
    try{
      const doc=iframe.contentDocument;
      const downAt=new Map();
      let lastY=doc.defaultView ? doc.defaultView.scrollY : 0;
      doc.addEventListener('mousemove', e=> push({event_type:'MOUSE_MOVE', x:e.clientX, y:e.clientY, page_url: iframe.src}), {passive:true, capture:true});
      doc.addEventListener('click', e=> push({event_type:'MOUSE_CLICK', x:e.clientX, y:e.clientY, page_url: iframe.src}), {passive:true, capture:true});
      doc.addEventListener('keydown', e=> downAt.set(e.code, Date.now()), {passive:true, capture:true});
      doc.addEventListener('keyup', e=>{ const t0=downAt.get(e.code); const h=t0?Date.now()-t0:80; push({event_type:'KEYSTROKE', key:e.key, hold_time:h, timestamp:Date.now(), page_url: iframe.src}); }, {passive:true, capture:true});
      doc.addEventListener('scroll', ()=>{ const cur=doc.defaultView.scrollY; const d=Math.abs(cur-lastY); lastY=cur; if(d) push({event_type:'MOUSE_SCROLL', scroll_delta:d, page_url: iframe.src}); }, {passive:true, capture:true});
    }catch{
      window.addEventListener('message', ev=>{
        if(ev.data && ev.data.__bgEvent) push(ev.data.__bgEvent);
      });
    }
  });
  return {drain:()=> buf.splice(0,buf.length)};
}
