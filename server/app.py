#!/usr/bin/env python3
"""
BehaviorGuard VPS - backend minimal multi-tenant (Flask + sqlite3, dependency-ringan).
Model HYBRID: yang MASUK server cuma VEKTOR FITUR teragregasi (34 angka/sesi) + verdict.
Event mentah (timing ketik/mouse) TIDAK pernah dikirim - tetap di device.

Skema per tenant + per akun (userId), BUKAN per device:
  tenants(pk, name)
  baselines(pk, user_id, vectors_json, updated_at)   # baseline akun -> tarik saat login device mana pun
  logs(id, pk, user_id, level, score, action, reasons, ts, ip)

Kunci (C-39):
  pk  publishable, ada di halaman. SENDIRIAN tidak membuka apa pun.
  sk  rahasia tenant, HANYA di server integrator. Dipakai (a) operator membuka dashboard,
      (b) server integrator mencetak TOKEN PENGGUNA sesudah pengguna login:
         token = b64url(userId) "." exp "." hex(HMAC-SHA256(sk, pk|userId|exp))
  Operasi per-akun (baseline, log) wajib pk + token; userId DIAMBIL DARI TOKEN, bukan
  dari parameter. Tanpa ini (versi lama): siapa pun yang membaca pk dari kode halaman bisa
  membaca template perilaku akun mana pun, MENIMPANYA (peracunan: penyerang mengirim
  vektornya sendiri ke akun korban, lalu dianggap pemilik), memalsukan vonis, dan - lewat
  /tenants tanpa auth - mengumpulkan pk SEMUA tenant beserta IP pengguna di dashboard.

Endpoint:
  POST /tenant                      {name}             -> {pk, sk}  (sk tampil SEKALI)
  GET  /baseline      Bearer pk + X-BG-User-Token      -> {vectors}
  POST /baseline      Bearer pk + X-BG-User-Token      -> {ok}
  POST /log           Bearer pk + X-BG-User-Token      -> {ok}
  GET  /api/dashboard Bearer sk                        -> data SOC
  GET  /api/account   Bearer sk  ?u=                   -> detail akun
  GET  /tenants       Bearer $BG_ADMIN_TOKEN           -> daftar tenant (mati tanpa env)
  GET  /dashboard                                      -> HTML (operator memasukkan sk)

Cetak token untuk uji lokal:  python server/app.py mint <pk> <sk> <userId> [ttl_detik]
"""
import os, re, json, time, secrets, sqlite3, hmac, hashlib, base64, sys, math
from flask import Flask, request, jsonify, g, Response

DB = os.environ.get("BG_DB") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "bg_server.db")
ADMIN_TOKEN = os.environ.get("BG_ADMIN_TOKEN", "")
TOKEN_MAX_TTL = 7 * 86400      # token pengguna tak boleh berlaku lebih dari seminggu
app = Flask(__name__)


def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def _close(_):
    d = g.pop("db", None)
    if d:
        d.close()


def init_db():
    c = sqlite3.connect(DB)
    c.executescript(
        """
    CREATE TABLE IF NOT EXISTS tenants(pk TEXT PRIMARY KEY, name TEXT, created_at REAL, sk TEXT);
    CREATE TABLE IF NOT EXISTS baselines(pk TEXT, user_id TEXT, vectors_json TEXT, updated_at REAL,
        PRIMARY KEY(pk, user_id));
    CREATE TABLE IF NOT EXISTS logs(id INTEGER PRIMARY KEY AUTOINCREMENT, pk TEXT, user_id TEXT,
        level TEXT, score REAL, action TEXT, reasons TEXT, ts REAL, ip TEXT,
        top_features TEXT, convergence TEXT, eligible INTEGER, sessions INTEGER, fp TEXT);
    """
    )
    # migrasi lembut untuk DB lama (kolom baru). Tenant lama tanpa sk TIDAK bisa membuka
    # dashboard atau menerima token sampai sk dibuat ulang - gagal-tertutup, disengaja.
    try:
        c.execute("ALTER TABLE tenants ADD COLUMN sk TEXT")
    except sqlite3.OperationalError:
        pass
    for col, typ in [("top_features", "TEXT"), ("convergence", "TEXT"),
                     ("eligible", "INTEGER"), ("sessions", "INTEGER"), ("fp", "TEXT")]:
        try:
            c.execute("ALTER TABLE logs ADD COLUMN %s %s" % (col, typ))
        except sqlite3.OperationalError:
            pass  # kolom sudah ada
    c.commit()
    c.close()


