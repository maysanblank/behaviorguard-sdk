/*
 * panel-demo.js — PANEL PRESENTASI. Bukan bagian dari situs Arunika dan bukan bagian dari
 * pustaka: alat bantu untuk memperlihatkan apa yang terjadi di dalam BehaviorGuard saat demo.
 * Situs sungguhan tidak memuat berkas ini. Klik & ketikan di panel tidak direkam (data-bg-mfa).
 */
(function () {
  'use strict';
  const BG = window.BehaviorGuard, A = window.Arunika;
  if (!BG || !A || !A.sesi() || !window.Guard) return;
  const inst = BG._instance;
  const K_OPEN = 'arunika:panel:buka', K_HIST = 'arunika:panel:vonis', K_REC = 'arunika:panel:rekaman', K_CEPAT = 'arunika:mode-cepat';
  const ss = { get: (k, d) => { try { return JSON.parse(sessionStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} } };

  // Rekam jendela yang BARU SAJA dinilai wajar, untuk simulasi rekam-ulang. Kait ke metode
  // internal pustaka hanya ada di panel presentasi ini.
  if (!inst.__panelHook) {
    inst.__panelHook = true;
    const orig = inst._assessSegment.bind(inst);
    inst._assessSegment = async (seg, acct, tot) => {
      const r = await orig(seg, acct, tot);
      if (r && r.level === 'LOW' && !r.replay && !r.integrity && r.eligible !== false && seg && seg.events && seg.events.length) {
        try { sessionStorage.setItem(K_REC, JSON.stringify(seg.events.slice(0, 900))); } catch {}
      }
      return r;
    };
  }

  const CSS = `
  .pd{position:fixed;left:14px;bottom:14px;z-index:45;font:12.5px/1.45 ui-sans-serif,system-ui,"Segoe UI",Roboto,sans-serif;color:#e5e7eb}
  .pd *{box-sizing:border-box}
  .pd-t{display:flex;align-items:center;gap:8px;background:#0f141b;color:#e5e7eb;border:1px solid #273042;border-radius:99px;padding:7px 12px 7px 10px;cursor:pointer;font:inherit;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.25)}
  .pd-t i{width:8px;height:8px;border-radius:50%;background:#6b7280}
  .pd-b{width:min(340px,calc(100vw - 28px));max-height:min(calc(100vh - 90px),640px);overflow:auto;background:#0f141b;border:1px solid #273042;border-radius:14px;box-shadow:0 18px 48px rgba(0,0,0,.35);margin-bottom:8px}
  .pd-h{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid #1f2735;position:sticky;top:0;background:#0f141b}
  .pd-h b{font-size:12.5px}.pd-h span{color:#8b95a7;font-size:11.5px}
  .pd-s{padding:12px 14px;border-bottom:1px solid #1f2735}
  .pd-l{color:#8b95a7;font-size:11px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px;display:flex;justify-content:space-between}
  .pd-big{font-size:20px;font-weight:700;letter-spacing:-.01em}
  .pd-m{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:11.5px;color:#aab3c2}
  .pd-bar{height:6px;border-radius:9px;background:#1f2735;overflow:hidden;margin-top:6px}.pd-bar i{display:block;height:100%;background:#60a5fa;transition:width .3s}
  .pd-sub{font-family:ui-monospace,"Cascadia Mono",Consolas,monospace;font-size:10.5px;color:#8b95a6;margin-top:6px;line-height:1.4}
  .pd-sub.pd-warn{color:#e3a14a}
  .pd-g{position:relative;height:26px;margin-top:10px;border-radius:6px;overflow:hidden;display:flex}
  .pd-g span{height:100%}
  .pd-g .dot{position:absolute;top:2px;width:3px;height:22px;background:#fff;border-radius:2px;box-shadow:0 0 0 2px #0f141b}
  .pd-g .tk{position:absolute;bottom:-1px;font-size:10px;color:#0f141b;font-weight:700;padding:0 3px}
  .pd-tl{display:flex;gap:3px;flex-wrap:wrap}.pd-tl i{width:14px;height:14px;border-radius:3px;background:#374151}
  .pd-r{margin:6px 0 0;padding-left:16px;color:#cbd2dc}.pd-r li{margin:2px 0}
  .pd-a{display:grid;grid-template-columns:1fr 1fr;gap:6px}
  .pd-a button{font:inherit;font-weight:600;font-size:12px;color:#e5e7eb;background:#1a2230;border:1px solid #2a3446;border-radius:8px;padding:8px 8px;cursor:pointer;text-align:left}
  .pd-a button:hover{background:#222c3d}
  .pd-a button small{display:block;font-weight:500;color:#8b95a7;font-size:11px;margin-top:1px}
  .pd-a .w{grid-column:1/-1}
  .pd-f{padding:10px 14px;color:#6b7589;font-size:11px}
  @media (max-width:820px){.pd{bottom:70px}.pd-b{max-height:55vh}}
  .lv-LOW{color:#4ade80}.lv-MEDIUM{color:#fbbf24}.lv-HIGH{color:#f87171}.lv-UNKNOWN{color:#9ca3af}.lv-LEARN{color:#60a5fa}`;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);

  const root = document.createElement('div');
  root.className = 'pd'; root.setAttribute('data-bg-mfa', '');   // interaksi presenter tidak direkam
  root.innerHTML = `<div class="pd-b" hidden id="pd-b">
      <div class="pd-h"><div><b>Panel demo</b> <span id="pd-v"></span></div><span>alat presentasi</span></div>
      <div class="pd-s"><div class="pd-l"><span>Fase</span><span id="pd-mode"></span></div><div class="pd-big" id="pd-phase"></div>
        <div class="pd-m" id="pd-enr"></div><div class="pd-bar"><i id="pd-enrbar"></i></div>
        <div class="pd-sub" id="pd-pool"></div></div>
      <div class="pd-s"><div class="pd-l"><span>Bukti untuk penilaian berikut</span><span id="pd-next"></span></div>
        <div class="pd-m" id="pd-ev"></div><div class="pd-bar"><i id="pd-evbar" style="background:#a78bfa"></i></div></div>
      <div class="pd-s"><div class="pd-l"><span>Vonis terakhir</span><span id="pd-at"></span></div>
        <div class="pd-big" id="pd-lv">—</div><div class="pd-m" id="pd-act"></div>
        <div class="pd-g" id="pd-g" hidden></div><ul class="pd-r" id="pd-why"></ul></div>
      <div class="pd-s"><div class="pd-l"><span>Riwayat vonis (terbaru di kanan)</span></div><div class="pd-tl" id="pd-tl"></div></div>
      <div class="pd-s"><div class="pd-l"><span>Aksi demo</span></div><div class="pd-a">
        <button data-a="nilai">Nilai sekarang<small>tutup jendela bukti</small></button>
        <button data-a="absen">Kembali 20 menit<small>serangan jam makan siang</small></button>
        <button data-a="rekam">Putar ulang rekaman<small>serangan rekam-ulang</small></button>
        <button data-a="bot">Suntik skrip bot<small>200 event buatan</small></button>
        <button data-a="cepat" class="w" id="pd-cepat"></button>
        <button data-a="reset" class="w">Hapus profil & mulai dari awal<small>pendaftaran diulang dari 0</small></button>
      </div></div>
      <div class="pd-f">Panel ini tidak ada di situs sungguhan. Vonis di atas adalah yang diterima situs lewat onRisk.</div>
    </div>
    <button class="pd-t" id="pd-t" type="button"><i id="pd-dot"></i>Panel demo</button>`;
  document.body.appendChild(root);
  const $ = id => root.querySelector('#' + id);
  const open = v => { $('pd-b').hidden = !v; try { localStorage.setItem(K_OPEN, v ? '1' : '0'); } catch {} };
  $('pd-t').onclick = () => open($('pd-b').hidden);
  open(localStorage.getItem(K_OPEN) === '1');

  const COL = { LOW: '#4ade80', MEDIUM: '#fbbf24', HIGH: '#f87171', UNKNOWN: '#6b7280', LEARN: '#60a5fa' };
  const hist = ss.get(K_HIST, []);
  let t0 = null;
  Guard.ready.then(() => { t0 = Date.now(); });

  BG.on('risk', e => {
    if (e.abstain) return;
    const lv = e.enrollment ? 'LEARN' : e.level;
    // vonis yang menunggu dialog diumumkan dua kali (awaiting lalu final): satu kotak saja
    const same = e.id != null && hist.length && hist[hist.length - 1].id === e.id;
    if (same) hist[hist.length - 1] = { id: e.id, lv, t: Date.now(), a: e.action };
    else hist.push({ id: e.id, lv, t: Date.now(), a: e.action });
    ss.set(K_HIST, hist.slice(-40));
    t0 = Date.now();
    render();
  });

  function gauge(e) {
    const g = $('pd-g');
    const th = e && e.thresholds;
    if (!e || e.enrollment || !th || !Number.isFinite(e.score) || !Number.isFinite(th.low)) { g.hidden = true; return; }
    const span = Math.max(1e-6, th.low - th.medium);
    const lo = th.medium - span, hi = th.low + span * 1.2;
    const pos = v => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
    const pm = pos(th.medium), pl = pos(th.low);
    const s = Number.isFinite(e.modelScore) ? e.modelScore : e.score;
    g.hidden = false;
    g.innerHTML = `<span style="width:${pm}%;background:#7f1d1d"></span><span style="width:${pl - pm}%;background:#78350f"></span><span style="flex:1;background:#14532d"></span>
      <i class="tk" style="left:2px;color:#fecaca">HIGH</i><i class="tk" style="left:${pm + 1}%;color:#fde68a">MEDIUM</i><i class="tk" style="left:${pl + 1}%;color:#bbf7d0">LOW</i>
      <span class="dot" style="left:calc(${pos(s)}% - 1px)"></span>`;
  }

  function render() {
    const s = Guard.status();
    if (!s) return;
    const cepat = localStorage.getItem(K_CEPAT) === '1';
    $('pd-v').textContent = 'v' + s.version;
    $('pd-mode').textContent = cepat ? 'mode presentasi' : 'mode standar';
    $('pd-cepat').innerHTML = cepat ? 'Mode presentasi: NYALA<small>60 event/vonis, jam 15 dtk · klik untuk kembali ke standar</small>' : 'Mode presentasi: MATI<small>standar 150 event/vonis, jam 30 dtk · klik untuk mempercepat</small>';
    const learning = s.phase === 'learning';
    $('pd-phase').innerHTML = !s.ready ? 'menyala…' : learning ? '<span class="lv-LEARN">Mengenali pemilik</span>' : '<span class="lv-LOW">Melindungi</span>';
    $('pd-enr').textContent = `pendaftaran ${s.enrollment.done}/${s.enrollment.need} jendela layak · irama ketik ${s.mfa.enrolled ? 'terdaftar (' + s.mfa.mode + ')' : 'belum'} · cadangan ${s.mfa.fallback ? 'ada' : 'tidak'}`;
    $('pd-enrbar').style.width = Math.round(s.enrollment.done / s.enrollment.need * 100) + '%';
    // Kolam latih & gerbang detektor-2. Batang pendaftaran berhenti di 10, tapi mesinnya baru
    // utuh di 20 (Mahalanobis, bobot 0,70, dibungkam di bawah itu). Tanpa baris ini presenter
    // tidak punya cara tahu ia sedang mendemokan mesin yang separuh.
    if (s.model) {
      $('pd-pool').textContent = !s.model.trained
        ? 'model belum terbentuk'
        : `kolam latih ${s.model.pool} vektor · detektor utama (Mahalanobis, 70%) ${s.model.mainDetector ? 'AKTIF' : 'belum aktif — butuh ' + s.model.mainDetectorNeeds}`;
      $('pd-pool').className = s.model.trained && !s.model.mainDetector ? 'pd-warn' : '';
    }
    const need = s.evidence.need, have = s.evidence.buffered;
    $('pd-ev').textContent = `${have} event terkumpul · vonis butuh ≥ ${need}` + (s.mfa.graceLeftSec > 0 ? ` · masa verifikasi ${Math.ceil(s.mfa.graceLeftSec / 60)} mnt` : '');
    $('pd-evbar').style.width = Math.min(100, Math.round(have / need * 100)) + '%';
    const win = (inst.cfg && inst.cfg.session && inst.cfg.session.windowSec) || 30;
    $('pd-next').textContent = t0 ? `jam berdetak ±${Math.max(0, Math.ceil(win - ((Date.now() - t0) / 1000) % win))} dtk` : '';
    const e = inst._lastEvt;
    if (e && !e.abstain) {
      const lv = e.enrollment ? 'LEARN' : e.level;
      $('pd-lv').innerHTML = e.enrollment ? `<span class="lv-LEARN">Pendaftaran ${e.enrollment.selesai}/${e.enrollment.perlu}</span>` : `<span class="lv-${lv}">${lv}</span>`;
      const bits = [e.action];
      if (Number.isFinite(e.score)) bits.push('skor ' + e.score.toFixed(2));
      if (e.thresholds && Number.isFinite(e.thresholds.low) && !e.enrollment) bits.push(`batas LOW ${e.thresholds.low.toFixed(2)} · HIGH ${e.thresholds.medium.toFixed(2)}`);
      if (e.modelLevel && e.modelLevel !== e.level) bits.push(`model ${e.modelLevel}${e.stepUpGrace ? ', diredam (baru terverifikasi)' : e.stickyFloor ? ', lantai lengket' : ''}`);
      if (e.mfa && e.mfa.awaiting) bits.push('menunggu verifikasi…');
      else if (e.mfa && e.mfa.busy) bits.push('dialog lain sedang terbuka');
      else if (e.mfa && e.mfa.shown) bits.push('dialog: ' + (e.mfa.verified ? 'lolos' : e.mfa.fallback ? 'kode ' + (e.mfa.verified ? 'lolos' : 'gagal') : e.mfa.cancelled ? 'dibatalkan' : 'gagal'));
      else if (e.mfa && e.mfa.fallback) bits.push('kode ' + (e.mfa.verified ? 'lolos' : 'gagal'));
      $('pd-act').textContent = bits.join(' · ');
      $('pd-at').textContent = e.at ? A.jam(e.at) : '';
      gauge(e);
      const why = e.enrollment ? [] : Guard.jelaskan(e);
      const raw = (e.topFeatures || []).map(f => `${f.name} z=${f.z.toFixed(1)}`);
      $('pd-why').innerHTML = why.map(w => `<li>${A.esc(w)}</li>`).join('') + (raw.length && !e.enrollment ? `<li class="pd-m">${A.esc(raw.join(' · '))}</li>` : '');
      $('pd-dot').style.background = COL[lv] || '#6b7280';
    }
    $('pd-tl').innerHTML = hist.slice(-28).map(h => `<i style="background:${COL[h.lv] || '#374151'}" title="${h.lv} · ${A.jam(h.t)} · ${h.a || ''}"></i>`).join('') || '<span class="pd-m">belum ada vonis</span>';
  }
  setInterval(render, 1000);
  Guard.ready.then(render);

  // ---------------------------------------------------------------- aksi demo
  function synthBot(n = 200) {
    // skrip yang "mengetik" dan mengklik dengan jeda konstan dan tahan identik
    const ev = []; let t = Date.now() - n * 45;
    for (let i = 0; i < n; i++) {
      t += 45;
      if (i % 4 === 0) ev.push({ event_type: 'MOUSE_CLICK', x: 400, y: 300, page_url: location.href, timestamp: t, tabId: inst.tabId });
      else ev.push({ event_type: 'KEYSTROKE', key: 'k' + (i % 5 + 1), hold_time: 50, page_url: location.href, timestamp: t, tabId: inst.tabId });
    }
    return ev;
  }
  root.querySelector('.pd-a').addEventListener('click', async e => {
    const b = e.target.closest('button[data-a]'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'nilai') {
      const s = Guard.status();
      if (s.evidence.buffered < s.evidence.need) A.toast(`Bukti baru ${s.evidence.buffered} dari ${s.evidence.need} event. Gerakkan mouse, gulir, atau ketik dulu, lalu coba lagi.`, { label: 'Panel demo' });
      await BG.endSession();
    }
    if (a === 'absen') {
      inst._markAwayReturn(20 * 60 * 1000, 'simulasi panel demo');
      A.toast('Disimulasikan: kursi kosong 20 menit. Vonis berikutnya meminta verifikasi walau perilakunya wajar, karena orang yang kembali belum tentu orang yang pergi.', { label: 'Panel demo', ms: 7000 });
    }
    if (a === 'rekam') {
      const rec = ss.get(K_REC, null);
      if (!rec || !Guard.status() || Guard.status().phase !== 'protecting') {
        A.toast('Belum ada rekaman. Selesaikan pendaftaran lalu tunggu satu vonis LOW, baru putar ulang.', { label: 'Panel demo' }); return;
      }
      const last = rec[rec.length - 1].timestamp, shift = Date.now() - 500 - last;
      const evs = rec.map(x => ({ ...x, timestamp: x.timestamp + shift + Math.round((Math.random() - .5) * 4), tabId: inst.tabId }));
      A.toast('Memutar ulang rekaman perilakumu sendiri (seperti yang dilakukan malware perekam), digeser ke waktu sekarang.', { label: 'Panel demo', ms: 6000 });
      await inst.scoreExternalEvents(evs);
    }
    if (a === 'bot') {
      const ok = await A.konfirmasi({ judul: 'Suntik skrip bot?', isi: 'Pustaka akan menilai 200 event buatan skrip. Bot yang terdeteksi langsung menghentikan sesi, jadi kamu akan dikeluarkan dan perlu masuk lagi.', ya: 'Jalankan' });
      if (ok) await inst.scoreExternalEvents(synthBot());
    }
    if (a === 'cepat') {
      const cepat = localStorage.getItem(K_CEPAT) === '1';
      const ok = await A.konfirmasi({ judul: cepat ? 'Kembali ke mode standar?' : 'Nyalakan mode presentasi?',
        isi: (cepat ? 'Vonis kembali memakai 150 event dan jam 30 detik, sama dengan angka akurasi resmi.' : 'Vonis memakai 60 event dan jam 15 detik, jadi pendaftaran selesai sekitar dua kali lebih cepat. Angka akurasi resmi tidak berlaku di mode ini.') + ' Profil perilaku dihapus dan pendaftaran diulang, karena ukuran bukti yang berbeda menghasilkan profil yang tidak sebanding.', ya: 'Ganti mode' });
      if (!ok) return;
      await BG.forget();
      localStorage.setItem(K_CEPAT, cepat ? '0' : '1');
      sessionStorage.removeItem(K_HIST); sessionStorage.removeItem(K_REC);
      location.reload();
    }
    if (a === 'reset') {
      const ok = await A.konfirmasi({ judul: 'Hapus profil perilaku?', isi: 'Profil dan irama ketik untuk akun ini di browser ini dihapus. Pendaftaran mulai lagi dari 0.', ya: 'Hapus', bahaya: true });
      if (!ok) return;
      await BG.forget();
      sessionStorage.removeItem(K_HIST); sessionStorage.removeItem(K_REC);
      location.reload();
    }
    render();
  });
})();
