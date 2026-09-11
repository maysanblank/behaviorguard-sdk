/**
 * idle.js — segmentasi sesi berbasis jeda idle + akuntansi waktu aktif (C-23)
 *
 * MASALAH. Fitur F4 dihitung dari SELISIH antar-event dan dari `duration` =
 * (timestamp terakhir − timestamp pertama). Kalau pengguna membuka halaman lalu
 * ditinggal — ambil minum, angkat telepon, pindah ke aplikasi lain — jeda mati itu
 * ikut masuk ke dalam statistik seolah-olah ia perilaku:
 *
 *   mouse_click_interval_mean     satu jeda 10 menit menarik rata-rata 2 dtk → 300 dtk
 *   keystroke_flight_time_mean    idem: satu selisih raksasa mendominasi mean
 *   keystroke_typing_speed        keyEv.length / duration → runtuh ke ~0
 *   keystroke_cross_field_cadence gap fokus→ketik melintasi jeda
 *   form_field_switch_rate        mean jeda antar-fokus melintasi jeda
 *   temporal_session_duration     durasi = jam, padahal interaksinya 20 detik
 *   mouse_velocity/acceleration   gerakan pertama sesudah jeda: dt raksasa → v≈0
 *
 * Model dilatih dari sesi riset berbasis-tugas yang PADAT (pengguna mengerjakan
 * skenario tanpa jeda panjang). Jadi jeda idle bukan cuma menambah derau: ia
 * menciptakan ketidakcocokan latih-vs-pakai yang sistematis — kelas cacat yang
 * sama dengan C-16/C-17, hanya sumbernya waktu, bukan field yang kosong.
 *
 * PRINSIP. Idle BUKAN perilaku, jadi ia tidak boleh diukur. Ia dipotong keluar,
 * bukan dirata-rata masuk. Aliran event dipecah pada tiap jeda ≥ `gapMs`;
 * `extractF4` hanya pernah melihat potongan yang KONTIGU. Rumus fitur di
 * core/SPEC.md tidak berubah sedikit pun — yang berubah hanya APA yang disuapkan
 * ke sana. Karena itu golden vector dan keempat port (Python/Rust/Java/WASM)
 * tetap 227/227 tanpa disentuh.
 *
 * Idle punya DUA konsekuensi berbeda, jadi ambangnya dua:
 *   gapMs  (ukur)  — jeda yang tidak boleh diukur melintasinya.        default 30 dtk
 *   awayMs (aman)  — jeda yang berarti kursinya mungkin kosong, dan orang yang
 *                    duduk sesudahnya belum tentu orang yang sama.     default 5 mnt
 * Lihat behaviorguard.js `_onCaptureEvent` / `resumedAfterAway` untuk lapis kedua.
 */

export const GAP_MS_DEFAULT  = 30_000;    // = session.windowSec: jeda sepanjang satu jendela penilaian bukan perilaku
export const AWAY_MS_DEFAULT = 300_000;   // 5 menit: batas "kursi mungkin kosong"

/**
 * B1: pisahkan event menurut ALIRAN asalnya (tab) sebelum apa pun diukur.
 *
 * Dua tab aplikasi yang sama menulis ke akumulator pending yang sama, jadi event
 * dari dua halaman berbeda — yang dipakai bergantian, saling menyela dalam waktu —
 * dulu tergabung jadi satu "sesi". Segmentasi idle tidak menolong di sini: kedua
 * aliran itu aktif BERSAMAAN, jadi tak ada jeda untuk dipotong. Yang tercipta
 * adalah orang ketiga yang tidak pernah ada: selisih antar-event melompat-lompat
 * antara dua konteks, dan tak satu pun mencerminkan perilaku siapa pun.
 *
 * Prinsipnya sama dengan C-23: kalau dua pengukuran datang dari alat yang berbeda,
 * jangan dirata-ratakan — pisahkan. Event tanpa `tabId` (data lama, atau event yang
 * disuntik integrator) diperlakukan sebagai satu aliran bersama, jadi perilaku lama
 * tidak berubah.
 */
export function groupByStream(events){
  if(!events || !events.length) return [];
  const byTab=new Map();
  for(const e of events){
    const k=e && e.tabId ? e.tabId : '';
    if(!byTab.has(k)) byTab.set(k, []);
    byTab.get(k).push(e);
  }
  // urut deterministik: aliran dengan event paling awal lebih dulu
  return [...byTab.values()].sort((a,b)=>(a[0].timestamp||0)-(b[0].timestamp||0));
}

/** Urutkan menaik menurut timestamp tanpa memutasi masukan. Akumulator
 *  `bg:pending` menggabung ekor dari banyak halaman, jadi urutan tidak dijamin. */
function byTs(events){
  return [...events].sort((a,b)=>(a.timestamp||0)-(b.timestamp||0));
}

/**
 * Pecah event menjadi segmen kontigu: potong di tiap jeda ≥ gapMs.
 * @returns {{events:Array, startTs:number, endTs:number, durationMs:number,
 *            gapBeforeMs:number}[]} urut menurut waktu; array kosong bila tak ada event.
 */