# ---- CORS (SDK jalan di origin vendor, beda domain) ----
@app.after_request
def cors(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-BG-User-Token"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    return resp


@app.route("/<path:_any>", methods=["OPTIONS"])
@app.route("/", methods=["OPTIONS"])
def preflight(_any=None):
    return ("", 204)


def get_pk():
    auth = request.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:].strip()
    if request.is_json:
        return (request.get_json(silent=True) or {}).get("pk")
    return request.args.get("pk")


def valid_pk(pk):
    if not pk:
        return False
    return db().execute("SELECT 1 FROM tenants WHERE pk=?", (pk,)).fetchone() is not None


def _b64u(b):
    return base64.urlsafe_b64encode(b).decode().rstrip("=")


def _unb64u(s):
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _sig(sk, pk, user_id, exp):
    return hmac.new(sk.encode(), f"{pk}|{user_id}|{exp}".encode(), hashlib.sha256).hexdigest()


def mint_user_token(pk, sk, user_id, ttl=3600):
    """Dipanggil di SERVER INTEGRATOR sesudah pengguna login. Padanan Node ada di
    server/README.md. Token terikat ke pk, userId, dan waktu kedaluwarsa."""
    exp = int(time.time()) + int(min(ttl, TOKEN_MAX_TTL))
    return f"{_b64u(user_id.encode())}.{exp}.{_sig(sk, pk, user_id, exp)}"


def auth_user():
    """((pk, userId), None) dari pk + X-BG-User-Token yang sah, atau (None, pesan)."""
    pk = get_pk()
    row = db().execute("SELECT sk FROM tenants WHERE pk=?", (pk,)).fetchone() if pk else None
    if not row or not row["sk"]:
        return None, "pk invalid"
    tok = request.headers.get("X-BG-User-Token", "")
    try:
        u_b64, exp_s, sig = tok.split(".")
        user_id, exp = _unb64u(u_b64).decode(), int(exp_s)
    except Exception:
        return None, "token pengguna wajib"
    now = time.time()
    if exp < now or exp > now + TOKEN_MAX_TTL + 60:
        return None, "token kedaluwarsa"
    if not hmac.compare_digest(sig, _sig(row["sk"], pk, user_id, exp)):
        return None, "token tidak sah"
    return (pk, user_id), None


def auth_operator():
    """pk tenant dari Bearer sk, atau None. sk dibandingkan waktu-konstan."""
    auth = request.headers.get("Authorization", "")
    sk = auth[7:].strip() if auth.startswith("Bearer ") else ""
    if not sk.startswith("sk_"):
        return None
    for r in db().execute("SELECT pk, sk FROM tenants WHERE sk IS NOT NULL").fetchall():
        if hmac.compare_digest(r["sk"], sk):
            return r["pk"]
    return None


# ---- daftar tenant ----
@app.post("/tenant")
def tenant():
    body = request.get_json(silent=True) or {}
    name = (body.get("name") or "tenant").strip()[:80]
    pk = "pk_" + secrets.token_hex(12)
    sk = "sk_" + secrets.token_hex(24)
    db().execute("INSERT INTO tenants(pk,name,created_at,sk) VALUES(?,?,?,?)", (pk, name, time.time(), sk))
    db().commit()
    return jsonify(pk=pk, sk=sk, name=name,
                   note="sk tampil SEKALI. Simpan di server Anda, JANGAN di halaman.")


# ---- baseline akun (per pk+userId) ----
@app.get("/baseline")
def get_baseline():
    who, err = auth_user()
    if not who:
        return jsonify(error=err), 401
    pk, u = who
    row = db().execute(
        "SELECT vectors_json, updated_at FROM baselines WHERE pk=? AND user_id=?", (pk, u)
    ).fetchone()
    if not row:
        return jsonify(vectors=[], updatedAt=None)
    return jsonify(vectors=json.loads(row["vectors_json"]), updatedAt=row["updated_at"])


