#!/usr/bin/env python3
"""
bundle.py - bundel SDK ESM (16 file) -> SATU classic-script IIFE (dist/behaviorguard.js)
Tanpa dependency (nol node/esbuild). Tiap modul dibungkus IIFE sendiri -> nol tabrakan nama.
Output: <script src> biasa, tanpa type=module, tanpa sub-file, cross-origin ready.
"""
import os, re, posixpath

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SDK  = os.path.join(ROOT, "sdk")

# urutan dependensi (deps dulu, entry terakhir)
ORDER = [
    "core/config.js", "core/standardize.js", "core/features.js",
    "core/ensemble.js", "core/risk.js", "core/isolation_forest.js",
    "core/ocsvm.js", "core/mahalanobis.js", "core/capture.js", "core/challenge.js", "core/mfa.js",
    "core/integrity.js", "core/fingerprint.js", "core/lifecycle.js",
    "core/ratelimit.js", "core/token.js", "storage.js",
    "behaviorguard.js",
]

def resolve_key(importer, spec):
    d = posixpath.dirname(importer)
    return posixpath.normpath(posixpath.join(d, spec)) if d else posixpath.normpath(spec)

def collect_exports(src):
    """kembalikan dict {exportedName: localName} + apakah ada default."""
    names = {}
    for m in re.finditer(r'^export\s+const\s+(\w+)', src, re.M): names[m.group(1)] = m.group(1)
    for m in re.finditer(r'^export\s+(?:async\s+)?function\s+(\w+)', src, re.M): names[m.group(1)] = m.group(1)
    for m in re.finditer(r'^export\s+class\s+(\w+)', src, re.M): names[m.group(1)] = m.group(1)
    for m in re.finditer(r'^export\s*\{([^}]*)\}\s*;', src, re.M):
        for part in m.group(1).split(','):
            part = part.strip()
            if not part: continue
            if ' as ' in part:
                local, exp = [p.strip() for p in part.split(' as ')]
            else:
                local = exp = part
            names[exp] = local
    return names

def transform(key, src):
    # 1) import { a, b as c } from 'spec';  ->  const { a, b: c } = __M["resolvedkey"];
    def imp(m):
        inner = m.group(1).replace(' as ', ': ')
        spec  = m.group(2)
        return 'const {%s} = __M["%s"];' % (inner, resolve_key(key, spec))
    src = re.sub(r"import\s*\{([^}]*)\}\s*from\s*['\"]([^'\"]+)['\"]\s*;", imp, src)

    # 2) buang baris export re-export / default (entry) - exports diambil dari collect
    src = re.sub(r'^export\s*\{[^}]*\}\s*;\s*$', '', src, flags=re.M)
    src = re.sub(r'^export\s+default\s+[^;]+;\s*$', '', src, flags=re.M)

    # 3) declarations: buang keyword 'export ' di depan const/function/class/async
    src = re.sub(r'^export\s+(const|function|async|class)\b', r'\1', src, flags=re.M)
    return src

def wrap(key, src, exports):
    body = transform(key, src)
    ret = ", ".join('%s: %s' % (e, l) for e, l in exports.items())
    return (
        '__M["%s"] = (function(){\n' % key
        + body.rstrip() + "\n"
        + "return {%s};\n})();\n" % ret
    )

