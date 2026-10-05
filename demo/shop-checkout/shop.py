"""
Toko Checkout - situs POLOS dengan backend sendiri.

Toko online beneran yang cuma punya fitur login + checkout, TANPA MFA, TANPA proteksi
sesi. File ini tidak tahu apa-apa soal BehaviorGuard, kecuali satu baris colok yang
masih dikomentari di bagian bawah.

Jalankan:  pip install flask  &&  python demo/shop-checkout/shop.py
"""
import hashlib, os, time
from flask import Flask, request, session, jsonify, send_from_directory

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))        # repo root (buat /dist)

app = Flask(__name__)
app.secret_key = "demo-shop-checkout-bukan-rahasia"

PRODUCTS = [
    {"id": "kopi", "nama": "Kopi Gayo 250g", "harga": 75000},
    {"id": "teh",  "nama": "Teh Melati 100g", "harga": 32000},
    {"id": "gula", "nama": "Gula Aren 500g",  "harga": 28000},
]
USERS = {}    # email -> hash sandi (in-memory, demo saja)
ORDERS = {}   # email -> [order, ...]


def _hash(pw):
    return hashlib.sha256(("demo-salt:" + pw).encode()).hexdigest()

def cek_sandi(email, pw):
    return email in USERS and USERS[email] == _hash(pw)


# ----- halaman & aset -----
@app.get("/")
def index():
    return send_from_directory(HERE, "index.html")

@app.get("/plug-behaviorguard.js")
def plug():
    return send_from_directory(HERE, "plug-behaviorguard.js", mimetype="application/javascript")

@app.get("/dist/<path:p>")
def dist(p):
    return send_from_directory(os.path.join(ROOT, "dist"), p)


# ----- API toko (polos: tanpa MFA) -----
@app.post("/api/login")
def login():
    b = request.get_json(force=True, silent=True) or {}
    email = (b.get("email") or "").strip().lower()
    pw = b.get("password") or ""
    if not email or not pw:
        return jsonify(ok=False, error="email & sandi wajib"), 400
    if email not in USERS:
        USERS[email] = _hash(pw)                 # login pertama = daftar (demo)
    elif not cek_sandi(email, pw):
        return jsonify(ok=False, error="sandi salah"), 401
    session["user"] = email                      # tanpa verifikasi kedua (polos)
    ORDERS.setdefault(email, [])
    return jsonify(ok=True, user=email)

@app.post("/api/logout")
def logout():
    session.pop("user", None)
    return jsonify(ok=True)

@app.get("/api/me")
def me():
    return jsonify(user=session.get("user"), products=PRODUCTS)

@app.post("/api/checkout")
def checkout():
    user = session.get("user")
    if not user:
        return jsonify(ok=False, error="belum login"), 401
    b = request.get_json(force=True, silent=True) or {}
    items = b.get("items") or []
    total = sum(p["harga"] for p in PRODUCTS if p["id"] in items)
    order = {"id": "ORD-" + str(int(time.time())), "items": items,
             "total": total, "at": time.strftime("%H:%M:%S")}
    ORDERS[user].append(order)
    return jsonify(ok=True, order=order)         # NOL verifikasi tambahan - ini intinya

@app.get("/api/orders")
def orders():
    return jsonify(orders=ORDERS.get(session.get("user"), []))


# ===========================================================================
# COLOK BEHAVIORGUARD (bagian backend) - hapus tanda # di baris bawah.
# Taruh SESUDAH route login dibuat, karena butuh tahu siapa user yang login.
# ---------------------------------------------------------------------------
# from bg_backend import pasang; pasang(app, current_user=lambda: session.get("user"), verify_password=cek_sandi)
# ===========================================================================


if __name__ == "__main__":
    print("Toko Checkout  ->  http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=5000, debug=False)
