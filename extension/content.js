/**
 * content.js - penangkap on-device untuk ekstensi, memakai capture.js YANG SAMA dengan SDK.
 *
 * C-41: versi lama memakai penangkap SALINAN-TANGAN di berkas ini: menyimpan KARAKTER ASLI
 * yang diketik (sandi di situs mana pun — ekstensi ini berjalan di <all_urls>), tanpa
 * velocity (C-16), tanpa mengabaikan popup MFA, lalu background menyimpan buffer mentahnya
 * ke chrome.storage.local. Kini capture.js dimuat apa adanya (token per-halaman, C-30),
 * jadi karakter tidak pernah meninggalkan halaman ini.
 *
 * Penilaian di background.js memakai orkestrator BehaviorGuard asli, satu model per origin.
 */
(async () => {
  if (window.__bgInjected) return; window.__bgInjected = true;
  let createCapture;
  try {
    ({ createCapture } = await import(chrome.runtime.getURL('core/capture.js')));
  } catch (e) { console.warn('[BG] capture tidak termuat', e); return; }

  const cap = createCapture(() => {});
  cap.attach();
  const WINDOW_MS = 30000;          // = session.windowSec: irama yang sama dengan SDK

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
  // pagehide: kirim sisa buffer sekali; background yang mengumpulkannya lintas halaman
  window.addEventListener('pagehide', flush);

  // C-41: dulu layar kunci HIGH punya tombol "Saya pemilik" yang cukup DIKLIK untuk
  // menutupnya — verifikasi yang bisa dilewati siapa pun. Ekstensi tidak punya jalur
  // step-up sungguhan, jadi yang jujur adalah PEMBERITAHUAN, bukan kunci palsu.
  function notice(evt) {
    if (evt.level !== 'HIGH' || document.getElementById('__bg_notice')) return;
    const el = document.createElement('div');
    el.id = '__bg_notice';
    el.style.cssText = 'position:fixed;right:16px;bottom:16px;max-width:360px;background:#111827;color:#f9fafb;' +
      'padding:14px 16px;border-radius:10px;z-index:2147483647;font:13px/1.45 system-ui;box-shadow:0 8px 24px rgba(0,0,0,.35)';
    const reason = (evt.reasons || [])[0] || '';
    el.textContent = 'BehaviorGuard: perilaku di situs ini tidak cocok dengan pola biasanya. ' +
      'Kalau ini bukan Anda, keluar dan ganti sandi. ' + (reason ? '(' + reason + ')' : '');
    const x = document.createElement('button');
    x.textContent = 'Tutup';
    x.style.cssText = 'margin-left:10px;padding:4px 10px;border-radius:6px;border:0;background:#374151;color:#fff;cursor:pointer';
    x.onclick = () => el.remove();
    el.appendChild(x);
    document.body.appendChild(el);
  }
})();
