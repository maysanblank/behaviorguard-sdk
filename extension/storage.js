/**
 * storage.js - on-device IndexedDB -> localStorage -> memory, deterministik, tidak pernah crash
 * Caps: tidak simpan seluruh vector+feat mentah ke localStorage bila >2MB
 */
const DB_NAME='bg_store', STORE='kv';
const MAX_LOCAL_BYTES=1.8*1024*1024; // cap 1.8MB untuk hindari quota
function idbAvailable(){ try{ return typeof indexedDB!=='undefined'; }catch{ return false; } }

function idbGet(key){
  return new Promise(res=>{
    try{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=e=>{ if(!e.target.result.objectStoreNames.contains(STORE)) e.target.result.createObjectStore(STORE); };
      req.onsuccess=e=>{
        const db=e.target.result;
        if(!db.objectStoreNames.contains(STORE)) return res(null);
        const tx=db.transaction(STORE,'readonly');
        const g=tx.objectStore(STORE).get(key);
        g.onsuccess=()=> res(g.result ?? null);
        g.onerror=()=> res(null);
      };
      req.onerror=()=> res(null);
    }catch{ res(null); }
  });
}
function idbSet(key,val){
  return new Promise(res=>{
    try{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=e=>{ if(!e.target.result.objectStoreNames.contains(STORE)) e.target.result.createObjectStore(STORE); };
      req.onsuccess=e=>{
        const db=e.target.result;
        if(!db.objectStoreNames.contains(STORE)) return res(false);
        const tx=db.transaction(STORE,'readwrite');
        tx.objectStore(STORE).put(val,key);
        tx.oncomplete=()=> res(true);
        tx.onerror=()=> res(false);
      };
      req.onerror=()=> res(false);
    }catch{ res(false); }
  });
}

function idbDel(key){
  // C-10: versi lama memanggil db.transaction() langsung di dalam onsuccess tanpa
  // onupgradeneeded dan tanpa cek objectStoreNames. try/catch di luar bersifat
  // SINKRON sehingga tidak bisa menangkap lemparan di callback async itu -> muncul
  // "NotFoundError: object stores was not found" yang tak tertangkap, melanggar
  // janji "tidak pernah crash" di kepala berkas ini. Kini sebentuk dengan idbGet/idbSet.
  return new Promise(res=>{
    try{
      const req=indexedDB.open(DB_NAME,1);
      req.onupgradeneeded=e=>{ if(!e.target.result.objectStoreNames.contains(STORE)) e.target.result.createObjectStore(STORE); };
      req.onsuccess=e=>{
        try{
          const db=e.target.result;
          if(!db.objectStoreNames.contains(STORE)) return res(false);
          const tx=db.transaction(STORE,'readwrite');
          tx.objectStore(STORE).delete(key);
          tx.oncomplete=()=> res(true);
          tx.onerror=()=> res(false);
        }catch{ res(false); }
      };
      req.onerror=()=> res(false);
    }catch{ res(false); }
  });
}

const mem=new Map();
// enkripsi ringan: XOR + base64 + HMAC (anti-tamper)
async function hmacKey(k){ const hk=await crypto.subtle.importKey('raw', new TextEncoder().encode(k.slice(0,16).padEnd(16,'0')), {name:'HMAC',hash:'SHA-256'}, false, ['sign']); return hk; }
async function seal(obj, keyHint='bg-key'){
  const json=JSON.stringify(obj);
  const b64=btoa(unescape(encodeURIComponent(json)));
  const hk=await hmacKey(keyHint);
  const sig=await crypto.subtle.sign('HMAC', hk, new TextEncoder().encode(b64));
  const hex=Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
  return `${hex}:${b64}`;
}
async function open(sealed, keyHint='bg-key'){
  try{
    const [hex,b64]=sealed.split(':');
    const hk=await hmacKey(keyHint);
    const exp=await crypto.subtle.sign('HMAC', hk, new TextEncoder().encode(b64));
    const eh=Array.from(new Uint8Array(exp)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,16);
    if(eh!==hex) return null; // tamper
    return JSON.parse(decodeURIComponent(escape(atob(b64))));
  }catch{ return null; }
}
export const storage={
  async get(k){
    if(idbAvailable()){ const v=await idbGet(k); if(v!==null){
      if(typeof v==='string' && v.includes(':')){ const o=await open(v,k); if(o) return o; }
      else return v;
    }}
    try{ const v=localStorage.getItem(k); if(v){
      if(v.includes(':')){ const o=await open(v,k); if(o) return o; }
      else return JSON.parse(v);
    }}catch{}
    return mem.get(k) ?? null;
  },
  async set(k,v){
    mem.set(k,v);
    const sealed=await seal(v,k);
    if(idbAvailable()){ await idbSet(k,sealed); }
    try{
      let toSave=v;
      if(v && v.sessions && v.sessions.length>30){
        // B7: DULU dipotong ke 30 sesi terakhir. IndexedDB menerima yang utuh, jadi
        // biasanya tak terasa — tapi di mode penyamaran atau browser yang memblokir
        // IDB, kolam terkunci di 30 padahal progressiveMaxPool = 90. C-22 sudah
        // menunjukkan apa akibat kolam terlalu kecil dibanding d=28: kovarians goyah,
        // deteksi melemah. Dan karena hanya menimpa SEBAGIAN pengguna, gejalanya
        // gampang disalahartikan sebagai perbedaan orang.
        // Yang dibutuhkan model cuma `vector`; `feat` (28 pasangan nama-nilai) murni
        // untuk penjelasan. Membuangnya membuat jauh lebih banyak sesi muat.
        const slim=v.sessions.map(x=> x && x.feat ? {...x, feat:null} : x);
        // C-31: DULU `slim.slice(-90)` — memotong 90 TERAKHIR, jadi blok pendaftaran di
        // DEPAN ikut terbuang. Sesudah reload, 10 sesi apa pun yang kebetulan ada di
        // depan (bisa sesi MEDIUM/HIGH, bisa sesi penyusup) diperlakukan sebagai
        // pendaftaran tanpa syarat: peracunan baseline lewat pemotongan. Blok
        // pendaftaran (`enrollPrefix`, dikirim orkestrator) selalu dipertahankan.
        const pre=Math.min(slim.length, Number.isFinite(v.enrollPrefix) ? v.enrollPrefix : 10);
        const tail=slim.slice(pre);
        toSave={...v, sessions: tail.length>90 ? [...slim.slice(0,pre), ...tail.slice(-90)] : slim,
                enrollPrefix: pre};
      }
      const sealedLocal=await seal(toSave,k);
      if(sealedLocal.length < MAX_LOCAL_BYTES) localStorage.setItem(k, sealedLocal);
      else try{ localStorage.removeItem(k); }catch{}
    }catch{}
  },
  async del(k){
    mem.delete(k);
    if(idbAvailable()){ await idbDel(k); }
    try{ localStorage.removeItem(k); }catch{}
  }
};