@app.post("/baseline")
def post_baseline():
    who, err = auth_user()
    if not who:
        return jsonify(error=err), 401
    pk, u = who
    body = request.get_json(silent=True) or {}
    if body.get("userId") not in (None, u):
        return jsonify(error="userId tidak cocok dengan token"), 403
    vecs = body.get("vectors")
    if not isinstance(vecs, list):
        return jsonify(error="vectors wajib"), 400
    # sanitasi: list-of-list angka HINGGA (NaN/inf ditolak), cap 100 sesi x 40 fitur
    clean = []
    for v in vecs[:100]:
        if isinstance(v, list) and v and all(isinstance(x, (int, float)) and math.isfinite(x) for x in v):
            clean.append([float(x) for x in v[:40]])
    db().execute(
        "INSERT INTO baselines(pk,user_id,vectors_json,updated_at) VALUES(?,?,?,?) "
        "ON CONFLICT(pk,user_id) DO UPDATE SET vectors_json=excluded.vectors_json, updated_at=excluded.updated_at",
        (pk, u, json.dumps(clean), time.time()),
    )
    db().commit()
    return jsonify(ok=True, stored=len(clean))


# ---- log verdict ----
@app.post("/log")
def log():
    who, err = auth_user()
    if not who:
        return jsonify(error=err), 401
    pk, uid = who
    b = request.get_json(silent=True) or {}
    if b.get("userId") not in (None, uid):
        return jsonify(error="userId tidak cocok dengan token"), 403
    c = clean_log(b)
    if c is None:
        return jsonify(error="level tidak dikenal"), 400
    db().execute(
        "INSERT INTO logs(pk,user_id,level,score,action,reasons,ts,ip,top_features,convergence,eligible,sessions,fp) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (pk, uid, c["level"], c["score"], c["action"], json.dumps(c["reasons"]), c["ts"], client_ip(),
         json.dumps(c["topFeatures"]), c["convergence"], c["eligible"], c["sessions"], c["fp"]),
    )
    db().commit()
    return jsonify(ok=True)


# ---- C-41: log adalah KIRIMAN KLIEN. Dulu disimpan apa adanya lalu dirender dashboard
# lewat innerHTML: satu token pengguna sah cukup untuk menanam skrip di browser operator.
# Dashboard kini meng-escape; ini lapisan kedua (bentuk & panjang dibatasi di sumber).
LEVELS = {"LOW", "MEDIUM", "HIGH", "UNKNOWN"}
_ACTION = re.compile(r"^[A-Z_]{1,32}$")
_FNAME = re.compile(r"^[a-z0-9_]{1,40}$")
_PRINTABLE = re.compile(r"[^\x20-\x7e\u00a0-\ufffd]")


def _fin(x, lo, hi):
    if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
        return None
    return float(min(hi, max(lo, x)))


def _txt(x, n):
    if not isinstance(x, str):
        return None
    return _PRINTABLE.sub("", x)[:n] or None


def clean_log(b):
    level = b.get("level")
    if level not in LEVELS:
        return None
    action = b.get("action") if isinstance(b.get("action"), str) and _ACTION.match(b.get("action")) else None
    reasons = [r for r in (_txt(x, 160) for x in (b.get("reasons") or [])[:6]) if r] \
        if isinstance(b.get("reasons"), list) else []
    tf = []
    for f in (b.get("topFeatures") or [])[:5] if isinstance(b.get("topFeatures"), list) else []:
        if isinstance(f, dict) and isinstance(f.get("name"), str) and _FNAME.match(f["name"]):
            z = _fin(f.get("z"), -1e6, 1e6)
            tf.append({"name": f["name"], "z": 0.0 if z is None else z})
    now = time.time()
    ts = _fin(b.get("ts"), 0, 1e14)
    if ts and ts > 1e11:        # klien mengirim Date.now() (milidetik)
        ts /= 1000.0
    if not ts or abs(ts - now) > 86400:   # jam klien tak dipercaya untuk urutan dashboard
        ts = now
    s = b.get("sessions")
    return {
        "level": level, "score": _fin(b.get("score"), -1e6, 1e6), "action": action,
        "reasons": reasons, "topFeatures": tf, "ts": ts,
        "convergence": _txt(b.get("convergence"), 64),
        "eligible": 1 if b.get("eligible") is True else 0,
        "sessions": int(s) if isinstance(s, int) and not isinstance(s, bool) and 0 <= s <= 10**6 else None,
        "fp": _txt(b.get("fp"), 128),
    }


