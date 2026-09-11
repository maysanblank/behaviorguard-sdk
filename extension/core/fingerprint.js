/**
 * fingerprint.js - device fingerprint ringan (canvas +UA +screen +tz)
 * Tanpa backend, untuk anti ganti-profile
 */
export const FP_VERSION=2;
export function normalizeUA(ua){
  return String(ua||'').replace(/\d+([._]\d+)*/g,'').replace(/\s+/g,' ').trim();
}
export async function getFingerprint(){
  // B2: `screen.width x screen.height` DULU ikut jadi sidik. Colok monitor eksternal
  // -> sidik berubah -> behaviorguard.js memaksa lastRisk='MEDIUM', dan lantai lengket
  // menahannya sampai tiga sesi LOW berturut. Colok monitor bukan ganti perangkat.
  // Resolusi adalah KONTEKS (ia menggeser skala kecepatan, lihat A2), bukan identitas
  // mesin — jadi ia keluar dari sini dan ditangani sebagai konteks.
  // C-36: `userAgent` DULU ikut utuh, lengkap dengan nomor versi. Chrome/Edge/Firefox
  // naik versi mayor ~tiap 4 minggu lewat pembaruan otomatis -> sidik berubah -> pemilik
  // dipaksa MEDIUM + lantai lengket sebulan sekali, padahal perangkatnya sama persis.
  // Versi bukan identitas mesin; keluarga browser + OS-nya yang identitas. Angka dibuang.
  const parts=[
    normalizeUA(navigator.userAgent),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.language,
    String(screen.colorDepth)
  ];
  // canvas
  try{
    const c=document.createElement('canvas');
    c.width=200; c.height=50;
    const ctx=c.getContext('2d');
    ctx.textBaseline='top'; ctx.font='14px Arial';
    ctx.fillStyle='#f60'; ctx.fillRect(0,0,200,50);
    ctx.fillStyle='#069'; ctx.fillText(parts.join('|').slice(0,120), 2,2);
    parts.push(c.toDataURL().slice(-64));
  }catch{}
  const raw=parts.join('||');
  // C-45: di http (bukan konteks aman) crypto.subtle tidak ada. Dulu sidiknya jadi
  // 'unknown' untuk semua orang -> ganti perangkat tak pernah terdeteksi. Sidik bukan
  // rahasia, jadi hash non-kriptografis (FNV-1a 2x32 bit) cukup untuk membedakan perangkat.
  if(!(globalThis.crypto && globalThis.crypto.subtle)){
    let h1=0x811c9dc5, h2=0x01000193 ^ raw.length;
    for(let i=0;i<raw.length;i++){ const c=raw.charCodeAt(i); h1=Math.imul(h1^c, 16777619)>>>0; h2=Math.imul(h2^c, 2246822507)>>>0; }
    return (h1.toString(16).padStart(8,'0')+h2.toString(16).padStart(8,'0')).repeat(2);
  }
  const buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
}
