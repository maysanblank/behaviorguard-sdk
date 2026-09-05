/**
 * capture.js - auto-capture DOM (pointer/key/scroll/focus/blur/submit/cart)
 * Tanpa ubah kode aplikasi. Tahan tab-switch/refresh. Caps & robust.
 */
export function createCapture(onEvent){
  const MAX_BUF=2000; // cap 2000 event per sesi (hindari volume gila mousemove)
  const buf=[];
  let dropped=0;
  const push=e=>{
    e.timestamp=Date.now();
    if(buf.length >= MAX_BUF){ dropped++; return; }
    buf.push(e);
    try{ onEvent&&onEvent(e); }catch{}
  };
  let attached=false;
  let handlers=null;
  function attach(){
    if(attached) return; attached=true;
    const opts={capture:true, passive:true};
    const downAt=new Map();
    let lastScrollY=window.scrollY;
    // C-16/C-17: `velocity` DULU TIDAK PERNAH DIISI di sini, padahal dua tempat
    // membacanya. Akibatnya di pemakaian nyata (bukan data riset):
    //   1. integrity.js membaca `e.velocity||0` -> selalu 0 -> std 0 -> sesi manusia
    //      biasa ditandai "velocity konstan" dan diblokir sebagai bot. Terpicu pada
    //      sesi yang keystroke+klik-nya < 10, yaitu sesi yang isinya kebanyakan
    //      gerak mouse — persis perilaku pengunjung yang cuma menelusuri halaman.
    //   2. features.js SPEC 8.4 menghitung idle = jumlah gerakan dgn velocity < 0.5;
    //      tanpa field itu SEMUA gerakan terhitung diam -> `cursor_idle_ratio` terkunci
    //      di 1.0. Satu dari 28 fitur jadi mati di produksi, padahal saat model
    //      dilatih dari basis data riset fitur itu bervariasi — ketidakcocokan
    //      latih-vs-pakai yang permanen.
    // Satuan piksel per milidetik, sama seperti `velocities` di features.js.
    let lastMovePt=null;
    const withVelocity=e=>{
      const now=Date.now();
      let v=0;
      if(lastMovePt){
        const dt=now-lastMovePt.t;
        if(dt>0){ const dx=e.clientX-lastMovePt.x, dy=e.clientY-lastMovePt.y; v=Math.hypot(dx,dy)/dt; }
      }
      lastMovePt={x:e.clientX, y:e.clientY, t:now};
      return Number.isFinite(v)? v : 0;
    };
    handlers={
      move: e=> push({event_type:'MOUSE_MOVE', x:e.clientX, y:e.clientY, velocity: withVelocity(e), page_url: location.href}),
      click: e=> push({event_type:'MOUSE_CLICK', x:e.clientX, y:e.clientY, page_url: location.href}),
      scroll: e=> { const cur=window.scrollY; const delta=Math.abs(cur-lastScrollY); lastScrollY=cur; if(delta===0) return; push({event_type:'MOUSE_SCROLL', scroll_delta: delta, scroll_velocity: 0, page_url: location.href}); },
      kd: e=> downAt.set(e.code, Date.now()),
      ku: e=> { const t0=downAt.get(e.code); const hold=t0? Date.now()-t0 : 80; push({event_type:'KEYSTROKE', key:e.key, hold_time: hold, page_url: location.href}); },
      focus: e=> { try{ if(e.target && e.target.matches && e.target.matches('input,textarea,select,[contenteditable]')) push({event_type:'FORM_FOCUS', page_url: location.href}); }catch{} },
      blur: e=> { try{ if(e.target && e.target.matches && e.target.matches('input,textarea,select,[contenteditable]')) push({event_type:'FORM_BLUR', page_url: location.href}); }catch{} },
      nav: ()=> push({event_type:'NAVIGATION', page_url: location.href}),
      cart: e=>{ try{ const t=e.target && e.target.closest && e.target.closest('[data-bg-cart], .add-to-cart, [data-cart]'); if(t) push({event_type:'CART_ACTION', page_url: location.href}); }catch{} }
    };
    // mousemove throttled: 1 per 50ms untuk cap volume
    let lastMove=0;
    const throttledMove=e=>{
      const now=Date.now();
      if(now-lastMove < 50) return;
      lastMove=now; handlers.move(e);
    };
    handlers.throttledMove=throttledMove;

    document.addEventListener('mousemove', throttledMove, opts);
    document.addEventListener('click', handlers.click, opts);
    document.addEventListener('click', handlers.cart, opts);
    window.addEventListener('scroll', handlers.scroll, opts);
    document.addEventListener('keydown', handlers.kd, opts);
    document.addEventListener('keyup', handlers.ku, opts);
    document.addEventListener('focusin', handlers.focus, opts);
    document.addEventListener('focusout', handlers.blur, opts);
    window.addEventListener('popstate', handlers.nav);
    document.addEventListener('submit', handlers.nav, opts);
  }
  function detach(){
    if(!attached) return;
    attached=false;
    const h=handlers; if(!h) return;
    document.removeEventListener('mousemove', h.throttledMove);
    document.removeEventListener('click', h.click);
    document.removeEventListener('click', h.cart);
    window.removeEventListener('scroll', h.scroll);
    document.removeEventListener('keydown', h.kd);
    document.removeEventListener('keyup', h.ku);
    document.removeEventListener('focusin', h.focus);
    document.removeEventListener('focusout', h.blur);
    window.removeEventListener('popstate', h.nav);
    document.removeEventListener('submit', h.nav);
    handlers=null;
  }
  function drain(){ const c=[...buf]; buf.length=0; dropped=0; return c; }
  function peek(){ return [...buf]; }
  return { attach, detach, drain, peek, get buffer(){ return buf; }, get dropped(){ return dropped; } };
}