def client_ip():
    """X-Forwarded-For bisa diisi siapa pun. Hanya dipercaya di balik proxy yang
    menimpanya (BG_TRUST_PROXY=1), dan hanya entri pertama."""
    if os.environ.get("BG_TRUST_PROXY") == "1":
        xff = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
        if xff:
            return xff[:64]
    return (request.remote_addr or "")[:64]


def _norm_ts(t):
    t = t or 0
    return t / 1000.0 if t > 1e11 else t


# ---- data JSON untuk dashboard SOC (dipoll tiap 3 dtk) ----
@app.get("/api/dashboard")
def api_dashboard():
    pk = auth_operator()
    if not pk:
        return jsonify(error="butuh sk operator"), 401
    d = db()
    name = d.execute("SELECT name FROM tenants WHERE pk=?", (pk,)).fetchone()["name"]
    users = [r["user_id"] for r in d.execute("SELECT DISTINCT user_id FROM logs WHERE pk=?", (pk,)).fetchall()]
    accounts = []
    for u in users:
        last = d.execute("SELECT * FROM logs WHERE pk=? AND user_id=? ORDER BY id DESC LIMIT 1", (pk, u)).fetchone()
        cnt = {r["level"]: r["c"] for r in d.execute(
            "SELECT level, COUNT(*) c FROM logs WHERE pk=? AND user_id=? GROUP BY level", (pk, u)).fetchall()}
        series = [(r["score"] or 0) for r in d.execute(
            "SELECT score FROM logs WHERE pk=? AND user_id=? ORDER BY id DESC LIMIT 24", (pk, u)).fetchall()][::-1]
        accounts.append({
            "userId": u, "level": last["level"], "score": last["score"] or 0,
            "action": last["action"], "convergence": last["convergence"],
            "sessions": last["sessions"], "ip": last["ip"], "fp": last["fp"],
            "lastTs": _norm_ts(last["ts"]),
            "high": cnt.get("HIGH", 0), "medium": cnt.get("MEDIUM", 0), "low": cnt.get("LOW", 0),
            "total": sum(cnt.values()),
            "reasons": json.loads(last["reasons"] or "[]"),
            "topFeatures": json.loads(last["top_features"] or "[]"),
            "series": series,
        })
    order = {"HIGH": 0, "MEDIUM": 1, "LOW": 2}
    accounts.sort(key=lambda a: (order.get(a["level"], 3), -(a["lastTs"] or 0)))
    events = []
    for r in d.execute("SELECT * FROM logs WHERE pk=? ORDER BY id DESC LIMIT 40", (pk,)).fetchall():
        events.append({
            "userId": r["user_id"], "level": r["level"], "score": r["score"] or 0,
            "ts": _norm_ts(r["ts"]), "ip": r["ip"], "convergence": r["convergence"],
            "action": r["action"], "reasons": json.loads(r["reasons"] or "[]"),
        })
    lvc = {r["level"]: r["c"] for r in d.execute(
        "SELECT level, COUNT(*) c FROM logs WHERE pk=? GROUP BY level", (pk,)).fetchall()}
    kpi = {"accounts": len(users), "events": sum(lvc.values()),
           "high": lvc.get("HIGH", 0), "medium": lvc.get("MEDIUM", 0), "low": lvc.get("LOW", 0),
           "atRisk": sum(1 for a in accounts if a["level"] == "HIGH")}
    return jsonify(name=name, pk=pk, generatedAt=time.time(), kpi=kpi, accounts=accounts, events=events)


# ---- daftar tenant: HANYA admin platform (env BG_ADMIN_TOKEN). Dulu tanpa auth dan
# mengembalikan pk semua tenant - satu permintaan membuka seluruh platform (C-39).
@app.get("/tenants")
def tenants():
    auth = request.headers.get("Authorization", "")
    if not ADMIN_TOKEN or not hmac.compare_digest(auth, "Bearer " + ADMIN_TOKEN):
        return jsonify(error="admin saja"), 403
    d = db()
    out = []
    for t in d.execute("SELECT pk, name, created_at FROM tenants ORDER BY created_at").fetchall():
        acc = d.execute("SELECT COUNT(DISTINCT user_id) c FROM logs WHERE pk=?", (t["pk"],)).fetchone()["c"]
        hi = d.execute("SELECT COUNT(DISTINCT user_id) c FROM logs l WHERE pk=? AND level='HIGH' "
                       "AND l.id IN (SELECT MAX(id) FROM logs WHERE pk=? GROUP BY user_id)",
                       (t["pk"], t["pk"])).fetchone()["c"]
        out.append({"pk": t["pk"], "name": t["name"], "accounts": acc, "atRisk": hi})
    return jsonify(tenants=out)


