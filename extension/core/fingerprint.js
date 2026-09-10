/**
 * fingerprint.js - device fingerprint ringan (canvas +UA +screen +tz)
 * Tanpa backend, untuk anti ganti-profile
 */
export async function getFingerprint(){
  // B2: `screen.width x screen.height` DULU ikut jadi sidik. Colok monitor eksternal
  // -> sidik berubah -> behaviorguard.js memaksa lastRisk='MEDIUM', dan lantai lengket
  // menahannya sampai tiga sesi LOW berturut. Colok monitor bukan ganti perangkat.
  // Resolusi adalah KONTEKS (ia menggeser skala kecepatan, lihat A2), bukan identitas
  // mesin — jadi ia keluar dari sini dan ditangani sebagai konteks.
  const parts=[
    navigator.userAgent,
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
  const buf=await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,32);
}
