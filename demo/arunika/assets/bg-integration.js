/*
 * bg-integration.js - the ONLY file the site owner writes to install BehaviorGuard.
 *
 * The Arunika site (app.js and its pages) existed before the library was installed. This file
 * adds four things, and no other line of application code changes:
 *   1. start the library after login               -> BehaviorGuard.init({ userId })
 *   2. respond to verdicts                         -> onRisk: record, lock, or end the session
 *   3. gate sensitive actions (transfer, password) -> assessNow(), then stepUp() when needed
 *   4. a FALLBACK verification path (one-time code) -> mfa.onFallback
 *
 * THE ORDER MATTERS, and is often misread. The MAIN verification here is not a one-time code
 * but BEHAVIOR: the LIBRARY's "type the phrase" dialog, which matches typing rhythm (how long
 * each key is held, the gaps between keys) against the owner's rhythm stored on this device.
 * The one-time code only appears when that path cannot be used: the owner has not set up a
 * rhythm yet, is on a different keyboard than at enrollment, or pressed "Use another method".
 * It is the way OUT, not the front door - without it, an owner who fails the rhythm check
 * would have no option but to be blocked.
 *
 * The code dialog below belongs to the SITE. In production the code is sent AND checked by
 * your server; `onFallback` may only return true once the server has said the code is right.
 */
