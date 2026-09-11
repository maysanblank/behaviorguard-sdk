#!/usr/bin/env python3
"""
export_demo.py - salin demo/arunika menjadi folder demo MANDIRI (tanpa repo).

    python tools/bundle.py                         # bangun dist/behaviorguard.js dulu
    python tools/export_demo.py ../BEHAVIORGUARD-DEMO-ARUNIKA

Yang ditulis ulang hanya DEST/site/ (halaman, aset, dan salinan pustaka di
site/behaviorguard/). Berkas lain di DEST (panduan, jalankan.py/.bat) tidak disentuh.
Di repo, halaman memuat ../../dist/behaviorguard.js; di folder mandiri, behaviorguard/behaviorguard.js.
"""
import os, shutil, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'demo', 'arunika')
BUNDLE = os.path.join(ROOT, 'dist', 'behaviorguard.js')
REPO_TAG = '../../dist/behaviorguard.js'
LOCAL_TAG = 'behaviorguard/behaviorguard.js'


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    dest = os.path.abspath(os.path.join(sys.argv[1], 'site'))
    if not os.path.isfile(BUNDLE):
        raise SystemExit('dist/behaviorguard.js belum ada - jalankan python tools/bundle.py')
    if os.path.isdir(dest):
        shutil.rmtree(dest)
    n = 0
    for base, _, files in os.walk(SRC):
        rel = os.path.relpath(base, SRC)
        for f in files:
            if f == 'README.md' and rel == '.':
                continue
            out_dir = os.path.join(dest, rel)
            os.makedirs(out_dir, exist_ok=True)
            src = os.path.join(base, f)
            if f.endswith('.html'):
                txt = open(src, encoding='utf-8').read().replace(REPO_TAG, LOCAL_TAG)
                open(os.path.join(out_dir, f), 'w', encoding='utf-8', newline='\n').write(txt)
            else:
                shutil.copyfile(src, os.path.join(out_dir, f))
            n += 1
    os.makedirs(os.path.join(dest, 'behaviorguard'), exist_ok=True)
    shutil.copyfile(BUNDLE, os.path.join(dest, 'behaviorguard', 'behaviorguard.js'))
    mini = BUNDLE.replace('behaviorguard.js', 'behaviorguard.min.js')
    if os.path.isfile(mini):   # versi produksi, untuk dipasang di situs lain
        shutil.copyfile(mini, os.path.join(dest, 'behaviorguard', 'behaviorguard.min.js'))
    print('OK -> %s (%d berkas + pustaka %.1f KB)' % (dest, n, os.path.getsize(BUNDLE) / 1024))


if __name__ == '__main__':
    main()
