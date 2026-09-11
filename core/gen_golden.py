#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_golden.py - bikin core/golden.json dari implementasi acuan (bg_core.py).

Golden = kontrak numerik. Input DITULIS EKSPLISIT di JSON (bukan digenerate ulang
per bahasa), supaya port bahasa lain tidak perlu meniru generator apa pun -
cukup baca angka, hitung, bandingkan.

Sejak v1.1.0 golden mencakup DUA jalur:
  - `feature_cases`: event mentah -> vektor 28-float   (SPEC v1.1)
  - `cases`        : vektor 28-float -> vonis           (SPEC v1.0)

Jalankan ulang HANYA kalau SPEC berubah, dan catat alasannya di core/DRIFT.md.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bg_core as bg  # noqa: E402

SPEC_VERSION = '1.3.0'   # C-34: toleransi pi/4 di direction_changes
ROUND = 6


def lcg(seed):
    """Generator input saja - TIDAK jadi bagian spec. Hasilnya dibekukan ke JSON."""
    a = seed

    def nxt():
        nonlocal a
        a = (a * 1664525 + 1013904223) % 0x100000000
        return a / 0x100000000

    return nxt


def make_case(case_id, seed, n_baseline, n_probe, drift):
    """Kolam baseline 'pemilik' + probe: sebagian pemilik, sebagian menyimpang."""
    r = lcg(seed)
    d = len(bg.F4)
    center = [round((r() * 2 - 1) * 3.0, ROUND) for _ in range(d)]
    baseline = []
    for _ in range(n_baseline):
        baseline.append([round(center[i] + (r() * 2 - 1) * 0.8, ROUND) for i in range(d)])
    probes = []
    for k in range(n_probe):
        # probe genap = mirip pemilik, probe ganjil = geser sejauh `drift`
        shift = 0.0 if k % 2 == 0 else drift
        probes.append([round(center[i] + (r() * 2 - 1) * 0.8 + shift, ROUND)
                       for i in range(d)])
    return {'id': case_id, 'baseline': baseline, 'probes': probes}


# ---------------------------------------------------------------------------
# KASUS FITUR (SPEC v1.1): event mentah EKSPLISIT -> vektor 28-float
# ---------------------------------------------------------------------------
# base = 2023-11-14T22:13:20.000Z (UTC bulat, aman lintas zona waktu). Timestamp &
# koordinat bilangan bulat, arah gerak dijauhkan dari ambang pi/4, supaya port
# lintas-bahasa stabil (hitungan direction_changes tak rapuh, tak ada NaN).
FBASE = 1700000000000


def _ev(t, ts, **kw):
    e = {'event_type': t, 'timestamp': ts}
    e.update(kw)
    return e


def _fc_rich_desktop():
    ev = [
        _ev('MOUSE_MOVE', FBASE + 0, x=100, y=100),
        _ev('MOUSE_MOVE', FBASE + 50, x=200, y=100),   # kanan
        _ev('MOUSE_MOVE', FBASE + 100, x=300, y=100),  # kanan -> tak belok
        _ev('MOUSE_MOVE', FBASE + 260, x=300, y=0),    # naik -> belok; dt160>100 pause
        _ev('MOUSE_MOVE', FBASE + 300, x=400, y=0),    # kanan -> belok
        _ev('MOUSE_CLICK', FBASE + 400, x=400, y=0),
        _ev('MOUSE_CLICK', FBASE + 700, x=410, y=5),
        _ev('MOUSE_SCROLL', FBASE + 800, x=410, y=5, scroll_delta=120),
        _ev('MOUSE_SCROLL', FBASE + 900, x=410, y=5, scroll_delta=-40),
        _ev('KEYSTROKE', FBASE + 1000, key='h', hold_time=90),
        _ev('KEYSTROKE', FBASE + 1120, key='e', hold_time=85),
        _ev('KEYSTROKE', FBASE + 1230, key='l', hold_time=95),
        _ev('KEYSTROKE', FBASE + 1340, key='l', hold_time=80),
        _ev('KEYSTROKE', FBASE + 1460, key='o', hold_time=88),
        _ev('KEYSTROKE', FBASE + 2000, key='w', hold_time=92),  # jeda>333 putus burst
        _ev('KEYSTROKE', FBASE + 2110, key='o', hold_time=87),
        _ev('FORM_FOCUS', FBASE + 950, page_url='/checkout'),
        _ev('FORM_BLUR', FBASE + 2200, page_url='/checkout'),
        _ev('FORM_FOCUS', FBASE + 2300, page_url='/checkout'),
        _ev('NAVIGATION', FBASE + 300, page_url='/home'),
        _ev('PAGE_STEP', FBASE + 900, page_url='/cart'),
        _ev('NAVIGATION', FBASE + 2400, page_url='/checkout'),
        _ev('CART_ACTION', FBASE + 850, page_url='/cart'),
        _ev('CART_ACTION', FBASE + 2350, page_url='/checkout'),
    ]
    ev.sort(key=lambda e: e['timestamp'])
    return {'id': 'fc01_rich_desktop', 'session_start_ts': FBASE, 'events': ev}


