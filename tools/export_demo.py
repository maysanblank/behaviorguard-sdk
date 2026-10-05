#!/usr/bin/env python3
"""
export_demo.py - copy demo/arunika into a STANDALONE demo folder (no repository needed).

    python tools/bundle.py                         # build dist/ first
    python tools/export_demo.py ../BEHAVIORGUARD-DEMO-ARUNIKA

Only DEST/site/ is rewritten: the bank (server.py, pages, assets) plus a copy of the library
in site/behaviorguard/ (the browser bundle and the server modules from dist/server/).
Other files in DEST are left alone. Run it with:

    pip install flask
    python DEST/site/server.py
"""
import os
import shutil
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'demo', 'arunika')
DIST = os.path.join(ROOT, 'dist')
SKIP_DIRS = {'.data', '__pycache__', 'behaviorguard'}
SKIP_FILES = {'README.md', 'test_server.py'}


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    dest = os.path.abspath(os.path.join(sys.argv[1], 'site'))
    if not os.path.isfile(os.path.join(DIST, 'behaviorguard.js')) or not os.path.isdir(os.path.join(DIST, 'server')):
        raise SystemExit('dist/ is not built - run python tools/bundle.py')
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    n = 0
    for base, dirs, files in os.walk(SRC):
        dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
        rel = os.path.relpath(base, SRC)
        for f in files:
            if rel == '.' and f in SKIP_FILES:
                continue
            os.makedirs(os.path.join(dest, rel), exist_ok=True)
            shutil.copyfile(os.path.join(base, f), os.path.join(dest, rel, f))
            n += 1
    lib = os.path.join(dest, 'behaviorguard')
    os.makedirs(os.path.join(lib, 'server'), exist_ok=True)
    for f in ('behaviorguard.js', 'behaviorguard.min.js'):
        if os.path.isfile(os.path.join(DIST, f)):
            shutil.copyfile(os.path.join(DIST, f), os.path.join(lib, f))
    for f in os.listdir(os.path.join(DIST, 'server')):
        if f.endswith('.py'):
            shutil.copyfile(os.path.join(DIST, 'server', f), os.path.join(lib, 'server', f))
    print('OK -> %s (%d files + the library)' % (dest, n))


if __name__ == '__main__':
    main()
