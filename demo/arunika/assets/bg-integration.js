/*
 * bg-integration.js - the ONLY browser file the site owner writes to install BehaviorGuard.
 *
 * BehaviorGuard runs in BACKEND MODE here. The page captures behavior and sends 34 summary
 * numbers per window to Arunika's own server (/bg, mounted in server.py). The account's
 * profile, the verdicts, the typing-rhythm template and the verifications are kept THERE,
 * so the profile follows the account to any browser or laptop. This file adds four things,
 * and no other line of application code changes:
 *   1. start the library after login               -> BehaviorGuard.init({ endpoint, tokenUrl })
 *   2. respond to verdicts                         -> onRisk: record, lock, or end the session
 *   3. sensitive actions (transfer, password)      -> assessNow(), stepUp() when needed, then the
 *                                                     request; the SERVER decides (guard.check)
 *   4. a FALLBACK verification path (one-time code) -> mfa.onFallback, checked by the server
 *
 * THE ORDER MATTERS, and is often misread. The MAIN verification is not a one-time code but
 * BEHAVIOR: the LIBRARY's "type the phrase" dialog, whose typing rhythm is matched on the
 * server against the owner's template. The one-time code only appears when that path cannot
 * be used: the owner has not set up a rhythm yet, the rhythm path is locked after failures,
 * or "Use another method" was pressed. It is the way OUT, not the front door.
 *
 * Nothing in this file is trusted for the decision. If a script skipped the gate below and
 * called /api/transfer directly, the server would still refuse it (403, verify first).
 */