# ---- detail satu akun (untuk drawer drill-down) ----
@app.get("/api/account")
def api_account():
    pk = auth_operator()
    if not pk:
        return jsonify(error="butuh sk operator"), 401
    u = request.args.get("u")
    if not u:
        return jsonify(error="userId wajib"), 400
    d = db()
    rows = d.execute("SELECT * FROM logs WHERE pk=? AND user_id=? ORDER BY id DESC LIMIT 60", (pk, u)).fetchall()
    if not rows:
        return jsonify(error="not found"), 404
    last = rows[0]
    cnt = {r["level"]: r["c"] for r in d.execute(
        "SELECT level, COUNT(*) c FROM logs WHERE pk=? AND user_id=? GROUP BY level", (pk, u)).fetchall()}
    ips = [r["ip"] for r in d.execute(
        "SELECT DISTINCT ip FROM logs WHERE pk=? AND user_id=? AND ip IS NOT NULL", (pk, u)).fetchall()]
    fps = [r["fp"] for r in d.execute(
        "SELECT DISTINCT fp FROM logs WHERE pk=? AND user_id=? AND fp IS NOT NULL", (pk, u)).fetchall()]
    span = d.execute("SELECT MIN(ts) a, MAX(ts) b FROM logs WHERE pk=? AND user_id=?", (pk, u)).fetchone()
    sessions = [{
        "level": r["level"], "score": r["score"] or 0, "ts": _norm_ts(r["ts"]),
        "ip": r["ip"], "convergence": r["convergence"], "action": r["action"],
        "eligible": r["eligible"], "reasons": json.loads(r["reasons"] or "[]"),
        "topFeatures": json.loads(r["top_features"] or "[]"),
    } for r in rows]
    series = [s["score"] for s in sessions][::-1]
    return jsonify(
        userId=u, level=last["level"], score=last["score"] or 0, action=last["action"],
        convergence=last["convergence"], sessions_count=last["sessions"],
        high=cnt.get("HIGH", 0), medium=cnt.get("MEDIUM", 0), low=cnt.get("LOW", 0),
        total=sum(cnt.values()), ips=ips, fps=fps,
        firstTs=_norm_ts(span["a"]), lastTs=_norm_ts(span["b"]),
        topFeatures=json.loads(last["top_features"] or "[]"),
        series=series, sessions=sessions,
    )


# ---- dashboard SOC (dark, live) ----
@app.get("/dashboard")
def dashboard():
    # Halaman statis; operator memasukkan sk-nya di halaman (disimpan di sessionStorage tab
    # itu saja). Kunci tidak pernah lewat URL - URL tercatat di log server & riwayat.
    # C-41: CSP ber-nonce. Satu-satunya skrip yang boleh jalan adalah milik halaman ini;
    # handler inline sisipan (<img onerror=...>) diblokir browser walau escape terlewat.
    tpl = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboard.html")
    with open(tpl, encoding="utf-8") as f:
        html = f.read()
    nonce = secrets.token_urlsafe(16)
    html = html.replace("<script>", f'<script nonce="{nonce}">')
    resp = Response(html, mimetype="text/html")
    resp.headers["Content-Security-Policy"] = (
        f"default-src 'none'; script-src 'nonce-{nonce}'; style-src 'unsafe-inline'; "
        "connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; "
        "frame-ancestors 'none'")
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["Referrer-Policy"] = "no-referrer"
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.get("/")
def home():
    return jsonify(service="behaviorguard-vps", ok=True)


if __name__ == "__main__":
    if len(sys.argv) >= 5 and sys.argv[1] == "mint":
        print(mint_user_token(sys.argv[2], sys.argv[3], sys.argv[4],
                              int(sys.argv[5]) if len(sys.argv) > 5 else 3600))
        sys.exit(0)
    init_db()
    app.run(host="0.0.0.0", port=5055, debug=False)