(function () {
  'use strict';
  const A = window.Arunika;
  const s = A && A.sesi();
  const BG = window.BehaviorGuard;
  const LOG_KEY = s ? 'arunika:log:' + s.email : '';
  const LOCK_KEY = 'arunika:terkunci';          // per tab: sensitive actions locked until verified
  const FAST = localStorage.getItem('arunika:mode-cepat') === '1';

  if (!s || !BG) {
    // The library failed to load (blocked by an extension, CDN down, wrong path): FAIL CLOSED.
    // Without behavioral assessment every sensitive action is treated as "not verified" and
    // goes through the one-time code. Never let a sensitive action through just because the
    // security script is missing.
    if (s && !BG) console.warn('[Arunika] BehaviorGuard did not load - sensitive actions use a one-time code');
    window.Guard = {
      ready: Promise.resolve(),
      gate: async () => (s ? { ok: await verifyCode({ why: 'library-not-loaded' }), assessment: { level: 'UNKNOWN' } } : { ok: false }),
      status: () => null, onChange: () => {}, log: () => [], explain: () => [], record: () => {},
      levelLabel: lv => lv,
    };
    return;
  }

  // ------------------------------------------------------------------ 1. init
  const options = {
    userId: s.email,
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

  function record(entry) {
    const log = A.baca(LOG_KEY, []);
    log.unshift({ t: Date.now(), ...entry });
    A.tulis(LOG_KEY, log.slice(0, 60));
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
        record({ lv: 'info', t1: 'Behavior profile built', t2: 'From now on, activity on this device is assessed against your habits.' });
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
    const r = BG.assessNow();
    const always = action === 'ganti-sandi';
    let needed = always || locked() || r.level === 'MEDIUM' || r.level === 'HIGH';
    // UNKNOWN = nothing to compare against yet, or not enough evidence on this page. Only
    // amounts >= Rp 1 million used to be verified: in the impostor test on 14 Sep 2026, a
    // friend at the owner's laptop during enrollment sent Rp 10,000 twice without being asked
    // anything. An amount limit is not a safeguard - the impostor just splits the transfer.
    if (r.level === 'UNKNOWN') needed = true;
    // A LOW from a half-built engine is not permission to move money: until the training pool
    // holds 20 pieces of evidence, Mahalanobis (weight 0.70) is muted and Isolation Forest
    // scores alone (C-46). The 15-minute verification grace keeps the owner from being asked
    // over and over.
    const st = BG.status();
    if (r.level === 'LOW' && amount > 0 && !(st && st.model && st.model.mainDetector)) needed = true;
    if (needed && !always && r.verifiedRecently && r.level !== 'HIGH' && !locked()) needed = false;
    if (!needed) return { ok: true, assessment: r };
    const v = await BG.stepUp({ level: r.level === 'HIGH' ? 'HIGH' : 'MEDIUM', reason: label });
    if (v.verified) {
      lock(false);
      record({ lv: 'ok', t1: 'Verified before you ' + label, t2: (v.method === 'fallback' ? 'With a one-time code.' : 'With typing rhythm.') + ' Assessment at the time: ' + levelLabel(r.level) + '.' });
      return { ok: true, assessment: r, verification: v };
    }
    record({ lv: 'warn', t1: 'Cancelled: ' + label, t2: 'Verification not completed. Assessment at the time: ' + levelLabel(r.level) + '.' });
    return { ok: false, assessment: r, verification: v };
  }
  const levelLabel = lv => ({ LOW: 'normal', MEDIUM: 'unusual', HIGH: 'very unusual', UNKNOWN: 'not enough evidence yet' }[lv] || lv);

  // ------------------------------------------------------------------ 4. fallback code
  // In production: the server sends the code (SMS/email/authenticator) AND checks it, then
  // returns true/false. In the demo the code is "sent" as a notification in the corner.
  // Note `ctx.why` - the library says WHY the fallback is used, and that reason is shown to
  // the user. Without it the code dialog appears for no visible reason.
  const FALLBACK_REASON = {
    'no-template': 'Typing-rhythm verification is not set up on this device.',
    'rhythm-locked': 'Typing rhythm failed several times in a row, so that path is locked for now.',
    'user-choice': 'You chose another method.',
    'library-not-loaded': 'Behavior checks are not running on this page.',
  };
  function verifyCode(ctx) {
    return new Promise(resolve => {
      const a = A.akun();
      const phone = a ? a.hp.replace(/(\+62 \d{3})-(\d{4})-(\d{2})(\d{2})/, '$1-••••-••$4') : 'your registered number';
      let code = '', wrong = 0, sms = null, timer = null, left = 0;
      const d = A.dialog(`<div data-bg-mfa>
        <h2>Enter the verification code</h2>
        <p class="sub">${A.esc(FALLBACK_REASON[(ctx && ctx.why) || ''] || 'We need to make sure this is you.')}
        We sent a 6-digit code to <b style="white-space:nowrap">${A.esc(phone)}</b>. It is valid for 5 minutes.</p>
        <div class="otp" role="group" aria-label="6-digit code">${'<input inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="digit">'.repeat(6)}</div>
        <div class="err" id="otp-err" role="alert"></div>
        <div class="acts"><button class="btn btn-ghost btn-sm" data-ulang disabled>Resend</button><span style="flex:1"></span>
          <button class="btn" data-x>Cancel</button><button class="btn btn-pri" data-y>Verify</button></div></div>`);
      const box = [...d.el.querySelectorAll('.otp input')];
      const err = d.el.querySelector('#otp-err');
      const resend = d.el.querySelector('[data-ulang]');
      const send = () => {
        code = String(Math.floor(100000 + Math.random() * 900000));
        if (sms) sms.remove();
        setTimeout(() => { sms = A.toast(`ARUNIKA: Your verification code is <span class="code">${code}</span>. Never share this code with anyone, including Arunika staff.`, { kind: 'sms', label: 'New message · just now', ms: 60000 }); }, 900);
        left = 30; resend.disabled = true;
        clearInterval(timer);
        timer = setInterval(() => { left--; resend.textContent = left > 0 ? `Resend (${left})` : 'Resend'; if (left <= 0) { resend.disabled = false; clearInterval(timer); } }, 1000);
      };
      const finish = ok => { clearInterval(timer); if (sms) sms.remove(); d.close(); resolve(ok); };
      const value = () => box.map(i => i.value).join('');
      const check = () => {
        if (value().length < 6) { err.textContent = 'Enter all 6 digits.'; return; }
        if (value() === code) return finish(true);
        wrong++;
        if (wrong >= 3) { err.textContent = 'Wrong code 3 times.'; setTimeout(() => finish(false), 900); return; }
        err.textContent = `That code does not match. ${3 - wrong} attempts left.`;
        box.forEach(i => { i.value = ''; }); box[0].focus();
      };
      box.forEach((inp, i) => {
        inp.addEventListener('input', () => {
          inp.value = inp.value.replace(/\D/g, '').slice(-1);
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

  window.Guard = { ready, gate, status, onChange, explain, log: () => A.baca(LOG_KEY, []), record, levelLabel, verifyCode };
})();
