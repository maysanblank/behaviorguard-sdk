"""
rhythm.py - typing-rhythm step-up, checked on the server.

A line-by-line port of sdk/core/challenge.js (buildTemplate, verify). The browser records
how long each key of the phrase is held (dwell) and the gap to the next key (flight), and
sends only those numbers. The template is built and kept here, never in the browser, so a
script running in the page (XSS, a malicious extension) cannot read the owner's rhythm and
replay it. server/test_rhythm.py checks this port against the JavaScript on the same
samples.

Fail-closed: a sample that is incomplete, not finite, a different length from the template,
or from a different keyboard type is rejected, never compared.
"""
import math

MIN_DWELL_POINTS = 8
MAD_FLOOR_MS = 3
MAD_FLOOR_REL = 0.12
MAD_CEIL_REL = 0.50
MISS_BUDGET_REL = 0.12
K_DEFAULT = 2.5
TEMPO_RATIO_LO, TEMPO_RATIO_HI = 0.5, 2.0
MAX_POINTS = 200     # a phrase longer than this is not a phrase


def _finite_list(a, n):
    if not isinstance(a, list) or len(a) != n:
        return False
    for x in a:
        if isinstance(x, bool) or not isinstance(x, (int, float)) or not math.isfinite(x):
            return False
    return True


def _median(sorted_vals):
    n = len(sorted_vals)
    if not n:
        return 0
    mid = n >> 1
    return sorted_vals[mid] if n % 2 else (sorted_vals[mid - 1] + sorted_vals[mid]) / 2


def _clamped_mad(vals, med):
    raw = sum(abs(v - med) for v in vals) / len(vals)
    floor = max(MAD_FLOOR_MS, MAD_FLOOR_REL * med)
    ceil = max(floor, MAD_CEIL_REL * med)
    return min(max(raw, floor), ceil)


def _axis(samples, key):
    n = len(samples[0][key])
    med, mad = [], []
    for i in range(n):
        vals = sorted(s[key][i] for s in samples)
        m = _median(vals)
        med.append(m)
        mad.append(_clamped_mad(vals, m))
    return med, mad


def _mode(s):
    return 'soft' if isinstance(s, dict) and s.get('mode') == 'soft' else 'hard'


def build_template(samples):
    if not isinstance(samples, list) or len(samples) < 2 or len(samples) > 10:
        return None
    s0 = samples[0] if isinstance(samples[0], dict) else {}
    nD = len(s0['dwell']) if isinstance(s0.get('dwell'), list) else 0
    nF = len(s0['flight']) if isinstance(s0.get('flight'), list) else 0
    if nD < MIN_DWELL_POINTS or nD > MAX_POINTS or nF > MAX_POINTS:
        return None
    mode = _mode(s0)
    for s in samples:
        if not isinstance(s, dict) or not _finite_list(s.get('dwell'), nD) or not _finite_list(s.get('flight'), nF):
            return None
        if _mode(s) != mode:
            return None
    clean = [{'dwell': [float(x) for x in s['dwell']], 'flight': [float(x) for x in s['flight']]} for s in samples]
    d_med, d_mad = _axis(clean, 'dwell')
    f_med, f_mad = _axis(clean, 'flight')
    return {'v': 2, 'mode': mode, 'dwell': d_med, 'dwellMad': d_mad,
            'flight': f_med, 'flightMad': f_mad, 'k': K_DEFAULT, 'rounds': len(samples)}


def verify(sample, tmpl):
    if not tmpl or not isinstance(tmpl.get('dwell'), list) or not isinstance(tmpl.get('flight'), list):
        return {'ok': False, 'reasons': ['no template'], 'checks': 0, 'misses': 0, 'budget': 0}
    nD, nF = len(tmpl['dwell']), len(tmpl['flight'])
    if not isinstance(sample, dict) or not _finite_list(sample.get('dwell'), nD) or not _finite_list(sample.get('flight'), nF):
        gD = len(sample['dwell']) if isinstance(sample, dict) and isinstance(sample.get('dwell'), list) else 0
        gF = len(sample['flight']) if isinstance(sample, dict) and isinstance(sample.get('flight'), list) else 0
        return {'ok': False,
                'reasons': ['incomplete rhythm: dwell %d/%d, flight %d/%d (paste/autofill is not accepted)' % (gD, nD, gF, nF)],
                'checks': nD + nF, 'misses': nD + nF, 'budget': 0}
    if _mode(sample) != _mode(tmpl):
        return {'ok': False, 'modeMismatch': True,
                'reasons': ['different keyboard type than at enrollment (%s vs %s)' % (_mode(tmpl), _mode(sample))],
                'checks': nD + nF, 'misses': nD + nF, 'budget': 0}
    soft = _mode(tmpl) == 'soft'
    k = tmpl['k'] if isinstance(tmpl.get('k'), (int, float)) and math.isfinite(tmpl['k']) else K_DEFAULT
    reasons = []

    def ratio(num, den):
        if not (den > 0) or not math.isfinite(num):
            return 1
        return min(max(num / den, TEMPO_RATIO_LO), TEMPO_RATIO_HI)

    rD = ratio(_median(sorted(tmpl['dwell'])), _median(sorted(sample['dwell'])))
    rF = ratio(_median(sorted(tmpl['flight'])), _median(sorted(sample['flight'])))
    if not soft:
        for i in range(nD):
            lim = k * tmpl['dwellMad'][i]
            d = abs(sample['dwell'][i] * rD - tmpl['dwell'][i])
            if d > lim:
                reasons.append('dwell %d %.1f>%.1f' % (i, d, lim))
    for i in range(nF):
        lim = k * tmpl['flightMad'][i]
        d = abs(sample['flight'][i] * rF - tmpl['flight'][i])
        if d > lim:
            reasons.append('flight %d %.1f>%.1f' % (i, d, lim))
    checks = nF if soft else nD + nF
    budget = max(1, int(math.floor(MISS_BUDGET_REL * checks)))
    return {'ok': len(reasons) <= budget, 'reasons': reasons, 'checks': checks,
            'misses': len(reasons), 'budget': budget}