export function segmentByIdle(events, gapMs=GAP_MS_DEFAULT){
  if(!events || !events.length) return [];
  const ev=byTs(events);
  const segs=[];
  let cur=[ev[0]];
  let gapBefore=0;
  for(let i=1;i<ev.length;i++){
    const gap=(ev[i].timestamp||0)-(ev[i-1].timestamp||0);
    if(gap >= gapMs){
      segs.push(mkSeg(cur, gapBefore));
      cur=[ev[i]];
      gapBefore=gap;
    } else {
      cur.push(ev[i]);
    }
  }
  segs.push(mkSeg(cur, gapBefore));
  return segs;
}

/**
 * C-28: PENDEKKAN tiap jeda ≥ gapMs jadi gapMs — jangan pecah sesinya.
 *
 * Segmentasi (di atas) memang membuang jeda dari pengukuran, tapi sekaligus
 * memendekkan SESI: sembilan fitur-cacah ikut mengecil (C-24), dan held-out 5
 * belahan menunjukkan ia merusak daya pisah. Kompresi hanya memendekkan WAKTU
 * KOSONG. Tak ada event yang dibuang, jumlahnya tetap, urutannya tetap; tiap event
 * sesudah jeda digeser mundur sebesar kelebihan jedanya. Jeda berpikir (< gapMs)
 * tidak tersentuh sama sekali.
 *
 * Tidak memutasi masukan. Padanan Python: tools/idle_ablation.py:compress_idle.
 * @returns {Array} event baru, urut waktu, timestamp sudah dikompresi
 */
export function compressIdle(events, gapMs){
  if(!events || !events.length) return [];
  if(!(gapMs > 0)) return byTs(events);
  const ev=byTs(events);
  const out=new Array(ev.length);
  let shift=0, prev=null;
  for(let i=0;i<ev.length;i++){
    const t=ev[i].timestamp||0;
    if(prev!==null && t-prev >= gapMs) shift+=(t-prev)-gapMs;
    prev=t;
    out[i]={ ...ev[i], timestamp: t-shift };
  }
  return out;
}

function mkSeg(list, gapBeforeMs){
  const startTs=list[0].timestamp||0;
  const endTs=list[list.length-1].timestamp||startTs;
  return { events:list, startTs, endTs, durationMs: endTs-startTs, gapBeforeMs };
}

/**
 * Akuntansi waktu: berapa yang benar-benar aktif, berapa yang mati.
 * Dipakai untuk telemetri (`evt.idle`) dan untuk memutuskan ABSTAIN — sistem
 * boleh bilang "bukti tidak cukup" alih-alih menebak dari sesi yang isinya jeda.
 */
export function idleAccounting(events, gapMs=GAP_MS_DEFAULT){
  const empty={ wallMs:0, activeMs:0, idleMs:0, activeRatio:0, gaps:[], longestGapMs:0, segments:0 };
  if(!events || !events.length) return empty;
  const segs=segmentByIdle(events, gapMs);
  const ev=byTs(events);
  const wallMs=(ev[ev.length-1].timestamp||0)-(ev[0].timestamp||0);
  let activeMs=0;
  const gaps=[];
  for(const s of segs){
    activeMs+=s.durationMs;
    if(s.gapBeforeMs>0) gaps.push(s.gapBeforeMs);
  }
  const idleMs=Math.max(0, wallMs-activeMs);
  const longestGapMs=gaps.length ? gaps.reduce((m,g)=>g>m?g:m, 0) : 0;
  return {
    wallMs, activeMs, idleMs,
    activeRatio: wallMs>0 ? activeMs/wallMs : 1,
    gaps, longestGapMs, segments: segs.length
  };
}

/**
 * Klasifikasi satu jeda. 'micro' = masih perilaku (jeda berpikir, baca sebentar);
 * 'idle' = jangan diukur melintasinya; 'away' = kursi mungkin kosong.
 */
export function classifyGap(gapMs, gapThresholdMs=GAP_MS_DEFAULT, awayThresholdMs=AWAY_MS_DEFAULT){
  if(gapMs >= awayThresholdMs) return 'away';
  if(gapMs >= gapThresholdMs) return 'idle';
  return 'micro';
}

/**
 * Bagi hasil segmentasi menjadi (a) segmen yang layak dinilai, (b) EKOR yang
 * masih terbuka — segmen terakhir yang belum cukup panjang tapi event barunya
 * masih baru, jadi pengguna kemungkinan masih aktif dan ia harus dikembalikan ke
 * buffer supaya terus tumbuh, bukan dibuang, dan (c) segmen basi yang dijatuhkan.
 *
 * `nowTs` disuntik (bukan Date.now() internal) supaya fungsi ini deterministik
 * dan bisa diuji.
 */
export function splitForAssessment(segments, minEvents, nowTs, gapMs=GAP_MS_DEFAULT){
  const assess=[], dropped=[];
  let carry=null;
  segments.forEach((s,i)=>{
    if(s.events.length >= minEvents){ assess.push(s); return; }
    const isLast = i===segments.length-1;
    // ekor masih "hidup" bila event terakhirnya belum melewati ambang jeda
    if(isLast && (nowTs - s.endTs) < gapMs) carry=s;
    else dropped.push(s);
  });
  return { assess, carry, dropped };
}
