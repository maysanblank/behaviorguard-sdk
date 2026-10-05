/*
 * status.js - the site's own "Behavior protection" card, built from BehaviorGuard.status().
 * An example of an integrator showing the library's state in the site's own words.
 */
(function () {
  'use strict';
  const A = window.Arunika;
  function isi(el, st, { ringkas }) {
    if (!window.BehaviorGuard) {
      el.innerHTML = `<div class="guard warn"><div class="ico">${A.I.alert}</div><div><h3>Behavior protection is off</h3>
        <p class="small muted" style="margin-top:3px">The security component did not load in this browser. Transfers and security changes use a one-time code.</p></div></div>`;
      return;
    }
    if (!st || !st.ready) {
      el.innerHTML = `<div class="guard"><div class="ico">${A.I.shield}</div><div><h3>Starting protection</h3></div></div>`;
      return;
    }
    const e = st.lastVerdict;
    const waktu = e && e.at ? A.jam(e.at) : null;
    if (st.locked) {
      el.innerHTML = `<div class="guard warn"><div class="ico">${A.I.alert}</div><div style="flex:1">
        <h3>Verification required</h3>
        <p class="small muted" style="margin-top:3px">Activity in this session is unusual. Sensitive actions are locked until you verify.</p></div></div>`;
      return;
    }
    if (st.phase === 'learning') {
      const k = st.enrollment.done, n = st.enrollment.need;
      el.innerHTML = `<div class="guard"><div class="ico">${A.I.shield}</div><div style="flex:1;min-width:0">
        <h3>Learning how you use Arunika</h3>
        <p class="small muted" style="margin:3px 0 10px">Use it as usual. While it is learning, every transfer and payment asks you to verify first.</p>
        <div class="progress" role="progressbar" aria-valuemin="0" aria-valuemax="${n}" aria-valuenow="${k}"><i style="width:${Math.round(k / n * 100)}%"></i></div>
        <p class="small muted num" style="margin-top:6px">${k} of ${n} activities${st.fast ? ' · presentation mode' : ''}</p></div></div>`;
      return;
    }
    const grace = st.mfa.graceLeftSec > 0;
    const lv = e ? e.level : 'LOW';
    const baris = grace ? `Verified ${Math.max(1, Math.round((Date.now() - st.mfa.verifiedAt) / 60000))} min ago.`
      : waktu ? `Latest activity ${Guard.levelLabel(lv)} · assessed ${waktu}.` : 'Waiting for the first activity on this visit.';
    const mfa = st.mfa.enrolled ? '' : `<p class="small" style="margin-top:8px"><a href="security.html#irama">Set up typing-rhythm verification</a> so verifying takes your typing rhythm, not a code.</p>`;
    el.innerHTML = `<div class="guard ok"><div class="ico">${A.I.shield}</div><div style="flex:1">
      <h3>Behavior protection on</h3>
      <p class="small muted" style="margin-top:3px">${baris}</p>${ringkas ? mfa : ''}</div></div>`;
  }
  window.StatusGuard = {
    mount(el, opt = {}) {
      if (!el || !window.Guard) return;
      isi(el, null, opt);
      Guard.onChange(st => isi(el, st, opt));
      setInterval(() => isi(el, Guard.status(), opt), 3000);
    },
  };
})();
