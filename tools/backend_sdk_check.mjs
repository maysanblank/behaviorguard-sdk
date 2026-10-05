/**
 * backend_sdk_check.mjs - the browser library in backend mode against a real server.
 *
 * Started by server/test_backend_sdk.py, which runs server/app.py on a free port and passes
 * BG_URL, BG_PK, BG_SK. Everything goes over HTTP exactly as in a browser: the SDK's own
 * capture-to-window path (scoreExternalEvents), assessNow(), stepUp() with the site's
 * fallback, reportStepUp(), status(), token refresh and an unreachable backend.
 */
import crypto from 'node:crypto';
globalThis.window = new EventTarget();
(await import('node:events')).setMaxListeners(100, globalThis.window);
globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
const mem = new Map();
globalThis.localStorage = { getItem: k => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k), key: i => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
console.warn = () => {};

const { BehaviorGuard } = await import('../sdk/behaviorguard.js');
const { storage } = await import('../sdk/storage.js');
const URL = process.env.BG_URL, PK = process.env.BG_PK, SK = process.env.BG_SK;

const results = [];
const check = (name, cond, note) => results.push({ name, ok: !!cond, note });

const b64u = s => Buffer.from(s).toString('base64url');
function mint(user, sid, ttl = 3600) {
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const sig = crypto.createHmac('sha256', SK).update(`${PK}|${user}|${sid}|${exp}`).digest('hex');
  return `${b64u(user)}.${b64u(sid)}.${exp}.${sig}`;
}
async function report(user, sid, passed = true) {
  const r = await fetch(URL + '/v1/report', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + SK },
    body: JSON.stringify({ userId: user, sessionId: sid, passed }) });
  return r.json();
}

let seed = 11;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
let T = Date.now() - 6 * 3600_000;
function burst(kind = 'owner', n = 170) {
  const ev = [];
  const hold = kind === 'owner' ? [60, 50] : [150, 120], gap = kind === 'owner' ? [60, 90] : [220, 300];
  for (let i = 0; i < n; i++) {
    T += gap[0] + Math.floor(rnd() * gap[1]);
    const r = i % 12;
    if (r === 0) ev.push({ event_type: 'MOUSE_CLICK', x: 120 + rnd() * 300, y: 100 + rnd() * 200, timestamp: T });
    else if (r === 1) ev.push({ event_type: 'MOUSE_SCROLL', scroll_delta: (kind === 'owner' ? 40 : 300) + rnd() * 120, timestamp: T });
    else if (r === 2) ev.push({ event_type: 'FORM_FOCUS', timestamp: T });
    else if (r === 3) ev.push({ event_type: 'FORM_BLUR', timestamp: T });
    else if (r % 2 === 1) ev.push({ event_type: 'KEYSTROKE', key: 'k' + (i % 7), hold_time: hold[0] + rnd() * hold[1], timestamp: T });
    else ev.push({ event_type: 'MOUSE_MOVE', x: 120 + rnd() * 300, y: 100 + rnd() * 200,
      velocity: kind === 'owner' ? 0.15 + rnd() * 2.5 : 3 + rnd() * 6, timestamp: T });
  }
  T += 20 * 60_000;
  return ev;
}
const USER = 'andi@example.com';

async function guardFor(sid, extra = {}) {
  const g = new BehaviorGuard();
  await g.init({ endpoint: URL, pk: PK, token: mint(USER, sid), mfa: { enabled: false }, session: { minEventsAssess: 150 }, ...extra });
  g._stopTimer();
  return g;
}

// A. enrollment over HTTP; nothing about the account is stored in this browser
const g1 = await guardFor('laptop-A');
check('A: init in backend mode, user id read from the token', g1.status().mode === 'backend' && g1.userId === USER, g1.userId);
let evt;
for (let i = 0; i < 10; i++) evt = await g1.scoreExternalEvents(burst('owner'));
check('A: 10 windows over HTTP build the profile on the server', g1.status().phase === 'protecting' && g1.status().enrollment.done === 10,
  JSON.stringify(g1.status().enrollment));
check('A: enrollment events keep both field names', evt && evt.enrollment && evt.enrollment.done === 10 && evt.enrollment.selesai === 10);
check('A: no profile in this browser\'s storage', !(await storage.get('bg:' + USER)) && g1.sessions.length === 0);
// MEDIUM windows never train, so it can take more than 10 more windows to reach 20
for (let i = 0; i < 30 && !g1.status().model.mainDetector; i++) evt = await g1.scoreExternalEvents(burst('owner'));
check('A: the owner keeps getting verdicts from the server', ['LOW', 'MEDIUM'].includes(evt.level) && Number.isInteger(evt.windowId), evt.level);
check('A: main detector on after 20 training windows', g1.status().model.mainDetector === true, JSON.stringify(g1.status().model));

