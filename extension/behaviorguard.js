/**
 * behaviorguard.js - SDK inti BehaviorGuard (plug-and-play, on-device, deterministik)
 * Cara pakai (≤3 baris):
 *   <script src="behaviorguard.js"></script>
 *   <script>BehaviorGuard.init({userId: "andi@example.com", onRisk: e=>console.log(e)})</script>
 * Selesai. Tanpa ubah kode aplikasi.
 */
import { DEFAULTS, normalizeWeights } from './core/config.js';
import { extractF4, featuresToVector, F4 } from './core/features.js';
import { computeStats, standardize, standardizeBatch } from './core/standardize.js';
import { IsolationForest } from './core/isolation_forest.js';
import { OCSVM } from './core/ocsvm.js';
import { Mahalanobis } from './core/mahalanobis.js';
import { Ensemble } from './core/ensemble.js';
import { toRisk, toAction, topFeatures, reasonsFrom, calibrateThresholds, calibrateThresholdsParametric } from './core/risk.js';
import { createCapture } from './core/capture.js';
import { segmentByIdle, idleAccounting, splitForAssessment, classifyGap, groupByStream, compressIdle, dropExactDuplicates } from './core/idle.js';
import { storage } from './storage.js';
import { isConverged, cohortLowRate } from './core/lifecycle.js';
import { getOrCreateSecret, generateToken } from './core/token.js';
import { checkIntegrity } from './core/integrity.js';
import { getFingerprint, FP_VERSION } from './core/fingerprint.js';
import { checkCollect } from './core/ratelimit.js';
import { buildTemplate, verify as verifyChallenge } from './core/challenge.js';
import { runMfaChallenge } from './core/mfa.js';

const ns = id => `bg:${id}`;
// A4: `bg:pending` DULU kunci GLOBAL, tidak seperti sesi yang sudah ber-ruang-nama.
// Akibatnya di browser bersama: pengguna A menutup halaman -> ekornya tersimpan ->
// pengguna B login -> init() membaca pending itu tanpa memeriksa pemiliknya ->
// perilaku A dinilai, dan bisa ikut MELATIH, sebagai B. Itu peracunan baseline
// lintas-akun, bukan sekadar derau. Kunci lama ikut dibersihkan sekali saat init.
const nsPending = id => `bg:pending:${id}`;
const LEGACY_PENDING = 'bg:pending';