def main():
    parts = []
    parts.append("/* BehaviorGuard bundle - AUTO-GENERATED oleh tools/bundle.py. Jangan edit tangan. */")
    parts.append("(function(){\n'use strict';\nvar __CURRENT = document.currentScript;\nvar __M = {};\n")

    for rel in ORDER:
        with open(os.path.join(SDK, rel), encoding="utf-8") as f:
            src = f.read()
        exports = collect_exports(src)
        parts.append("/* ---- %s ---- */" % rel)
        parts.append(wrap(rel, src, exports))

    # bootstrap plug-and-play: config via data-* attribute ATAU window.BehaviorGuardConfig
    parts.append(r'''
/* ---- panel status bawaan (opsional, aktif via cfg.panel:true / data-panel) ---- */
function __bgMountPanel(){
  if(document.getElementById('bg-panel')) return function(){};
  var wrap=document.createElement('div');
  wrap.id='bg-panel';
  wrap.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483000;width:230px;'+
    'font:13px/1.45 system-ui,Segoe UI,Roboto,sans-serif;background:#fff;color:#0f1729;'+
    'border:1px solid #e6e9ee;border-left:5px solid #94a3b8;border-radius:12px;'+
    'box-shadow:0 10px 30px rgba(15,23,41,.18);overflow:hidden;transition:border-color .2s';
  wrap.innerHTML=
    '<div style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:#f8fafc;border-bottom:1px solid #eef2f7">'+
      '<span style="font-size:15px">🛡️</span>'+
      '<b style="flex:1;font-size:13px">BehaviorGuard</b>'+
      '<span id="bg-p-dot" style="width:10px;height:10px;border-radius:50%;background:#94a3b8"></span>'+
    '</div>'+
    '<div style="padding:12px">'+
      '<div style="display:flex;align-items:baseline;gap:8px">'+
        '<span id="bg-p-lvl" style="font-size:20px;font-weight:800;color:#64748b">MENGENALI…</span>'+
      '</div>'+
      '<div id="bg-p-score" style="color:#64748b;font-size:12px;margin-top:2px">menunggu aktivitas…</div>'+
      '<div id="bg-p-bar" style="display:none;height:6px;border-radius:99px;background:#e6e9ee;margin-top:9px;overflow:hidden">'+
        '<i id="bg-p-fill" style="display:block;height:100%;width:0%;background:#64748b;border-radius:99px;transition:width .3s"></i></div>'+
      '<div id="bg-p-reason" style="color:#94a3b8;font-size:11px;margin-top:8px;line-height:1.35"></div>'+
    '</div>';
  (document.body||document.documentElement).appendChild(wrap);
  var C={LOW:{c:'#059669',t:'AMAN'},MEDIUM:{c:'#d97706',t:'WASPADA'},HIGH:{c:'#dc2626',t:'BAHAYA'}};
  return function(e){
    var lvl=document.getElementById('bg-p-lvl');
    var skor=document.getElementById('bg-p-score');
    var bar=document.getElementById('bg-p-bar');
    var fill=document.getElementById('bg-p-fill');
    var alasan=document.getElementById('bg-p-reason');

    // Fase pendaftaran: tampilkan PROGRES, bukan cuma "MENGENALI...". Tanpa ini
    // penonton tidak punya cara tahu sistemnya sedang berjalan atau menggantung.
    var m=(e.reasons&&e.reasons[0]||'').match(/enrollment\s+(\d+)\s*\/\s*(\d+)/);
    if(m){
      var kini=+m[1], perlu=+m[2];
      wrap.style.borderLeftColor='#6366f1';
      document.getElementById('bg-p-dot').style.background='#6366f1';
      lvl.textContent='MENGENALI '+kini+'/'+perlu; lvl.style.color='#4f46e5'; lvl.style.fontSize='18px';
      skor.textContent='membangun profil pemilik…';
      bar.style.display='block'; fill.style.width=Math.round(kini/perlu*100)+'%'; fill.style.background='#6366f1';
      alasan.textContent = kini>=perlu ? 'profil siap — sesi berikutnya sudah dinilai'
                                       : 'butuh '+(perlu-kini)+' sesi lagi sebelum bisa menilai';
      return;
    }

    var s=C[e.level]||C.LOW;
    wrap.style.borderLeftColor=s.c;
    document.getElementById('bg-p-dot').style.background=s.c;
    lvl.textContent=e.level+' · '+s.t; lvl.style.color=s.c; lvl.style.fontSize='20px';
    bar.style.display='none';
    skor.textContent='skor perilaku: '+(e.score!=null?e.score.toFixed(2):'-');
    var r=(e.reasons&&e.reasons.length)?('Sinyal: '+e.reasons.slice(0,2).join(', ')):'';
    alasan.textContent=r;
  };
}

/* ---- auto-boot plug-and-play ---- */
try{
  var BG = window.BehaviorGuard;
  var S  = __CURRENT;
  var cfg = (window.BehaviorGuardConfig && typeof window.BehaviorGuardConfig==='object') ? window.BehaviorGuardConfig : {};
  var userId = cfg.userId || (S && (S.getAttribute('data-user') || S.getAttribute('data-user-id')));
  if(BG && userId){
    var cbName = cfg.callback || (S && S.getAttribute('data-callback'));
    var userOnRisk = (cbName && typeof window[cbName]==='function') ? window[cbName] : cfg.onRisk;
    var wantPanel = cfg.panel===true || (S && S.getAttribute('data-panel')!=null);
    var panelUpdate = null;
    var mount = function(){ if(wantPanel && !panelUpdate) panelUpdate=__bgMountPanel(); };
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', mount); else mount();
    var onRisk = function(e){
      try{ if(panelUpdate) panelUpdate(e); }catch(_){}
      if(typeof userOnRisk==='function'){ try{ userOnRisk(e); }catch(_){}}
      // event DOM tetap disiarkan untuk integrasi lanjutan
      try{ window.dispatchEvent(new CustomEvent('behaviorguard:risk',{detail:e})); }catch(_){}
    };
    var opts = {userId:userId, onRisk:onRisk};
    // HYBRID cloud: pk (kunci tenant) + endpoint (VPS) -> baseline lintas-device + log verdict
    opts.pk       = cfg.pk       || (S && S.getAttribute('data-pk'))       || null;
    opts.endpoint = cfg.endpoint || (S && S.getAttribute('data-endpoint')) || null;
    ['weights','baseline','retrainEvery','features','thresholds','mfa'].forEach(function(k){ if(cfg[k]!=null) opts[k]=cfg[k]; });
    BG.init(opts);
    window.addEventListener('pagehide', function(){ try{ BG.endSession(); }catch(_){}} );
  }
}catch(e){ try{ console.error('[BehaviorGuard boot]', e); }catch(_){} }
})();
''')

    out = os.path.join(ROOT, "dist")
    os.makedirs(out, exist_ok=True)
    dest = os.path.join(out, "behaviorguard.js")
    with open(dest, "w", encoding="utf-8") as f:
        f.write("\n".join(parts))
    kb = os.path.getsize(dest)/1024
    print("OK -> dist/behaviorguard.js  (%.1f KB, %d modul)" % (kb, len(ORDER)))

    # SDK backend single-file: salin bg_core.py apa adanya ke dist/ (biar sinkron)
    import shutil
    src_py = os.path.join(ROOT, "core", "bg_core.py")
    dst_py = os.path.join(out, "behaviorguard.py")
    shutil.copyfile(src_py, dst_py)
    print("OK -> dist/behaviorguard.py (%.1f KB, SDK backend Python)"
          % (os.path.getsize(dst_py)/1024))

if __name__ == "__main__":
    main()
