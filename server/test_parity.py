"""
test_parity.py - the server engine reaches the same decisions as the SDK.

Runs tools/parity_check.mjs (the SDK's own _ingestVector) and replays the identical window
sequence through server/engine.py. Every window must match: level, action, eligibility,
convergence, gate reopening, block, replay, grace, re-verification, enrollment progress,
the risk floor, the model's training-set size, the thresholds and the score (within the
spec's 1e-9 relative tolerance).

Run: python server/test_parity.py   (needs node on PATH, or set NODE=path/to/node)
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import engine as E  # noqa: E402


def close(a, b, tol=1e-9):
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def main():
    node = os.environ.get('NODE', 'node')
    js = json.loads(subprocess.check_output([node, os.path.join(ROOT, 'tools', 'parity_check.mjs')], cwd=ROOT))
    eng = E.Engine(model_cache={})
    acc, ses = E.new_account(), E.new_session()
    ses['sid'] = 's1'
    key = ('pk', 'parity')
    fails, n = [], 0
    for i, row in enumerate(js):
        step = row['step']
        if step['kind'] == 'verify':
            eng.apply_verified(acc, ses, row.get('now') or js[i - 1]['now'] + 31000, None, key)
            m = eng.model(acc, key)
            got = {'risk': acc['lastRisk'], 'model': m.n if m else 0}
            want = {'risk': row['risk'], 'model': row['model']}
            n += 1
            if got != want:
                fails.append((i, 'verify', got, want))
            continue
        win = {'vector': row['vector'], 'events': row['events'], 'activeSec': 30,
               'keystrokeBypassed': bool(step.get('keystrokeBypassed')), 'synthetic': row['synthetic']}
        if step.get('away'):
            win['away'] = {'awayMs': step['away'], 'reason': 'no-input'}
        evt = eng.assess(acc, ses, win, row['now'], key)
        m = eng.model(acc, key)
        got = {
            'level': evt['level'], 'action': evt['action'], 'eligible': evt['eligible'],
            'convergence': evt.get('convergence'), 'gateReopened': bool(evt.get('gateReopened')),
            'blocked': bool(evt.get('blocked')), 'replay': bool(evt.get('replay')),
            'stepUpGrace': bool(evt.get('stepUpGrace')), 'reverify': bool(evt.get('reverifyAfterAway')),
            'enrollment': evt['enrollment']['done'] if evt.get('enrollment') else None,
            'lastRisk': acc['lastRisk'], 'model': m.n if m else 0,
        }
        want = {k: row[k] for k in got}
        n += 1
        if got != want:
            fails.append((i, step['kind'], {k: got[k] for k in got if got[k] != want[k]},
                          {k: want[k] for k in got if got[k] != want[k]}))
        if not close(evt.get('score'), row['score']):
            fails.append((i, 'score', evt.get('score'), row['score']))
        th, wt = evt.get('thresholds'), row.get('thresholds')
        if row['enrollment'] is None and wt:
            if not th or not close(th['low'], wt['low']) or not close(th['medium'], wt['medium']):
                fails.append((i, 'thresholds', th, wt))
    levels = {}
    for r in js:
        if 'level' in r:
            levels[r['level']] = levels.get(r['level'], 0) + 1
    print('PARITY engine.py vs sdk/behaviorguard.js: %d windows, levels %s' % (n, levels))
    for f in fails[:20]:
        print('  DIFF', f)
    print('RESULT:', 'PASS' if not fails else 'FAIL (%d)' % len(fails))
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(main())
