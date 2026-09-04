/**
 * bg-loader.js - drop-in 1 script (plug-and-play)
 * Pakai: <script src="bg-loader.js" data-user="andi@example.com" data-callback="onRisk"></script>
 * SDK inti sudah auto-skor (interval 30s + visibilitychange + SPA), loader hanya bootstrap.
 */
(function(){
  const s=document.currentScript;
  if(!s) return;
  const user=s.getAttribute('data-user');
  const cbName=s.getAttribute('data-callback');
  const onRisk = cbName && window[cbName] ? window[cbName] : (e=> console.log('[BG]', e));
  if(!user){ console.warn('[BehaviorGuard] data-user belum diisi'); return; }
  const base=s.src.replace(/\/loader\/bg-loader\.js.*$/,'');
  const sdk=base+'/sdk/behaviorguard.js';
  import(sdk).then(m=>{
    const bg=m.default||m.singleton||window.BehaviorGuard._instance;
    if(bg && bg.init) bg.init({userId:user, onRisk});
    // auto-skor sudah di SDK (_wireAuto), di sini cukup pastikan endSession saat unload
    window.addEventListener('pagehide', ()=>{ if(bg && bg.endSession) bg.endSession(); });
    window.addEventListener('beforeunload', ()=>{ if(bg && bg.endSession) bg.endSession(); });
  }).catch(e=> console.error('[BG loader]', e));
})();
