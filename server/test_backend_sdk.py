"""
test_backend_sdk.py - the browser library in backend mode, end to end over HTTP.

Starts server/app.py on a free local port, creates a tenant and runs
tools/backend_sdk_check.mjs against it. Run: python server/test_backend_sdk.py
(needs node on PATH, or NODE=path/to/node)
"""
import os
import subprocess
import sys
import tempfile
import threading

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from werkzeug.serving import make_server  # noqa: E402
import app as srv  # noqa: E402


def main():
    import logging
    logging.getLogger('werkzeug').setLevel(logging.ERROR)
    db = tempfile.NamedTemporaryFile(suffix='.db', delete=False)
    db.close()
    app = srv.create_app(db.name, windows_per_min=120)
    pk, sk = app.config['BG_GUARD'].create_tenant('sdk test')
    server = make_server('127.0.0.1', 0, app, threaded=True)
    port = server.server_port
    t = threading.Thread(target=server.serve_forever, daemon=True)
    t.start()
    env = dict(os.environ, BG_URL='http://127.0.0.1:%d' % port, BG_PK=pk, BG_SK=sk)
    try:
        r = subprocess.run([os.environ.get('NODE', 'node'), os.path.join(ROOT, 'tools', 'backend_sdk_check.mjs')],
                           cwd=ROOT, env=env, timeout=300)
        return r.returncode
    finally:
        server.shutdown()
        try:
            os.unlink(db.name)
        except OSError:
            pass


if __name__ == '__main__':
    sys.exit(main())
