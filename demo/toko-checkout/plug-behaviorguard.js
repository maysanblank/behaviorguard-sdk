/*
  plug-behaviorguard.js - SATU file yang "mencolok" BehaviorGuard ke sebuah web.

  Pasang di layout halaman SESUDAH login, sebelum </body>:

    <script src="plug-behaviorguard.js" defer></script>

  Yang dilakukannya, tanpa menyentuh kode web kamu:
    1. minta kredensial ke backend kamu (GET token-url) - dicetak sesudah login
    2. muat pustaka behaviorguard.js
    3. nyalakan: mode BACKEND kalau ada token (34 fitur + vonis dikirim ke server BG),
       atau on-device kalau backend belum dicolok / server BG mati
    4. web tanpa MFA: jalur cadangan "ketik ulang sandi" yang DIPERIKSA backend (reauth-url)
    5. badge status mengambang (belajar -> aman / periksa / bahaya)
    6. gerbang verifikasi di semua tombol aksi sensitif (atribut data-checkout)

  Semua bisa diatur lewat atribut di tag script (nilai default di kanan):
    data-token-url   alamat route cetak token        /api/bg-token
    data-reauth-url  alamat route cek ulang sandi     /api/bg-reauth
    data-lib         lokasi behaviorguard.js          /dist/behaviorguard.js
    data-user        id user, kalau backend belum dicolok (mode on-device)
    data-gate        selector tombol yang dijaga      [data-checkout]
    data-badge       "off" untuk menyembunyikan badge
*/
(() => {
  const tag = document.currentScript || {};
  const ds = tag.dataset || {};
  const URL_TOKEN  = ds.tokenUrl  || "/api/bg-token";
  const URL_REAUTH = ds.reauthUrl || "/api/bg-reauth";
  const URL_LIB    = ds.lib       || "/dist/behaviorguard.js";
  const GATE       = ds.gate      || "[data-checkout]";

  // Laravel & framework lain menolak POST tanpa token CSRF. Kalau halaman punya
  // <meta name="csrf-token">, ikut dikirim.
  const csrfMeta = document.querySelector('meta[name="csrf-token"]');
  const headersPost = { "Content-Type": "application/json" };
  if (csrfMeta) headersPost["X-CSRF-TOKEN"] = csrfMeta.content;

  const loadScript = src => new Promise((ok, no) => {
    const s = document.createElement("script");
    s.src = src; s.onload = ok; s.onerror = () => no(new Error("gagal muat " + src));
    document.head.appendChild(s);
  });

  // ---------- jalur cadangan: konfirmasi sandi (dicek BACKEND, bukan browser) ----------
  function konfirmasiSandi() {
    return new Promise(selesai => {
      const layar = document.createElement("div");
      layar.style.cssText = "position:fixed;inset:0;z-index:10000;background:rgba(15,23,42,.55);" +
        "display:flex;align-items:center;justify-content:center;font:15px system-ui,Segoe UI,sans-serif";
      const kartu = document.createElement("div");
      kartu.style.cssText = "background:#fff;border-radius:14px;padding:22px;width:min(380px,92vw);" +
        "box-shadow:0 20px 50px rgba(0,0,0,.3);color:#111827";
      const judul = document.createElement("b");
      judul.textContent = "Konfirmasi sandi";
      judul.style.cssText = "display:block;font-size:17px;margin-bottom:6px";
      const ket = document.createElement("div");
      ket.textContent = "Sebelum melanjutkan, ketik ulang sandi akun kamu.";
      ket.style.cssText = "color:#6b7280;font-size:13px;margin-bottom:12px";
      const isian = document.createElement("input");
      isian.type = "password"; isian.placeholder = "sandi"; isian.autocomplete = "current-password";
      isian.style.cssText = "width:100%;box-sizing:border-box;padding:11px;border:1px solid #d1d5db;border-radius:9px;font-size:15px";
      const salah = document.createElement("div");
      salah.style.cssText = "color:#b91c1c;font-size:13px;min-height:18px;margin:6px 0";
      const baris = document.createElement("div");
      baris.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
      const batal = document.createElement("button");
      batal.type = "button"; batal.textContent = "Batal";
      batal.style.cssText = "background:#fff;color:#111827;border:1px solid #e5e7eb;border-radius:999px;padding:9px 16px;font-weight:600;cursor:pointer";
      const lanjut = document.createElement("button");
      lanjut.type = "button"; lanjut.textContent = "Lanjut";
      lanjut.style.cssText = "background:#0a7a63;color:#fff;border:0;border-radius:999px;padding:9px 16px;font-weight:700;cursor:pointer";
      baris.append(batal, lanjut);
      kartu.append(judul, ket, isian, salah, baris);
      layar.append(kartu);
      document.body.append(layar);
      isian.focus();

      const tutup = hasil => { layar.remove(); selesai(hasil); };
      batal.onclick = () => tutup(false);
      const kirim = async () => {
        lanjut.disabled = true;
        let ok = false;
        try {
          const r = await fetch(URL_REAUTH, { method: "POST", headers: headersPost,
            credentials: "same-origin", body: JSON.stringify({ password: isian.value }) });
          ok = r.ok && (await r.json()).ok === true;
        } catch (e) {}
        lanjut.disabled = false;
        if (ok) return tutup(true);
        salah.textContent = "Sandi salah.";
        isian.value = ""; isian.focus();
      };
      lanjut.onclick = kirim;
      isian.onkeydown = e => { if (e.key === "Enter") kirim(); };
    });
  }

  // ---------- 1-4. ambil kredensial, muat pustaka, nyalakan ----------
  let mode = "mati";
  const nyalakan = async () => {
    let cfg = {};
    try {
      const r = await fetch(URL_TOKEN, { credentials: "same-origin" });
      if (r.ok) cfg = await r.json();
    } catch (e) {}
    cfg.userId = cfg.userId || ds.user;
    if (!cfg.userId) {
      // khusus demo toko-checkout: tanya backend siapa yang login
      try { cfg.userId = (await fetch("/api/me").then(r => r.json())).user; } catch (e) {}
    }
    if (!cfg.userId) { console.info("[plug] belum login - BehaviorGuard tidak dinyalakan"); return false; }

    try { await loadScript(URL_LIB); }
    catch (e) { console.error("[plug] " + e.message); return false; }

    const opts = { userId: cfg.userId };
    if (cfg.enabled) { opts.pk = cfg.pk; opts.endpoint = cfg.endpoint; opts.userToken = cfg.token; }
    if (cfg.fallback) opts.mfa = { onFallback: () => konfirmasiSandi() };
    await BehaviorGuard.init(opts);
    mode = cfg.enabled ? "backend" : "on-device";
    if (ds.badge !== "off") pasangBadge();
    console.log("[plug] BehaviorGuard aktif - mode " + mode + (cfg.fallback ? ", jalur cadangan: konfirmasi sandi" : ""));
    return true;
  };
  let siap = nyalakan();

  // Banyak web login tanpa reload halaman (SPA, form via fetch). Kalau tadi belum login,
  // coba nyalakan lagi sebentar sesudah user berinteraksi, dan sekali lagi saat tombol
  // yang dijaga diklik.
  let aktif = false, mencoba = false;
  siap.then(ok => { aktif = ok; });
  const cobaLagi = () => {
    if (aktif || mencoba) return siap;
    mencoba = true;
    siap = nyalakan();
    siap.then(ok => { aktif = ok; mencoba = false; });
    return siap;
  };
  const pastikan = async () => (await siap) || cobaLagi();
  let jeda = null;
  ["click", "keydown"].forEach(t => document.addEventListener(t, () => {
    if (aktif || jeda) return;
    jeda = setTimeout(() => { jeda = null; cobaLagi(); }, 1500);
  }, true));

  // ---------- 5. badge status ----------
  function pasangBadge() {
    const badge = document.createElement("div");
    badge.style.cssText =
      "position:fixed;left:12px;bottom:12px;z-index:9999;font:600 13px system-ui,Segoe UI,sans-serif;" +
      "padding:10px 14px;border-radius:12px;color:#fff;background:#334155;box-shadow:0 6px 20px rgba(0,0,0,.25);" +
      "display:flex;gap:8px;align-items:center;min-width:220px";
    const dot = document.createElement("span");
    dot.style.cssText = "width:9px;height:9px;border-radius:50%;background:#94a3b8;flex:0 0 auto";
    const text = document.createElement("span");
    const tMode = document.createElement("span");
    tMode.style.cssText = "margin-left:auto;font-weight:500;opacity:.8;font-size:11px";
    badge.append(dot, text, tMode);
    document.body.appendChild(badge);

    const PALETTE = {
      learning: ["#2563eb", "BehaviorGuard: belajar pola pemilik"],
      LOW:      ["#16a34a", "AMAN - sesi cocok dengan pemilik"],
      MEDIUM:   ["#d97706", "PERIKSA - perilaku mulai menyimpang"],
      HIGH:     ["#dc2626", "BAHAYA - sesi tidak seperti pemilik"],
      UNKNOWN:  ["#64748b", "bukti belum cukup (gagal-tertutup)"],
    };
    function paint() {
      const s = BehaviorGuard.status();
      tMode.textContent = s.cloud ? "mode: backend" : "mode: on-device";
      if (!s.ready) { dot.style.background = "#94a3b8"; text.textContent = "memulai..."; return; }
      if (s.phase === "learning") {
        const [c, label] = PALETTE.learning;
        dot.style.background = c;
        const gate = s.model.mainDetector ? "" : `  (detektor utama ${s.model.pool}/${s.model.mainDetectorNeeds})`;
        text.textContent = `${label} ${s.enrollment.done}/${s.enrollment.need}${gate}`;
        return;
      }
      const lvl = (s.lastVerdict && s.lastVerdict.level) || "UNKNOWN";
      const [c, label] = PALETTE[lvl] || PALETTE.UNKNOWN;
      dot.style.background = c;
      text.textContent = label;
    }
    paint();
    setInterval(paint, 2000);
    BehaviorGuard.on("risk", paint);
  }

  // ---------- 6. gerbang aksi sensitif ----------
  // Didengar di level dokumen (fase capture), jadi tombol yang baru dirender belakangan
  // (React/Vue/SPA) juga ikut dijaga. Kode web kamu tidak perlu diubah.
  function tahan(btn, v) {
    let box = btn.parentElement && btn.parentElement.querySelector(":scope > .bg-hold");
    if (!box) {
      box = document.createElement("div");
      box.className = "bg-hold";
      box.style.cssText = "margin-top:12px;padding:12px 14px;border-radius:10px;background:#fef2f2;" +
        "border:1px solid #fecaca;color:#991b1b;font:14px/1.5 system-ui,Segoe UI,sans-serif";
      btn.insertAdjacentElement("afterend", box);
    }
    box.textContent = "";
    const title = document.createElement("b");
    title.textContent = "Ditahan oleh BehaviorGuard";
    const why = document.createElement("div");
    why.textContent = "Vonis " + v.level + ": " +
      ((v.reasons && v.reasons[0]) || "perilaku sesi tidak cocok dengan pemilik");
    box.append(title, why);
  }

  document.addEventListener("click", async (ev) => {
    const btn = ev.target instanceof Element ? ev.target.closest(GATE) : null;
    if (!btn) return;
    if (btn.dataset.bgOk === "1") { btn.dataset.bgOk = ""; return; }   // sudah lolos: teruskan
    ev.preventDefault(); ev.stopImmediatePropagation();

    const lolos = () => {
      const box = btn.parentElement && btn.parentElement.querySelector(":scope > .bg-hold");
      if (box) box.remove();
      btn.dataset.bgOk = "1"; btn.click();
    };
    // Pustaka gagal dimuat / user belum login: gerbang tidak bisa menilai apa-apa.
    // Diteruskan, karena pemeriksaan yang mengikat tetap tugas backend (THREAT-MODEL 4.2).
    if (!(await pastikan())) return lolos();

    const v = BehaviorGuard.assessNow();
    if (v.level === "LOW") return lolos();
    const r = await BehaviorGuard.stepUp({ reason: btn.dataset.bgReason || "menyelesaikan aksi ini" });
    if (r && r.verified) lolos(); else tahan(btn, v);
  }, true);
})();
