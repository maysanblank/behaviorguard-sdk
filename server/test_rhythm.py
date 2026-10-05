"""
test_rhythm.py - server/rhythm.py makes the same decisions as sdk/core/challenge.js.

Builds templates from generated enrollment samples and verifies owner, impostor, tempo-
shifted, incomplete and wrong-keyboard samples with both implementations.

Run: python server/test_rhythm.py   (needs node on PATH, or set NODE=path/to/node)
"""
import json
import os
import random
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import rhythm  # noqa: E402

JS = r"""
import { buildTemplate, verify } from './sdk/core/challenge.js';
let raw = ''; for await (const c of process.stdin) raw += c;
const cases = JSON.parse(raw);
const out = cases.map(c => {
  const t = buildTemplate(c.enroll);
  return { t, v: c.tries.map(s => { const r = verify(s, t); return { ok: r.ok, misses: r.misses, budget: r.budget, mm: !!r.modeMismatch }; }) };
});
process.stdout.write(JSON.stringify(out));
"""


def person(rng, n):
    return {'dwell': [rng.uniform(70, 160) for _ in range(n)], 'flight': [rng.uniform(40, 260) for _ in range(n - 1)]}


def sample(rng, p, jitter, tempo=1.0, mode=None):
    s = {'dwell': [max(5, d * tempo * (1 + rng.uniform(-jitter, jitter))) for d in p['dwell']],
         'flight': [max(5, f * tempo * (1 + rng.uniform(-jitter, jitter))) for f in p['flight']]}
    if mode:
        s['mode'] = mode
    return s


def main():
    rng = random.Random(3)
    cases = []
    for k in range(40):
        n = rng.choice([8, 12, 20, 25])
        owner, other = person(rng, n), person(rng, n)
        enroll = [sample(rng, owner, 0.08) for _ in range(3)]
        tries = [sample(rng, owner, 0.10), sample(rng, owner, 0.12, tempo=1.3), sample(rng, other, 0.08),
                 {'dwell': enroll[0]['dwell'][:-2], 'flight': enroll[0]['flight']},
                 sample(rng, owner, 0.05, mode='soft')]
        if k % 10 == 0:
            enroll = enroll[:1]          # one round is not a template
        cases.append({'enroll': enroll, 'tries': tries})
    node = os.environ.get('NODE', 'node')
    js = json.loads(subprocess.run([node, '--input-type=module', '-e', JS], input=json.dumps(cases).encode(),
                                  cwd=ROOT, capture_output=True, check=True).stdout)
    fails, ok_owner, ok_other = [], 0, 0
    for i, (c, j) in enumerate(zip(cases, js)):
        t = rhythm.build_template(c['enroll'])
        if (t is None) != (j['t'] is None):
            fails.append((i, 'template', t is None, j['t'] is None))
            continue
        if t is None:
            continue
        for key in ('dwell', 'flight', 'dwellMad', 'flightMad'):
            if any(abs(a - b) > 1e-9 for a, b in zip(t[key], j['t'][key])):
                fails.append((i, key))
        for k, (s, jv) in enumerate(zip(c['tries'], j['v'])):
            r = rhythm.verify(s, t)
            got = {'ok': r['ok'], 'misses': r['misses'], 'budget': r['budget'], 'mm': bool(r.get('modeMismatch'))}
            if got != jv:
                fails.append((i, k, got, jv))
            if k == 0 and r['ok']:
                ok_owner += 1
            if k == 2 and r['ok']:
                ok_other += 1
    print('RHYTHM rhythm.py vs challenge.js: %d cases, owner passed %d, other person passed %d' % (len(cases), ok_owner, ok_other))
    for f in fails[:10]:
        print('  DIFF', f)
    print('RESULT:', 'PASS' if not fails else 'FAIL (%d)' % len(fails))
    return 0 if not fails else 1


if __name__ == '__main__':
    sys.exit(main())
