"""
bg_backend.py - bagian BACKEND untuk mencolok BehaviorGuard ke aplikasi Flask.

Dipasang dengan SATU baris di aplikasi kamu (sesudah route login dibuat):

    from bg_backend import pasang
    pasang(app, current_user=lambda: session.get("user"), verify_password=cek_sandi)

Yang ditambahkan ke aplikasi kamu:

  GET  /api/bg-token   mencetak token pengguna BehaviorGuard untuk user yang SUDAH login.
                       Halaman memakainya supaya fitur + vonis boleh dikirim ke server BG.
                       sk tenant TIDAK pernah keluar dari backend ini.

  POST /api/bg-reauth  jalur verifikasi CADANGAN untuk situs yang belum punya MFA:
                       pengguna mengetik ulang sandinya, dan BACKEND (bukan browser) yang
                       memeriksanya. Dipakai BehaviorGuard lewat mfa.onFallback.
                       Hanya aktif kalau verify_password diberikan.

Kredensial tenant (urutan):
  1. variabel lingkungan BG_PK dan BG_SK (cara produksi)
  2. kalau kosong: dibuat sekali di server BG lalu disimpan ke .bg-tenant.json (demo)
"""
import base64, hashlib, hmac, json, os, time, urllib.request
from flask import jsonify, request

HERE = os.path.dirname(os.path.abspath(__file__))
BG_SERVER = os.environ.get("BG_SERVER", "http://127.0.0.1:5055")
TENANT_FILE = os.path.join(HERE, ".bg-tenant.json")


def _b64u(b):
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def mint_token(pk, sk, user_id, ttl=3600):
    """Sama persis dengan mint_user_token di server/app.py (HMAC-SHA256)."""
    exp = int(time.time()) + ttl
    sig = hmac.new(sk.encode(), f"{pk}|{user_id}|{exp}".encode(), hashlib.sha256).hexdigest()
    return f"{_b64u(user_id.encode())}.{exp}.{sig}"


def get_tenant():
    if os.environ.get("BG_PK") and os.environ.get("BG_SK"):
        return {"pk": os.environ["BG_PK"], "sk": os.environ["BG_SK"]}
    if os.path.exists(TENANT_FILE):
        try:
            return json.load(open(TENANT_FILE, encoding="utf-8"))
        except Exception:
            pass
    try:
        req = urllib.request.Request(
            BG_SERVER + "/tenant",
            data=json.dumps({"name": "Toko Checkout Demo"}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        t = json.load(urllib.request.urlopen(req, timeout=2))
        json.dump(t, open(TENANT_FILE, "w", encoding="utf-8"))
        return t
    except Exception:
        return None


def pasang(app, current_user, verify_password=None):
    """current_user(): email/id user yang login, atau None.
    verify_password(user, sandi) -> bool: dipakai jalur cadangan /api/bg-reauth."""

    @app.get("/api/bg-token")
    def bg_token():
        user = current_user()
        if not user:
            return jsonify(enabled=False, error="belum login"), 401
        t = get_tenant()
        if not t:
            # server BG mati: halaman tetap dilindungi on-device, tanpa dashboard
            return jsonify(enabled=False, userId=user, reason="server BG tidak aktif")
        return jsonify(enabled=True, userId=user, pk=t["pk"], endpoint=BG_SERVER,
                       token=mint_token(t["pk"], t["sk"], user),
                       fallback=bool(verify_password))

    if verify_password:
        @app.post("/api/bg-reauth")
        def bg_reauth():
            user = current_user()
            if not user:
                return jsonify(ok=False), 401
            sandi = (request.get_json(force=True, silent=True) or {}).get("password") or ""
            return jsonify(ok=bool(verify_password(user, sandi)))
