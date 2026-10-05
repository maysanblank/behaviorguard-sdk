#!/usr/bin/env python3
"""
bundle.py - bundel SDK ESM (17 file) -> SATU classic-script IIFE (dist/behaviorguard.js)
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
    "core/ocsvm.js", "core/mahalanobis.js", "core/capture.js", "core/idle.js", "core/challenge.js", "core/mfa.js", "core/enroll_ui.js",
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

def strip_comments(src):
    """
    Pengecil KONSERVATIF, tanpa dependensi: hanya membuang baris yang SELURUHNYA komentar
    (`// ...`, blok `/* ... */` yang dibuka di awal baris), baris kosong, dan indentasi -
    dan tidak pernah menyentuh isi template literal (CSS dialog, HTML). Komentar di ujung
    baris kode dibiarkan: memotongnya butuh pengurai JS penuh (string, regex), dan salah
    potong di pustaka keamanan bukan pertukaran yang layak demi beberapa KB.
    Kesetaraannya diuji: tools/min_check.mjs menjalankan kedua berkas dengan event yang
    sama dan mewajibkan vonis yang identik.
    """
    out, in_tpl, in_block = [], False, False
    for line in src.replace("\r\n", "\n").split("\n"):
        if in_tpl:
            out.append(line)
        else:
            t = line.strip()
            if in_block:
                if "*/" in t:
                    in_block = False
                    rest = t.split("*/", 1)[1].strip()
                    if rest:
                        out.append(rest)
                continue
            if t.startswith("/*") and "*/" not in t[2:]:
                in_block = True
                continue
            if t.startswith("/*") and t.endswith("*/") and t.count("*/") == 1:
                continue
            if t.startswith("//") or not t:
                continue
            out.append(t)
        # status template literal sesudah baris ini: jumlah backtick tak-ter-escape ganjil = berganti
        n = 0; i = 0
        while i < len(line):
            if line[i] == "\\":
                i += 2; continue
            if line[i] == "`":
                n += 1
            i += 1
        if n % 2 == 1:
            in_tpl = not in_tpl
    return "\n".join(out) + "\n"


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
/* ---- built-in status panel (optional, on with cfg.panel:true / data-panel) ----
   C-45: Shadow DOM (site CSS cannot break it, CSP style-src safe), no emoji, text via
   textContent, enrollment progress from evt.enrollment (not a regex over reasons).
   Language follows the page (lang attribute, then the browser), English by default. */
function __bgMountPanel(){
  if(document.querySelector('[data-bg-panel]')) return function(){};
  var ID=false; try{ ID=/^id/i.test(document.documentElement.getAttribute('lang')||navigator.language||'en'); }catch(_){}
  var T=ID ? {more:'Lihat detail', learning:'Mengenali', waiting:'menunggu aktivitas', building:'membangun profil pemilik',
      ready:'Profil siap. Jendela berikutnya dinilai.', need:function(m){ return 'Butuh '+m+' jendela aktivitas lagi.'; }, score:'skor',
      LOW:'Aman', MEDIUM:'Perlu verifikasi', HIGH:'Berisiko', UNKNOWN:'Belum cukup bukti'}
    : {more:'See details', learning:'Learning', waiting:'waiting for activity', building:'building the owner profile',
      ready:'Profile ready. The next window is assessed.', need:function(m){ return m+' more activity windows needed.'; }, score:'score',
      LOW:'Safe', MEDIUM:'Verify', HIGH:'At risk', UNKNOWN:'Not enough evidence'};
  var host=document.createElement('div');
  host.setAttribute('data-bg-panel','');
  host.style.cssText='position:fixed;right:16px;bottom:16px;z-index:2147483000';
  var root=host.attachShadow?host.attachShadow({mode:'open'}):host;
  var css=':host{all:initial}*{box-sizing:border-box}'+
    '.p{width:236px;font:13px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fff;color:#141a24;'+
    'border:1px solid #e3e6eb;border-radius:12px;box-shadow:0 10px 30px rgba(15,23,41,.14);overflow:hidden}'+
    '.h{display:flex;align-items:center;gap:8px;padding:9px 12px;border-bottom:1px solid #eef0f3;font-weight:650;font-size:12.5px}'+
    '.h svg{width:15px;height:15px;color:#1f5fd6}.h b{flex:1;font-weight:650}'+
    '.d{width:8px;height:8px;border-radius:50%;background:#9aa3af}'+
    '.b{padding:11px 12px 12px}.l{font-size:17px;font-weight:700;letter-spacing:-.01em}'+
    '.s{color:#5b6573;font-size:12px;margin-top:2px}.r{color:#8a93a0;font-size:11.5px;margin-top:7px}'+
    '.bar{height:5px;border-radius:9px;background:#eef0f3;margin-top:9px;overflow:hidden}.bar i{display:block;height:100%;width:0;background:#1f5fd6;transition:width .3s}'+
    '.m{margin-top:8px;border:0;background:none;padding:0;font:inherit;font-size:12px;font-weight:600;color:#1f5fd6;cursor:pointer}.m:focus-visible{outline:2px solid #1f5fd6;outline-offset:2px}'+
    '@media (prefers-color-scheme:dark){.p{background:#171b22;color:#e8ebf0;border-color:#2c323c}.h{border-color:#2c323c}.s{color:#9aa3af}.bar{background:#2c323c}}';
  try{ if(root.adoptedStyleSheets!==undefined && typeof CSSStyleSheet==='function'){ var sh=new CSSStyleSheet(); sh.replaceSync(css); root.adoptedStyleSheets=[sh]; } else throw 0; }
  catch(_){ var st=document.createElement('style'); st.textContent=css; root.appendChild(st); }
  var p=document.createElement('div'); p.className='p';
  p.innerHTML='<div class="h"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l7 3v5.5c0 4.3-2.9 8.1-7 9.5-4.1-1.4-7-5.2-7-9.5V6l7-3z"/></svg><b>BehaviorGuard</b><span class="d"></span></div>'+
    '<div class="b"><div class="l"></div><div class="s"></div><div class="bar" hidden><i></i></div><div class="r"></div><button class="m" type="button"></button></div>';
  root.appendChild(p);
  (document.body||document.documentElement).appendChild(host);
  var q=function(c){ return p.querySelector(c); };
  var L=q('.l'), S=q('.s'), R=q('.r'), D=q('.d'), BAR=q('.bar'), FILL=q('.bar i');
  q('.m').onclick=function(){ try{ window.BehaviorGuard.openEnrollment(); }catch(e){ try{ console.error(e); }catch(_){} } };
  q('.m').textContent=T.more;
  L.textContent=T.learning; S.textContent=T.waiting;
  var C={LOW:['#1a7f4b',T.LOW],MEDIUM:['#b35c00',T.MEDIUM],HIGH:['#c4312b',T.HIGH],UNKNOWN:['#6b7380',T.UNKNOWN]};
  return function(e){
    if(e.enrollment){
      var k=e.enrollment.done, n=e.enrollment.need;
      D.style.background='#1f5fd6'; L.style.color='#1f5fd6';
      L.textContent=T.learning+' '+k+'/'+n; S.textContent=T.building;
      BAR.hidden=false; FILL.style.width=Math.round(k/n*100)+'%';
      R.textContent= k>=n ? T.ready : T.need(n-k);
      return;
    }
    var c=C[e.level]||C.UNKNOWN;
    BAR.hidden=true; D.style.background=c[0]; L.style.color=c[0];
    L.textContent=c[1];
    S.textContent=(e.action||'')+(e.score!=null&&isFinite(e.score)?' · '+T.score+' '+e.score.toFixed(2):'');
    R.textContent=(e.reasons&&e.reasons.length)?e.reasons.slice(0,2).join(' · '):'';
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
      // C-45: event DOM `behaviorguard:risk` kini disiarkan oleh inti untuk SEMUA integrasi;
      // menyiarkannya lagi di sini membuat pendengar auto-boot menerima tiap vonis dua kali.
    };
    var opts = {userId:userId, onRisk:onRisk};
    // HYBRID cloud: pk (kunci tenant) + endpoint (VPS) -> baseline lintas-device + log verdict
    opts.pk       = cfg.pk       || (S && S.getAttribute('data-pk'))       || null;
    opts.endpoint = cfg.endpoint || (S && S.getAttribute('data-endpoint')) || null;
    // C-39: token pengguna berumur pendek dari server integrator; tanpa ini mode cloud mati
    opts.userToken = cfg.userToken || (S && S.getAttribute('data-user-token')) || null;
    // C-33: session/idle/calibration dulu TIDAK diteruskan -> integrator auto-boot tak bisa
    // mengatur titik operasi maupun ukuran bukti.
    ['weights','baseline','retrainEvery','features','thresholds','mfa','session','idle','calibration',
     'aggregateWindows','calibrationHoldout'].forEach(function(k){ if(cfg[k]!=null) opts[k]=cfg[k]; });
    BG.init(opts);
    // C-40: DULU di sini ada pagehide -> BG.endSession(). Pendengar ini terpasang SEBELUM
    // milik SDK (init() menunggu fingerprint dulu), jadi ia menguras buffer lebih dulu:
    // penilaian async-nya tak sempat selesai karena halaman mati, dan _bankTail milik SDK
    // mendapati buffer kosong -> bukti terakhir hilang (C-21 lewat pintu lain). SDK sudah
    // menangani pagehide sendiri secara sinkron.
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
    print("OK -> dist/behaviorguard.js  (%.1f KB, %d modules)" % (kb, len(ORDER)))
    import gzip
    full = "\n".join(parts)
    mini = strip_comments(full)
    dest_min = os.path.join(out, "behaviorguard.min.js")
    with open(dest_min, "w", encoding="utf-8", newline="\n") as f:
        f.write(mini)
    print("OK -> dist/behaviorguard.min.js  (%.1f KB, %.1f KB gzip)"
          % (len(mini.encode("utf-8"))/1024, len(gzip.compress(mini.encode("utf-8"), 9))/1024))

    # SDK backend single-file: salin bg_core.py apa adanya ke dist/ (biar sinkron)
    import shutil
    src_py = os.path.join(ROOT, "core", "bg_core.py")
    dst_py = os.path.join(out, "behaviorguard.py")
    shutil.copyfile(src_py, dst_py)
    print("OK -> dist/behaviorguard.py (%.1f KB, Python SDK backend)"
          % (os.path.getsize(dst_py)/1024))

if __name__ == "__main__":
    main()