class BehaviorGuard {
  constructor(){ this.cfg=structuredClone(DEFAULTS); this.userId=null; this.onRisk=null; this.capture=null; this.model=null; this.stats=null; this.sessions=[]; this.inited=false; this.lastRisk='LOW'; this.fingerprint=null; this.secret=null; this.challengeTemplate=null; }
  async init({userId, onRisk, storage: storageOpt, weights, baseline, retrainEvery, features, thresholds, pk, endpoint, userToken, mfa, session, idle, aggregateWindows, calibrationHoldout, calibration}={}){
    if(!userId) throw new Error('BehaviorGuard.init: userId wajib');
    // C-38: init() ULANG (SPA ganti rute, atau logout A -> login B di tab yang sama) DULU
    // mewarisi seluruh state di memori: kalau B belum punya data tersimpan, blok
    // `if(saved)` di bawah tidak jalan, sehingga B dinilai dengan MODEL A, sesinya melatih
    // kolam A lalu tersimpan sebagai milik B, dan verifikasinya dicocokkan dengan TEMPLATE
    // RITME A. Kerabat C-7 (clear()), lewat pintu yang berbeda. State per-pengguna selalu
    // dimulai dari nol; capture lama dilepas supaya pendengar tidak menumpuk.
    this._resetUserState();
    if(this.capture){ try{ this.capture.detach(); }catch{} this.capture=null; }
    // opsi init() sebelumnya (mis. mfa.enabled:false milik integrasi lain) juga tidak
    // boleh terbawa ke init() berikutnya
    if(this.inited) this.cfg=structuredClone(DEFAULTS);
    this.userId=userId; this.onRisk=onRisk||(()=>{});
    // HYBRID cloud mode: baseline per tenant+userId hidup di VPS (lintas-device),
    // event mentah TETAP di device. Aktif kalau pk+endpoint diisi.
    // C-39: pk SENDIRIAN tidak lagi membuka baseline/log. Server menuntut token pengguna
    // HMAC(sk, pk|userId|exp) yang dicetak server integrator sesudah login; tanpa token,
    // mode cloud MATI (gagal-tertutup) dan pustaka berjalan murni on-device.
    this.pk=pk||null; this.endpoint=endpoint?endpoint.replace(/\/+$/,''):null; this.userToken=userToken||null;
    this.cloud=!!(this.pk&&this.endpoint&&this.userToken);
    if(this.pk && this.endpoint && !this.userToken){
      try{ console.warn('[BG] mode cloud butuh userToken dari server Anda (lihat server/README.md) - berjalan on-device saja'); }catch{}
    }
    if(weights) this.cfg.weights=normalizeWeights(weights);
    if(baseline) this.cfg.baseline=baseline;
    if(retrainEvery) this.cfg.retrainEvery=retrainEvery;
    if(features) this.cfg.features=features;
    if(thresholds) this.cfg.thresholds=thresholds;
    // C-11: `mfa` dulu tidak ada di daftar opsi init() MAUPUN di daftar kunci yang
    // diteruskan auto-boot, sehingga `{ mfa:{enabled:false} }` diam-diam diabaikan —
    // knob yang didokumentasikan tapi tidak pernah ada. Digabung, bukan ditimpa,
    // supaya konfigurasi parsial ({enabled:false}) tetap mewarisi default lainnya.
    if(mfa && typeof mfa==='object') this.cfg.mfa={...this.cfg.mfa, ...mfa};
    // C-23: sama pola dengan `mfa` — digabung, bukan ditimpa, supaya konfigurasi
    // parsial ({idleGapSec:60}) tetap mewarisi sisa default.
    if(session && typeof session==='object') this.cfg.session={...this.cfg.session, ...session};
    if(idle && typeof idle==='object') this.cfg.idle={...this.cfg.idle, ...idle};
    // C-24: ketiga knob invariansi panjang sesi. Default 0/1 = perilaku lama persis.
    if(Number.isFinite(aggregateWindows)) this.cfg.aggregateWindows=aggregateWindows;
    if(Number.isFinite(calibrationHoldout)) this.cfg.calibrationHoldout=calibrationHoldout;
    // C-33: titik operasi (ketat vs longgar) dulu TIDAK bisa diatur integrator — k_low
    // tidak ada di daftar opsi init(), jadi satu-satunya cara adalah menyunting config.js.
    // Lebih kecil = lebih ketat (penyusup lebih jarang lolos, pemilik lebih sering
    // diminta verifikasi). Tabel pertukarannya di README "Choosing an operating point".
    if(calibration && typeof calibration==='object'){
      if(Number.isFinite(calibration.k_low)) this.cfg.k_low=calibration.k_low;
      if(Number.isFinite(calibration.k_med_extra)) this.cfg.k_med_extra=calibration.k_med_extra;
    }
    // fingerprint + secret + token (HMAC)
    try{ this.fingerprint=await getFingerprint(); }catch{ this.fingerprint='unknown'; }
    try{ this.secret=await getOrCreateSecret(userId, storage); this.token=await generateToken({secret:this.secret, userId}); }catch{}
    const saved=await storage.get(ns(userId));
    if(saved){ this.sessions=saved.sessions||[]; this.stats=saved.stats||null; this.lastRisk=saved.lastRisk||'LOW'; this._highRun=saved.highRun||0; this.challengeTemplate=saved.challengeTemplate||null;
      // C-32: streak LOW dulu TIDAK disimpan. Lantai lengket turun hanya setelah 3 LOW
      // berturut dalam SATU muat-halaman, jadi pengguna yang kunjungannya pendek (1-2
      // vonis) dan tak punya MFA bawaan tidak pernah turun dari MEDIUM, selamanya.
      this._lowStreak=saved.lowStreak||0;
      this._mfaEnrollSnoozeUntil=saved.mfaEnrollSnoozeUntil||0;
      // C-43: masa berlaku step-up melintasi muat-halaman (situs multi-halaman memuat
      // ulang tiap klik) tapi TIDAK melintasi absen: jeda >= awaySec sejak vonis terakhir
      // yang tersimpan mencabutnya.
      const awayMs=((this.cfg.idle && this.cfg.idle.awaySec) || 300)*1000;
      this._mfaPassedAt=(saved.mfaPassedAt && saved.lastActiveAt && Date.now()-saved.lastActiveAt < awayMs) ? saved.mfaPassedAt : null;
      // cek ganti device. C-36: sidik versi lama (dengan nomor versi UA) tidak dibandingkan
      // — kalau dibandingkan, SEMUA pengguna lama dicurigai sekali sesudah pembaruan ini.
      if(saved.fingerprint && saved.fpv===FP_VERSION && saved.fingerprint!==this.fingerprint){
        console.warn('[BG] device fingerprint berubah - sesi dianggap berisiko');
        this.lastRisk='MEDIUM'; this._mfaPassedAt=null;
      }
    }
    // R4: jika ada ekor yang kesimpen pas beforeunload sebelumnya, pulihkan ke buffer
    try{
      // A4: buang sisa kunci global lama — pemiliknya tak bisa dipastikan, jadi
      // satu-satunya perlakuan yang aman adalah membuangnya, bukan menebak.
      try{ localStorage.removeItem(LEGACY_PENDING); }catch{}
      let pending=JSON.parse(localStorage.getItem(nsPending(userId))||'null');
      // C-33: ekor pending dulu tidak punya umur maksimum. Ia dimaksudkan untuk pindah
      // HALAMAN (detik), tapi ikut terbawa ke kunjungan BESOKNYA: ekor kemarin + ketikan
      // hari ini jadi satu vektor campuran dua hari, dan jeda semalam di dalamnya
      // terbaca sebagai "kembali dari absen" -> MEDIUM di awal tiap kunjungan.
      // Terukur (eval_sdk --live): 149 dari ~500 gesekan pemilik berasal dari sini.
      if(pending && pending.length){
        const maxAge=(this.cfg.session.carryMaxAgeSec||this.cfg.idle.awaySec||300)*1000;
        const last=pending.reduce((m,e)=> Math.max(m, (e&&e.timestamp)||0), 0);
        if(Date.now()-last > maxAge){ pending=null; localStorage.removeItem(nsPending(userId)); }
      }
      if(pending && pending.length){
        localStorage.removeItem(nsPending(userId));
        // pending adalah event mentah - simpan dulu, akan di-score di endSession berikutnya
        // untuk init yang baru, taruh di capture buffer sementara
        this._pendingEvents=pending;
      }
    }catch{}
    // capture auto — C-23: callback dipakai melacak kehadiran (kapan input terakhir
    // masuk), bukan lagi no-op. Dari situ absen terdeteksi tanpa timer tambahan.
    this._lastEventAt=Date.now();
    // B1: penanda aliran per instance/tab, dicap ke tiap event supaya pengukuran
    // tidak pernah menyeberangi dua tab.
    this.tabId=Math.random().toString(36).slice(2,10);
    this.capture=createCapture(e=>{ e.tabId=this.tabId; this._onCaptureEvent(e); });
    try{ this.capture.attach(); }catch{}
    // S6: pending skor sebagai sesi terpisah, jangan gabung (bikin durasi ngembung)
    // C-21: pending adalah AKUMULATOR ekor lintas-halaman. Versi lama meng-null-kan
    // pending TANPA SYARAT walau belum sempat di-skor (chunk < minEventsAssess), jadi
    // ekor halaman-halaman pendek terbuang tiap init dan tak pernah berakumulasi jadi
    // sesi utuh -> "pindah halaman terus, sesi tak keambil". Kini: kalau belum cukup,
    // KEMBALIKAN ke pending; kalau cukup, skor satu chunk lalu simpan SISANYA.
    try{
      if(this._pendingEvents && this._pendingEvents.length){
        const pending=this._pendingEvents; delete this._pendingEvents;
        if(pending.length >= this.cfg.session.minEventsAssess){
          // C-33: chunk minimal sebesar ambang bukti, kalau tidak ia tak pernah dinilai
          const CH=Math.max(200, this.cfg.session.minEventsAssess);
          const chunk=pending.slice(0,CH);
          const sisa=pending.slice(CH);
          // B1 fix: jangan require di ESM, pakai scoreExternalEvents langsung (extractF4 sudah diimpor)
          setTimeout(()=> this.scoreExternalEvents(chunk).catch(()=>{}), 100);
          try{ if(sisa.length) localStorage.setItem(nsPending(userId), JSON.stringify(sisa));
               else localStorage.removeItem(nsPending(userId)); }catch{}
        } else {
          // belum cukup jadi sesi -> tunggu ekor halaman berikut menambah (JANGAN buang)
          try{ localStorage.setItem(nsPending(userId), JSON.stringify(pending)); }catch{}
        }
      }
    }catch{}
    // HYBRID: tarik baseline akun dari VPS (source of truth lintas-device) SEBELUM rebuild.
    // Device penyerang yg fresh -> dapat baseline Andi -> perilaku penyerang di-skor HIGH.
    if(this.cloud){ try{ await this._cloudPull(); }catch{} }
    // coba rebuild model dari sessions
    if(this.sessions.filter(s=>s.eligible!==false).length >= this.cfg.baseline) this._rebuildModel();
    // auto-skor plug-and-play: segmentasi sesi otomatis (tanpa panggil manual)
    // - interval 30s + visibilitychange + SPA pushState + beforeunload
    this._wireAuto();
    this.inited=true;
    return this;
  }
  // C-23: satu-satunya sumber kebenaran "kapan pengguna terakhir memberi input".
  // Jeda antar-input yang melewati `idle.awaySec` dicatat sebagai ABSEN; input
  // berikutnya sesudah itu adalah KEMBALI dari absen — dan orang yang kembali
  // belum tentu orang yang pergi.
  _onCaptureEvent(e){
    const ts=e&&e.timestamp || Date.now();
    const prev=this._lastEventAt;
    this._lastEventAt=ts;
    if(!prev) return;
    const gap=ts-prev;
    if(gap >= this.cfg.idle.awaySec*1000) this._markAwayReturn(gap, 'tanpa-input', ts);
  }
  // Ambil absen TERPANJANG yang belum ditindaklanjuti: tab tersembunyi 20 menit lalu
  // kembali tidak boleh tertimpa oleh jeda-tanpa-input 6 menit yang menyusul.
  _markAwayReturn(awayMs, reason, atTs){
    const cur=this._awayReturn;
    if(cur && cur.awayMs >= awayMs) return;
    this._awayReturn={ awayMs, reason, at: atTs||Date.now() };
  }
  // B1: hanya SATU tab yang boleh menilai dan menulis penyimpanan. Tanpa ini, dua
  // tab memegang array `sessions` sendiri di memori lalu `storage.set` bergantian —
  // penulis terakhir menang dan sesi yang dikumpulkan tab lain hilang diam-diam.
  // Denyut sederhana lewat localStorage: pemimpin memperbarui capnya; tab lain
  // mengambil alih hanya kalau capnya sudah basi (pemimpin ditutup/crash).
  _isLeader(){
    const K=`bg:leader:${this.userId}`, TTL=25000;
    try{
      const now=Date.now();
      const cur=JSON.parse(localStorage.getItem(K)||'null');
      if(!cur || !cur.ts || now-cur.ts > TTL || cur.id===this.tabId){
        localStorage.setItem(K, JSON.stringify({id:this.tabId, ts:now}));
        return true;
      }
      return false;
    }catch{ return true; }   // tanpa localStorage, anggap tab tunggal
  }
  _wireAuto(){
    if(this._wired) return; this._wired=true;
    this._autoTimer=setInterval(()=>{
      // Tab pengikut tetap MENANGKAP (ekornya dibank dan diambil nanti), hanya tidak
      // menilai — jadi datanya tidak hilang, cuma tidak ada dua penulis bersamaan.
      if(!this._isLeader()){ this._bankTail(); return; }
      this.endSession().catch(()=>{});
    }, this.cfg.session.windowSec*1000);
    try{
      const self=this;
      document.addEventListener('visibilitychange', ()=>{
        if(document.visibilityState!=='hidden'){
          // C-23: kembali terlihat. Tab tersembunyi lama = kursi mungkin kosong,
          // dan ini sinyal yang TIDAK terlihat dari jeda antar-event (tab latar
          // memang tidak mengirim event apa pun, jadi keduanya perlu dicek).
          if(self._hiddenAt){
            const hid=Date.now()-self._hiddenAt;
            self._hiddenAt=null;
            if(hid >= self.cfg.idle.awaySec*1000) self._markAwayReturn(hid, 'tab-tersembunyi');
          }
          return;
        }
        self._hiddenAt=Date.now();
        // C-21: JANGAN drain-buang. `endSession()` membuang buffer <30 event, dan saat
        // pindah halaman ia jalan SEBELUM `beforeunload` -> ekor halaman hilang sebelum
        // sempat disimpan. Kalau cukup jadi sesi -> skor; kalau belum -> BANK ke pending.
        const evs=self.capture ? self.capture.peek() : [];
        if(evs.length >= self.cfg.session.minEventsAssess) self.endSession().catch(()=>{});
        else self._bankTail();
      });
      const origPush=history.pushState.bind(history);
      const origReplace=history.replaceState.bind(history);
      history.pushState=function(...a){ const r=origPush(...a); self.capture && self.capture.buffer.push({event_type:'NAVIGATION', page_url: location.href, timestamp: Date.now()}); return r; };
      history.replaceState=function(...a){ const r=origReplace(...a); self.capture && self.capture.buffer.push({event_type:'NAVIGATION', page_url: location.href, timestamp: Date.now()}); return r; };
      window.addEventListener('popstate', ()=>{ self.capture && self.capture.buffer.push({event_type:'NAVIGATION', page_url: location.href, timestamp: Date.now()}); });
      // R4/C-21: pada leave terminal, bank ekor ke pending SECARA SINKRON (skor async
      // tak sempat flush saat halaman mati). pagehide + beforeunload dua-duanya bank;
      // `_bankTail` idempoten (drain setelah simpan) jadi aman dipanggil berkali-kali.
      window.addEventListener('pagehide', ()=>{ try{ self._bankTail(); clearInterval(self._autoTimer); }catch{} });
      window.addEventListener('beforeunload', ()=>{ try{ self._bankTail(); clearInterval(self._autoTimer); }catch{} });
    }catch{}
  }
  // C-21: simpan ekor buffer yang belum jadi sesi ke akumulator lintas-halaman
  // (`bg:pending`, raw localStorage). Idempoten: drain setelah simpan supaya handler
  // leave lain (pagehide+beforeunload) tak menyimpan ganda.
  _bankTail(){
    if(!this.capture) return;
    const evs=this.capture.peek();
    if(evs.length < 10) return;               // terlalu sedikit untuk disimpan
    try{
      const pending=JSON.parse(localStorage.getItem(nsPending(this.userId))||'[]');
      pending.push(...evs.slice(-200));
      if(pending.length>800) pending.splice(0, pending.length-800);
      localStorage.setItem(nsPending(this.userId), JSON.stringify(pending));
      this.capture.drain();
    }catch{}
  }
  // C-31: indeks tepat SESUDAH sesi layak ke-`baseline`, yaitu ujung blok pendaftaran.
  // Dulu blok ini diandaikan = sessions.slice(0, baseline). Salah begitu ada satu sesi
  // tak-layak di masa pendaftaran: sesi pendaftaran ke-10 jatuh ke bagian "LOW
  // progresif", dan begitu kolam itu bergulir (maks 90) sesi pendaftaran asli ikut
  // terbuang. Blok pendaftaran adalah jangkar model — ia tidak boleh bergulir.
  _enrollPrefix(){
    let c=0;
    for(let i=0;i<this.sessions.length;i++){
      if(this.sessions[i].eligible!==false && ++c===this.cfg.baseline) return i+1;
    }
    return this.sessions.length;
  }
  // C-31: riwayat sesi dulu tumbuh TANPA BATAS — satu entri tiap jendela 30 dtk, jadi
  // ribuan per minggu — dan SELURUHNYA diserialisasi + di-HMAC ulang pada tiap vonis.
  // Yang dibutuhkan model hanya blok pendaftaran + 90 LOW terakhir + 6 vonis terakhir
  // (konvergensi). Disimpan: blok pendaftaran UTUH + `historyMax` entri terakhir;
  // `feat` (murni penjelasan) dibuang dari entri yang lebih tua dari 20 terakhir.
  _compactHistory(){
    const keep=this.cfg.historyMax||240;
    const pre=this._enrollPrefix();
    if(this.sessions.length > pre+keep) this.sessions=[...this.sessions.slice(0,pre), ...this.sessions.slice(-keep)];
    const cut=this.sessions.length-20;
    for(let i=pre;i<cut;i++){ if(this.sessions[i].feat) this.sessions[i]={...this.sessions[i], feat:null}; }
  }
  // Satu-satunya penulis state ke storage (C-31: dulu 7 salinan, dua di antaranya lupa
  // menulis challengeTemplate & highRun).
  async _persist(){
    this._compactHistory();
    await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, fpv:FP_VERSION,
      lastRisk:this.lastRisk, highRun:this._highRun, challengeTemplate:this.challengeTemplate,
      lowStreak:this._lowStreak||0, enrollPrefix:this._enrollPrefix(),
      mfaEnrollSnoozeUntil:this._mfaEnrollSnoozeUntil||0, mfaPassedAt:this._mfaPassedAt||null, lastActiveAt:Date.now()});
  }
  // C-35: sesi tersimpan terdekat dalam ruang terstandar, tanpa fitur temporal.
  _nearestPastSession(xstd){
    if(!this.stats || !this.sessions.length) return null;
    const idx=this._behIdx || (this._behIdx=F4.map((_,i)=>i).filter(i=>!F4[i].startsWith('temporal_')));
    let best=null;
    for(const s of this.sessions){
      if(!s || !s.vector) continue;
      const z=standardize(s.vector, this.stats);
      let acc=0; for(const i of idx){ const d=xstd[i]-z[i]; acc+=d*d; }
      const dist=Math.sqrt(acc/idx.length);
      if(!best || dist<best.dist) best={dist, ts:s.ts};
    }
    return best;
  }
  _trainingVectors(){
    // K6 + T1: hanya sesi eligible yang masuk kolam (gagal gate tidak latih)
    const isEligible=s=> s.eligible!==false;
    const pre=this._enrollPrefix();
    if(this.sessions.length <= pre) return this.sessions.filter(isEligible).map(s=>s.vector);
    const base=this.sessions.slice(0, pre).filter(isEligible).map(s=>s.vector);
    // TRUST-LOOP: sesi LOW normal ATAU sesi non-LOW yang LOLOS MFA (mfaVerified) boleh
    // masuk kolam. Sesi menyimpang yang belum terbukti pemilik -> TIDAK pernah melatih
    // (anti-peracunan baseline + adaptasi drift pemilik yang aman).
    let lows=this.sessions.slice(pre).filter(s=>(s.risk==='LOW' || s.mfaVerified) && isEligible(s)).map(s=>s.vector);
    if(lows.length > this.cfg.progressiveMaxPool) lows=lows.slice(-this.cfg.progressiveMaxPool);
    const temporalIdx=new Set();
    F4.forEach((name,i)=>{ if(name.startsWith('temporal_')) temporalIdx.add(i); });
    const behavioralIndices=F4.map((_,i)=>i).filter(i=>!temporalIdx.has(i));
    const deduped=[];
    const eps=this.cfg.progressiveDupEps;
    for(const v of lows){
      let isDup=false;
      for(const u of deduped){
        let sum=0;
        for(const idx of behavioralIndices){ const d=v[idx]-u[idx]; sum+=d*d; }
        const dist=Math.sqrt(sum / behavioralIndices.length);
        if(dist < eps){ isDup=true; break; }
      }
      if(!isDup) deduped.push(v);
    }
    return [...base, ...deduped];
  }
  _rebuildModel(){
    const vecs=this._trainingVectors();
    if(!vecs.length) return;
    this._newSinceRebuild=0;
    // C-24 (opt-in): sisihkan EKOR kolam khusus untuk mengkalibrasi ambang.
    // Versi lama mengkalibrasi dari skor vektor yang PERSIS dipakai memfit detektor.
    // Skor in-sample selalu optimistik — model memang dipas-paskan ke titik-titik itu —
    // sehingga ambangnya terlalu rapat dan sesi PEMILIK berikutnya, yang di luar
    // sampel, jatuh di luar ambang. Bukan teori: itu persis mekanisme C-22.
    // calibrationHoldout=0 (default) -> cut=vecs.length -> jalur lama, tak tersentuh.
    const hold=this.cfg.calibrationHoldout||0;
    let cut=vecs.length;
    if(hold>0){ const c=Math.floor(vecs.length*(1-hold)); if(c>=8 && vecs.length-c>=4) cut=c; }
    const fitVecs=vecs.slice(0,cut);
    const calibVecs=cut<vecs.length ? vecs.slice(cut) : null;
    this.stats=computeStats(fitVecs);
    const Xstd=standardizeBatch(fitVecs, this.stats);
    const iff=new IsolationForest(this.cfg.iforest);
    iff.fit(Xstd);
    // detektor-2: Mahalanobis (default) atau centroid lama (cfg.model2)
    // C-22: shrinkage ADAPTIF terhadap rasio sampel/dimensi. Kovarians d×d butuh
    // n >> d untuk stabil; live gerbang buka di n=20 padahal d=28 (n<d!) → kovarians
    // OVERFIT: jarak in-sample kecil palsu, ambang dikalibrasi optimistik, lalu sesi
    // PEMILIK baru (out-of-sample) meledak jadi anomali → "sesi ke-20 dst selalu
    // MEDIUM" (FRR 98%). Regularisasi lebih berat saat sampel sedikit menariknya ke
    // Euclidean-terstandardisasi (aman): FRR 98%→~7% di n=20, FAR ~0 utk penyusup
    // jelas-beda. Meluruh ke shrink dasar (0.3) saat n≥~3d → korelasi penuh kelas
    // riset kembali. Hanya jalur LIVE — conformance/golden pakai shrink tetap
    // `cfg.mahalanobis.shrink` langsung, jadi tak tersentuh. Lihat core/DRIFT.md C-22.
    const baseShrink=this.cfg.mahalanobis.shrink;
    const nfe=this.cfg.features.length;
    const adaptShrink=Math.min(0.9, Math.max(baseShrink, nfe/Math.max(1,fitVecs.length)));
    const det2=(this.cfg.model2||'mahalanobis')==='mahalanobis'
      ? new Mahalanobis({ shrink: adaptShrink, n_features: nfe })
      : new OCSVM({...this.cfg.ocsvm, n_features: nfe});
    det2.fit(Xstd);
    const ens=new Ensemble(iff, det2, this.cfg.weights, fitVecs.length);
    ens.calibrate(Xstd, fitVecs.length);
    this.model=ens;
    this._aggThresholds=null;
    if(this.cfg.calibrateThresholds){
      const src = calibVecs ? standardizeBatch(calibVecs, this.stats) : Xstd;
      const baseScores=src.map(x=> ens.scoreOne(x));
      const parametric=(this.cfg.calibrationMode||'parametric')==='parametric';
      const calib = arr => parametric
        ? calibrateThresholdsParametric(arr, this.cfg.k_low, this.cfg.k_med_extra)
        : calibrateThresholds(arr, this.cfg.q_low, this.cfg.q_med);
      this.cfg.thresholds=calib(baseScores);
      // C-24 (opt-in): ambang untuk vonis AGREGAT dikalibrasi dari skor baseline yang
      // diagregasi dengan cara yang PERSIS sama. Jalan pintas analitik — rapatkan
      // ambang sebesar std/sqrt(M) — salah, dan salahnya searah: jendela berurutan
      // berkorelasi, jadi sebaran nyatanya lebih lebar dari yang diandaikan, ambang
      // jadi terlalu rapat, dan pemilik yang ditolak. Mengagregasi data latihnya
      // sendiri membawa korelasi itu ikut serta tanpa perlu diasumsikan.
      const AGG=this.cfg.aggregateWindows|0;
      if(AGG>1 && baseScores.length>=AGG){
        const agg=[];
        for(let i=0;i+AGG<=baseScores.length;i++)
          agg.push(baseScores.slice(i,i+AGG).reduce((x,y)=>x+y,0)/AGG);
        this._aggThresholds=calib(agg);
      }
    }
  }
  // ===== HYBRID cloud (baseline per tenant+userId di VPS; event mentah tak keluar) =====
  async _http(method, path, body){
    if(!this.endpoint) return null;
    try{
      const r=await fetch(this.endpoint+path, {method, headers:{'Content-Type':'application/json','Authorization':'Bearer '+this.pk,'X-BG-User-Token':this.userToken||''}, body: body?JSON.stringify(body):undefined, keepalive:true});
      if(!r.ok) return null;
      return await r.json().catch(()=>null);
    }catch{ return null; }
  }
  async _cloudPull(){
    if(!this.cloud) return;
    const res=await this._http('GET','/baseline');
    if(res && Array.isArray(res.vectors) && res.vectors.length){
      const localEligible=this.sessions.filter(s=>s.eligible!==false).length;
      // C-39: DULU diadopsi bila jumlah server >= lokal — siapa pun yang bisa menulis ke
      // server (dulu: cukup pk) menimpa baseline yang SUDAH ada di perangkat pemilik.
      // Kini hanya perangkat BARU (belum punya pendaftaran sendiri) yang mengadopsi;
      // baseline lokal yang sudah ada tidak pernah diganti dari jarak jauh.
      const vecsOk=res.vectors.every(v=> Array.isArray(v) && v.length===this.cfg.features.length && v.every(Number.isFinite));
      if(vecsOk && localEligible < this.cfg.baseline && res.vectors.length >= this.cfg.baseline){
        this.sessions=res.vectors.map(v=>({vector:v, feat:null, ts:Date.now(), risk:'LOW', score:0, eligible:true}));
      }
    }
  }
  _cloudPush(){
    // kirim VEKTOR FITUR teragregasi (bukan event mentah) sebagai baseline akun
    if(!this.cloud) return;
    const vectors=this._trainingVectors();
    if(!vectors.length) return;
    this._http('POST','/baseline',{vectors});
  }
  _cloudLog(evt){
    if(!this.cloud || !evt) return;
    this._http('POST','/log',{level:evt.level, score:evt.score, action:evt.action, reasons:evt.reasons,
      topFeatures:evt.topFeatures, convergence:evt.convergence, eligible:evt.eligible,
      sessions:(this.sessions?this.sessions.length:0), fp:this.fingerprint, ts:Date.now()});
  }
  // R3 + hardening: gate, integrity, ratelimit, fingerprint, monotonic, challenge
  async _ingestVector(vec, feat, eligible=true, events=null, meta=null){
    const M=meta||{};                 // C-23: telemetri idle ikut ke SEMUA jalur vonis
    // ratelimit
    const rl=checkCollect(this.userId);
    if(!rl.allowed){
      // C-4: dulu di-return diam-diam tanpa onRisk, jadi integrator tak pernah
      // tahu sesi diblokir rate-limit (jalur integrity di bawah memanggilnya).
      const rlEvt={...M, level:'HIGH', score:-2, action:'BLOCK_SESSION', blocked:true, reasons:[rl.reason], topFeatures:[], features: feat, thresholds: {...this.cfg.thresholds}, eligible:false, rateLimited:true};
      this._cloudLog(rlEvt);
      try{ this.onRisk(rlEvt); }catch{}
      return rlEvt;
    }
    // integrity (bot/replay) - jika events tersedia
    if(events){
      const integ=checkIntegrity(events, {throttled:true});
      if(integ.suspected){
        const evt={...M, level:'HIGH', score:-1.5, action:'BLOCK_SESSION', reasons:integ.reasons, topFeatures:[], features: feat, thresholds: {...this.cfg.thresholds}, eligible:false, integrity:true};
        this.sessions.push({vector: vec, feat, ts: Date.now(), risk:'HIGH', score:-1.5, eligible:false});
        // C-31: dulu HANYA storage yang diberi lastRisk HIGH (memori tidak), dan
        // challengeTemplate tidak ikut tertulis -> satu tuduhan bot menghapus template
        // MFA pemilik dari penyimpanan. Kini memori & storage sama, dan state utuh.
        this.lastRisk='HIGH'; this._lowStreak=0;
        await this._persist();
        this._cloudLog(evt);
        try{ this.onRisk(evt); }catch{}
        return evt;
      }
    }
    const eligibleCount=this.sessions.filter(s=>s.eligible!==false).length;
    if(eligibleCount < this.cfg.baseline){
      // C-23: selama pendaftaran belum ada model pembanding, jadi absen tidak bisa
      // ditindaklanjuti. Dibuang di sini supaya tidak menggantung dan meletus di
      // vonis pertama sesudah pendaftaran selesai (bisa berhari-hari kemudian).
      this._awayReturn=null;
      this.sessions.push({vector: vec, feat, ts: Date.now(), risk:'LOW', score:0, eligible});
      await this._persist();
      let doneEnroll=false;
      if(this.sessions.filter(s=>s.eligible!==false).length >= this.cfg.baseline){ this._rebuildModel(); doneEnroll=true; }
      const enrollEvt={...M, level:'LOW', score:0, reasons:[eligible?'enrollment '+this.sessions.filter(s=>s.eligible!==false).length+'/'+this.cfg.baseline:'sesi tidak layak - tidak masuk kolam'], topFeatures:[], features: feat, thresholds: {...this.cfg.thresholds}, convergence: 'enrollment', eligible};
      this._cloudLog(enrollEvt);
      if(doneEnroll) this._cloudPush(); // enrollment selesai -> unggah baseline akun ke VPS
      // C-19: jalur pendaftaran DULU tidak pernah memanggil onRisk, jadi selama 10
      // sesi pertama pustaka ini DIAM TOTAL ke integrator — tak ada callback, tak ada
      // event `behaviorguard:risk`, dan panel bawaan mandek di "MENGENALI..." tanpa
      // pernah bergerak. Justru fase inilah yang paling perlu diperlihatkan: pengguna
      // baru mendaftar dan ingin tahu sistemnya sedang belajar, bukan menggantung.
      // Hanya `endSession()` yang mengembalikan nilainya, sehingga integrasi berbasis
      // event (cara yang didokumentasikan) tidak melihat apa pun.
      enrollEvt.enrollment = { selesai: this.sessions.filter(s=>s.eligible!==false).length,
                               perlu: this.cfg.baseline, siap: doneEnroll };
      enrollEvt.action = 'ALLOW_SESSION';
      try{ this.onRisk(enrollEvt); }catch{}
      return enrollEvt;
    }
    if(!this.model) this._rebuildModel();
    const xstd=standardize(vec, this.stats);
    let score=this.model.scoreOne(xstd);
    // C-35: REKAM-ULANG. Perilaku korban yang terekam (XSS, ekstensi jahat, malware
    // perekam) lalu diputar dengan waktu digeser menghasilkan vektor yang IDENTIK dengan
    // sesi lama — model menilainya LOW, karena memang itu perilaku pemiliknya. Manusia
    // tidak pernah mengulang dirinya sampai sedekat itu: di 637 pasangan sesi riset,
    // jarak RMS terstandar ke sesi pemilik terdekat minimum 0,289 (p1 0,365). Ambang
    // `replayEps` 0,05 memberi margin ~6x. Fitur temporal dikecualikan (putar ulang di
    // jam lain). Vonis HIGH (step-up, bukan blokir) dan tak pernah melatih.
    const replay=this._nearestPastSession(xstd);
    if(replay && replay.dist < (this.cfg.replayEps ?? 0.05)){
      M.replay={ distance: replay.dist, matchedTs: replay.ts };
      eligible=false;
    }
    // C-5: toRisk() memakai `score <= thr`; untuk NaN itu SELALU false -> 'LOW'.
    // Skor rusak karena itu gagal-TERBUKA. Perlakukan sebagai anomali, bukan aman.
    if(!Number.isFinite(score)){
      const badEvt={...M, level:'HIGH', score:null, action:'REQUIRE_STEPUP', blocked:false,
        reasons:['skor tidak finit - model/statistik rusak'], topFeatures:[], features: feat,
        thresholds: {...this.cfg.thresholds}, eligible:false, degraded:true};
      this.sessions.push({vector: vec, feat, ts: Date.now(), risk:'HIGH', score:null, eligible:false});
      await this._persist();
      this._cloudLog(badEvt);
      try{ this.onRisk(badEvt); }catch{}
      return badEvt;
    }
    // C-24 (opt-in): AGREGASI BUKTI. Jendela kanonik lebih pendek dari sesi utuh,
    // jadi tiap vonis berdiri di atas bukti yang lebih sedikit dan lebih berisik.
    // Jawabannya bukan melonggarkan ambang — itu cuma memindahkan kesalahan ke sisi
    // FAR — melainkan menunda vonis sampai M jendela terkumpul, lalu memvonis
    // rata-ratanya. Yang ditukar LATENSI dengan KEYAKINAN, bukan FRR dengan FAR:
    // terukur AUC 0,770 (M=1) -> 0,829 (M=5) pada harness ablasi.
    // Selama bukti belum cukup, sistem menerbitkan 'PENDING' — bukan diam, karena
    // diam selalu dibaca aman (alasan yang sama dengan ABSTAIN di C-23).
    const AGG=this.cfg.aggregateWindows|0;
    let aggMembers=null;
    if(AGG>1){
      (this._aggBuf=this._aggBuf||[]).push({score, vec, feat});
      if(this._aggBuf.length < AGG){
        const pend={...M, level:'UNKNOWN', score, action:'PENDING', blocked:false,
          reasons:[`mengumpulkan bukti ${this._aggBuf.length}/${AGG} jendela`],
          topFeatures:[], features:feat, thresholds:{...this.cfg.thresholds},
          eligible, aggregating:{have:this._aggBuf.length, need:AGG}};
        this._cloudLog(pend);
        try{ this.onRisk(pend); }catch{}
        return pend;
      }
      aggMembers=this._aggBuf; this._aggBuf=[];
      score=aggMembers.reduce((a,b)=>a+b.score,0)/aggMembers.length;
    }
    // Ambang agregat dipakai HANYA kalau vonisnya memang agregat.
    const usedThresholds = (aggMembers && this._aggThresholds) ? this._aggThresholds : this.cfg.thresholds;
    let level=toRisk(score, usedThresholds);
    if(M.replay) level='HIGH';
    // C-23 (sisi KEAMANAN dari idle). Segmentasi sudah menangani sisi PENGUKURAN;
    // yang ini menangani akibat yang berbeda: selama kursi kosong, orang lain bisa
    // duduk di sesi yang SUDAH terautentikasi ("serangan jam makan siang"). Karena
    // penyusupnya mewarisi sesi yang sah, satu-satunya sinyal yang tersedia adalah
    // adanya absen panjang di tengah — jadi absen itu harus dicatat, bukan dilewati.
    // Jalur pending/eksternal tidak lewat `_onCaptureEvent`, jadi jeda antar-segmen
    // dibaca langsung dari datanya di sini.
    const segGapMs=(M.idle && M.idle.gapBeforeMs) || 0;
    if(segGapMs >= this.cfg.idle.awaySec*1000) this._markAwayReturn(segGapMs, 'jeda-antar-segmen');
    let awayInfo=null;
    if(this._awayReturn){
      awayInfo={...this._awayReturn};
      this._awayReturn=null;
      this._lowStreak=0;   // streak LOW TIDAK menyeberangi absen: itu bukti tentang
                           // orang sebelum absen, bukan tentang orang sesudahnya
    }
    // T3: monotonic dengan decay - turun 1 tingkat tiap 3 LOW berturut
    const order={LOW:0,MEDIUM:1,HIGH:2};
    const modelLevel=level, modelScore=score;   // vonis mentah model, sebelum lantai lengket
    let stickyFloor=false;
    this._lowStreak = (level==='LOW') ? (this._lowStreak||0)+1 : 0;
    // C-6: dulu `score=Math.min(score,-0.9)` MEMALSUKAN skor supaya cocok dengan
    // level yang dipaksa. Karena ambang dikalibrasi per-pengguna (low bisa -3.5),
    // -0.9 sering justru masuk pita LOW -> level dan score saling bertentangan,
    // dan angka palsu itu ikut tersimpan + terkirim ke log cloud. Sekarang skor
    // asli dipertahankan; kenaikan level ditandai eksplisit lewat stickyFloor.
    if(this._lowStreak>=3 && order[this.lastRisk]>order[level]){
      const rev={2:'MEDIUM',1:'LOW',0:'LOW'};
      this.lastRisk=rev[order[this.lastRisk]] || 'LOW';
      if(order[level] < order[this.lastRisk]){ level=this.lastRisk; stickyFloor=true; }
    } else if(order[level] < order[this.lastRisk]){ level=this.lastRisk; stickyFloor=true; }
    if(order[level] > order[this.lastRisk]){ this.lastRisk=level; this._lowStreak=0; }
    // C-23: absen melewati `reverifyAfterSec` -> naikkan LOW jadi MEDIUM supaya
    // step-up jalan sekali, walau perilaku sesudahnya terlihat normal. Sengaja
    // dipisah dari `awaySec`: absen 5 menit cukup untuk berhenti mengukur melintas,
    // 15 menit (sejajar batas idle-timeout PCI DSS 8.2.8) baru cukup untuk
    // mengganggu pengguna. Hanya menaikkan LOW — MEDIUM/HIGH sudah step-up sendiri.
    let reverifyAfterAway=false;
    if(awayInfo && awayInfo.awayMs >= this.cfg.idle.reverifyAfterSec*1000 && level==='LOW'){
      level='MEDIUM'; reverifyAfterAway=true;
      if(order[level]>order[this.lastRisk]){ this.lastRisk=level; this._lowStreak=0; }
    }
    // C-43: MASA BERLAKU STEP-UP ("sudo mode"). Gesekan pemilik tidak tersebar acak: ia
    // menumpuk di hari-hari ketika perilakunya memang berbeda, dan pada hari itu SEMUA
    // jendela berbeda (model != LOW 14-15% di jendela ke-1, ke-2, ke-3... kunjungan).
    // Dulu pemilik yang baru lolos OTP ditanya LAGI 30 detik kemudian, dan lagi. Kini,
    // selama graceSec sesudah verifikasi TERBUKTI (MFA bawaan terverifikasi atau
    // reportStepUp({passed:true})), MEDIUM tidak meminta verifikasi ulang.
    // Batasnya, supaya penyusup tidak ikut menikmati:
    //  - hanya hasil verifikasi sungguhan yang membukanya; penyusup berkredensial curian
    //    tak punya faktor kedua, jadi tak pernah mendapatkannya;
    //  - HIGH tetap meminta verifikasi (orangnya jelas berbeda), rekam-ulang tak pernah;
    //  - absen >= idle.awaySec mencabutnya (kursi mungkin berganti orang), begitu juga
    //    muat-halaman sesudah jeda sepanjang itu (lihat init);
    //  - jendela yang diredam TIDAK melatih model (bukan LOW model, bukan terverifikasi).
    const graceMs=((this.cfg.mfa && this.cfg.mfa.graceSec) || 0)*1000;
    if(awayInfo) this._mfaPassedAt=null;
    let stepUpGrace=null;
    if(graceMs>0 && level==='MEDIUM' && !M.replay && !reverifyAfterAway && this._mfaPassedAt
       && Date.now()-this._mfaPassedAt < graceMs){
      stepUpGrace={ verifiedAgoSec: Math.round((Date.now()-this._mfaPassedAt)/1000), wasLevel: level };
      level='LOW'; this.lastRisk='LOW';
      eligible=false;
    }
    // A3: bukti sebagian tidak boleh jadi DASAR KEPERCAYAAN. Vonisnya tidak dinaikkan
    // — memaksa step-up tiap kali orang memakai password manager itu hukuman untuk
    // kebiasaan yang justru aman. Yang dicabut adalah kemampuannya MEMBANGUN
    // kepercayaan: ia tidak menghitung sebagai LOW berturut, jadi ia tak bisa
    // meluruhkan lantai lengket, dan integrator diberi tahu lewat `partialEvidence`
    // supaya aksi bernilai tinggi bisa menuntut bukti yang utuh.
    if(M.keystrokeBypassed && level==='LOW') this._lowStreak=Math.max(0, (this._lowStreak||1)-1);
    const top=topFeatures(xstd, F4, 3);
    let action=toAction(level);   // HIGH -> REQUIRE_STEPUP (bukan block langsung)
    // challenge step-up
    let reasons=reasonsFrom(top);
    if(M.keystrokeBypassed) reasons=['bukti keystroke dialihkan (autofill/tempel) - blok ritme ketik tidak dinilai', ...reasons];
    if(M.replay) reasons=[`perilaku identik dengan sesi lama (jarak ${M.replay.distance.toFixed(4)}) - kemungkinan rekam-ulang`, ...reasons];
    if(reverifyAfterAway) reasons=[`kembali setelah absen ${Math.round(awayInfo.awayMs/60000)} menit (${awayInfo.reason}) - verifikasi ulang`, ...reasons];
    if(stepUpGrace) reasons=[`model: MEDIUM, tidak ditanya ulang - terverifikasi ${Math.round(stepUpGrace.verifiedAgoSec/60)} menit lalu`, ...reasons];
    if(level==='HIGH' && this.challengeTemplate){
      action='REQUIRE_CHALLENGE'; reasons=[...reasons, 'challenge: ketik kata kunci + ritme'];
    }
    // --- aturan-run: HIGH tunggal = step-up; HIGH BERUNTUN >= N = block keras ---
    // Pemilik off-day bikin HIGH terpencar (-> step-up, lolos verifikasi); ATO nyata
    // bikin HIGH berturut (-> block). Held-out: block owner 9.7%->2.4%, FAR tetap.
    this._highRun = (level==='HIGH') ? (this._highRun||0)+1 : 0;
    const blockAfter=this.cfg.blockAfterConsecutiveHigh || 2;
    let blocked=false;
    if(level==='HIGH' && this._highRun>=blockAfter){ action='BLOCK_SESSION'; blocked=true; }
    const evt={...M, level, score, action, blocked, consecutiveHigh: this._highRun, reasons, topFeatures: top, features: feat, thresholds: {...usedThresholds}, eligible, modelLevel, modelScore, stickyFloor,
      resumedAfterAway: awayInfo, reverifyAfterAway, stepUpGrace,
      // topFeatures/features berasal dari jendela TERAKHIR; skornya dari rata-rata M.
      aggregated: aggMembers ? {windows: aggMembers.length} : null,
      partialEvidence: M.keystrokeBypassed ? 'keystroke' : null};
    // R3: push dengan flag eligible - sesi gagal gate tetap log tapi tidak latih
    // C-24: kalau vonisnya agregat, SEMUA jendela penyusunnya masuk dengan vonis itu —
    // kalau hanya yang terakhir yang disimpan, kolam latih tumbuh M kali lebih lambat.
    for(const m of (aggMembers || [{vec, feat}]))
      this.sessions.push({vector: m.vec, feat: m.feat, ts: Date.now(), risk: level, score, eligible});
    // R2: cohort guard jujur - bg:cohort HANYA dari seed penyusup, bukan dari diri sendiri
    // Jika kosong, fallback window-only dan JANGAN klaim cohort-guarded
    const trainVecs=this._trainingVectors();
    // C-15: gerbang ensemble WAJIB dibuka walau model sudah dinyatakan konvergen.
    // `ensembleMinSamples.svm = 20` sementara `baseline = 10`, dan bobot gerbang
    // dibekukan pada `model.n` saat rebuild terakhir. Pengguna yang 6 sesi pertamanya
    // konsisten akan konvergen di n=10 -> `_rebuildModel()` tidak pernah dipanggil lagi
    // -> detektor-2 (Mahalanobis, bobot 0.70) TETAP TERGERBANG MATI SELAMANYA, dan
    // sistem berjalan dengan Isolation Forest sendirian — persis konfigurasi yang
    // terukur jauh lebih lemah. Terlihat empiris: kolam 24 vektor, model.n masih 10,
    // sesi penyusup dengan skor Mahalanobis -1811 tetap divonis LOW.
    // Menyeberangi ambang gerbang adalah perubahan STRUKTUR model, bukan adaptasi
    // ke data baru, jadi konvergensi tidak boleh memblokirnya.
    const minGate=this.cfg.ensembleMinSamples;
    if(this.model && this.model.n < minGate.svm && trainVecs.length >= minGate.svm){
      this._rebuildModel();
      evt.gateReopened=true;
    }
    // C-31: jadwal latih ulang dulu `ukuran kolam % 6 === 0`. Kolam dibatasi 90 LOW, jadi
    // begitu penuh (~90 jendela x 30 dtk = 45 menit pemakaian) ukurannya BERHENTI
    // bergerak: di 90 (kelipatan 6) model dilatih ulang TIAP jendela, di 88/89 (sisa
    // dedup) TIDAK PERNAH LAGI — adaptasi drift pemilik mati diam-diam. Yang benar
    // menghitung sesi layak-latih BARU sejak latih ulang terakhir.
    const joinsPool = eligible && (level==='LOW');
    if(joinsPool) this._newSinceRebuild=(this._newSinceRebuild||0)+1;
    const shouldRetrain = (this._newSinceRebuild||0) >= this.cfg.retrainEvery;
    if(shouldRetrain){
      const recent=this.sessions.slice(-this.cfg.convergence.window).map(s=>s.risk);
      let cohortRate=0; let hasCohort=false; let cohort=null;
      try{ cohort=await storage.get('bg:cohort'); if(cohort && cohort.length>=10) hasCohort=true; }catch{}
      if(hasCohort){
        const sample=cohort.slice(0,60);
        const scores=sample.map(v=> { const xs=standardize(v, this.stats); return this.model.scoreOne(xs); });
        cohortRate=cohortLowRate(scores, this.cfg.thresholds);
        const converged=isConverged(recent, cohortRate, this.cfg.convergence);
        evt.convergence= converged ? 'cohort-guarded' : 'not-converged';
        evt.cohortLowRate=cohortRate; evt.hasCohort=true;
        if(!converged) this._rebuildModel();
      } else {
        const converged=recent.length>=this.cfg.convergence.window && recent.every(r=>r==='LOW');
        evt.convergence='window-only'; evt.hasCohort=false; evt.cohortLowRate=cohortRate;
        if(!converged) this._rebuildModel();
      }
    } else {
      evt.convergence='no-retrain'; evt.hasCohort=false;
      if(this.sessions.filter(s=>s.eligible!==false).length===this.cfg.baseline) this._rebuildModel();
    }
    await this._persist();
    // R2: HAPUS push own non-LOW ke bg:cohort - cohort harus seed dari luar (reproduce_db), bukan diri sendiri
    this._cloudLog(evt);                    // verdict -> VPS (dashboard per akun)
    if(shouldRetrain && level==='LOW') this._cloudPush(); // baseline tumbuh (hanya LOW) -> sinkron ke VPS
    // MFA behavioral BAWAAN: popup step-up sebelum kabari integrator (evt diperbarui hasil MFA)
    await this._maybeMfa(evt);          // verifikasi: vonis bergantung hasilnya, jadi ditunggu
    // C-18: pendaftaran template TIDAK ditunggu. Ini prompt penyiapan di sesi
    // LOW yang tenang, bukan bagian dari vonis; menunggunya berarti `endSession()`
    // baru selesai setelah pengguna mengetik frasa 3x — dan tidak pernah selesai
    // kalau popupnya diabaikan.
    this._maybeEnrollMfa(evt).catch(()=>{});
    try{ this.onRisk(evt); }catch{}
    return evt;
  }

  // Popup MFA otomatis saat vonis MEDIUM/HIGH (bila cfg.mfa.enabled & ada DOM).
  // Pertama kali -> DAFTAR frasa (ketik 3x). Selanjutnya -> VERIFIKASI ritme.
  async _maybeMfa(evt){
    const m=this.cfg.mfa;
    if(!m || !m.enabled || typeof document==='undefined') return;
    if(!m.triggerOn.includes(evt.level) || this._mfaBusy) return;
    // C-2: TIDAK PERNAH mendaftarkan template saat sesi sedang dicurigai.
    // Versi lama memanggil runMfaChallenge dengan template=null -> mode DAFTAR,
    // sehingga penyusup di perangkat baru (storage kosong) cukup mengetik frasa
    // 3x untuk MEMBUAT template miliknya sendiri, lalu dinyatakan "MFA_PASSED",
    // _highRun direset, dan sesinya masuk kolam latih. Itu jalur ATO utuh.
    // Pendaftaran kini hanya terjadi di sesi TEPERCAYA (lihat _maybeEnrollMfa).
    if(!this.challengeTemplate){
      evt.mfa={ shown:false, unavailable:'belum ada template ritme (pendaftaran hanya di sesi LOW tepercaya)' };
      return;                                   // gagal-tertutup: aksi risiko tetap berlaku
    }
    const now=Date.now();
    if(m.cooldownMs && this._mfaPassedAt && now-this._mfaPassedAt < m.cooldownMs){ evt.mfa={skipped:'cooldown'}; return; }
    this._mfaBusy=true;
    try{
      const res=await runMfaChallenge({
        phrase: m.phrase, rounds: m.rounds,
        template: this.challengeTemplate,
        buildTemplate, verify: verifyChallenge,
        title: evt.level==='HIGH' ? 'Verifikasi keamanan — sesi berisiko' : 'Verifikasi cepat',
        timeoutMs: m.timeoutMs,
      });
      evt.mfa={ shown:true, passed:!!res.passed, verified:!!res.verified, cancelled:!!res.cancelled,
                attemptsExhausted:!!res.attemptsExhausted, reasons:res.reasons||[] };
      // Hanya VERIFIKASI sungguhan (res.verified) yang membuktikan identitas.
      // res.passed sendirian bisa berasal dari mode daftar -> tidak cukup.
      if(res.verified){
        this._applyMfaVerified(evt, now);
      } else {
        evt.action = evt.blocked ? 'BLOCK_SESSION' : 'MFA_FAILED';
      }
      await this._persist();
    }catch(e){ evt.mfa={ shown:true, error:String(e&&e.message||e) }; }
    finally{ this._mfaBusy=false; }
  }

  // Akibat MFA yang TERVERIFIKASI. Dipisah dari popup-nya supaya tools/eval_sdk.mjs
  // bisa mensimulasikan "pemilik lolos verifikasi" dengan kode yang PERSIS ini — bukan
  // tiruan tangan yang lama-lama menyimpang (C-29).
  _applyMfaVerified(evt={}, now=Date.now()){
    this._mfaPassedAt=now; this._highRun=0;
    this.lastRisk='LOW'; this._lowStreak=0;   // C-3: bersihkan lantai lengket,
                                              // kalau tidak sesi berikutnya dipaksa HIGH terus
    evt.action='MFA_PASSED'; evt.blocked=false; evt.mfaVerified=true;
    // TRUST-LOOP: hanya sesi terverifikasi yang boleh mengajari model.
    const last=this.sessions[this.sessions.length-1];
    if(last){ last.mfaVerified=true; this._rebuildModel(); }
  }
  /**
   * C-32: laporan hasil step-up MILIK INTEGRATOR (OTP, WebAuthn, email, telepon).
   * Vonis MEDIUM/HIGH menyuruh integrator "minta verifikasi", tapi dulu tidak ada jalan
   * untuk memberi tahu hasilnya ke pustaka. Akibatnya bagi integrator yang tidak memakai
   * popup ritme bawaan: lantai lengket tak pernah dibersihkan, sesi pemilik yang lolos
   * verifikasi tak pernah mengajari model, dan HIGH beruntun berakhir BLOCK untuk
   * pemilik sendiri. Terukur (tools/eval_sdk.mjs, pemilik tanpa jalur verifikasi):
   * gesekan 40,5%, DIBLOKIR 13,3%.
   *   passed:true  -> efeknya sama persis dengan MFA bawaan yang terverifikasi.
   *   passed:false -> tidak mengubah apa pun selain tercatat; hukuman tetap milik
   *                   aturan vonis (HIGH beruntun), bukan milik laporan ini.
   * HANYA panggil dari hasil verifikasi SISI SERVER yang sudah dicek. Skrip di halaman
   * yang sama bisa memanggilnya juga — itu batas kepercayaan sisi-klien yang sama
   * dengan seluruh pustaka ini (THREAT-MODEL.md).
   */
  // C-39: token pengguna berumur pendek; server integrator memperbaruinya.
  setUserToken(token){ this.userToken=token||null; this.cloud=!!(this.pk&&this.endpoint&&this.userToken); }
  async reportStepUp({ passed } = {}){
    const evt={};
    if(passed===true){ this._applyMfaVerified(evt); await this._persist(); }
    else { this._stepUpFailures=(this._stepUpFailures||0)+1; }
    return { applied: passed===true, lastRisk: this.lastRisk };
  }
  /**
   * C-33: vonis SEKETIKA untuk aksi sensitif (ganti email/sandi, transfer, tambah
   * perangkat). Vonis rutin kini menunggu bukti cukup (minEventsAssess), jadi penyusup
   * yang masuk lalu langsung mengganti email pemulihan dalam 20 detik bisa selesai
   * sebelum vonis pertama. Aksi seperti itu harus memanggil ini dan memperlakukan
   * UNKNOWN sebagai "minta verifikasi" (gagal-TERTUTUP), bukan "aman".
   *
   * TANPA efek samping: tidak menguras buffer, tidak masuk kolam latih, tidak menggeser
   * lantai lengket, tidak menaikkan hitungan HIGH. Bukti parsial (< minEventsAssess)
   * lebih berisik, jadi ia lebih mudah salah-curiga — biaya yang wajar di momen yang
   * memang pantas diverifikasi. Lantai lengket & absen yang belum terselesaikan ikut
   * menaikkan vonisnya.
   */
  assessNow({ minEvents=30 }={}){
    const S=this.cfg.session;
    const base={ at: Date.now(), sensitive:true };
    const eligibleCount=this.sessions.filter(s=>s.eligible!==false).length;
    if(!this.model || eligibleCount < this.cfg.baseline){
      return {...base, level:'UNKNOWN', action:'REQUIRE_STEPUP', enrollment:true,
        reasons:['pendaftaran belum selesai - belum ada pembanding, verifikasi dengan cara lain']};
    }
    let events=dropExactDuplicates(this.capture ? this.capture.peek() : []);
    if(S.idleCompressSec>0) events=compressIdle(events, S.idleCompressSec*1000);
    const order={LOW:0,MEDIUM:1,HIGH:2};
    const away=this._awayReturn && this._awayReturn.awayMs >= this.cfg.idle.reverifyAfterSec*1000;
    if(events.length < minEvents){
      return {...base, level:'UNKNOWN', action:'REQUIRE_STEPUP', evidence:{events:events.length, partial:true},
        reasons:[`bukti belum cukup (${events.length} event) - perlakukan sebagai belum terverifikasi`]};
    }
    const feat=extractF4(events), vec=featuresToVector(feat);
    const xstd=standardize(vec, this.stats);
    const score=this.model.scoreOne(xstd);
    let level=Number.isFinite(score) ? toRisk(score, this.cfg.thresholds) : 'HIGH';
    const floor=this.lastRisk||'LOW';
    if(order[floor] > order[level]) level=floor;
    if(away && level==='LOW') level='MEDIUM';
    const top=topFeatures(xstd, F4, 3);
    return {...base, level, score, action: toAction(level), modelLevel: Number.isFinite(score)? toRisk(score, this.cfg.thresholds):'HIGH',
      evidence:{ events:events.length, partial: events.length < S.minEventsAssess },
      reasons:[...(away?['kembali setelah absen - verifikasi ulang']:[]), ...reasonsFrom(top)], topFeatures: top};
  }
  // Pendaftaran template ritme HANYA di sesi tepercaya: vonis LOW, model sudah
  // terbentuk, dan belum pernah punya template. Ini pasangan dari C-2 — kalau
  // pendaftaran tidak pernah terjadi di sini, MFA tidak akan pernah tersedia.
  async _maybeEnrollMfa(evt){
    const m=this.cfg.mfa;
    if(!m || !m.enabled || typeof document==='undefined') return;
    if(this.challengeTemplate || this._mfaBusy) return;
    if(evt.level!=='LOW' || evt.eligible===false || !this.model) return;
    // C-37: popup pendaftaran DULU muncul di SETIAP vonis LOW selama template belum ada.
    // Pengguna yang menutupnya sekali ditanya lagi di vonis berikutnya, lagi, dan lagi —
    // cara tercepat membuat orang mencopot pustaka keamanan. Kini ditunda
    // `mfa.enrollSnoozeMs` (default 24 jam) sesudah ditutup/diabaikan, dan tersimpan
    // lintas muat-halaman.
    if(this._mfaEnrollSnoozeUntil && Date.now() < this._mfaEnrollSnoozeUntil) return;
    this._mfaBusy=true;
    try{
      const res=await runMfaChallenge({
        phrase: m.phrase, rounds: m.rounds,
        template: null,                          // mode DAFTAR, di saat yang aman
        buildTemplate, verify: verifyChallenge,
        title: 'Atur verifikasi keamanan',
        timeoutMs: m.enrollTimeoutMs,
      });
      if(res.enrolled && res.template){
        this.challengeTemplate=res.template;
        evt.mfa={ enrolled:true, verified:false };
        await this._persist();
      } else {
        evt.mfa={ enrolled:false, reason:res.reason||'dibatalkan' };
        this._mfaEnrollSnoozeUntil=Date.now()+(m.enrollSnoozeMs ?? 86_400_000);
        await this._persist();
      }
    }catch(e){ evt.mfa={ enrolled:false, error:String(e&&e.message||e) }; }
    finally{ this._mfaBusy=false; }
  }
  async endSession(){
    if(!this.capture) return null;
    return this._assessEvents(this.capture.drain(), true);
  }
  async scoreExternalEvents(events){
    return this._assessEvents(events||[], false);
  }
  /**
   * C-23: satu jalur penilaian untuk buffer live MAUPUN akumulator `bg:pending`.
   * Aliran event dipecah pada tiap jeda idle lebih dulu, lalu TIAP segmen kontigu
   * dinilai sendiri-sendiri. Yang berubah hanya apa yang disuapkan ke `extractF4`;
   * rumus fiturnya (core/SPEC.md) tidak disentuh, jadi golden tetap 227/227.
   *
   * Versi lama: `drain()` dulu MEMBUANG buffer < minEventsAssess tanpa jejak. Dua
   * akibatnya sekaligus diperbaiki di sini — ekor yang masih hidup dikembalikan ke
   * buffer supaya bisa tumbuh (bukan dibuang tiap 30 detik), dan jendela yang tak
   * menghasilkan vonis tidak lagi diam-diam berlalu (lihat `_maybeAbstain`).
   */
  async _assessEvents(events, carryBack){
    // C-29: kembaran identik adalah artefak pencatatan, bukan perilaku (lihat
    // idle.js:dropExactDuplicates). Dibuang sebelum apa pun diukur atau diperiksa.
    events=dropExactDuplicates(events||[]);
    // B1: pisahkan per tab DULU. Dua tab aktif bersamaan tidak punya jeda untuk
    // dipotong segmentasi idle, jadi tanpa langkah ini keduanya menyatu jadi satu
    // "sesi" yang tidak mewakili perilaku siapa pun.
    const streams=groupByStream(events);
    if(streams.length > 1){
      let last=null;
      for(const st of streams) last=await this._assessStream(st, carryBack && st===streams[streams.length-1]);
      return last;
    }
    return this._assessStream(events, carryBack);
  }
  async _assessStream(events, carryBack){
    const S=this.cfg.session;
    const gapMs=(S.idleGapSec ?? 30)*1000;
    const acct=idleAccounting(events, gapMs);
    const segs=(S.idleCompressSec>0) ? this._compressedUnit(events, acct) : segmentByIdle(events, gapMs);
    // C-33: dengan kompresi nyala, ekor yang belum mencapai minEventsAssess terus
    // dikumpulkan sampai carryMaxAgeSec (bukan dibuang begitu diam 30 dtk).
    const carryMs=(S.idleCompressSec>0 && S.carryMaxAgeSec>0) ? S.carryMaxAgeSec*1000 : gapMs;
    const {assess, carry, dropped}=splitForAssessment(segs, S.minEventsAssess, Date.now(), gapMs, carryMs);
    if(carryBack && carry && this.capture){
      // ekor masih "hidup" (event terakhir belum melewati ambang jeda) -> kembalikan
      // ke depan buffer supaya terus tumbuh. Panjangnya < minEventsAssess, jadi
      // spread di sini aman dari stack overflow.
      try{ this.capture.buffer.unshift(...(carry.rawEvents||carry.events)); }catch{}
    }
    if(!assess.length) return this._maybeAbstain(events, acct, dropped);
    this._noAssessRuns=0; this._abstainEmitted=false;
    let last=null;
    // C-24 (opt-in): pecah tiap segmen jadi jendela KANONIK berukuran tetap K event.
    // Cacahan mentah (9 dari 28 fitur) membesar bersama panjang sesi, jadi panjang
    // yang berubah-ubah terbaca sebagai identitas yang berubah. Menyamakan panjangnya
    // memperbaiki itu tanpa menyentuh satu baris pun rumus fitur di core/SPEC.md.
    for(const seg0 of assess){
      const seg=this._withContext(seg0);
      // acct.segments = jumlah rentetan AKTIF di batch. Di jalur segmen sama dengan
      // segs.length; di jalur kompresi C-28 segs selalu 1, tapi telemetri tetap harus
      // bilang ada berapa rentetan yang dinilai jadi satu.
      for(const win of this._canonicalize(seg)) last=await this._assessSegment(win, acct, acct.segments);
    }
    return last;
  }
  /**
   * C-42: JENDELA GESER. Vonis pertama sebuah kunjungan tetap jatuh begitu 150 event
   * BARU terkumpul — penyusup diperiksa secepat sebelumnya. Vonis berikutnya menilai
   * event baru DITAMBAH event yang baru saja dinilai, sampai `contextEvents` total, jadi
   * pemilik yang terus bekerja dinilai dengan bukti ~2x lebih banyak (EER per pemilik
   * turun tajam dengan ukuran bukti, tabel C-29) tanpa menunda vonis pertama.
   *
   * Konteks HANYA dari kunjungan ini (memori, tidak disimpan) dan DIBUANG bila ada jeda
   * >= idle.awaySec antara konteks dan event baru: orang yang duduk di kursi pemilik
   * yang pergi tidak boleh meminjam perilaku pemilik untuk mengencerkan vonisnya.
   * Syarat 150 event baru tetap diperiksa pada event BARU saja (splitForAssessment).
   */
  _withContext(seg){
    const CE=this.cfg.session.contextEvents|0;
    const raw=seg.rawEvents;
    if(CE<=0 || !raw || !raw.length || !(this.cfg.session.idleCompressSec>0)) return seg;
    const prev=this._ctx||[];
    const awayMs=(this.cfg.idle && this.cfg.idle.awaySec ? this.cfg.idle.awaySec : 300)*1000;
    const fresh=prev.length && ((raw[0].timestamp||0)-(prev[prev.length-1].timestamp||0)) < awayMs;
    const room=Math.max(0, CE-raw.length);
    const combined= (fresh && room>0) ? prev.slice(-room).concat(raw) : raw;
    this._ctx=combined.slice(-CE);
    if(combined===raw) return seg;
    const u=this._compressedUnit(combined, {longestGapMs: seg.gapBeforeMs||0});
    return {...u[0], gapBeforeMs: seg.gapBeforeMs||0, context: combined.length-raw.length};
  }
  /**
   * C-28: seluruh aliran jadi SATU unit penilaian, jeda ≥ idleCompressSec
   * dipendekkan (bukan dipotong). Held-out 5 belahan, AFK 2-20 mnt disuntik:
   * FRR 18,4% -> 9,7% pada FAR 9,2% -> 9,3%, AUC 0,952 -> 0,968 — sedangkan
   * segmentasi C-23 memberi 18,8% / AUC 0,927. Memecah di jeda "away" ikut diuji dan
   * membatalkan manfaatnya (FRR 18,5%): yang merusak adalah MEMENDEKKAN SESI, bukan
   * jedanya. Lihat core/DRIFT.md C-28.
   *
   * Sisi KEAMANAN tidak hilang. Jeda terpanjang diukur dari timestamp ASLI sebelum
   * dikompresi dan dibawa sebagai `gapBeforeMs`, jadi `_ingestVector` tetap menandai
   * `resumedAfterAway`, mereset streak LOW, dan menaikkan LOW->MEDIUM bila absennya
   * ≥ reverifyAfterSec — persis seperti jalur segmen. Yang berubah: satu batch yang
   * melintasi absen menghasilkan SATU vonis, bukan dua.
   *
   * Bentuk keluarannya sama dengan segmentByIdle (array segmen) supaya
   * splitForAssessment, carry-back ekor, dan ABSTAIN berjalan tanpa diubah.
   */
  _compressedUnit(events, acct){
    if(!events || !events.length) return [];
    const ev=compressIdle(events, this.cfg.session.idleCompressSec*1000);
    const startTs=ev[0].timestamp||0, endTs=ev[ev.length-1].timestamp||startTs;
    // endTs dipakai splitForAssessment untuk memutuskan ekor masih "hidup"; ukur dari
    // waktu ASLI, bukan waktu hasil kompresi yang sudah digeser mundur.
    const realEnd=events.reduce((m,e)=> Math.max(m, e.timestamp||0), 0);
    // rawEvents: kalau unit ini ternyata ekor yang dikembalikan ke buffer, yang
    // dikembalikan harus event ASLI — timestamp hasil kompresi akan merusak jendela
    // berikutnya (jeda antara ekor dan event baru jadi terukur salah).
    return [{ events:ev, rawEvents:events, startTs, endTs:realEnd, durationMs:endTs-startTs,
              gapBeforeMs: acct.longestGapMs||0 }];
  }
  // C-24: [segmen] -> [jendela K event]. K=0 (default) mengembalikan segmen apa
  // adanya, jadi jalur lama tidak tersentuh. Sisa < K di ekor DIBUANG di sini —
  // ia tetap aman karena `splitForAssessment` sudah lebih dulu mengembalikan ekor
  // yang masih hidup ke buffer, jadi yang dibuang hanya sisa yang memang mati.
  _canonicalize(seg){
    const K=this.cfg.session.canonicalWindow|0;
    if(K<=0 || seg.events.length<K) return [seg];
    const out=[];
    for(let i=0;i+K<=seg.events.length;i+=K){
      const evs=seg.events.slice(i,i+K);
      out.push({ events:evs, startTs:evs[0].timestamp, endTs:evs[evs.length-1].timestamp,
                 durationMs:(evs[evs.length-1].timestamp||0)-(evs[0].timestamp||0),
                 gapBeforeMs: i===0 ? seg.gapBeforeMs : 0 });
    }
    return out;
  }
  async _assessSegment(seg, acct, totalSegments){
    const S=this.cfg.session;
    const gapMs=(S.idleGapSec ?? 30)*1000;
    const events=seg.events;
    const feat=extractF4(events);
    const vec=featuresToVector(feat);
    const durationSec=seg.durationMs/1000;     // durasi AKTIF, bukan rentang jam dinding
    const nonZero=Object.values(feat).filter(v=> Math.abs(v)>1e-9).length;
    // A3: bukti keystroke DIALIHKAN, bukan sekadar tidak ada. Dibedakan dengan hati-hati
    // dari sesi menelusuri biasa: sesi baca-baca juga nol keystroke, tapi ia nol pada
    // baseline-nya juga, jadi tidak menyesatkan. Yang menyesatkan adalah form yang
    // TERSENTUH tapi tidak diketik — autofill, password manager, atau tempel.
    // C-42: hanya event BARU yang diperiksa. Dengan jendela geser, satu tempel di konteks
    // dulu mencemari 2-3 vonis berikutnya (pengguna password manager tak pernah selesai
    // mendaftar); konteks sudah dinilai di vonis sebelumnya.
    const fresh=seg.context ? events.slice(seg.context) : events;
    const nKey=fresh.reduce((n,e)=> n+(e.event_type==='KEYSTROKE'?1:0), 0);
    const nPaste=fresh.reduce((n,e)=> n+(e.event_type==='PASTE'?1:0), 0);
    const nFocus=fresh.reduce((n,e)=> n+(e.event_type==='FORM_FOCUS'?1:0), 0);
    const keystrokeBypassed = nPaste>0 || (nFocus>0 && nKey===0);
    // Sesi yang blok keystroke-nya dialihkan TIDAK PERNAH melatih: kedelapan fiturnya
    // nol secara STRUKTURAL — karena memang tidak ada yang diketik — bukan karena
    // begitulah cara orang ini mengetik. Melatihkannya menarik baseline ke arah
    // "tidak pernah mengetik", dan itu justru MELEBARKAN jalan bagi penyusup yang
    // memakai autofill untuk menghapus jejak ritmenya.
    const passesGate = !keystrokeBypassed && events.length>=S.minEventsTrain && durationSec>=S.minDurationSec && nonZero>=S.minNonZeroFeatures;
    const meta={ keystrokeBypassed, contextEvents: seg.context||0, idle: {
      activeSec: durationSec,
      gapBeforeMs: seg.gapBeforeMs,
      gapClass: classifyGap(seg.gapBeforeMs, gapMs, this.cfg.idle.awaySec*1000),
      batchIdleMs: acct.idleMs, batchActiveRatio: acct.activeRatio,
      batchSegments: totalSegments,
    }};
    return this._ingestVector(vec, feat, passesGate, events, meta);
  }
  /**
   * C-23: jendela tanpa vonis TIDAK sama dengan jendela aman. Versi lama
   * mengembalikan `null` diam-diam, sehingga integrator yang menunggu callback
   * tidak bisa membedakan "sudah diperiksa, aman" dari "tak ada bukti sama sekali"
   * — dan default diam itu selalu jatuh ke sisi mempercayai. Sekarang diterbitkan
   * vonis 'UNKNOWN' / action 'ABSTAIN' SEKALI per rentetan idle (bukan tiap
   * jendela, supaya tab yang ditinggal semalaman tidak membanjiri log).
   */
  _maybeAbstain(events, acct, dropped){
    const I=this.cfg.idle;
    this._noAssessRuns=(this._noAssessRuns||0)+1;
    if(!I || !I.emitAbstain || this._abstainEmitted) return null;
    if(this._noAssessRuns < (I.abstainAfterWindows||4)) return null;
    this._abstainEmitted=true;
    const n=events ? events.length : 0;
    const evt={
      level:'UNKNOWN', score:null, action:'ABSTAIN', blocked:false, abstain:true,
      reasons:[ n===0
        ? 'tidak ada input — halaman kemungkinan ditinggal'
        : `bukti tidak cukup untuk menilai (${n} event, ambang ${this.cfg.session.minEventsAssess})` ],
      topFeatures:[], features:null, thresholds:{...this.cfg.thresholds}, eligible:false,
      idle:{ activeMs:acct.activeMs, idleMs:acct.idleMs, activeRatio:acct.activeRatio,
             segments:acct.segments, droppedSegments:dropped.length, events:n,
             windowsWithoutVerdict:this._noAssessRuns }
    };
    try{ this.onRisk(evt); }catch{}
    return evt;   // sengaja TIDAK di-_cloudLog: ini keadaan lokal, bukan vonis akun
  }
  // A5: `features.js` menghitung navEv = NAVIGATION | PAGE_STEP, dan basis data riset
  // berisi 2.672 PAGE_STEP — SEMUANYA dari alur checkout bertahap. Tapi `capture.js`
  // tidak pernah menerbitkannya, jadi `nav_step_transition_count` dan
  // `nav_page_transition_pattern` dihitung dari populasi event yang BERBEDA saat
  // dilatih dan saat dipakai (kerabat C-17).
  // Semantiknya tidak bisa ditebak otomatis — "langkah" itu urusan aplikasi, bukan
  // DOM — jadi jalan yang jujur adalah menyediakan API eksplisit, bukan menebak dari
  // submit/pushState dan diam-diam salah.
  markStep(name){
    if(!this.capture) return;
    try{
      this.capture.buffer.push({event_type:'PAGE_STEP', page_url: (typeof location!=='undefined'?location.href:'')+(name?('#'+name):''), timestamp: Date.now()});
    }catch{}
  }
  // challenge API
  async setChallenge(samples){ // samples: [{dwell, flight}]
    this.challengeTemplate=buildTemplate(samples);
    await this._persist();
  }
  async verifyChallenge(sample){
    if(!this.challengeTemplate) return {ok:false, reason:'no template'};
    return verifyChallenge(sample, this.challengeTemplate);
  }
  // untuk evaluasi / reproduce: skor tanpa side-effect
  scoreVector(vec){
    if(!this.model || !this.stats) return {score:0, level:'LOW'};
    const xstd=standardize(vec, this.stats);
    const score=this.model.scoreOne(xstd);
    return {score, level: toRisk(score, this.cfg.thresholds)};
  }
  // mode collector: ambil vektor 28-fitur dari perilaku yang tertangkap SEKARANG,
  // tanpa skor lokal & tanpa mengosongkan buffer. Dipakai untuk dikirim ke backend.
  getVector(){
    if(!this.capture) return null;
    let events=dropExactDuplicates(this.capture.peek());
    if(!events.length) return null;
    // C-28: vektor untuk backend harus melewati praproses yang SAMA dengan penilaian
    // lokal, kalau tidak backend menerima besaran yang berbeda dari yang dinilai di sini.
    const cs=this.cfg.session.idleCompressSec;
    if(cs>0) events=compressIdle(events, cs*1000);
    const feat=extractF4(events);
    return { vector: featuresToVector(feat), features: feat, n: events.length };
  }
  // untuk demo pemantau: expose
  getState(){ return {userId:this.userId, sessions:this.sessions, cfg:this.cfg, hasModel:!!this.model, thresholds: this.cfg.thresholds}; }
  // Satu daftar state per-pengguna, dipakai clear() (C-7) DAN init() (C-38) supaya
  // keduanya tidak bisa lagi menyimpang satu sama lain.
  _resetUserState(){
    this.sessions=[]; this.stats=null; this.model=null; this.lastRisk='LOW'; this._lowStreak=0;
    this._highRun=0; this.challengeTemplate=null; this._mfaPassedAt=null; this._mfaBusy=false;
    // C-23: keadaan idle/absen juga milik pengguna lama - jangan diwariskan.
    this._awayReturn=null; this._hiddenAt=null; this._lastEventAt=Date.now();
    this._noAssessRuns=0; this._abstainEmitted=false;
    this._aggBuf=[]; this._aggThresholds=null;   // C-24: bukti separuh terkumpul milik pengguna lama
    this._newSinceRebuild=0; this._mfaEnrollSnoozeUntil=0; this._stepUpFailures=0;
    this._pendingEvents=null; this._ctx=[];
  }
  async clear(){
    // C-7: dulu challengeTemplate/_highRun/_mfaPassedAt tetap hidup di memori
    // setelah clear(), jadi template pengguna lama masih dipakai untuk memverifikasi
    // pengguna berikutnya di tab yang sama.
    this._resetUserState();
    await storage.del(ns(this.userId));
    try{ localStorage.removeItem(nsPending(this.userId)); localStorage.removeItem(LEGACY_PENDING); }catch{}
  }
}

// singleton global untuk loader 3-baris
const singleton=new BehaviorGuard();
if(typeof window!=='undefined'){
  window.BehaviorGuard={
    init: (opts)=> singleton.init(opts),
    endSession: ()=> singleton.endSession(),
    markStep: (name)=> singleton.markStep(name),
    reportStepUp: (r)=> singleton.reportStepUp(r),
    assessNow: (o)=> singleton.assessNow(o),
    setUserToken: (t)=> singleton.setUserToken(t),
    getVector: ()=> singleton.getVector(),
    _instance: singleton,
    // untuk reproduce/tools
    _core: { extractF4, IsolationForest, OCSVM, Ensemble, computeStats, standardize }
  };
}
export { BehaviorGuard, singleton };
export default singleton;
