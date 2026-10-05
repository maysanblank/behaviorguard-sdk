/*
 * demo-panel.js - PRESENTER PANEL. Not part of the Arunika site and not part of the library:
 * a tool for showing what happens inside BehaviorGuard during a demo. A real site does not
 * load this file. Clicks and keys inside the panel are not recorded (data-bg-mfa).
 */
(function () {
  'use strict';
  const BG = window.BehaviorGuard, A = window.Arunika;
  if (!BG || !A || !A.sesi() || !window.Guard) return;
  const inst = BG._instance;
  const K_OPEN = 'arunika:panel:buka', K_HIST = 'arunika:panel:vonis', K_REC = 'arunika:panel:rekaman', K_CEPAT = 'arunika:mode-cepat';
  const ss = { get: (k, d) => { try { return JSON.parse(sessionStorage.getItem(k)) ?? d; } catch { return d; } }, set: (k, v) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {} } };

  // Keep the window that was JUST assessed as normal, for the replay simulation. Hooking an
  // internal library method only happens in this presenter panel.
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
  root.className = 'pd'; root.setAttribute('data-bg-mfa', '');   // presenter interaction is not recorded
  root.innerHTML = `<div class="pd-b" hidden id="pd-b">
      <div class="pd-h"><div><b>Demo panel</b> <span id="pd-v"></span></div><span>presenter tool</span></div>
      <div class="pd-s"><div class="pd-l"><span>Phase</span><span id="pd-mode"></span></div><div class="pd-big" id="pd-phase"></div>
        <div class="pd-m" id="pd-enr"></div><div class="pd-bar"><i id="pd-enrbar"></i></div>
        <div class="pd-sub" id="pd-pool"></div></div>
      <div class="pd-s"><div class="pd-l"><span>Evidence for the next verdict</span><span id="pd-next"></span></div>
        <div class="pd-m" id="pd-ev"></div><div class="pd-bar"><i id="pd-evbar" style="background:#a78bfa"></i></div></div>
      <div class="pd-s"><div class="pd-l"><span>Last verdict</span><span id="pd-at"></span></div>
        <div class="pd-big" id="pd-lv">-</div><div class="pd-m" id="pd-act"></div>
        <div class="pd-g" id="pd-g" hidden></div><ul class="pd-r" id="pd-why"></ul></div>
      <div class="pd-s"><div class="pd-l"><span>Verdict history (newest on the right)</span></div><div class="pd-tl" id="pd-tl"></div></div>
      <div class="pd-s"><div class="pd-l"><span>Demo actions</span></div><div class="pd-a">
        <button data-a="nilai">Assess now<small>close the evidence window</small></button>
        <button data-a="absen">Back after 20 min<small>lunch-break attack</small></button>
        <button data-a="rekam">Replay a recording<small>replay attack</small></button>
        <button data-a="bot">Inject a bot script<small>200 synthetic events</small></button>
        <button data-a="cepat" class="w" id="pd-cepat"></button>
        <button data-a="reset" class="w">Delete profile & start over<small>enrollment restarts at 0</small></button>
      </div></div>
      <div class="pd-f">This panel does not exist on a real site. The verdict above is what the site receives through onRisk.</div>
    </div>
    <button class="pd-t" id="pd-t" type="button"><i id="pd-dot"></i>Demo panel</button>`;
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
    // a verdict waiting on a dialog is announced twice (awaiting, then final): one box only
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
    $('pd-mode').textContent = cepat ? 'presentation mode' : 'standard mode';
    $('pd-cepat').innerHTML = cepat ? 'Presentation mode: ON<small>60 events/verdict, 15 s clock · click to go back to standard</small>' : 'Presentation mode: OFF<small>standard 150 events/verdict, 30 s clock · click to speed up</small>';
    const learning = s.phase === 'learning';
    $('pd-phase').innerHTML = !s.ready ? 'starting' : learning ? '<span class="lv-LEARN">Learning the owner</span>' : '<span class="lv-LOW">Protecting</span>';
    $('pd-enr').textContent = `enrollment ${s.enrollment.done}/${s.enrollment.need} eligible windows · typing rhythm ${s.mfa.enrolled ? 'enrolled (' + s.mfa.mode + ')' : 'not yet'} · fallback ${s.mfa.fallback ? 'yes' : 'no'}`;
    $('pd-enrbar').style.width = Math.round(s.enrollment.done / s.enrollment.need * 100) + '%';
    // Training pool & the second-detector gate. The enrollment bar stops at 10, but the engine is
    // only complete at 20 (Mahalanobis, weight 0.70, muted below that). Without this line the
    // presenter has no way to know they are demonstrating half an engine.
    if (s.model) {
      $('pd-pool').textContent = !s.model.trained
        ? 'model not built yet'
        : `training pool ${s.model.pool} vectors · main detector (Mahalanobis, 70%) ${s.model.mainDetector ? 'ON' : 'not on yet - needs ' + s.model.mainDetectorNeeds}`;
      $('pd-pool').className = s.model.trained && !s.model.mainDetector ? 'pd-warn' : '';
    }
    const need = s.evidence.need, have = s.evidence.buffered;
    $('pd-ev').textContent = `${have} events collected · a verdict needs ≥ ${need}` + (s.mfa.graceLeftSec > 0 ? ` · verification grace ${Math.ceil(s.mfa.graceLeftSec / 60)} min` : '');
    $('pd-evbar').style.width = Math.min(100, Math.round(have / need * 100)) + '%';
    const win = (inst.cfg && inst.cfg.session && inst.cfg.session.windowSec) || 30;
    $('pd-next').textContent = t0 ? `next tick in ~${Math.max(0, Math.ceil(win - ((Date.now() - t0) / 1000) % win))} s` : '';
    const e = inst._lastEvt;
    if (e && !e.abstain) {
      const lv = e.enrollment ? 'LEARN' : e.level;
      $('pd-lv').innerHTML = e.enrollment ? `<span class="lv-LEARN">Enrollment ${e.enrollment.done}/${e.enrollment.need}</span>` : `<span class="lv-${lv}">${lv}</span>`;
      const bits = [e.action];
      if (Number.isFinite(e.score)) bits.push('score ' + e.score.toFixed(2));
      if (e.thresholds && Number.isFinite(e.thresholds.low) && !e.enrollment) bits.push(`LOW above ${e.thresholds.low.toFixed(2)} · HIGH below ${e.thresholds.medium.toFixed(2)}`);
      if (e.modelLevel && e.modelLevel !== e.level) bits.push(`model ${e.modelLevel}${e.stepUpGrace ? ', suppressed (just verified)' : e.stickyFloor ? ', sticky floor' : ''}`);
      if (e.mfa && e.mfa.awaiting) bits.push('waiting for verification');
      else if (e.mfa && e.mfa.busy) bits.push('another dialog is open');
      else if (e.mfa && e.mfa.shown) bits.push('dialog: ' + (e.mfa.verified ? 'passed' : e.mfa.fallback ? 'code ' + (e.mfa.verified ? 'passed' : 'failed') : e.mfa.cancelled ? 'cancelled' : 'failed'));
      else if (e.mfa && e.mfa.fallback) bits.push('code ' + (e.mfa.verified ? 'passed' : 'failed'));
      $('pd-act').textContent = bits.join(' · ');
      $('pd-at').textContent = e.at ? A.jam(e.at) : '';
      gauge(e);
      const why = e.enrollment ? [] : Guard.explain(e);
      const raw = (e.topFeatures || []).map(f => `${f.name} z=${f.z.toFixed(1)}`);
      $('pd-why').innerHTML = why.map(w => `<li>${A.esc(w)}</li>`).join('') + (raw.length && !e.enrollment ? `<li class="pd-m">${A.esc(raw.join(' · '))}</li>` : '');
      $('pd-dot').style.background = COL[lv] || '#6b7280';
    }
    $('pd-tl').innerHTML = hist.slice(-28).map(h => `<i style="background:${COL[h.lv] || '#374151'}" title="${h.lv} · ${A.jam(h.t)} · ${h.a || ''}"></i>`).join('') || '<span class="pd-m">no verdicts yet</span>';
  }
  setInterval(render, 1000);
  Guard.ready.then(render);

  // ---------------------------------------------------------------- demo actions
  function synthBot(n = 200) {
    // a script that "types" and clicks with constant gaps and identical holds
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
      if (s.evidence.buffered < s.evidence.need) A.toast(`Only ${s.evidence.buffered} of ${s.evidence.need} events of evidence so far. Move the mouse, scroll or type, then try again.`, { label: 'Demo panel' });
      await BG.endSession();
    }
    if (a === 'absen') {
      inst._markAwayReturn(20 * 60 * 1000, 'demo panel simulation');
      A.toast('Simulated: the seat was empty for 20 minutes. The next verdict asks for verification even if behavior looks normal, because whoever comes back is not necessarily who left.', { label: 'Demo panel', ms: 7000 });
    }
    if (a === 'rekam') {
      const rec = ss.get(K_REC, null);
      if (!rec || !Guard.status() || Guard.status().phase !== 'protecting') {
        A.toast('No recording yet. Finish enrollment and wait for one LOW verdict, then replay.', { label: 'Demo panel' }); return;
      }
      const last = rec[rec.length - 1].timestamp, shift = Date.now() - 500 - last;
      const evs = rec.map(x => ({ ...x, timestamp: x.timestamp + shift + Math.round((Math.random() - .5) * 4), tabId: inst.tabId }));
      A.toast('Replaying a recording of your own behavior (as recording malware would), shifted to the current time.', { label: 'Demo panel', ms: 6000 });
      await inst.scoreExternalEvents(evs);
    }
    if (a === 'bot') {
      const ok = await A.konfirmasi({ judul: 'Inject a bot script?', isi: 'The library will assess 200 script-made events. A detected bot ends the session at once, so you will be logged out and need to log in again.', ya: 'Run it' });
      if (ok) await inst.scoreExternalEvents(synthBot());
    }
    if (a === 'cepat') {
      const cepat = localStorage.getItem(K_CEPAT) === '1';
      const ok = await A.konfirmasi({ judul: cepat ? 'Back to standard mode?' : 'Turn on presentation mode?',
        isi: (cepat ? 'Verdicts go back to 150 events and a 30-second clock, the same as the published accuracy numbers.' : 'Verdicts use 60 events and a 15-second clock, so enrollment finishes about twice as fast. The published accuracy numbers do not apply in this mode.') + ' The behavior profile is deleted and enrollment restarts, because a different evidence size produces a profile that is not comparable.', ya: 'Switch mode' });
      if (!ok) return;
      await BG.forget();
      localStorage.setItem(K_CEPAT, cepat ? '0' : '1');
      sessionStorage.removeItem(K_HIST); sessionStorage.removeItem(K_REC);
      location.reload();
    }
    if (a === 'reset') {
      const ok = await A.konfirmasi({ judul: 'Delete the behavior profile?', isi: 'The profile and typing rhythm for this account in this browser are deleted. Enrollment starts again from 0.', ya: 'Delete', bahaya: true });
      if (!ok) return;
      await BG.forget();
      sessionStorage.removeItem(K_HIST); sessionStorage.removeItem(K_REC);
      location.reload();
    }
    render();
  });
})();