// B. another laptop, same account: the profile is already there
const g2 = await guardFor('laptop-B');
check('B: a new login on another device starts PROTECTED, not learning', g2.status().phase === 'protecting', g2.status().phase);
const a1 = await g2.scoreExternalEvents(burst('stranger'));
const a2 = await g2.scoreExternalEvents(burst('stranger'));
check('B: a stranger is HIGH from the first window', a1.level === 'HIGH', a1.level);
check('B: two HIGH in a row end the session', a2.action === 'BLOCK_SESSION' && a2.blocked === true, a2.action);
g2.capture.buffer.push(...burst('stranger', 60));
const p = g2.assessNow();
check('B: assessNow() returns a Promise in backend mode', p && typeof p.then === 'function');
const pv = await p;
check('B: assessNow() verdict comes from the server', pv.level === 'HIGH' && pv.sensitive === true, pv.level);

// C. the browser cannot vouch for a verification
const fake = await g2.reportStepUp({ passed: true });
check('C: reportStepUp({passed:true}) from the page alone changes nothing', fake.applied === false && g2.status().risk === 'HIGH', JSON.stringify(fake));
const g3 = await guardFor('laptop-B2', { mfa: { enabled: true, onFallback: async () => true } });
const s1 = await g3.stepUp({ reason: 'test' });
check('C: onFallback returning true WITHOUT a server report is not a verification', s1.verified === false, JSON.stringify(s1));
const g4 = await guardFor('laptop-A2', { mfa: { enabled: true, onFallback: async () => { await report(USER, 'laptop-A2'); return true; } } });
const s2 = await g4.stepUp({ reason: 'test' });
check('C: onFallback + the site\'s server report = verified', s2.verified === true && s2.method === 'fallback', JSON.stringify(s2));
check('C: the verified login shows the grace period', g4.status().mfa.graceLeftSec > 800, g4.status().mfa.graceLeftSec);
check('C: the stranger\'s login did not inherit it', (await g2._remoteSync()).mfa.graceLeftSec === 0);

// D. rhythm verification is answered by the server
const v = await g1._remoteVerifier(null)({ dwell: [1, 2], flight: [1] });
check('D: no template yet -> the server says so (no local guess)', v.ok === false && v.unavailable === true, JSON.stringify(v));

// E. token refresh and an unreachable backend
let calls = 0;
const g5 = new BehaviorGuard();
await g5.init({ endpoint: URL, pk: PK, token: mint(USER, 'laptop-C', -10), getToken: async () => { calls++; return mint(USER, 'laptop-C'); }, mfa: { enabled: false } });
g5._stopTimer();
const e5 = await g5.scoreExternalEvents(burst('owner'));
check('E: an expired token is refreshed through getToken and the window still counts', calls >= 1 && !e5.offline, `${calls} ${e5.level}`);
const g6 = new BehaviorGuard();
await g6.init({ endpoint: 'http://127.0.0.1:1', pk: PK, token: mint(USER, 'laptop-D'), mfa: { enabled: false } });
g6._stopTimer();
const e6 = await g6.scoreExternalEvents(burst('owner'));
check('E: backend unreachable -> UNKNOWN / ABSTAIN, never "safe"', e6.level === 'UNKNOWN' && e6.offline === true, e6.level);
const p6 = await g6.assessNow();
check('E: assessNow() with the backend down -> UNKNOWN, verify', p6.level === 'UNKNOWN' && p6.action === 'REQUIRE_STEPUP');

// F. what crossed the wire
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (u, o) => { sent.push(o && o.body ? String(o.body) : ''); return realFetch(u, o); };
await g1.scoreExternalEvents(burst('owner'));
globalThis.fetch = realFetch;
const body = JSON.parse(sent.find(b => b.includes('vector')) || '{}');
check('F: a window carries 34 numbers and counts only (no events, no keys)',
  Array.isArray(body.vector) && body.vector.length === 34 && !('events' in body && Array.isArray(body.events)) &&
  !sent.some(b => /KEYSTROKE|"key"|timestamp/.test(b)), Object.keys(body).join(','));
for (const g of [g1, g2, g3, g4, g5, g6]) { try { await g.stop(); } catch {} }

const failed = results.filter(r => !r.ok);
console.log('\nBACKEND MODE - SDK against the server over HTTP');
for (const r of results) console.log(`  ${r.ok ? 'OK  ' : 'FAIL'} ${r.name}` + (r.note != null && !r.ok ? `  [${r.note}]` : ''));
console.log(`\n  passed ${results.length - failed.length} / ${results.length}\n  RESULT: ${failed.length ? 'FAIL' : 'PASS'}`);
process.exit(failed.length ? 1 : 0);
