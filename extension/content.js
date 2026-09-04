/**
 * content.js - on-device capture + scoring (tanpa backend)
 * Skor dilakukan di content (bundled core) agar MV3 tidak butuh offscreen.
 * Background hanya untuk badge/notifikasi & persistensi Alarm.
 */
(() => {
  if(window.__bgInjected) return; window.__bgInjected=true;

  // --- inline minimal core (subset) agar tidak butuh import di content-script ---
  // Untuk full engine, background akan sync via chrome.storage; di sini kita lakukan scoring ringan
  const buf=[];
  const push=e=>{ e.timestamp=Date.now(); e.page_url=location.href; if(buf.length<2000) buf.push(e); };
  let lastMove=0;
  document.addEventListener('mousemove', e=>{
    const now=Date.now(); if(now-lastMove<50) return; lastMove=now;
    push({event_type:'MOUSE_MOVE', x:e.clientX, y:e.clientY});
  }, {passive:true, capture:true});
  document.addEventListener('click', e=> push({event_type:'MOUSE_CLICK', x:e.clientX, y:e.clientY}), {passive:true, capture:true});
  let lastY=window.scrollY;
  window.addEventListener('scroll', ()=>{ const cur=window.scrollY; const d=Math.abs(cur-lastY); lastY=cur; if(d) push({event_type:'MOUSE_SCROLL', scroll_delta: d}); }, {passive:true});
  const downAt=new Map(); document.addEventListener('keydown', e=> downAt.set(e.code, Date.now()), {passive:true, capture:true});
  document.addEventListener('keyup', e=>{ const t0=downAt.get(e.code); const h=t0?Date.now()-t0:80; push({event_type:'KEYSTROKE', key:e.key, hold_time:h}); }, {passive:true, capture:true});
  document.addEventListener('focusin', e=>{
    try{ if(e.target && e.target.matches && e.target.matches('input,textarea,select,[contenteditable]')) push({event_type:'FORM_FOCUS'}); }catch{}
  }, true);
  document.addEventListener('focusout', e=>{
    try{ if(e.target && e.target.matches && e.target.matches('input,textarea,select,[contenteditable]')) push({event_type:'FORM_BLUR'}); }catch{}
  }, true);

  // drain tiap 5 detik → background untuk scoring + badge
  setInterval(()=>{
    if(!buf.length) return;
    const batch=buf.splice(0, buf.length);
    chrome.runtime.sendMessage({type:'BG_EVENTS', events: batch}, resp=>{
      if(chrome.runtime.lastError) return;
      if(resp && resp.evt){
        // background sudah skor → tampilkan banner ringan
        const evt=resp.evt;
        console.log('[BG]', evt);
        // dispatch ke page agar demo/pemantau bisa dengar
        window.dispatchEvent(new CustomEvent('BG_RISK', {detail: evt}));
        // overlay sederhana untuk HIGH
        if(evt.level==='HIGH'){
          let el=document.getElementById('__bg_lock');
          if(!el){
            el=document.createElement('div');
            el.id='__bg_lock';
            el.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.7);color:#fff;display:flex;align-items:center;justify-content:center;z-index:999999;font-family:system-ui;padding:20px;text-align:center';
            el.innerHTML='<div><h2>Perilaku tidak dikenali - verifikasi diperlukan</h2><p>Skor '+evt.score.toFixed(2)+' - '+evt.reasons.join(', ')+'</p><button id="__bg_ok" style="padding:10px 16px;border-radius:8px;border:0;background:#0ea5a0;color:#fff;font-weight:700;cursor:pointer">Saya pemilik</button></div>';
            document.body.appendChild(el);
            document.getElementById('__bg_ok').onclick=()=> el.remove();
          }
        }
      }
    });
  }, 5000);

  // terusan BG_RISK dari background (alarm berkala)
  chrome.runtime.onMessage.addListener(msg=>{
    if(msg.type==='BG_RISK' && msg.evt){
      window.dispatchEvent(new CustomEvent('BG_RISK', {detail: msg.evt}));
      console.log('[BG BG_RISK]', msg.evt);
    }
  });
})();