(function () {
  'use strict';
  const A = window.Arunika;
  const s = A && A.sesi();
  const BG = window.BehaviorGuard;
  const LOCK_KEY = 'arunika:terkunci';          // per tab: sensitive actions locked until verified
  const FAST = !!(A && A.akun() && A.akun().fast);   // presentation mode, kept on the account
  let LOG = (A && A.ME.log) || [];
  // The security log is kept on the account (server), so the owner sees what happened from
  // another laptop too.
  function record(entry) {
    LOG = [{ t: Date.now(), ...entry }, ...LOG].slice(0, 20);
    A.api('/api/log', entry).then(r => { if (r.ok && r.body.log) LOG = r.body.log; });
  }

  if (!s || !BG) {
    // The library failed to load (blocked by an extension, CDN down, wrong path): FAIL CLOSED.
    // Without behavioral assessment every sensitive action is treated as "not verified" and
    // goes through the one-time code. Never let a sensitive action through just because the
    // security script is missing.
    if (s && !BG) console.warn('[Arunika] BehaviorGuard did not load - sensitive actions use a one-time code');
    const gateNoLib = async () => (s ? { ok: await verifyCode({ why: 'library-not-loaded' }), assessment: { level: 'UNKNOWN' } } : { ok: false });
    window.Guard = {
      ready: Promise.resolve(),
      gate: gateNoLib,
      act: async (action, opts, request) => { const g = await gateNoLib(); return g.ok ? request() : { ok: false, cancelled: true }; },
      status: () => null, onChange: () => {}, log: () => LOG, explain: () => [], record,
      levelLabel: lv => lv,
    };
    return;
  }

  // ------------------------------------------------------------------ 1. init
  const options = {
    endpoint: '/bg',                        // BehaviorGuard's API, mounted inside Arunika's server
    tokenUrl: '/api/bg-token',              // a short-lived token for THIS login, signed by the server
    pk: 'pk_arunika_demo',                  // public key; opens nothing by itself
    onRisk: handleVerdict,
    mfa: {
      phrase: 'arunika guards my account', // retyped during verification (not a secret)
      brand: 'Arunika',
      accent: '#b4501a',
      theme: 'light',                       // the site is always light
      lang: 'en',
      onFallback: verifyCode,               // "Use another method" -> the site's one-time code
    },
  };
  // Presentation mode: less evidence per verdict, so enrollment finishes about 2x faster.
  // The published accuracy numbers do NOT apply in this mode (measured at 150 events per verdict).
  // The setting is kept on the account, so every browser that opens it sends the same size.
  if (FAST) options.session = { minEventsAssess: 60, minEventsTrain: 60, windowSec: 15 };
  const ready = BG.init(options).catch(e => { console.error('[Arunika] BehaviorGuard failed to start', e); });

  // ------------------------------------------------------------------ 2. verdicts
  const FEATURE_NAMES = {
    mouse_velocity_mean: 'mouse speed', mouse_velocity_std: 'mouse speed variation', mouse_velocity_max: 'top mouse speed',
    mouse_acceleration_std: 'mouse acceleration variation', mouse_curvature_mean: 'mouse path curvature', mouse_direction_changes: 'mouse turns',
    mouse_pause_count: 'mouse pauses', mouse_click_interval_mean: 'time between clicks', cursor_idle_ratio: 'share of idle cursor time',
    cross_mouse_keyboard_coordination: 'switching from mouse to keyboard', keystroke_dwell_time_mean: 'key hold time',
    keystroke_dwell_time_std: 'key hold time variation', keystroke_flight_time_mean: 'gap between keys', keystroke_transition_entropy: 'variety of key sequences',
    keystroke_typing_speed: 'typing speed', keystroke_cross_field_cadence: 'rhythm when moving between fields', keystroke_burst_count: 'typing bursts',
    temporal_time_of_day_score: 'time of day', temporal_session_duration: 'activity length', temporal_activity_bursts: 'activity spikes',
    nav_page_transition_pattern: 'page navigation pattern', nav_scroll_depth_mean: 'scroll depth', nav_page_count: 'pages opened',
    nav_step_transition_count: 'flow steps', form_focus_count: 'entering form fields', form_blur_count: 'leaving form fields',
    form_field_switch_rate: 'field switching rate', cart_action_count: 'cart actions',
    keystroke_flight_median: 'typical gap between keys', keystroke_flight_iqr: 'typing rhythm consistency', keystroke_backspace_ratio: 'deleting habit',
    keystroke_cross_hand_ratio: 'left-right hand pattern', keystroke_dwell_median: 'typical key hold', keystroke_shift_ratio: 'use of capital letters',
  };
  // topFeatures -> plain sentences ("gap between keys much higher than usual")
  function explain(e) {
    if (!e) return [];
    const out = [];
    if (e.replay) out.push('behavior identical to an earlier session, the mark of a replayed recording');
    if (e.integrity) out.push('input too regular for a human (script or bot)');
    if (e.reverifyAfterAway) out.push('back after a long time away');
    for (const f of (e.topFeatures || [])) {
      if (!FEATURE_NAMES[f.name] || !Number.isFinite(f.z) || Math.abs(f.z) < 1.5) continue;
      const a = Math.abs(f.z), dir = f.z > 0 ? 'higher' : 'lower';
      out.push(`${FEATURE_NAMES[f.name]} ${a > 4 ? 'much ' : ''}${dir} than usual`);
    }
    return out.slice(0, 3);
  }

  const locked = () => sessionStorage.getItem(LOCK_KEY) === '1';
  function lock(on) {
    if (on) sessionStorage.setItem(LOCK_KEY, '1'); else sessionStorage.removeItem(LOCK_KEY);
    showBanner();
  }

  let doneLearning = false;
  function handleVerdict(e) {
    if (e.enrollment) {
      if (e.enrollment.ready && !doneLearning) {
        doneLearning = true;
        record({ lv: 'info', t1: 'Behavior profile built', t2: 'From now on, activity on this account is assessed against your habits, on any device.' });
        A.toast('Your behavior profile is built. Protection is on.', { label: 'Security' });
      }
      return;
    }
    if (e.abstain || e.action === 'PENDING') return;
    // A verification dialog is showing or about to: the action is not final yet. The next
    // event (same id, stage 'final') carries the result. mfa.busy = another verdict landed
    // while a dialog was open; that dialog's result decides, so do not act on your own.
    if (e.mfa && (e.mfa.awaiting || e.mfa.busy)) return;
    const reasons = explain(e);
    const sentence = (list, fallback) => list.length ? list.join('; ').replace(/^./, c => c.toUpperCase()) + '.' : fallback;
    const lv = e.level;
    if (e.action === 'MFA_PASSED') {
      lock(false);
      record({ lv: 'ok', t1: 'Verification passed', t2: (e.mfa && e.mfa.fallback ? 'With a one-time code. ' : 'With typing rhythm. ') + (reasons[0] ? 'Trigger: ' + reasons[0] + '.' : '') });
      return;
    }
    if (e.action === 'BLOCK_SESSION' || (e.action === 'MFA_FAILED' && lv === 'HIGH')) {
      record({ lv: 'bad', t1: 'Session ended', t2: sentence(reasons, 'Activity does not match the account owner.') });
      endSession(reasons);
      return;
    }
    if (lv === 'MEDIUM' || lv === 'HIGH') {
      // dialog closed or failed, or no verification path -> lock sensitive actions in this tab
      lock(true);
      record({ lv: 'warn', t1: lv === 'HIGH' ? 'Very unusual activity' : 'Unusual activity', t2: sentence(reasons, 'Usage differs from the usual pattern.') + ' Verification not completed.' });
      return;
    }
    if (e.stepUpGrace) return;      // a MEDIUM suppressed because the owner just verified
  }

  function endSession() {
    const bd = document.createElement('div');
    bd.className = 'dlg-bd';
    bd.innerHTML = `<div class="dlg" role="alertdialog" aria-modal="true" aria-labelledby="blk-t">
      <h2 id="blk-t">Session ended for your security</h2>
      <p class="sub">The way this account is being used does not match its owner, and verification did not succeed. You will be logged out. If this is really you, log in again and verify with a one-time code.</p>
      <div class="acts"><button class="btn btn-pri" data-ok>Log out now</button></div></div>`;
    document.body.appendChild(bd);
    const go = () => A.keluar('diblokir');
    bd.querySelector('[data-ok]').onclick = go;
    bd.querySelector('[data-ok]').focus();
    setTimeout(go, 6000);
  }

  function showBanner() {
    const wrap = document.querySelector('main.wrap');
    if (!wrap) return;
    let b = document.getElementById('bn-kunci');
    if (!locked()) { if (b) b.remove(); return; }
    if (b) return;
    b = document.createElement('div');
    b.id = 'bn-kunci'; b.className = 'banner bn-warn'; b.setAttribute('role', 'status');
    b.innerHTML = `${A.I.alert}<div class="grow"><div class="t">Verification required</div>
      <div>Activity in this session is unusual. Transfers, payments and security changes are locked until you verify.</div></div>
      <button class="btn btn-sm" type="button">Verify now</button>`;
    b.querySelector('button').onclick = async () => {
      const v = await BG.stepUp({ level: 'MEDIUM', reason: 'unlock this session' });
      if (v.verified) { lock(false); record({ lv: 'ok', t1: 'Verification passed', t2: 'Session unlocked.' }); A.toast('Verified. Everything is unlocked again.'); }
    };
    wrap.prepend(b);
  }

  // ------------------------------------------------------------------ 3. sensitive-action gate
  /**
   * Arunika's policy (an example of a risk-based policy; every site decides its own):
   *   change password             -> ALWAYS verify
   *   LOW                         -> go ahead
   *   MEDIUM / HIGH / locked      -> verify first
   *   UNKNOWN (not enough evidence yet, or the device is still being learned)
   *                               -> verify, WHATEVER the amount
   *   LOW but the main detector is not on yet (training pool < 20 pieces of evidence)
   *                               -> verify for money going out (transfer, payment)
   *   just passed verification (<= 15 minutes, assessNow().verifiedRecently)
   *                               -> not asked again, unless HIGH or a password change
   */
  async function gate(action, { amount = 0, label = action } = {}) {
    await ready;
    // assessNow() asks the server; the result is also kept there for the server-side gate
    const r = await BG.assessNow();
    const always = action === 'ganti-sandi';
    let needed = always || locked() || r.level === 'MEDIUM' || r.level === 'HIGH';
    // UNKNOWN = nothing to compare against yet, not enough evidence, or the backend is down.
    // Only amounts >= Rp 1 million used to be verified: in the impostor test on 14 Sep 2026, a
    // friend at the owner's laptop during enrollment sent Rp 10,000 twice without being asked
    // anything. An amount limit is not a safeguard - the impostor just splits the transfer.
    if (r.level === 'UNKNOWN') needed = true;
    // A LOW from a half-built engine is not permission to move money: until the training pool
    // holds 20 pieces of evidence, Mahalanobis (weight 0.70) is muted and Isolation Forest
    // scores alone (C-46). The server applies the same rule (guard.check(money=True)).
    const st = BG.status();
    if (r.level === 'LOW' && amount > 0 && !(st && st.model && st.model.mainDetector)) needed = true;
    if (needed && !always && r.verifiedRecently && r.level !== 'HIGH' && !locked()) needed = false;
    if (!needed) return { ok: true, assessment: r };
    return verifyNow(r, label);
  }
  async function verifyNow(r, label) {
    const v = await BG.stepUp({ level: r.level === 'HIGH' ? 'HIGH' : 'MEDIUM', reason: label });
    if (v.verified) {
      lock(false);
      record({ lv: 'ok', t1: 'Verified before you ' + label, t2: (v.method === 'fallback' ? 'With a one-time code.' : 'With typing rhythm.') + ' Assessment at the time: ' + levelLabel(r.level) + '.' });
      return { ok: true, assessment: r, verification: v };
    }
    record({ lv: 'warn', t1: 'Cancelled: ' + label, t2: 'Verification not completed. Assessment at the time: ' + levelLabel(r.level) + '.' });
    return { ok: false, assessment: r, verification: v };
  }
  /**
   * gate() + the request. The server has the last word: if it answers 403 "verify first"
   * (for example the assessment changed between the two calls), the user verifies once and
   * the request is sent again. 401 = the behavior verdict ended this login on the server.
   */
  async function act(action, opts, request) {
    const g = await gate(action, opts);
    if (!g.ok) return { ok: false, cancelled: true, gate: g };
    let res = await request();
    if (res.status === 403 && res.body && res.body.verify) {
      const v = await verifyNow({ level: res.body.level || 'MEDIUM' }, (opts && opts.label) || action);
      if (!v.ok) return { ok: false, cancelled: true, gate: v };
      res = await request();
    }
    if (res.status === 401) { endSession(); return { ok: false, ended: true }; }
    return res;
  }
  const levelLabel = lv => ({ LOW: 'normal', MEDIUM: 'unusual', HIGH: 'very unusual', UNKNOWN: 'not enough evidence yet' }[lv] || lv);

  // ------------------------------------------------------------------ 4. fallback code
  // Arunika's SERVER sends the code and checks it (/api/otp/send, /api/otp/verify). When the
  // code is right, the server itself tells BehaviorGuard (guard.report_verified); returning
  // true from here is not enough - the library asks the server whether it happened.
  // Note `ctx.why`: the library says WHY the fallback is used, and that reason is shown.
  const FALLBACK_REASON = {
    'no-template': 'Typing-rhythm verification is not set up for this account yet.',
    'rhythm-locked': 'Typing rhythm failed several times in a row, so that path is locked for now.',
    'user-choice': 'You chose another method.',
    'library-not-loaded': 'Behavior checks are not running on this page.',
  };
  function verifyCode(ctx) {
    return new Promise(resolve => {
      let timer = null, left = 0, poll = null, seen = -1, sms = null, busy = false;
      const d = A.dialog(`<div data-bg-mfa>
        <h2>Enter the verification code</h2>
        <p class="sub">${A.esc(FALLBACK_REASON[(ctx && ctx.why) || ''] || 'We need to make sure this is you.')}
        We sent a 6-digit code to <b style="white-space:nowrap" id="otp-to">your registered number</b>. It is valid for 5 minutes.</p>
        <div class="otp" role="group" aria-label="6-digit code">${'<input inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="digit">'.repeat(6)}</div>
        <div class="err" id="otp-err" role="alert"></div>
        <p class="small muted" id="otp-demo" style="margin-top:8px"></p>
        <div class="acts"><button class="btn btn-ghost btn-sm" data-ulang disabled>Resend</button><span style="flex:1"></span>
          <button class="btn" data-x>Cancel</button><button class="btn btn-pri" data-y>Verify</button></div></div>`);
      const box = [...d.el.querySelectorAll('.otp input')];
      const err = d.el.querySelector('#otp-err');
      const resend = d.el.querySelector('[data-ulang]');
      // DEMO: the code goes to the account's simulated phone. Only the browser that created
      // the account holds the phone's key; a second laptop with the stolen password does not.
      const key = A.phoneKey(s.email);
      d.el.querySelector('#otp-demo').innerHTML = key
        ? 'Demo: the SMS appears in the corner, because this browser holds the account\'s phone. <a href="phone.html#' + encodeURIComponent(key) + '" target="_blank" rel="noopener">Open the phone</a>'
        : 'Demo: the code goes to the account owner\'s phone, which this browser does not have.';
      const phone = after => A.api('/api/demo/phone?k=' + encodeURIComponent(key) + '&after=' + Math.max(0, after));
      const watchPhone = () => {
        if (!key) return;
        clearInterval(poll);
        poll = setInterval(async () => {
          const r = await phone(seen);
          for (const m of (r.ok && r.body.messages) || []) {
            seen = Math.max(seen, m.id);
            if (sms) sms.remove();
            sms = A.toast(A.esc(m.text).replace(/(\d{6})/, '<span class="code">$1</span>'), { kind: 'sms', label: 'New message · just now', ms: 60000 });
          }
        }, 1000);
      };
      const send = async () => {
        if (key && seen < 0) { const r0 = await phone(0); seen = 0; for (const m of (r0.ok && r0.body.messages) || []) seen = Math.max(seen, m.id); }
        const r = await A.api('/api/otp/send', {});
        if (!r.ok) { err.textContent = r.status === 401 ? 'You are logged out.' : 'The code could not be sent. Try again.'; return; }
        d.el.querySelector('#otp-to').textContent = r.body.to;
        watchPhone();
        left = 30; resend.disabled = true;
        clearInterval(timer);
        timer = setInterval(() => { left--; resend.textContent = left > 0 ? `Resend (${left})` : 'Resend'; if (left <= 0) { resend.disabled = false; clearInterval(timer); } }, 1000);
      };
      const finish = ok => { clearInterval(timer); clearInterval(poll); if (sms) sms.remove(); d.close(); resolve(ok); };
      const value = () => box.map(i => i.value).join('');
      const check = async () => {
        if (busy) return;
        if (value().length < 6) { err.textContent = 'Enter all 6 digits.'; return; }
        busy = true; err.textContent = 'Checking';
        const r = await A.api('/api/otp/verify', { code: value() });
        busy = false;
        if (r.ok && r.body.ok) return finish(true);
        err.textContent = (r.body && r.body.error) || 'The code could not be checked.';
        if (r.body && r.body.exhausted) { setTimeout(() => finish(false), 900); return; }
        box.forEach(i => { i.value = ''; }); box[0].focus();
      };
      box.forEach((inp, i) => {
        inp.addEventListener('input', () => {
          // several digits at once (a phone's one-time-code autofill): spread them over the boxes
          const got = inp.value.replace(/\D/g, '');
          if (got.length > 1) {
            got.slice(0, 6 - i).split('').forEach((c, j) => { box[i + j].value = c; });
            box[Math.min(5, i + got.length)].focus();
            if (value().length === 6) check();
            return;
          }
          inp.value = got;
          if (inp.value && i < 5) box[i + 1].focus();
          if (value().length === 6) check();
        });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Backspace' && !inp.value && i > 0) box[i - 1].focus();
          if (e.key === 'Enter') check();
          if (e.key === 'Escape') finish(false);
        });
        inp.addEventListener('paste', e => {
          const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
          if (!t) return;
          e.preventDefault();
          t.split('').forEach((c, j) => { if (box[j]) box[j].value = c; });
          if (t.length === 6) check();
        });
      });
      d.el.querySelector('[data-x]').onclick = () => finish(false);
      d.el.querySelector('[data-y]').onclick = check;
      resend.onclick = send;
      send();
      box[0].focus();
    });
  }

  // ------------------------------------------------------------------ status for the pages
  function status() {
    const st = BG.status();
    return st ? { ...st, locked: locked(), fast: FAST } : null;
  }
  function onChange(fn) {
    const run = () => { try { fn(status()); } catch (e) { console.error(e); } };
    ready.then(run);
    BG.on('risk', () => setTimeout(run, 0));
  }

  document.addEventListener('DOMContentLoaded', showBanner);
  if (document.readyState !== 'loading') showBanner();

  // the account can change from another laptop: refresh the server's view every few seconds
  ready.then(() => setInterval(() => { if (!document.hidden && BG._instance && BG._instance.remote) BG._instance._remoteSync().catch(() => {}); }, 5000));

  window.Guard = { ready, gate, act, status, onChange, explain, log: () => LOG, record, levelLabel, verifyCode };
})();
