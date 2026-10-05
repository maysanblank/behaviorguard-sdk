/*
  plug-behaviorguard.js - ONE file that plugs BehaviorGuard into a site's pages.

  Put it in the page layout, before </body>:

    <script src="plug-behaviorguard.js" defer></script>

  It needs the backend part (bg_backend.py, or server/app.py plus a token route in your own
  backend). What it does, without touching the site's code:
    1. asks the site's backend for a token for the logged-in user (GET token-url)
    2. loads behaviorguard.js and starts it in BACKEND mode: 34 summary numbers per window go
       to the site's server, which keeps the profile and decides
    3. before a guarded button (data-checkout) does its work, takes a fresh assessment on the
       server (assessNow)
    4. when the site's server answers "verify first" (403), shows the verification, then
       sends the same request again; "session ended" (401) logs the user out
    5. a site without MFA gets a fallback: a one-time code to the account's email (or, weaker,
       the password again), sent and checked by the SERVER
    6. a floating status badge (learning -> normal / unusual / not the owner)

  The decision is the server's. This file only makes the page cooperate with it: a script
  that skips it and calls the protected route directly still gets 403.

  Options on the script tag (defaults on the right):
    data-token-url   route that signs the token       /api/bg-token
    data-code-url    route that sends a code          /api/bg-code  (+ /verify)
    data-reauth-url  route that checks the password   /api/bg-reauth
    data-lib         where behaviorguard.js is        /dist/behaviorguard.js
    data-gate        selector of guarded buttons      [data-checkout]
    data-badge       "off" hides the badge
    data-rhythm      "on" also offers typing-rhythm verification (set up once, then main method)

  An element of the page marked data-bg-label (the store's "plain site" tag here) is
  relabelled so a screenshot shows the protection is on.
*/
(() => {
  const ds = (document.currentScript || {}).dataset || {};
  const URL_TOKEN = ds.tokenUrl || "/api/bg-token";
  const URL_REAUTH = ds.reauthUrl || "/api/bg-reauth";
  const URL_CODE = ds.codeUrl || "/api/bg-code";
  const URL_LIB = ds.lib || "/dist/behaviorguard.js";
  const GATE = ds.gate || "[data-checkout]";
  const relabel = () => document.querySelectorAll("[data-bg-label]").forEach(el => {
    el.textContent = "BehaviorGuard installed - the store's server decides";
    el.style.cssText = "color:#065f46;background:#ecfdf5;border-color:#a7f3d0";
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", relabel); else relabel();

  // Laravel and others refuse a POST without a CSRF token: send it if the page has one
  const csrf = document.querySelector('meta[name="csrf-token"]');
  const postHeaders = { "Content-Type": "application/json" };
  if (csrf) postHeaders["X-CSRF-TOKEN"] = csrf.content;
  const realFetch = window.fetch.bind(window);

  const loadScript = src => new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => no(new Error("could not load " + src));
    document.head.appendChild(s);
  });
  const el = (tag, css, text) => { const e = document.createElement(tag); if (css) e.style.cssText = css; if (text) e.textContent = text; return e; };

  // ---------- 5. fallbacks, checked by the SERVER (never by this page) ----------
  // ask({title, sub, type, placeholder, onOpen, submit(value) -> {ok, error, done}})
  function ask(o) {
    return new Promise(done => {
      const shade = el("div", "position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;font:15px system-ui,Segoe UI,sans-serif");
      shade.setAttribute("data-bg-mfa", "");
      const card = el("div", "background:#fff;border-radius:14px;padding:22px;width:min(380px,92vw);box-shadow:0 20px 50px rgba(0,0,0,.3);color:#111827");
      const title = el("b", "display:block;font-size:17px;margin-bottom:6px", o.title);
      const sub = el("div", "color:#6b7280;font-size:13px;margin-bottom:12px", o.sub);
      const input = el("input", "width:100%;box-sizing:border-box;padding:11px;border:1px solid #d1d5db;border-radius:9px;font-size:15px" + (o.type === "code" ? ";letter-spacing:.3em;font-family:ui-monospace,Consolas,monospace" : ""));
      input.type = o.type === "code" ? "text" : "password"; input.placeholder = o.placeholder;
      input.autocomplete = o.type === "code" ? "one-time-code" : "current-password";
      if (o.type === "code") { input.inputMode = "numeric"; input.maxLength = 6; }
      const err = el("div", "color:#b91c1c;font-size:13px;min-height:18px;margin:6px 0");
      const row = el("div", "display:flex;gap:8px;justify-content:flex-end");
      const cancel = el("button", "background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:999px;padding:9px 16px;font-weight:600;cursor:pointer", "Cancel");
      const go = el("button", "background:#0a7a63;color:#fff;border:0;border-radius:999px;padding:9px 16px;font-weight:700;cursor:pointer", "Continue");
      cancel.type = go.type = "button";
      row.append(cancel, go);
      card.append(title, sub, input, err, row);
      shade.append(card);
      document.body.append(shade);
      input.focus();
      if (o.onOpen) o.onOpen(err);
      const close = ok => { shade.remove(); done(ok); };
      cancel.onclick = () => close(false);
      const send = async () => {
        go.disabled = true;
        let r = { ok: false };
        try { r = await o.submit(input.value); } catch (e) {}
        go.disabled = false;
        if (r.ok) return close(true);
        if (r.done) { err.textContent = r.error; setTimeout(() => close(false), 900); return; }
        err.textContent = r.error || "That did not work.";
        input.value = ""; input.focus();
      };
      go.onclick = send;
      input.onkeydown = e => { if (e.key === "Enter") send(); if (e.key === "Escape") close(false); };
    });
  }
  const postJson = (url, body) => realFetch(url, { method: "POST", headers: postHeaders, credentials: "same-origin", body: JSON.stringify(body || {}) })
    .then(r => r.json().catch(() => ({}))).catch(() => ({}));
  function confirmCode() {
    return ask({
      title: "Check your email", type: "code", placeholder: "6-digit code",
      sub: "We sent a 6-digit code to this account's email address. Enter it to continue.",
      onOpen: async err => { const r = await postJson(URL_CODE); if (!r.sent) err.textContent = "The code could not be sent. Try again."; },
      submit: async v => {
        const r = await postJson(URL_CODE + "/verify", { code: v.trim() });
        if (r.ok) return { ok: true };
        if (r.expired || r.left === 0) return { done: true, error: "Too many wrong codes." };
        return { error: "Wrong code." + (r.left ? ` ${r.left} left.` : "") };
      },
    });
  }
  function confirmPassword() {
    return ask({
      title: "Confirm your password", type: "password", placeholder: "password",
      sub: "Before you continue, type your account password again.",
      submit: async v => ((await postJson(URL_REAUTH, { password: v })).ok === true ? { ok: true } : { error: "Wrong password." }),
    });
  }

  // ---------- 1-2. token, library, start ----------
  let fallback = null;                                  // "code" | "password" | null
  const start = async () => {
    let cfg = null;
    try { const r = await realFetch(URL_TOKEN, { credentials: "same-origin" }); if (r.ok) cfg = await r.json(); } catch (e) {}
    if (!cfg || !cfg.token) return false;                 // not logged in (yet)
    fallback = cfg.fallback === true ? "password" : cfg.fallback || null;
    if (!window.BehaviorGuard) {
      try { await loadScript(URL_LIB); } catch (e) { console.error("[plug] " + e.message); return false; }
    }
    const opts = { endpoint: cfg.endpoint, pk: cfg.pk, token: cfg.token, tokenUrl: URL_TOKEN };
    // The store's own check is the password. The library's typing-rhythm verification is
    // offered too when the tag says data-rhythm="on" (it then asks to set it up once).
    opts.mfa = { autoEnroll: ds.rhythm === "on" };
    if (fallback) opts.mfa.onFallback = () => (fallback === "code" ? confirmCode() : confirmPassword());
    await BehaviorGuard.init(opts);
    if (ds.badge !== "off") badge();
    console.log("[plug] BehaviorGuard on - backend mode" + (fallback ? ", fallback: " + fallback : ""));
    return true;
  };
  // Many sites log in without a page load (SPA, fetch forms): if nobody was logged in, try
  // again shortly after the user interacts, and when a guarded button is clicked.
  let ready = start(), on = false, trying = false, wait = null;
  ready.then(ok => { on = ok; });
  const retry = () => {
    if (on || trying) return ready;
    trying = true;
    ready = start();
    ready.then(ok => { on = ok; trying = false; });
    return ready;
  };
  const ensure = async () => (await ready) || retry();
  ["click", "keydown"].forEach(t => document.addEventListener(t, () => {
    if (on || wait) return;
    wait = setTimeout(() => { wait = null; retry(); }, 1500);
  }, true));

  // ---------- 6. status badge ----------
  function badge() {
    if (document.getElementById("bg-plug-badge")) return;
    const b = el("div", "position:fixed;left:12px;bottom:12px;z-index:9999;font:600 13px system-ui,Segoe UI,sans-serif;padding:10px 14px;border-radius:12px;color:#fff;background:#334155;box-shadow:0 6px 20px rgba(0,0,0,.25);display:flex;gap:8px;align-items:center;min-width:240px");
    b.id = "bg-plug-badge";
    const dot = el("span", "width:9px;height:9px;border-radius:50%;background:#94a3b8;flex:0 0 auto");
    const text = el("span");
    const mode = el("span", "margin-left:auto;font-weight:500;opacity:.8;font-size:11px");
    b.append(dot, text, mode);
    document.body.appendChild(b);
    const P = {
      learning: ["#2563eb", "BehaviorGuard: learning the owner"],
      LOW: ["#16a34a", "NORMAL - matches the owner"],
      MEDIUM: ["#d97706", "UNUSUAL - verify before paying"],
      HIGH: ["#dc2626", "NOT THE OWNER - payments held"],
      UNKNOWN: ["#64748b", "not enough evidence yet"],
    };
    const paint = () => {
      const s = BehaviorGuard.status();
      if (!s.ready) { b.remove(); return; }
      mode.textContent = s.mode === "backend" ? "server decides" : "on-device";
      if (s.phase === "learning") {
        dot.style.background = P.learning[0];
        text.textContent = `${P.learning[1]} ${s.enrollment.done}/${s.enrollment.need}`;
        return;
      }
      if (!s.lastVerdict) {                                  // profile loaded, this session not assessed yet
        dot.style.background = "#64748b"; text.textContent = "Protecting - watching this session"; return;
      }
      const lv = s.lastVerdict.level;
      const [c, label] = P[lv] || P.UNKNOWN;
      dot.style.background = c; text.textContent = label;
    };
    paint();
    setInterval(paint, 1500);
    BehaviorGuard.on("risk", paint);
  }

  // ---------- 3. a fresh assessment before a guarded button acts ----------
  // Listened to at document level (capture phase), so buttons rendered later by
  // React/Vue/SPA are covered too. The site's code is not changed.
  document.addEventListener("click", async ev => {
    const btn = ev.target instanceof Element ? ev.target.closest(GATE) : null;
    if (!btn) return;
    if (btn.dataset.bgOk === "1") { btn.dataset.bgOk = ""; return; }
    ev.preventDefault(); ev.stopImmediatePropagation();
    if (await ensure()) { try { await BehaviorGuard.assessNow(); } catch (e) {} }
    btn.dataset.bgOk = "1"; btn.click();                 // the server decides on the request itself
  }, true);

  // ---------- 4. the server's answer: verify first, or session ended ----------
  function held(level, reason) {
    const btn = document.querySelector(GATE);
    if (!btn) return;
    let box = btn.parentElement && btn.parentElement.querySelector(":scope > .bg-hold");
    if (!box) {
      box = el("div", "margin-top:12px;padding:12px 14px;border-radius:10px;background:#fef2f2;border:1px solid #fecaca;color:#991b1b;font:14px/1.5 system-ui,Segoe UI,sans-serif");
      box.className = "bg-hold";
      btn.insertAdjacentElement("afterend", box);
    }
    box.textContent = "";
    box.append(el("b", "", "Held by BehaviorGuard"), el("div", "", `Assessment ${level || "UNKNOWN"}: ${reason || "this session does not look like the account owner"}. Verification was not completed.`));
  }
  function ended() {
    const shade = el("div", "position:fixed;inset:0;z-index:10001;background:rgba(15,23,42,.6);display:flex;align-items:center;justify-content:center;font:15px system-ui,Segoe UI,sans-serif");
    const card = el("div", "background:#fff;border-radius:14px;padding:22px;width:min(400px,92vw);color:#111827");
    card.append(el("b", "display:block;font-size:17px;margin-bottom:6px", "Session ended"),
      el("div", "color:#4b5563;font-size:14px", "The way this account was being used did not match its owner. You have been logged out."));
    shade.append(card);
    document.body.append(shade);
    setTimeout(() => location.reload(), 3500);
  }
  window.fetch = async (input, init) => {
    let res = await realFetch(input, init);
    // not started yet and the page just talked to its server (a log-in without a page load?)
    if (!on && res.ok) { clearTimeout(wait); wait = setTimeout(() => { wait = null; retry(); }, 300); }
    if (res.status !== 403 && res.status !== 401) return res;
    let body = null;
    try { body = await res.clone().json(); } catch (e) { return res; }
    if (res.status === 401 && body && body.ended) { ended(); return res; }
    if (!(body && body.verify)) return res;
    let ok = false;
    if (await ensure()) ok = (await BehaviorGuard.stepUp({ level: body.level === "HIGH" ? "HIGH" : "MEDIUM", reason: "complete this payment" })).verified;
    else if (fallback) ok = await (fallback === "code" ? confirmCode() : confirmPassword());   // the library did not load
    if (!ok) { held(body.level, body.reason); return res; }
    const box = document.querySelector(".bg-hold");
    if (box) box.remove();
    return realFetch(input, init);                         // same request, now with a verification on the server
  };
})();
