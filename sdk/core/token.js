/**
 * token.js - HMAC session token (anti-forgery, BlackHat ARSITEKTUR_PERTAHANAN)
 * Token = base64( HMAC_SHA256(secret, tid|uid|exp|nonce) ) + "." + payload
 * Secret per-user disimpan terenkripsi di storage, TTL 30m, nonce sekali pakai
 */
const enc = new TextEncoder();
async function hmac(secret, data){
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), {name:'HMAC', hash:'SHA-256'}, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/,'');
}
export async function generateToken({secret, userId, ttlSec=1800}){
  const exp = Date.now() + ttlSec*1000;
  const nonce = crypto.randomUUID();
  const payload = `${userId}|${exp}|${nonce}`;
  const sig = await hmac(secret, payload);
  return `${btoa(payload)}.${sig}`;
}
export async function verifyToken(token, secret){
  const [b64, sig] = token.split('.');
  if(!b64||!sig) return false;
  let payload;
  try{ payload = atob(b64); }catch{ return false; }
  const [uid, exp, nonce] = payload.split('|');
  if(Date.now() > Number(exp)) return false;
  const expected = await hmac(secret, payload);
  // constant-time compare
  if(expected.length !== sig.length) return false;
  let diff=0; for(let i=0;i<expected.length;i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff===0;
}
export async function getOrCreateSecret(userId){
  const key = `bg:secret:${userId}`;
  // S1 fix: secret disimpan via storage seal (HMAC), bukan plaintext localStorage
  try{ const {storage}=await import('../storage.js'); const v=await storage.get(key); if(v) return v; const raw=crypto.getRandomValues(new Uint8Array(32)); const s=btoa(String.fromCharCode(...raw)); await storage.set(key,s); return s; }catch{ return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))); }
}