def _fc_keyboard_heavy():
    ev = []
    ts = FBASE
    for i, ch in enumerate('password123'):
        ts += 130 if i else 0
        ev.append(_ev('KEYSTROKE', ts, key=ch, hold_time=70 + (i % 5) * 5))
    ev.append(_ev('KEYSTROKE', ts + 800, key='Enter', hold_time=60))  # putus burst
    ev.append(_ev('FORM_FOCUS', FBASE + 10, page_url='/login'))
    return {'id': 'fc02_keyboard_heavy', 'session_start_ts': FBASE, 'events': ev}


def _fc_mouse_only_velfield():
    ev = [
        _ev('MOUSE_MOVE', FBASE + 0, x=10, y=10, velocity=0.2),   # idle (<0.5)
        _ev('MOUSE_MOVE', FBASE + 40, x=30, y=12, velocity=0.9),
        _ev('MOUSE_MOVE', FBASE + 90, x=70, y=40, velocity=1.4),
        _ev('MOUSE_MOVE', FBASE + 130, x=70, y=90, velocity=1.1),
        _ev('MOUSE_CLICK', FBASE + 200, x=70, y=90),
    ]
    return {'id': 'fc03_mouse_only_velfield', 'session_start_ts': FBASE, 'events': ev}


def _fc_sparse_edges():
    ev = [
        _ev('MOUSE_MOVE', FBASE + 0, x=5, y=5),
        _ev('MOUSE_MOVE', FBASE + 0, x=9, y=9),   # dt=0 -> dilewati
        _ev('KEYSTROKE', FBASE + 0),              # tanpa key/hold_time
        _ev('NAVIGATION', FBASE + 0),             # tanpa page_url
    ]
    return {'id': 'fc04_sparse_edges', 'session_start_ts': FBASE, 'events': ev}


def _fc_atan2_pi4_edges():
    # C-34: pasangan gerakan NYATA dari basis data riset yang selisih arahnya tepat pi/4
    # dan dulu berbalik antara JS (V8) dan Python (libm). Tiap pasang dipisah gerakan
    # sumbu-x supaya last_dir diset ulang dengan pasti.
    pairs = [((-5, -1), (-2, -3)), ((-1, -6), (5, -7)), ((6, -15), (-3, -7)),
             ((-3, -7), (2, -5)), ((-25, 5), (-8, 12)), ((1, 0), (1, 1)), ((4, 4), (0, 1))]
    ev, x, y, t = [], 500, 500, FBASE
    ev.append(_ev('MOUSE_MOVE', t, x=x, y=y))
    for a, b in pairs:
        for dx, dy in (a, b, (40, 0)):
            t += 50; x += dx; y += dy
            ev.append(_ev('MOUSE_MOVE', t, x=x, y=y, velocity=0.8))
    return {'id': 'fc05_atan2_pi4_edges', 'session_start_ts': FBASE, 'events': ev}


def make_feature_cases():
    return [_fc_rich_desktop(), _fc_keyboard_heavy(),
            _fc_mouse_only_velfield(), _fc_sparse_edges(), _fc_atan2_pi4_edges()]


