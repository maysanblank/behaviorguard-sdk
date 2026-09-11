/**
 * bg-loader.js - drop-in 1 script untuk build ES-module (sdk/). Padanan dist/behaviorguard.js.
 * Pakai: <script src="/loader/bg-loader.js" data-user="andi@example.com" data-callback="onRisk"></script>
 * Opsional: data-pk, data-endpoint, data-user-token (mode cloud, C-39), atau
 *           window.BehaviorGuardConfig = { session, idle, calibration, mfa, ... } sebelum tag ini.
 * SDK inti sudah auto-skor (interval 30s + visibilitychange + SPA) dan menyimpan ekor
 * saat pagehide; loader hanya bootstrap.
 */
(function(){
  const s=document.currentScript;
  if(!s) return;
  const cfg=(window.BehaviorGuardConfig && typeof window.BehaviorGuardConfig==='object') ? window.BehaviorGuardConfig : {};
  const user=cfg.userId || s.getAttribute('data-user') || s.getAttribute('data-user-id');
  const cbName=cfg.callback || s.getAttribute('data-callback');
  const onRisk = (cbName && typeof window[cbName]==='function') ? window[cbName]
               : (typeof cfg.onRisk==='function' ? cfg.onRisk : (e=> console.log('[BG]', e)));
  if(!user){ console.warn('[BehaviorGuard] data-user belum diisi'); return; }
  const base=s.src.replace(/\/loader\/bg-loader\.js.*$/,'');
  import(base+'/sdk/behaviorguard.js').then(m=>{
    const bg=m.default||m.singleton;
    const opts={userId:user, onRisk:(e)=>{
      try{ onRisk(e); }catch(_){}
      try{ window.dispatchEvent(new CustomEvent('behaviorguard:risk',{detail:e})); }catch(_){}
    }};
    opts.pk       = cfg.pk       || s.getAttribute('data-pk')         || null;
    opts.endpoint = cfg.endpoint || s.getAttribute('data-endpoint')   || null;
    opts.userToken= cfg.userToken|| s.getAttribute('data-user-token') || null;
    ['weights','baseline','retrainEvery','features','thresholds','mfa','session','idle','calibration',
     'aggregateWindows','calibrationHoldout'].forEach(k=>{ if(cfg[k]!=null) opts[k]=cfg[k]; });
    bg.init(opts);
    // C-40/C-41: TIDAK ada pagehide -> endSession() di sini. Pendengar itu terpasang sebelum
    // milik SDK, menguras buffer lebih dulu dengan penilaian async yang tak sempat selesai,
    // dan _bankTail milik SDK mendapati buffer kosong: bukti halaman terakhir hilang.
  }).catch(e=> console.error('[BG loader]', e));
})();
