/**
 * ratelimit.js - token bucket per-user (120/min collect, 60/min score) - copy server RATE_LIMIT
 */
const buckets=new Map();
export function allow(key, perMin){
  const now=Date.now();
  const b=buckets.get(key) || {tokens: perMin, last: now};
  const elapsed=(now-b.last)/60000;
  b.tokens=Math.min(perMin, b.tokens + elapsed*perMin);
  b.last=now;
  if(b.tokens < 1) { buckets.set(key,b); return false; }
  b.tokens-=1; buckets.set(key,b); return true;
}
export function checkCollect(userId){
  if(!allow(`collect:${userId}`, 120)) return {allowed:false, reason:'rate limit collect 120/min'};
  if(!allow(`score:${userId}`, 60)) return {allowed:false, reason:'rate limit score 60/min'};
  return {allowed:true};
}