def build():
    cases = [
        # n_baseline sengaja beda-beda: 12 (svm aktif, >=20? tidak -> tergerbang),
        # 24 (svm aktif), 10 (persis batas enrollment)
        make_case('c01_pool12_drift2', 42, 12, 6, 2.0),
        make_case('c02_pool24_drift4', 7, 24, 6, 4.0),
        make_case('c03_pool10_drift0', 1234, 10, 4, 0.0),
    ]
    feature_cases = make_feature_cases()
    out = {
        'spec_version': SPEC_VERSION,
        'tolerance': 1e-9,
        'note': ('Kontrak numerik lintas-bahasa. Setiap implementasi (JS/Python/Go/…) '
                 'wajib menghasilkan angka ini dari input yang sama.'),
        'features': bg.F4,
        'config': {
            'baseline': bg.DEFAULTS['baseline'],
            'weights': bg.DEFAULTS['weights'],
            'q_low': bg.DEFAULTS['q_low'],
            'q_med': bg.DEFAULTS['q_med'],
            'iforest': bg.DEFAULTS['iforest'],
            'ensembleMinSamples': bg.DEFAULTS['ensembleMinSamples'],
            'stdFloorEps': bg.DEFAULTS['stdFloorEps'],
            'stdFloorValue': bg.DEFAULTS['stdFloorValue'],
            'scoreStdMin': bg.DEFAULTS['scoreStdMin'],
            'scoreStdMax': bg.DEFAULTS['scoreStdMax'],
            'zClamp': bg.DEFAULTS['zClamp'],
            # C-33: dicatat eksplisit supaya kontrak numerik tidak diam-diam ikut default
            'calibrationMode': 'parametric',
            'k_low': bg.DEFAULTS['k_low'],
            'k_med_extra': bg.DEFAULTS['k_med_extra'],
        },
        # SPEC v1.1: event mentah -> vektor 28-float
        'feature_cases': [],
        # SPEC v1.0: vektor 28-float -> vonis
        'cases': [],
    }
    for fc in feature_cases:
        feat = bg.extract_features(fc['events'], fc['session_start_ts'])
        out['feature_cases'].append({
            'id': fc['id'],
            'session_start_ts': fc['session_start_ts'],
            'events': fc['events'],
            'expect_vector': bg.features_to_vector(feat),
        })
    for c in cases:
        model = bg.build_model(c['baseline'])
        verdicts = []
        for p in c['probes']:
            v = bg.score_vector(model, p)
            verdicts.append({
                'level': v['level'],
                'score': v['score'],
                'action': v['action'],
                'topFeature': v['topFeatures'][0]['name'],
            })
        out['cases'].append({
            'id': c['id'],
            'baseline': c['baseline'],
            'probes': c['probes'],
            'expect': {
                'thresholds': model['thresholds'],
                # jejak antara: bikin kegagalan port bisa dilokalisasi, bukan cuma "beda"
                'stats_mean_head': model['stats']['mean'][:4],
                'stats_std_head': model['stats']['std'][:4],
                'if_stats': model['ensemble'].if_stats,
                'svm_stats': model['ensemble'].svm_stats,
                'gated_weights': model['ensemble'].gated_weights,
                'verdicts': verdicts,
            },
        })
    return out


def main():
    out = build()
    dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'golden.json')
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
    n_probe = sum(len(c['probes']) for c in out['cases'])
    print('OK -> core/golden.json (%d kasus fitur, %d kasus mesin, %d probe, %.1f KB)'
          % (len(out['feature_cases']), len(out['cases']), n_probe,
             os.path.getsize(dest) / 1024))
    for fc in out['feature_cases']:
        nz = sum(1 for v in fc['expect_vector'] if v != 0)
        print('  %-24s %d event -> vektor %d/28 nonzero'
              % (fc['id'], len(fc['events']), nz))
    for c in out['cases']:
        lv = [v['level'] for v in c['expect']['verdicts']]
        print('  %-20s thresholds low=%.6f med=%.6f  verdict=%s'
              % (c['id'], c['expect']['thresholds']['low'],
                 c['expect']['thresholds']['medium'], ','.join(lv)))


if __name__ == '__main__':
    main()
