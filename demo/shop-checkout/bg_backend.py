"""
bg_backend.py - the BACKEND part of installing BehaviorGuard into a Flask app.

One line in your app, after your routes:

    from bg_backend import install
    install(app, current_user=lambda: session.get("user"),
            send_code=lambda user, code: send_email(user, "Your code", code), protect=["/api/checkout"])

What it adds to your app (BehaviorGuard's server runs INSIDE it; no second service):

  /bg/v1/...          BehaviorGuard's API (server/guard.py). The page sends 34 summary
                      numbers per 30-second window; the account's profile, the verdicts and
                      the verifications are kept and decided here.
  GET  /api/bg-token  a short-lived token for the logged-in user and THIS login, signed
                      with the secret key. The page cannot make one; the sk never leaves.
  POST /api/bg-code   the fallback verification for a site without MFA: a 6-digit code
       /api/bg-code/verify  sent with YOUR send_code(user, code) (email, SMS), checked HERE
                      and reported to the guard. An attacker with the stolen password does
                      not have the mailbox. Only when send_code is given.
  POST /api/bg-reauth the weakest fallback: the user retypes the password. Only when
                      verify_password is given, and only for trying things out - whoever
                      stole the password knows it.
  the gate            every POST to a path in `protect` asks guard.check() first. Not
                      allowed -> 403 {verify: true}; a session the verdict ended -> 401.
                      The browser cannot talk its way past it.

Keys and data:
  BG_PK / BG_SK  the tenant keys (production). Without them, a pair is generated once and
                 kept in .bg-tenant.json next to this file (gitignored).
  BG_DB          where profiles live. Default: a fresh file per start, because this demo
                 shop keeps its own accounts in memory too. Set it to keep profiles.

For Node, PHP, Laravel and other stacks, run server/app.py as a service instead and sign
the token in your own backend: docs/INTEGRATION.md.
"""
import hashlib
import hmac
import json
import os
import secrets
import time
import sys
import tempfile

from flask import jsonify, request, session

HERE = os.path.dirname(os.path.abspath(__file__))
_root = os.path.abspath(os.path.join(HERE, "..", ".."))
for _p in (os.path.join(_root, "server"), os.path.join(_root, "dist", "server")):
    if os.path.isfile(os.path.join(_p, "guard.py")):
        sys.path.insert(0, _p)
        break
from guard import Guard, create_blueprint  # noqa: E402

TENANT_FILE = os.path.join(HERE, ".bg-tenant.json")


def _tenant():
    if os.environ.get("BG_PK") and os.environ.get("BG_SK"):
        return os.environ["BG_PK"], os.environ["BG_SK"]
    try:
        with open(TENANT_FILE, encoding="utf-8") as f:
            t = json.load(f)
        if str(t.get("pk", "")).startswith("pk_") and str(t.get("sk", "")).startswith("sk_"):
            return t["pk"], t["sk"]
    except Exception:
        pass
    pk, sk = "pk_" + secrets.token_hex(12), "sk_" + secrets.token_hex(24)
    with open(TENANT_FILE, "w", encoding="utf-8") as f:
        json.dump({"pk": pk, "sk": sk, "note": "demo tenant keys; the sk stays on the server"}, f)
    return pk, sk


def install(app, current_user, send_code=None, verify_password=None, protect=(), money=True, db_path=None):
    """current_user(): the logged-in user's id, or None.
    send_code(user, code): deliver a one-time code to the account's email or phone; the
        fallback verification (POST /api/bg-code, /api/bg-code/verify).
    verify_password(user, password) -> bool: a weaker fallback (POST /api/bg-reauth), used
        only when send_code is not given.
    protect: paths whose POST requests need BehaviorGuard's permission.
    money: apply the stricter money rule to them (guard.check(money=True))."""
    pk, sk = _tenant()
    db_path = db_path or os.environ.get("BG_DB") or os.path.join(tempfile.mkdtemp(prefix="bg-"), "behaviorguard.db")
    guard = Guard(db_path, tenant=(pk, sk))
    app.register_blueprint(create_blueprint(guard), url_prefix="/bg")
    app.config["BG_GUARD"] = guard
    protect = set(protect or ())

    def login_sid():
        """A login session id, new for every login: an attacker's login never shares the
        owner's verification."""
        user = current_user()
        if not user:
            return None, None
        if session.get("_bg_user") != user or not session.get("_bg_sid"):
            session["_bg_user"], session["_bg_sid"] = user, secrets.token_hex(16)
        return user, session["_bg_sid"]

    @app.get("/api/bg-token")
    def bg_token():
        user, sid = login_sid()
        if not user:
            return jsonify(error="not logged in"), 401
        return jsonify(token=guard.mint_token(user, sid, ttl=900), endpoint="/bg", pk=pk,
                       fallback="code" if send_code else "password" if verify_password else None)

    codes = {}                                                # (user, sid) -> [hash, expires, tries]

    if send_code:
        @app.post("/api/bg-code")
        def bg_code_send():
            user, sid = login_sid()
            if not user:
                return jsonify(ok=False), 401
            code = "%06d" % secrets.randbelow(1000000)
            codes[(user, sid)] = [hashlib.sha256((sid + code).encode()).hexdigest(), time.time() + 300, 0]
            send_code(user, code)
            return jsonify(sent=True)

        @app.post("/api/bg-code/verify")
        def bg_code_verify():
            user, sid = login_sid()
            if not user:
                return jsonify(ok=False), 401
            c = codes.get((user, sid))
            code = str((request.get_json(silent=True) or {}).get("code") or "").strip()
            if not c or c[1] < time.time() or c[2] >= 3:
                return jsonify(ok=False, error="the code expired - send a new one", expired=True)
            if hmac.compare_digest(c[0], hashlib.sha256((sid + code).encode()).hexdigest()):
                codes.pop((user, sid), None)
                guard.report_verified(pk, user, sid, True)    # the trust boundary: server to server
                return jsonify(ok=True)
            c[2] += 1
            if c[2] >= 3:
                guard.report_verified(pk, user, sid, False)
            return jsonify(ok=False, error="wrong code", left=3 - c[2])

    if verify_password and not send_code:
        @app.post("/api/bg-reauth")
        def bg_reauth():
            user, sid = login_sid()
            if not user:
                return jsonify(ok=False), 401
            ok = bool(verify_password(user, (request.get_json(silent=True) or {}).get("password") or ""))
            guard.report_verified(pk, user, sid, ok)        # the trust boundary: server to server
            return jsonify(ok=ok)

    @app.before_request
    def bg_gate():
        if request.method != "POST" or request.path not in protect:
            return None
        user, sid = login_sid()
        if not user:
            return None                                       # the app's own "not logged in"
        if guard.blocked(user, sid):
            session.clear()
            return jsonify(ok=False, ended=True, error="session ended: activity did not match the account owner"), 401
        c = guard.check(user, sid, money=money)
        if not c["allowed"]:
            return jsonify(ok=False, verify=True, level=c["level"], reason=c["reason"],
                           error="verify first: " + c["reason"]), 403
        return None

    return guard
