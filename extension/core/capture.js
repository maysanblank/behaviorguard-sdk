/**
 * capture.js - auto-capture DOM (pointer/key/scroll/focus/blur/submit/cart)
 * Tanpa ubah kode aplikasi. Tahan tab-switch/refresh. Caps & robust.
 */
export function createCapture(onEvent){
  const MAX_BUF=2000; // cap 2000 event per sesi (hindari volume gila mousemove)
  const buf=[];
  let dropped=0;
  // C-46: PERILAKU HARUS DATANG DARI MANUSIA. `isTrusted` false = event yang DIBUAT skrip
  // (`el.click()`, `dispatchEvent(new KeyboardEvent(...))`), bukan dari perangkat masukan.
  // Tanpa saringan ini, penyerang yang sudah menjalankan skrip di halaman tidak perlu
  // menebak perilaku pemilik sama sekali: ia cukup MENYIARKAN aliran event bergaya manusia
  // (jitter acak, jeda wajar) sampai modelnya sendiri yang meyakinkan pustaka bahwa
  // pemiliklah yang duduk di sini - dan karena vektor palsu itu dinilai LOW, ia bahkan ikut
  // MELATIH kolam baseline. Itu meracuni profil, bukan sekadar melewati satu vonis.
  // `!== false` (bukan `=== true`): peramban sangat lama tanpa properti ini tidak ikut
  // disaring - gagal ke perilaku lama, bukan diam-diam buta.
  // Yang dijatuhkan tetap DIHITUNG: banyaknya masukan sintetis adalah sinyal tersendiri
  // (lihat behaviorguard._assessEvents), bukan sesuatu yang boleh hilang tanpa jejak.
  let synthetic=0;
  const real=e=>{ if(e && e.isTrusted===false){ synthetic++; return false; } return true; };
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
    // C-30 PRIVASI: `key` DULU menyimpan KARAKTER ASLI yang diketik - termasuk di kolom
    // kata sandi. Momen paling berbahaya justru login: ketik sandi -> Enter -> halaman
    // pindah -> `_bankTail()` menyimpan 200 event terakhir sebagai JSON TEKS BIASA di
    // localStorage. Sandi tertinggal di browser, terbaca skrip mana pun di origin itu.
    // Satu-satunya fitur yang memakai identitas tombol adalah
    // keystroke_transition_entropy, dan ia hanya butuh tahu "sama atau beda dengan
    // tombol sebelumnya". Jadi tiap karakter diganti token urut-kemunculan (k1, k2, ..)
    // lewat peta yang HANYA hidup di memori halaman ini dan tidak pernah disimpan.
    // Pemetaan injektif -> hitungan transisi identik -> entropi identik persis. Nama
    // tombol khusus (Backspace, Enter, Shift, ..) bukan rahasia dan dibiarkan.
    // Yang tersisa untuk sandi hanyalah POLA pengulangan (mis. k1 k2 k1), bukan isinya.
    const keyTok=new Map();
    const tokenOf=k=>{
      if(typeof k!=='string' || k.length!==1) return k;      // tombol bernama / kosong
      let t=keyTok.get(k);
      if(!t){ t='k'+(keyTok.size+1); keyTok.set(k,t); }
      return t;
    };
    // C-44: KELAS POSISI tombol (tangan kiri/kanan, angka, spasi) untuk
    // keystroke_cross_hand_ratio - dari e.code (posisi FISIK, tak bergantung tata letak),
    // bukan dari hurufnya. Di kolom kata sandi kelasnya TIDAK direkam: urutan kiri/kanan
    // sandi mempersempit tebakan, jadi di sana hanya waktu tekan yang diambil.
    const LEFT_CODES=new Set(['KeyQ','KeyW','KeyE','KeyR','KeyT','KeyA','KeyS','KeyD','KeyF','KeyG','KeyZ','KeyX','KeyC','KeyV','KeyB']);
    const codeClass=e=>{
      try{ if(e.target && e.target.matches && e.target.matches('input[type=password]')) return undefined; }catch{}
      const c=e.code||'';
      if(c.startsWith('Key')) return LEFT_CODES.has(c)? 'L' : 'R';
      if(c.startsWith('Digit') || c.startsWith('Numpad')) return 'D';
      if(c==='Space') return 'S';
      return undefined;                                    // tombol lain: cukup nama tombolnya
    };
    // C-30: ketikan di popup MFA milik BG sendiri BUKAN perilaku alami - itu frasa tetap
    // yang diketik berulang dengan sengaja. Dulu ikut terekam dan mencemari fitur ketik
    // jendela berikutnya (plus FORM_FOCUS/BLUR dari kolom popup). Gerak mouse tetap
    // direkam: menggerakkan mouse ke popup adalah gerakan tangan yang wajar.
    const NON_TEXT=new Set(['checkbox','radio','button','submit','reset','range','color','file','image','hidden']);
    const isTextEntry=t=>{
      try{
        if(t.isContentEditable || t.tagName==='TEXTAREA') return true;
        if(t.tagName!=='INPUT') return false;          // SELECT dan lainnya
        return !NON_TEXT.has(String(t.type||'text').toLowerCase());
      }catch{ return true; }
    };
    const fromBg=e=>{ try{ return !!(e && e.target && e.target.closest && e.target.closest('[data-bg-mfa]')); }catch{ return false; } };
    let lastScrollY=window.scrollY;
    // C-16/C-17: `velocity` DULU TIDAK PERNAH DIISI di sini, padahal dua tempat
    // membacanya. Akibatnya di pemakaian nyata (bukan data riset):
    //   1. integrity.js membaca `e.velocity||0` -> selalu 0 -> std 0 -> sesi manusia
    //      biasa ditandai "velocity konstan" dan diblokir sebagai bot. Terpicu pada
    //      sesi yang keystroke+klik-nya < 10, yaitu sesi yang isinya kebanyakan
    //      gerak mouse - persis perilaku pengunjung yang cuma menelusuri halaman.
    //   2. features.js SPEC 8.4 menghitung idle = jumlah gerakan dgn velocity < 0.5;
    //      tanpa field itu SEMUA gerakan terhitung diam -> `cursor_idle_ratio` terkunci
    //      di 1.0. Satu dari 28 fitur jadi mati di produksi, padahal saat model
    //      dilatih dari basis data riset fitur itu bervariasi - ketidakcocokan
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
      click: e=> { if(fromBg(e) || !real(e)) return; push({event_type:'MOUSE_CLICK', x:e.clientX, y:e.clientY, page_url: location.href}); },
      // `scroll` tidak bisa disaring dengan isTrusted: menggulir lewat window.scrollTo()
      // menerbitkan event dengan isTrusted TRUE. Yang diukur di sini memang selisih posisi,
      // bukan gerak tangan; biarkan apa adanya dan jangan mengaku menyaringnya.
      scroll: e=> { const cur=window.scrollY; const delta=Math.abs(cur-lastScrollY); lastScrollY=cur; if(delta===0) return; push({event_type:'MOUSE_SCROLL', scroll_delta: delta, scroll_velocity: 0, page_url: location.href}); },
      // auto-repeat (tombol ditahan) menembakkan keydown berulang; yang dihitung tahan
      // adalah tekanan PERTAMA, jadi pengulangan diabaikan. Entri dihapus di keyup supaya
      // keydown yang hilang (fokus pindah) tidak meninggalkan t0 basi bermenit-menit.
      kd: e=> { if(fromBg(e) || e.repeat || !real(e)) return; downAt.set(e.code, Date.now()); },
      ku: e=> { if(fromBg(e) || !real(e)) return; const t0=downAt.get(e.code); downAt.delete(e.code); const hold=t0? Date.now()-t0 : 80; const ev={event_type:'KEYSTROKE', key:tokenOf(e.key), hold_time: hold, page_url: location.href}; const kc=codeClass(e); if(kc) ev.kc=kc; if(e.key==='Unidentified' || e.keyCode===229 || e.isComposing) ev.soft=true; push(ev); },
      // C-45: `txt` = kolom yang MEMANG diisi dengan mengetik. Fokus ke <select>, kotak
      // centang, atau tombol radio tidak pernah menghasilkan ketikan, dan dulu terbaca sebagai
      // "form tersentuh tapi tidak diketik" (A3, autofill) -> jendelanya tak layak melatih dan
      // ditandai bukti sebagian. Fiturnya (form_focus_count) tidak berubah: event yang sama.
      // C-46: fokus/blur SENGAJA tidak disaring isTrusted. `el.focus()` yang dipanggil situs
      // (autofocus kolom pertama, pindah kolom otomatis sesudah 4 digit) menerbitkan event
      // tak-tepercaya, padahal itu perilaku aplikasi yang normal dan ikut terhitung saat data
      // riset dikumpulkan. Menyaringnya di sini hanya akan membuat form_focus_count di
      // pemakaian berbeda dari saat model dilatih. Kedua fitur itu struktural, bukan biometrik
      // waktu - nilai sinyalnya tidak sepadan dengan risiko ketidakcocokan latih-vs-pakai.
      focus: e=> { try{ if(fromBg(e)) return; if(e.target && e.target.matches && e.target.matches('input,textarea,select,[contenteditable]')) push({event_type:'FORM_FOCUS', txt: isTextEntry(e.target), page_url: location.href}); }catch{} },
      blur: e=> { try{ if(fromBg(e)) return; if(e.target && e.target.matches && e.target.matches('input,textarea,select,[contenteditable]')) push({event_type:'FORM_BLUR', page_url: location.href}); }catch{} },
      nav: ()=> push({event_type:'NAVIGATION', page_url: location.href}),
      // A3: form yang diisi password manager / autofill / tempel TIDAK menghasilkan
      // satu pun event keyboard, sehingga KEDELAPAN fitur keystroke jatuh ke nol
      // (terukur: dwell 80->0, flight 120->0, speed 4,8->0, entropi 1,1->0, dst).
      // Dua arah bahayanya: pemilik yang memakai password manager terlihat menyimpang
      // tiap login, DAN penyusup bisa menyenjatakannya untuk menghapus seluruh blok
      // bukti ketikan. Nol di sini berarti "tidak ada bukti", bukan "beginilah cara
      // orang ini mengetik" - dan model tidak bisa membedakannya sendiri.
      // Peristiwanya ditandai di sini; keputusannya (ABSTAIN pada blok keystroke)
      // ada di behaviorguard.js, sama seperti C-23 menandai idle lalu memutuskan.
      paste: e=>{ if(fromBg(e)) return; try{
        const n=(e.clipboardData && e.clipboardData.getData ? (e.clipboardData.getData('text')||'') : '').length;
        push({event_type:'PASTE', chars:n, page_url: location.href});
      }catch{ push({event_type:'PASTE', chars:0, page_url: location.href}); } },
      // B4: di layar sentuh `mousemove` praktis tidak pernah muncul, sehingga SEMBILAN
      // fitur mouse jadi nol - pola yang sama dengan A3, blok yang berbeda. Sentuhan
      // dan mouse adalah dua ALAT UKUR untuk gerakan yang sama, jadi ia dipetakan ke
      // tipe event yang sama; tanpa ini, pengguna ponsel tidak pernah bisa dinilai
      // sama sekali. Ditandai `touch:true` supaya lapisan konteks bisa memisahkan
      // baselinenya kalau nanti diperlukan.
      touch: e=>{ try{
        const t=e.touches && e.touches[0]; if(!t) return;
        push({event_type:'MOUSE_MOVE', x:t.clientX, y:t.clientY, velocity: withVelocity(t), touch:true, page_url: location.href});
      }catch{} },
      // klik yang sama sudah dihitung di handler `click`, jadi di sini disaring TANPA menghitung
      cart: e=>{ try{ if(e && e.isTrusted===false) return; const t=e.target && e.target.closest && e.target.closest('[data-bg-cart], .add-to-cart, [data-cart]'); if(t) push({event_type:'CART_ACTION', page_url: location.href}); }catch{} }
    };
    // mousemove throttled: 1 per 50ms untuk cap volume
    //
    // C-46: saringan isTrusted WAJIB di depan throttle, bukan di dalam handler.move. Kalau
    // di dalam, event tiruan tetap lolos throttle lebih dulu dan MEMPERBARUI `lastMove` -
    // sehingga skrip yang membanjiri mousemove 1000/dtk membuat gerakan mouse ASLI selalu
    // jatuh di dalam jendela 50 ms dan tak pernah terekam. Menolak event palsu jadi malah
    // membungkam yang asli; penyerang tidak perlu memalsukan perilaku, cukup menghapusnya.
    let lastMove=0;
    const throttledMove=e=>{
      if(!real(e)) return;
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
    document.addEventListener('paste', handlers.paste, opts);
    // touchmove di-throttle memakai penjaga yang sama dengan mousemove
    handlers.throttledTouch=e=>{ if(!real(e)) return; const now=Date.now(); if(now-lastMove < 50) return; lastMove=now; handlers.touch(e); };
    document.addEventListener('touchmove', handlers.throttledTouch, opts);
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
    document.removeEventListener('paste', h.paste);
    document.removeEventListener('touchmove', h.throttledTouch);
    handlers=null;
  }
  // `synthetic` sengaja TIDAK direset di drain: ia hitungan KUMULATIF seumur kunjungan,
  // supaya orkestrator bisa mengambil selisihnya per vonis (lihat behaviorguard._ingestVector).
  function drain(){ const c=[...buf]; buf.length=0; dropped=0; return c; }
  function peek(){ return [...buf]; }
  return { attach, detach, drain, peek, get buffer(){ return buf; }, get dropped(){ return dropped; },
           get synthetic(){ return synthetic; } };
}
