/**
 * mfa.js - MFA behavioral BAWAAN (popup dari library).
 *
 * Dipicu otomatis saat vonis MEDIUM (REQUIRE_MFA) / HIGH (REQUIRE_STEPUP) bila
 * cfg.mfa.enabled. User diminta MENGETIK ULANG frasa-rahasianya; identitas
 * dibuktikan dari RITME ketik (dwell/flight per posisi) lewat challenge.js.
 * NOL dependensi, NOL backend, murni on-device.
 *
 * CATATAN KEJUJURAN: verifikasi client-side = re-autentikasi step-up yang nyaman,
 * BUKAN faktor kedua kelas-keamanan. Attacker yang menguasai browser bisa melewati
 * cek client-only. Untuk keamanan sungguhan, verifikasi ritme sebaiknya juga
 * diulang di server (kirim sample ke endpoint) atau gabung faktor eksternal.
 *
 * API: runMfaChallenge({ phrase, template, rounds, buildTemplate, verify, title })
 *  -> Promise<{ passed, enrolled?, template?, reasons?, cancelled? }>
 *   - template null  -> mode DAFTAR: ketik `rounds`x -> kembalikan {enrolled:true, template}
 *   - template ada   -> mode VERIFIKASI: ketik 1x -> {passed, reasons}
 */

function norm(s) { return (s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

// Rekam dwell (keydown->keyup) & flight (keyup->keydown berikut) per karakter tampak.
function attachCapture(input, onDone, expectedLen) {
  let downAt = null, lastUp = null, tainted = false;
  const dwell = [], flight = [];
  function reset() { downAt = null; lastUp = null; dwell.length = 0; flight.length = 0; tainted = false; }

  // C-1: jalur masuk yang TIDAK menghasilkan ritme harus diblokir di sumbernya.
  // Tanpa ini, menempel frasa memberi teks yang benar dengan nol event ketik.
  for (const evt of ['paste', 'drop', 'cut']) {
    input.addEventListener(evt, (e) => {
      e.preventDefault();
      tainted = true;
      input.value = ''; reset();
      if (input._bgOnTaint) input._bgOnTaint(evt);
    });
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); return; }
    // Ctrl+V / Cmd+V: 'v' lolos filter panjang-1 dan tercatat sebagai satu dwell
    // palsu. Abaikan setiap penekanan bermodifier.
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1) return;            // abaikan modifier/nav
    const t = performance.now();
    if (lastUp != null) flight.push(t - lastUp);
    downAt = t;
  });
  input.addEventListener('keyup', (e) => {
    if (e.key === 'Backspace' || e.key === 'Delete') { reset(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key.length !== 1 || downAt == null) return;
    const t = performance.now();
    dwell.push(t - downAt);
    lastUp = t;
  });
  input._bgSample = () => ({ dwell: dwell.slice(), flight: flight.slice() });
  input._bgReset = reset;
  // Sampel sah hanya bila SETIAP karakter di kolom berasal dari ketikan dan
  // tidak pernah ada tempel. Dibandingkan dengan isi kolom (bukan panjang frasa)
  // supaya beda spasi tidak salah-tolak. Dicek sebelum verify(), bukan
  // dipercayakan padanya.
  input._bgIntact = () => {
    const n = input.value.length;
    return !tainted && n > 0 && dwell.length === n && flight.length === n - 1;
  };
  input._bgCounts = () => ({ dwell: dwell.length, flight: flight.length, tainted });
}

function overlay() {
  const wrap = document.createElement('div');
  wrap.setAttribute('data-bg-mfa', '');
  wrap.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;' +
    'justify-content:center;background:rgba(15,18,26,.55);backdrop-filter:blur(3px);' +
    'font:14px system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#0d1117';
  const card = document.createElement('div');
  card.style.cssText =
    'background:#fff;color:#0d1117;max-width:380px;width:calc(100% - 40px);' +
    'border-radius:14px;padding:22px 22px 18px;box-shadow:0 20px 60px rgba(0,0,0,.35);' +
    'border:1px solid rgba(0,0,0,.08)';
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    card.style.background = '#161b22'; card.style.color = '#e6edf3';
    card.style.border = '1px solid #30363d';
  }
  wrap.appendChild(card);
  return { wrap, card };
}

