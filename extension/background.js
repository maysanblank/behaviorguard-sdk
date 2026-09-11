/**
 * background.js - MV3 service worker: penilaian on-device dengan orkestrator ASLI.
 *
 * C-41: versi lama adalah mesin salinan-tangan yang basi — centroid-OCSVM, bobot IF 0,70
 * (terbalik dari DEFAULTS), ambang kuantil, satu baseline campuran SEMUA situs, dan buffer
 * event mentah (berisi karakter ketikan) disimpan ke chrome.storage.local. Orkestrator
 * yang disinkron oleh tools/sync_core.ps1 (C-9) tidak pernah dipakainya.
 *
 * Kini: satu BehaviorGuard per origin (perilaku di bank dan di forum berbeda — mencampurnya
 * melebarkan baseline untuk keduanya). Event datang dari content.js sudah ditokenisasi;
 * buffer tiruan + endSession() memakai jalur penilaian SDK yang sama persis (kompresi,
 * dedup, integritas, bukti >= minEventsAssess, carry-back ekor). State per origin
 * disimpan storage.js (IndexedDB tersedia di service worker). MFA popup tidak ada di
 * service worker, jadi vonis dikembalikan ke halaman sebagai pemberitahuan.
 */
import { BehaviorGuard } from './behaviorguard.js';

const guards = new Map();     // origin -> BehaviorGuard

async function guardFor(origin) {
  let g = guards.get(origin);
  if (g) return g;
  g = new BehaviorGuard();
  await g.init({ userId: 'ext:' + origin, mfa: { enabled: false } });
  try { clearInterval(g._autoTimer); } catch {}
  const buf = [];
  g.capture = { buffer: buf, drain() { const c = buf.slice(); buf.length = 0; return c; }, peek() { return buf.slice(); } };
  guards.set(origin, g);
  return g;
}

function badge(level) {
  try {
    const text = level === 'LOW' ? 'OK' : level === 'MEDIUM' ? '!' : level === 'HIGH' ? 'X' : '';
    const color = level === 'LOW' ? '#16a34a' : level === 'MEDIUM' ? '#d97706' : '#dc2626';
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color });
  } catch {}
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (msg.type === 'GET_STATE' && msg.origin) {
      const g = await guardFor(msg.origin);
      const enrolled = g.sessions.filter(x => x.eligible !== false).length;
      sendResponse({ ok: true, origin: msg.origin, lastRisk: g.lastRisk, enrolled: Math.min(enrolled, g.cfg.baseline),
        baseline: g.cfg.baseline, buffered: g.capture.buffer.length, need: g.cfg.session.minEventsAssess });
      return;
    }
    if (msg.type !== 'BG_EVENTS' || !Array.isArray(msg.events) || !msg.origin) { sendResponse({ ok: false }); return; }
    const g = await guardFor(msg.origin);
    let last = null;
    g.onRisk = e => { if (!e.abstain) last = e; };
    g.capture.buffer.push(...msg.events);
    await g.endSession();
    if (last) {
      badge(last.level);
      if (last.level === 'HIGH') {
        try {
          chrome.notifications.create({ type: 'basic', iconUrl: 'icons/icon128.png', title: 'BehaviorGuard',
            message: `Perilaku tidak dikenali di ${msg.origin}`, priority: 2 });
        } catch {}
      }
    }
    sendResponse({ ok: true, evt: last ? { level: last.level, score: last.score, action: last.action,
      reasons: last.reasons, enrollment: last.enrollment || null } : null });
  })();
  return true;
});

// menjaga service worker; tak ada kerja lain
chrome.alarms.create('health', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(() => {});
