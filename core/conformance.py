#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
conformance.py - uji apakah sebuah implementasi mesin SESUAI core/golden.json.

Ini yang bikin "satu otak" bisa dibuktikan, bukan cuma diklaim. Implementasi
bahasa apa pun dinyatakan sah HANYA kalau lulus berkas golden yang sama.

  python core/conformance.py              # uji implementasi acuan (bg_core.py)
  python core/conformance.py --verbose    # tampilkan tiap probe

Untuk implementasi JS: buka core/conformance.html lewat server lokal - logika
pemeriksaannya identik dengan berkas ini.
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bg_core as bg  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))


def close(a, b, tol):
    if a == b:
        return True
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def run(verbose=False):
    with open(os.path.join(HERE, 'golden.json'), encoding='utf-8') as f:
        g = json.load(f)
    tol = g['tolerance']
    passed = failed = 0
    problems = []

    # --- SPEC v1.1: ekstraksi fitur (event mentah -> vektor 34-float) ---
    for fcase in g.get('feature_cases', []):
        got_vec = bg.features_to_vector(
            bg.extract_features(fcase['events'], fcase.get('session_start_ts')))
        want_vec = fcase['expect_vector']
        for i, want in enumerate(want_vec):
            ok = close(got_vec[i], want, tol)
            if ok:
                passed += 1
            else:
                failed += 1
                problems.append('%s / vector[%d] (%s): got %r, want %r'
                                % (fcase['id'], i, g['features'][i], got_vec[i], want))

    for case in g['cases']:
        model = bg.build_model(case['baseline'])
        exp = case['expect']

        def check(label, got, want):
            nonlocal passed, failed
            ok = close(got, want, tol) if isinstance(want, (int, float)) else got == want
            if ok:
                passed += 1
            else:
                failed += 1
                problems.append('%s / %s: got %r, want %r' % (case['id'], label, got, want))
            return ok

        check('thresholds.low', model['thresholds']['low'], exp['thresholds']['low'])
        check('thresholds.medium', model['thresholds']['medium'], exp['thresholds']['medium'])
        for i, want in enumerate(exp['stats_mean_head']):
            check('stats.mean[%d]' % i, model['stats']['mean'][i], want)
        for i, want in enumerate(exp['stats_std_head']):
            check('stats.std[%d]' % i, model['stats']['std'][i], want)
        for k in ('mean', 'std'):
            check('if_stats.' + k, model['ensemble'].if_stats[k], exp['if_stats'][k])
            check('svm_stats.' + k, model['ensemble'].svm_stats[k], exp['svm_stats'][k])
        for k, want in exp['gated_weights'].items():
            check('gated_weights.' + k, model['ensemble'].gated_weights[k], want)

        for i, probe in enumerate(case['probes']):
            v = bg.score_vector(model, probe)
            w = exp['verdicts'][i]
            ok_s = check('probe[%d].score' % i, v['score'], w['score'])
            ok_l = check('probe[%d].level' % i, v['level'], w['level'])
            check('probe[%d].action' % i, v['action'], w['action'])
            check('probe[%d].topFeature' % i, v['topFeatures'][0]['name'], w['topFeature'])
            if verbose:
                print('  %s probe[%d] %-6s score=%+.9f %s'
                      % (case['id'], i, v['level'], v['score'],
                         'OK' if (ok_s and ok_l) else 'DIFF'))

    print()
    print('CONFORMANCE  spec %s  tolerance %g' % (g['spec_version'], tol))
    print('  passed %d / %d' % (passed, passed + failed))
    if problems:
        print('  FAILED:')
        for p in problems[:25]:
            print('    - ' + p)
        if len(problems) > 25:
            print('    ... %d more' % (len(problems) - 25))
    print('  RESULT: %s' % ('PASS' if failed == 0 else 'FAIL'))
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('--verbose', action='store_true')
    sys.exit(run(ap.parse_args().verbose))