export function runMfaChallenge(opts) {
  const {
    phrase, template = null, rounds = 3, buildTemplate, verify,
    title = 'Verifikasi keamanan',
    // C-18: TANPA batas waktu, popup yang diabaikan membuat Promise ini tidak
    // pernah selesai -> `endSession()` menggantung selamanya, dan `_mfaBusy`
    // tidak pernah direset sehingga SELURUH lapisan step-up mati untuk sisa
    // hidup halaman. Terlihat di uji live: satu popup terlantar di sesi 11
    // mematikan MFA untuk semua sesi sesudahnya.
    timeoutMs = 120000,
  } = opts;
  if (typeof document === 'undefined') {
    return Promise.resolve({ passed: false, cancelled: true, reason: 'no-dom' });
  }
  const enrollMode = !template;
  const need = enrollMode ? rounds : 1;
  const samples = [];

  return new Promise((resolve) => {
    const { wrap, card } = overlay();
    const muted = card.style.color === '#e6edf3' ? '#8b949e' : '#57606a';
    const accent = '#2563eb';
    card.innerHTML =
      `<div style="font-weight:700;font-size:16px;margin-bottom:4px">${title}</div>` +
      `<div id="bg-sub" style="color:${muted};margin-bottom:14px;line-height:1.45"></div>` +
      `<div style="font-weight:600;letter-spacing:.3px;padding:9px 12px;border-radius:8px;` +
      `background:${muted}1a;margin-bottom:10px;user-select:none">${phrase}</div>` +
      `<input id="bg-inp" type="text" autocomplete="off" autocapitalize="off" ` +
      `spellcheck="false" style="width:100%;box-sizing:border-box;padding:10px 12px;` +
      `border-radius:8px;border:1.5px solid ${muted}55;background:transparent;color:inherit;` +
      `font:inherit;outline:none" placeholder="ketik frasa di atas..."/>` +
      `<div id="bg-msg" style="min-height:18px;font-size:12.5px;margin:8px 2px 12px"></div>` +
      `<div style="display:flex;gap:8px;justify-content:flex-end">` +
      `<button id="bg-cancel" style="padding:8px 14px;border-radius:8px;border:1px solid ${muted}55;` +
      `background:transparent;color:inherit;cursor:pointer">Batal</button>` +
      `<button id="bg-ok" style="padding:8px 16px;border-radius:8px;border:0;background:${accent};` +
      `color:#fff;font-weight:600;cursor:pointer">Lanjut</button></div>`;
    document.body.appendChild(wrap);

    const inp = card.querySelector('#bg-inp');
    const sub = card.querySelector('#bg-sub');
    const msg = card.querySelector('#bg-msg');
    const okBtn = card.querySelector('#bg-ok');
    attachCapture(inp, null, phrase.length);
    inp.focus();

    const setSub = () => {
      sub.textContent = enrollMode
        ? `Atur frasa keamananmu — ketik ${rounds}× dengan ritme alamimu (${samples.length + 1}/${rounds}).`
        : 'Sesi ini tak lazim. Ketik ulang frasa keamananmu untuk melanjutkan.';
    };
    setSub();

    let killTimer = null;
    function finish(result) {
      if (killTimer) { clearTimeout(killTimer); killTimer = null; }
      wrap.remove();
      resolve(result);
    }
    if (timeoutMs > 0) {
      killTimer = setTimeout(function () {
        finish({ passed: false, enrolled: false, verified: false,
                 cancelled: true, timedOut: true });
      }, timeoutMs);
    }
    let failedAttempts = 0;
    const MAX_ATTEMPTS = 3;

    function submit() {
      if (norm(inp.value) !== norm(phrase)) {
        msg.style.color = '#d1242f'; msg.textContent = 'Teks tidak cocok — ketik persis frasanya.';
        inp.value = ''; inp._bgReset(); inp.focus(); return;
      }
      // C-1: teks benar TIDAK cukup. Setiap karakter harus datang dari ketikan.
      // Tempel/autofill/isi sebagian berhenti di sini dan tidak pernah mencapai verify().
      if (!inp._bgIntact()) {
        const c = inp._bgCounts();
        msg.style.color = '#d1242f';
        msg.textContent = c.tainted
          ? 'Menempel tidak diterima — ketik frasanya secara manual.'
          : 'Ritme tidak terekam utuh — ketik ulang tanpa menempel.';
        inp.value = ''; inp._bgReset(); inp.focus();
        return;
      }
      const sample = inp._bgSample();
      if (enrollMode) {
        samples.push(sample);
        inp.value = ''; inp._bgReset();
        if (samples.length >= need) {
          const tmpl = buildTemplate(samples);
          if (!tmpl) {
            // frasa terlalu pendek / sampel tidak konsisten -> jangan simpan template lemah
            finish({ passed: false, enrolled: false, verified: false, reason: 'template-ditolak' });
            return;
          }
          // PENDAFTARAN BUKAN BUKTI IDENTITAS: verified sengaja false.
          finish({ passed: true, enrolled: true, verified: false, template: tmpl });
        } else { setSub(); msg.style.color = muted; msg.textContent = 'Bagus. Sekali lagi.'; inp.focus(); }
      } else {
        const res = verify(sample, template);
        if (res.ok) { finish({ passed: true, enrolled: false, verified: true, reasons: res.reasons || [] }); return; }
        failedAttempts++;
        if (failedAttempts >= MAX_ATTEMPTS) {
          finish({ passed: false, enrolled: false, verified: false, reasons: res.reasons || [], attemptsExhausted: true });
          return;
        }
        inp.value = ''; inp._bgReset();
        msg.style.color = '#d1242f';
        msg.textContent = `Ritme tidak cocok (percobaan ${failedAttempts}/${MAX_ATTEMPTS}).`;
        inp.focus();
      }
    }
    okBtn.onclick = submit;
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    card.querySelector('#bg-cancel').onclick = () => finish({ passed: false, enrolled: false, verified: false, cancelled: true });
  });
}
