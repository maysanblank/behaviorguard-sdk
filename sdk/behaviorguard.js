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
import { storage } from './storage.js';
import { isConverged, cohortLowRate } from './core/lifecycle.js';
import { getOrCreateSecret, generateToken } from './core/token.js';
import { checkIntegrity } from './core/integrity.js';
import { getFingerprint } from './core/fingerprint.js';
import { checkCollect } from './core/ratelimit.js';
import { buildTemplate, verify as verifyChallenge } from './core/challenge.js';
import { runMfaChallenge } from './core/mfa.js';

const ns = id => `bg:${id}`;

class BehaviorGuard {
  constructor(){ this.cfg=structuredClone(DEFAULTS); this.userId=null; this.onRisk=null; this.capture=null; this.model=null; this.stats=null; this.sessions=[]; this.inited=false; this.lastRisk='LOW'; this.fingerprint=null; this.secret=null; this.challengeTemplate=null; }
  async init({userId, onRisk, storage: storageOpt, weights, baseline, retrainEvery, features, thresholds, pk, endpoint, mfa}={}){
    if(!userId) throw new Error('BehaviorGuard.init: userId wajib');
    this.userId=userId; this.onRisk=onRisk||(()=>{});
    // HYBRID cloud mode: baseline per tenant+userId hidup di VPS (lintas-device),
    // event mentah TETAP di device. Aktif kalau pk+endpoint diisi.
    this.pk=pk||null; this.endpoint=endpoint?endpoint.replace(/\/+$/,''):null; this.cloud=!!(this.pk&&this.endpoint);
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
    // fingerprint + secret + token (HMAC)
    try{ this.fingerprint=await getFingerprint(); }catch{ this.fingerprint='unknown'; }
    try{ this.secret=await getOrCreateSecret(userId); this.token=await generateToken({secret:this.secret, userId}); }catch{}
    const saved=await storage.get(ns(userId));
    if(saved){ this.sessions=saved.sessions||[]; this.stats=saved.stats||null; this.lastRisk=saved.lastRisk||'LOW'; this._highRun=saved.highRun||0; this.challengeTemplate=saved.challengeTemplate||null;
      // cek ganti device
      if(saved.fingerprint && saved.fingerprint!==this.fingerprint){
        console.warn('[BG] device fingerprint berubah - sesi dianggap berisiko');
        this.lastRisk='MEDIUM';
      }
    }
    // R4: jika ada ekor yang kesimpen pas beforeunload sebelumnya, pulihkan ke buffer
    try{
      const pending=JSON.parse(localStorage.getItem('bg:pending')||'null');
      if(pending && pending.length){
        localStorage.removeItem('bg:pending');
        // pending adalah event mentah - simpan dulu, akan di-score di endSession berikutnya
        // untuk init yang baru, taruh di capture buffer sementara
        this._pendingEvents=pending;
      }
    }catch{}
    // capture auto
    this.capture=createCapture(()=>{});
    try{ this.capture.attach(); }catch{}
    // S6: pending skor sebagai sesi terpisah, jangan gabung (bikin durasi ngembung)
    try{
      if(this._pendingEvents && this._pendingEvents.length){
        const pending=this._pendingEvents; delete this._pendingEvents;
        // skor pending sebagai sesi terpisah via _ingestVector, pakai seal storage
        const chunk=pending.slice(0,100);
        if(chunk.length>=this.cfg.session.minEventsAssess){
          // B1 fix: jangan require di ESM, pakai scoreExternalEvents langsung (extractF4 sudah diimpor)
          // async scoring deferred to next tick
          setTimeout(()=> this.scoreExternalEvents(chunk).catch(()=>{}), 100);
        }
        try{ await storage.set('bg:pending', null); }catch{}
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
  _wireAuto(){
    if(this._wired) return; this._wired=true;
    this._autoTimer=setInterval(()=>{ this.endSession().catch(()=>{}); }, this.cfg.session.windowSec*1000);
    try{
      document.addEventListener('visibilitychange', ()=>{
        if(document.visibilityState==='hidden') this.endSession().catch(()=>{});
      });
      const origPush=history.pushState.bind(history);
      const origReplace=history.replaceState.bind(history);
      const self=this;
      history.pushState=function(...a){ const r=origPush(...a); self.capture && self.capture.buffer.push({event_type:'NAVIGATION', page_url: location.href, timestamp: Date.now()}); return r; };
      history.replaceState=function(...a){ const r=origReplace(...a); self.capture && self.capture.buffer.push({event_type:'NAVIGATION', page_url: location.href, timestamp: Date.now()}); return r; };
      window.addEventListener('popstate', ()=>{ self.capture && self.capture.buffer.push({event_type:'NAVIGATION', page_url: location.href, timestamp: Date.now()}); });
      // R4: simpan ekor ke storage, bukan data: URL no-op; clear timer
      window.addEventListener('pagehide', ()=>{ try{ clearInterval(self._autoTimer); }catch{} });
      window.addEventListener('beforeunload', ()=>{
        try{
          const evs=self.capture.peek();
          if(evs.length>=10){
            // simpan untuk load berikutnya, bukan beacon ke data:
            const pending=JSON.parse(localStorage.getItem('bg:pending')||'[]');
            pending.push(...evs.slice(-100));
            if(pending.length>500) pending.splice(0, pending.length-500);
            localStorage.setItem('bg:pending', JSON.stringify(pending));
          }
          clearInterval(self._autoTimer);
        }catch{}
      });
    }catch{}
  }
  _trainingVectors(){
    // K6 + T1: hanya sesi eligible yang masuk kolam (gagal gate tidak latih)
    const isEligible=s=> s.eligible!==false;
    if(this.sessions.length <= this.cfg.baseline) return this.sessions.filter(isEligible).map(s=>s.vector);
    const base=this.sessions.slice(0, this.cfg.baseline).filter(isEligible).map(s=>s.vector);
    // TRUST-LOOP: sesi LOW normal ATAU sesi non-LOW yang LOLOS MFA (mfaVerified) boleh
    // masuk kolam. Sesi menyimpang yang belum terbukti pemilik -> TIDAK pernah melatih
    // (anti-peracunan baseline + adaptasi drift pemilik yang aman).
    let lows=this.sessions.slice(this.cfg.baseline).filter(s=>(s.risk==='LOW' || s.mfaVerified) && isEligible(s)).map(s=>s.vector);
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
    this.stats=computeStats(vecs);
    const Xstd=standardizeBatch(vecs, this.stats);
    const iff=new IsolationForest(this.cfg.iforest);
    iff.fit(Xstd);
    // detektor-2: Mahalanobis (default) atau centroid lama (cfg.model2)
    const det2=(this.cfg.model2||'mahalanobis')==='mahalanobis'
      ? new Mahalanobis({ shrink: this.cfg.mahalanobis.shrink, n_features: this.cfg.features.length })
      : new OCSVM({...this.cfg.ocsvm, n_features: this.cfg.features.length});
    det2.fit(Xstd);
    const ens=new Ensemble(iff, det2, this.cfg.weights, vecs.length);
    ens.calibrate(Xstd, vecs.length);
    this.model=ens;
    if(this.cfg.calibrateThresholds){
      const baseScores=Xstd.map(x=> ens.scoreOne(x));
      this.cfg.thresholds=(this.cfg.calibrationMode||'parametric')==='parametric'
        ? calibrateThresholdsParametric(baseScores, this.cfg.k_low, this.cfg.k_med_extra)
        : calibrateThresholds(baseScores, this.cfg.q_low, this.cfg.q_med);
    }
  }
  // ===== HYBRID cloud (baseline per tenant+userId di VPS; event mentah tak keluar) =====
  async _http(method, path, body){
    if(!this.endpoint) return null;
    try{
      const r=await fetch(this.endpoint+path, {method, headers:{'Content-Type':'application/json','Authorization':'Bearer '+this.pk}, body: body?JSON.stringify(body):undefined, keepalive:true});
      if(!r.ok) return null;
      return await r.json().catch(()=>null);
    }catch{ return null; }
  }
  async _cloudPull(){
    if(!this.cloud) return;
    const res=await this._http('GET','/baseline?u='+encodeURIComponent(this.userId));
    if(res && Array.isArray(res.vectors) && res.vectors.length){
      const localEligible=this.sessions.filter(s=>s.eligible!==false).length;
      // server = sumber kebenaran baseline lintas-device; adopsi bila >= lokal
      if(res.vectors.length >= localEligible){
        this.sessions=res.vectors.map(v=>({vector:v, feat:null, ts:Date.now(), risk:'LOW', score:0, eligible:true}));
      }
    }
  }
  _cloudPush(){
    // kirim VEKTOR FITUR teragregasi (bukan event mentah) sebagai baseline akun
    if(!this.cloud) return;
    const vectors=this._trainingVectors();
    if(!vectors.length) return;
    this._http('POST','/baseline',{userId:this.userId, vectors});
  }
  _cloudLog(evt){
    if(!this.cloud || !evt) return;
    this._http('POST','/log',{userId:this.userId, level:evt.level, score:evt.score, action:evt.action, reasons:evt.reasons,
      topFeatures:evt.topFeatures, convergence:evt.convergence, eligible:evt.eligible,
      sessions:(this.sessions?this.sessions.length:0), fp:this.fingerprint, ts:Date.now()});
  }
  // R3 + hardening: gate, integrity, ratelimit, fingerprint, monotonic, challenge
  async _ingestVector(vec, feat, eligible=true, events=null){
    // ratelimit
    const rl=checkCollect(this.userId);
    if(!rl.allowed){
      // C-4: dulu di-return diam-diam tanpa onRisk, jadi integrator tak pernah
      // tahu sesi diblokir rate-limit (jalur integrity di bawah memanggilnya).
      const rlEvt={level:'HIGH', score:-2, action:'BLOCK_SESSION', blocked:true, reasons:[rl.reason], topFeatures:[], features: feat, thresholds: {...this.cfg.thresholds}, eligible:false, rateLimited:true};
      this._cloudLog(rlEvt);
      try{ this.onRisk(rlEvt); }catch{}
      return rlEvt;
    }
    // integrity (bot/replay) - jika events tersedia
    if(events){
      const integ=checkIntegrity(events, {throttled:true});
      if(integ.suspected){
        const evt={level:'HIGH', score:-1.5, action:'BLOCK_SESSION', reasons:integ.reasons, topFeatures:[], features: feat, thresholds: {...this.cfg.thresholds}, eligible:false, integrity:true};
        this.sessions.push({vector: vec, feat, ts: Date.now(), risk:'HIGH', score:-1.5, eligible:false});
        await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:'HIGH'});
        this._cloudLog(evt);
        try{ this.onRisk(evt); }catch{}
        return evt;
      }
    }
    const eligibleCount=this.sessions.filter(s=>s.eligible!==false).length;
    if(eligibleCount < this.cfg.baseline){
      this.sessions.push({vector: vec, feat, ts: Date.now(), risk:'LOW', score:0, eligible});
      await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:'LOW'});
      let doneEnroll=false;
      if(this.sessions.filter(s=>s.eligible!==false).length >= this.cfg.baseline){ this._rebuildModel(); doneEnroll=true; }
      const enrollEvt={level:'LOW', score:0, reasons:[eligible?'enrollment '+this.sessions.filter(s=>s.eligible!==false).length+'/'+this.cfg.baseline:'sesi tidak layak - tidak masuk kolam'], topFeatures:[], features: feat, thresholds: {...this.cfg.thresholds}, convergence: 'enrollment', eligible};
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
    // C-5: toRisk() memakai `score <= thr`; untuk NaN itu SELALU false -> 'LOW'.
    // Skor rusak karena itu gagal-TERBUKA. Perlakukan sebagai anomali, bukan aman.
    if(!Number.isFinite(score)){
      const badEvt={level:'HIGH', score:null, action:'REQUIRE_STEPUP', blocked:false,
        reasons:['skor tidak finit - model/statistik rusak'], topFeatures:[], features: feat,
        thresholds: {...this.cfg.thresholds}, eligible:false, degraded:true};
      this.sessions.push({vector: vec, feat, ts: Date.now(), risk:'HIGH', score:null, eligible:false});
      await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:this.lastRisk, highRun:this._highRun, challengeTemplate:this.challengeTemplate});
      this._cloudLog(badEvt);
      try{ this.onRisk(badEvt); }catch{}
      return badEvt;
    }
    let level=toRisk(score, this.cfg.thresholds);
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
    const top=topFeatures(xstd, F4, 3);
    let action=toAction(level);   // HIGH -> REQUIRE_STEPUP (bukan block langsung)
    // challenge step-up
    let reasons=reasonsFrom(top);
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
    const evt={level, score, action, blocked, consecutiveHigh: this._highRun, reasons, topFeatures: top, features: feat, thresholds: {...this.cfg.thresholds}, eligible, modelLevel, modelScore, stickyFloor};
    // R3: push dengan flag eligible - sesi gagal gate tetap log tapi tidak latih
    this.sessions.push({vector: vec, feat, ts: Date.now(), risk: level, score, eligible});
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
    const lowsCount=trainVecs.length - this.cfg.baseline;
    const shouldRetrain = lowsCount>0 && lowsCount % this.cfg.retrainEvery === 0;
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
    await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:this.lastRisk, highRun:this._highRun, challengeTemplate:this.challengeTemplate});
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
        this._mfaPassedAt=now; this._highRun=0;
        this.lastRisk='LOW'; this._lowStreak=0;   // C-3: bersihkan lantai lengket,
                                                  // kalau tidak sesi berikutnya dipaksa HIGH terus
        evt.action='MFA_PASSED'; evt.blocked=false; evt.mfaVerified=true;
        // TRUST-LOOP: hanya sesi terverifikasi yang boleh mengajari model.
        const last=this.sessions[this.sessions.length-1];
        if(last){ last.mfaVerified=true; this._rebuildModel(); }
      } else {
        evt.action = evt.blocked ? 'BLOCK_SESSION' : 'MFA_FAILED';
      }
      await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:this.lastRisk, highRun:this._highRun, challengeTemplate:this.challengeTemplate});
    }catch(e){ evt.mfa={ shown:true, error:String(e&&e.message||e) }; }
    finally{ this._mfaBusy=false; }
  }

  // Pendaftaran template ritme HANYA di sesi tepercaya: vonis LOW, model sudah
  // terbentuk, dan belum pernah punya template. Ini pasangan dari C-2 — kalau
  // pendaftaran tidak pernah terjadi di sini, MFA tidak akan pernah tersedia.
  async _maybeEnrollMfa(evt){
    const m=this.cfg.mfa;
    if(!m || !m.enabled || typeof document==='undefined') return;
    if(this.challengeTemplate || this._mfaBusy) return;
    if(evt.level!=='LOW' || evt.eligible===false || !this.model) return;
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
        await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:this.lastRisk, highRun:this._highRun, challengeTemplate:this.challengeTemplate});
      } else {
        evt.mfa={ enrolled:false, reason:res.reason||'dibatalkan' };
      }
    }catch(e){ evt.mfa={ enrolled:false, error:String(e&&e.message||e) }; }
    finally{ this._mfaBusy=false; }
  }
  async endSession(){
    if(!this.capture) return null;
    const events=this.capture.drain();
    if(events.length < this.cfg.session.minEventsAssess) return null;
    const feat=extractF4(events);
    const vec=featuresToVector(feat);
    const duration=(events[events.length-1]?.timestamp||0)-(events[0]?.timestamp||0);
    const durationSec=duration/1000;
    const nonZero=Object.values(feat).filter(v=> Math.abs(v)>1e-9).length;
    const passesGate = events.length>=this.cfg.session.minEventsTrain && durationSec>=this.cfg.session.minDurationSec && nonZero>=this.cfg.session.minNonZeroFeatures;
    return this._ingestVector(vec, feat, passesGate, events);
  }
  async scoreExternalEvents(events){
    if(!events || events.length < this.cfg.session.minEventsAssess) return null;
    const feat=extractF4(events);
    const vec=featuresToVector(feat);
    const duration=(events[events.length-1]?.timestamp||0)-(events[0]?.timestamp||0);
    const durationSec=duration/1000;
    const nonZero=Object.values(feat).filter(v=> Math.abs(v)>1e-9).length;
    const passesGate = events.length>=this.cfg.session.minEventsTrain && durationSec>=this.cfg.session.minDurationSec && nonZero>=this.cfg.session.minNonZeroFeatures;
    return this._ingestVector(vec, feat, passesGate, events);
  }
  // challenge API
  async setChallenge(samples){ // samples: [{dwell, flight}]
    this.challengeTemplate=buildTemplate(samples);
    await storage.set(ns(this.userId), {sessions:this.sessions, stats:this.stats, fingerprint:this.fingerprint, lastRisk:this.lastRisk, highRun:this._highRun, challengeTemplate:this.challengeTemplate});
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
    const events=this.capture.peek();
    if(!events.length) return null;
    const feat=extractF4(events);
    return { vector: featuresToVector(feat), features: feat, n: events.length };
  }
  // untuk demo pemantau: expose
  getState(){ return {userId:this.userId, sessions:this.sessions, cfg:this.cfg, hasModel:!!this.model, thresholds: this.cfg.thresholds}; }
  async clear(){
    // C-7: dulu challengeTemplate/_highRun/_mfaPassedAt tetap hidup di memori
    // setelah clear(), jadi template pengguna lama masih dipakai untuk memverifikasi
    // pengguna berikutnya di tab yang sama.
    this.sessions=[]; this.stats=null; this.model=null; this.lastRisk='LOW'; this._lowStreak=0;
    this._highRun=0; this.challengeTemplate=null; this._mfaPassedAt=null; this._mfaBusy=false;
    await storage.del(ns(this.userId)); await storage.del('bg:pending');
  }
}

// singleton global untuk loader 3-baris
const singleton=new BehaviorGuard();
if(typeof window!=='undefined'){
  window.BehaviorGuard={
    init: (opts)=> singleton.init(opts),
    endSession: ()=> singleton.endSession(),
    getVector: ()=> singleton.getVector(),
    _instance: singleton,
    // untuk reproduce/tools
    _core: { extractF4, IsolationForest, OCSVM, Ensemble, computeStats, standardize }
  };
}
export { BehaviorGuard, singleton };
export default singleton;
