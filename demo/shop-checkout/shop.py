"""
One-Click Store - a PLAIN site with its own backend.

A real online store with only log-in and checkout, NO MFA and NO session protection. This
file knows nothing about BehaviorGuard, except one install line near the bottom that is
still commented out.

Run:  pip install flask  &&  python demo/shop-checkout/shop.py      -> http://127.0.0.1:5000
"""
import hashlib
import os
import secrets
import time

from flask import Flask, jsonify, request, send_from_directory, session

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))        # repo root (for /dist)

app = Flask(__name__)
app.secret_key = secrets.token_hex(32)                       # new on every start (demo)

PRODUCTS = [
    {"id": "coffee", "name": "Gayo coffee beans 250 g", "price": 75000},
    {"id": "tea", "name": "Jasmine tea 100 g", "price": 32000},
    {"id": "sugar", "name": "Palm sugar 500 g", "price": 28000},
]
USERS = {}    # email -> password hash (in memory, demo only)
ORDERS = {}   # email -> [order, ...]
MAILBOX = {}  # DEMO: email -> {"key": ..., "mail": [...]}, a stand-in for real email


def _hash(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 100_000).hex()


def check_password(email, pw):
    u = USERS.get(email)
    return bool(u) and secrets.compare_digest(u["hash"], _hash(pw, u["salt"]))


def send_email(to, subject, text):
    """The store's email sender (order receipts). DEMO: delivered to a simulated mailbox,
    /inbox#<key>, whose link is printed in this terminal when the account is created."""
    box = MAILBOX.setdefault(to, {"key": secrets.token_urlsafe(12), "mail": []})
    box["mail"].append({"subject": subject, "text": text, "at": time.strftime("%H:%M:%S")})


# ----- page and assets -----
@app.get("/")
def index():
    return send_from_directory(HERE, "index.html")


@app.get("/plug-behaviorguard.js")
def plug():
    return send_from_directory(HERE, "plug-behaviorguard.js", mimetype="application/javascript")


@app.get("/dist/<path:p>")
def dist(p):
    return send_from_directory(os.path.join(ROOT, "dist"), p)


# ----- store API (plain: no MFA) -----
@app.post("/api/login")
def login():
    b = request.get_json(silent=True) or {}
    email = (b.get("email") or "").strip().lower()
    pw = b.get("password") or ""
    if not email or not pw:
        return jsonify(ok=False, error="email and password are required"), 400
    if email not in USERS:
        salt = secrets.token_hex(8)                          # first log-in = sign-up (demo)
        USERS[email] = {"salt": salt, "hash": _hash(pw, salt)}
        send_email(email, "Welcome to One-Click Store", "Your account is ready.")
        print("DEMO mailbox of %s: http://127.0.0.1:%s/inbox#%s" % (email, os.environ.get("PORT", "5000"), MAILBOX[email]["key"]), flush=True)
    elif not check_password(email, pw):
        return jsonify(ok=False, error="wrong password"), 401
    session.clear()
    session["user"] = email                                  # no second factor (plain)
    ORDERS.setdefault(email, [])
    return jsonify(ok=True, user=email)


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify(ok=True)


@app.get("/api/me")
def me():
    return jsonify(user=session.get("user"), products=PRODUCTS)


@app.post("/api/checkout")
def checkout():
    user = session.get("user")
    if not user:
        return jsonify(ok=False, error="not logged in"), 401
    items = (request.get_json(silent=True) or {}).get("items") or []
    total = sum(p["price"] for p in PRODUCTS if p["id"] in items)
    order = {"id": "ORD-%d" % (time.time() * 1000 % 10**9), "items": items, "total": total,
             "at": time.strftime("%H:%M:%S")}
    ORDERS[user].append(order)
    send_email(user, "Receipt " + order["id"], "Paid Rp %s. Thank you." % format(total, ","))
    return jsonify(ok=True, order=order)                     # ZERO extra checks - that is the point


@app.get("/api/orders")
def orders():
    return jsonify(orders=ORDERS.get(session.get("user"), []))


# ----- DEMO: the simulated mailbox (a real store sends real email) -----
@app.get("/inbox")
def inbox():
    return send_from_directory(HERE, "inbox.html")


@app.get("/api/inbox")
def inbox_api():
    key = request.args.get("k", "")
    for email, box in MAILBOX.items():
        if secrets.compare_digest(box["key"], key):
            return jsonify(owner=email, mail=box["mail"][::-1][:20])
    return jsonify(error="unknown mailbox"), 404


# ===========================================================================
# INSTALL BEHAVIORGUARD (backend part) - remove the # on the line below.
# Put it AFTER the routes: it needs to know who is logged in, and which routes to guard.
# ---------------------------------------------------------------------------
# from bg_backend import install; install(app, current_user=lambda: session.get("user"), send_code=lambda user, code: send_email(user, "Your verification code", code), protect=["/api/checkout"])
# ===========================================================================


if __name__ == "__main__":
    print("One-Click Store  ->  http://127.0.0.1:5000")
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=False, threaded=True)
