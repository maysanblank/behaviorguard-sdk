/**
 * content.js - the extension's on-device capture, using the SAME capture.js as the SDK.
 *
 * C-41: the old version used a HAND-COPIED capture in this file: it stored the REAL
 * characters typed (passwords on any site - this extension runs on <all_urls>), had no
 * velocity (C-16), did not ignore the MFA popup, and background.js saved the raw buffer to
 * chrome.storage.local. Now capture.js is loaded as is (per-page tokens, C-30), so
 * characters never leave this page.
 *
 * Scoring in background.js uses the real BehaviorGuard orchestrator, one model per origin.
 */
(async () => {
  if (window.__bgInjected) return; window.__bgInjected = true;
  let createCapture;
  try {
    ({ createCapture } = await import(chrome.runtime.getURL('core/capture.js')));
  } catch (e) { console.warn('[BG] capture did not load', e); return; }

  const cap = createCapture(() => {});
  cap.attach();
  const WINDOW_MS = 30000;          // = session.windowSec: the same rhythm as the SDK

  const flush = () => {
    const batch = cap.drain();
    if (!batch.length) return;
    chrome.runtime.sendMessage({ type: 'BG_EVENTS', origin: location.origin, events: batch }, resp => {
      if (chrome.runtime.lastError || !resp || !resp.evt) return;
      window.dispatchEvent(new CustomEvent('BG_RISK', { detail: resp.evt }));
      notice(resp.evt);
    });
  };
  setInterval(flush, WINDOW_MS);
  // pagehide: send what is left once; background.js collects it across pages
  window.addEventListener('pagehide', flush);

  // C-41: the HIGH lock screen used to have an "I am the owner" button that closed it with
  // one CLICK - verification anyone could skip. The extension has no real step-up path, so
  // the honest response is a NOTICE, not a fake lock.
  function notice(evt) {
    if (evt.level !== 'HIGH' || document.getElementById('__bg_notice')) return;
    const el = document.createElement('div');
    el.id = '__bg_notice';
    el.style.cssText = 'position:fixed;right:16px;bottom:16px;max-width:360px;background:#111827;color:#f9fafb;' +
      'padding:14px 16px;border-radius:10px;z-index:2147483647;font:13px/1.45 system-ui;box-shadow:0 8px 24px rgba(0,0,0,.35)';
    const reason = (evt.reasons || [])[0] || '';
    el.textContent = 'BehaviorGuard: behavior on this site does not match the usual pattern. ' +
      'If this is not you, log out and change your password. ' + (reason ? '(' + reason + ')' : '');
    const x = document.createElement('button');
    x.textContent = 'Close';
    x.style.cssText = 'margin-left:10px;padding:4px 10px;border-radius:6px;border:0;background:#374151;color:#fff;cursor:pointer';
    x.onclick = () => el.remove();
    el.appendChild(x);
    document.body.appendChild(el);
  }
})();
