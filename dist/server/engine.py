"""
engine.py - the BehaviorGuard decision engine, running on the server.

The browser captures behavior and turns each 30-second window into 34 numbers. Everything
that decides anything happens here: the account's profile, enrollment, training, scoring,
the replay check, the sticky risk floor, re-verification after an absence, the step-up
grace period, the consecutive-HIGH block and the retraining schedule.

This is a line-by-line port of BehaviorGuard._ingestVector in sdk/behaviorguard.js (spec
1.4.0), built on core/bg_core.py, which is proven numerically identical to the JavaScript
engine by core/golden.json. tools/parity_check.mjs feeds the same window sequence to both
and checks they reach the same verdict, score and model state on every window.

Pure: no I/O, no clock, no globals. Every method takes the state it works on and the time
`now` in milliseconds; guard.py loads and stores the state.

Two kinds of state:
  account  - one per user: the profile (scored windows), the training state, the typing-
             rhythm template, the risk floor and the consecutive-HIGH count. It follows the
             account to any device, which is the point of running on the server.
  session  - one per login: the step-up grace period and the rhythm attempts of this login.
             A verification proves who sits in THIS session, so another session (an attacker
             on another laptop) never inherits it.
"""
import math
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_CORE = os.path.join(os.path.dirname(_HERE), 'core')
for _p in (_CORE, _HERE):
    if _p not in sys.path:
        sys.path.insert(0, _p)
import bg_core as B  # noqa: E402
import rhythm  # noqa: E402

FEATURES = list(B.F4)
RHYTHM_C44 = {'keystroke_flight_median', 'keystroke_flight_iqr', 'keystroke_backspace_ratio',
              'keystroke_cross_hand_ratio', 'keystroke_dwell_median', 'keystroke_shift_ratio'}

# The shipped defaults (sdk/core/config.js). bg_core.DEFAULTS is the spec's numeric core;
# the orchestrator values below are the ones the SDK ships with.
CFG = dict(B.DEFAULTS)
CFG.update({
    'progressiveMaxPool': 90,
    'historyMax': 240,
    'replayEps': 0.05,
    'progressiveDupEps': 1e-3,
    'blockAfterConsecutiveHigh': 2,
    'session': {'minEventsAssess': 150, 'minEventsTrain': 100, 'minDurationSec': 5.0,
                'minNonZeroFeatures': 6, 'windowSec': 30},
    'idle': {'awaySec': 300, 'reverifyAfterSec': 900},
    'mfa': {'graceSec': 900, 'lockAfterFailures': 3, 'attempts': 3},
    'probe': {'minEvents': 30},
    # Server-only option (no browser counterpart, off by default so the parity tests hold):
    # a brand-new account learns only from logins that passed a verification. Closes the
    # gap where a stolen password used before the owner's first sessions would be enrolled.
    'enrollRequiresVerified': False,
})

_ORDER = {'LOW': 0, 'MEDIUM': 1, 'HIGH': 2}
_TEMPORAL = {i for i, f in enumerate(FEATURES) if f.startswith('temporal_')}
_BEHAVIORAL = [i for i in range(len(FEATURES)) if i not in _TEMPORAL]
_REPLAY_IDX = [i for i in range(len(FEATURES)) if i not in _TEMPORAL and FEATURES[i] not in RHYTHM_C44]


def new_account():
    return {
        'windows': [],          # [{v, risk, score, eligible, mfa, ts, sid, id}]
        'newSince': 0,          # eligible LOW windows since the last rebuild
        'modelVecs': None,      # the exact training set of the current model
        'modelVersion': 0,
        'lastRisk': 'LOW',      # sticky floor
        'lowStreak': 0,
        'highRun': 0,
        'template': None,       # typing-rhythm template (never sent to the browser)
        'failStreak': 0,        # rhythm dialogs failed in a row, across sessions
        'seq': 0,               # verdict counter
    }


def new_session():
    return {
        'mfaPassedAt': None,    # step-up grace starts here (this login only)
        'rhythmFails': 0,       # failed attempts in the current rhythm dialog
        'lastActiveAt': None,   # last window or probe from this login
        'lastWindowId': None,
        'lastVerdict': None,
        'probe': None,          # last assessNow() result, for the site's own server-side gate
        'away': None,           # an absence reported by the browser, not yet answered
        'highRun': 0,           # HIGH verdicts in a row in THIS login (the block rule)
    }


# ---------------------------------------------------------------- model
class Model:
    """The ensemble built from one training set. Deterministic: the same vectors always
    give the same model, so it can be rebuilt from `modelVecs` after a restart."""

    def __init__(self, vecs, cfg=CFG):
        self.n = len(vecs)
        self.stats = B.compute_stats(vecs, cfg)
        X = B.standardize_batch(vecs, self.stats)
        iff = B.IsolationForest(**cfg['iforest'])
        iff.fit(X)
        # C-22: shrinkage adapts to the sample/dimension ratio (see sdk _rebuildModel)
        nfe = len(cfg['features'])
        shrink = min(0.9, max(cfg['mahalanobis']['shrink'], nfe / max(1, self.n)))
        det2 = B.Mahalanobis(shrink=shrink, n_features=nfe)
        det2.fit(X)
        self.ens = B.Ensemble(iff, det2, cfg['weights'], self.n, cfg)
        self.ens.calibrate(X, self.n)
        base = [self.ens.score_one(x) for x in X]
        self.thresholds = B.calibrate_thresholds_parametric(base, cfg['k_low'], cfg['k_med_extra'])

    def std(self, vec):
        return B.standardize(vec, self.stats)

    def score(self, xstd):
        return self.ens.score_one(xstd)


def _finite(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


class Engine:
    def __init__(self, cfg=None, model_cache=None):
        self.cfg = cfg or CFG
        self._cache = model_cache if model_cache is not None else {}

    # ---------------------------------------------------------- training set
    def enroll_prefix(self, acc):
        c = 0
        for i, w in enumerate(acc['windows']):
            if w['eligible']:
                c += 1
                if c == self.cfg['baseline']:
                    return i + 1
        return len(acc['windows'])

    def eligible_count(self, acc):
        return sum(1 for w in acc['windows'] if w['eligible'])

    def training_vectors(self, acc):
        W = acc['windows']
        pre = self.enroll_prefix(acc)
        if len(W) <= pre:
            return [w['v'] for w in W if w['eligible']]
        base = [w['v'] for w in W[:pre] if w['eligible']]
        lows = [w['v'] for w in W[pre:] if (w['risk'] == 'LOW' or w['mfa']) and w['eligible']]
        cap = self.cfg['progressiveMaxPool']
        if len(lows) > cap:
            lows = lows[-cap:]
        eps = self.cfg['progressiveDupEps']
        out = []
        for v in lows:
            dup = False
            for u in out:
                s = 0.0
                for i in _BEHAVIORAL:
                    d = v[i] - u[i]
                    s += d * d
                if math.sqrt(s / len(_BEHAVIORAL)) < eps:
                    dup = True
                    break
            if not dup:
                out.append(v)
        return base + out

    def rebuild(self, acc, key=None):
        vecs = self.training_vectors(acc)
        if not vecs:
            return
        acc['newSince'] = 0
        acc['modelVecs'] = [list(v) for v in vecs]
        acc['modelVersion'] = acc.get('modelVersion', 0) + 1
        if key is not None:
            self._cache[key] = (acc['modelVersion'], Model(vecs, self.cfg))

    def model(self, acc, key=None):
        if not acc.get('modelVecs'):
            return None
        if key is not None:
            hit = self._cache.get(key)
            if hit and hit[0] == acc['modelVersion']:
                return hit[1]
        m = Model(acc['modelVecs'], self.cfg)
        if key is not None:
            self._cache[key] = (acc['modelVersion'], m)
        return m

    def _nearest(self, acc, m, xstd):
        best = None
        for w in acc['windows']:
            z = m.std(w['v'])
            s = 0.0
            for i in _REPLAY_IDX:
                d = xstd[i] - z[i]
                s += d * d
            dist = math.sqrt(s / len(_REPLAY_IDX))
            if best is None or dist < best[0]:
                best = (dist, w['ts'])
        return best

    def _compact(self, acc):
        keep = self.cfg['historyMax']
        pre = self.enroll_prefix(acc)
        W = acc['windows']
        if len(W) > pre + keep:
            acc['windows'] = W[:pre] + W[-keep:]

    # ---------------------------------------------------------- one window
    def assess(self, acc, ses, win, now, key=None):
        """Score one 30-second window. `win` comes from the browser:
            vector      34 numbers (core/SPEC.md order)
            events      events in the window (after duplicate removal and idle compression)
            activeSec   active duration of the window
            keystrokeBypassed  form fields touched but nothing typed (paste / autofill)
            synthetic   script-made inputs seen since the previous window
            integrity   {suspected, reasons} from core/integrity.js (needs raw events)
            gapBeforeMs longest idle gap inside the window
            away        {awayMs, reason}: the longest absence since the previous window
        Returns the verdict event, the same shape the on-device engine emits."""
        S = self.cfg['session']
        vec = [float(x) for x in win['vector']]
        events = int(win.get('events') or 0)
        meta = {}
        idle = {'activeSec': float(win.get('activeSec') or 0), 'gapBeforeMs': float(win.get('gapBeforeMs') or 0)}
        meta['idle'] = idle
        keystroke_bypassed = bool(win.get('keystrokeBypassed'))
        meta['keystrokeBypassed'] = keystroke_bypassed
        nonzero = sum(1 for x in vec if abs(x) > 1e-9)
        eligible = (not keystroke_bypassed and events >= S['minEventsTrain']
                    and idle['activeSec'] >= S['minDurationSec'] and nonzero >= S['minNonZeroFeatures'])
        ses['lastActiveAt'] = now
        # an absence reported by the browser waits here until a verdict answers it
        away = win.get('away')
        if isinstance(away, dict) and _finite(away.get('awayMs')) and away['awayMs'] > 0:
            self._mark_away(ses, float(away['awayMs']), str(away.get('reason') or 'no-input')[:40], now)

        syn = int(win.get('synthetic') or 0)
        synthetic = syn >= 20 and syn >= 0.1 * max(1, events)
        if synthetic:
            eligible = False
        wid = acc['seq'] + 1
        integ = win.get('integrity') or {}
        if integ.get('suspected'):
            reasons = [str(r)[:160] for r in (integ.get('reasons') or [])][:6] or ['input too regular for a human']
            evt = {**meta, 'level': 'HIGH', 'score': -1.5, 'action': 'BLOCK_SESSION', 'blocked': True,
                   'reasons': reasons, 'topFeatures': [], 'eligible': False, 'integrity': True}
            self._push(acc, vec, 'HIGH', -1.5, False, now, ses, wid)
            acc['lastRisk'] = 'HIGH'
            acc['lowStreak'] = 0
            return self._finish(acc, ses, evt, wid, now)

        if self.eligible_count(acc) < self.cfg['baseline']:
            ses['away'] = None     # nothing to compare against yet
            waits = bool(eligible and self.cfg.get('enrollRequiresVerified') and not ses.get('mfaPassedAt'))
            if waits:
                eligible = False
            self._push(acc, vec, 'LOW', 0.0, eligible, now, ses, wid)
            done = self.eligible_count(acc)
            ready = False
            if done >= self.cfg['baseline']:
                self.rebuild(acc, key)
                ready = True
            evt = {**meta, 'level': 'LOW', 'score': 0, 'action': 'ALLOW_SESSION', 'blocked': False,
                   'reasons': ['enrollment %d/%d' % (done, self.cfg['baseline']) if eligible
                               else 'enrollment waits for a verification in this login' if waits
                               else 'ineligible window - not added to the training pool'],
                   'topFeatures': [], 'convergence': 'enrollment', 'eligible': eligible,
                   'enrollment': {'done': done, 'need': self.cfg['baseline'], 'ready': ready,
                                  'waitingForVerification': waits}}
            if synthetic:
                evt['automation'] = {'syntheticInputs': syn}
            return self._finish(acc, ses, evt, wid, now)

        m = self.model(acc, key)
        if m is None:
            self.rebuild(acc, key)
            m = self.model(acc, key)
        xstd = m.std(vec)
        score = m.score(xstd)
        replay = None
        if all(_finite(x) for x in xstd):
            near = self._nearest(acc, m, xstd)
            if near and near[0] < self.cfg['replayEps']:
                replay = {'distance': near[0], 'matchedTs': near[1]}
                meta['replay'] = replay
                eligible = False
        if not _finite(score):
            evt = {**meta, 'level': 'HIGH', 'score': None, 'action': 'REQUIRE_STEPUP', 'blocked': False,
                   'reasons': ['non-finite score - model or statistics corrupted'], 'topFeatures': [],
                   'eligible': False, 'degraded': True}
            self._push(acc, vec, 'HIGH', None, False, now, ses, wid)
            return self._finish(acc, ses, evt, wid, now)

        thresholds = dict(m.thresholds)
        level = B.to_risk(score, thresholds)
        if replay:
            level = 'HIGH'
        if idle['gapBeforeMs'] >= self.cfg['idle']['awaySec'] * 1000:
            self._mark_away(ses, idle['gapBeforeMs'], 'gap-between-segments', now)
        away_info = None
        if ses.get('away'):
            away_info = dict(ses['away'])
            ses['away'] = None
            acc['lowStreak'] = 0
        model_level, model_score = level, score
        sticky = False
        acc['lowStreak'] = acc['lowStreak'] + 1 if level == 'LOW' else 0
        if acc['lowStreak'] >= 3 and _ORDER[acc['lastRisk']] > _ORDER[level]:
            acc['lastRisk'] = {2: 'MEDIUM', 1: 'LOW', 0: 'LOW'}[_ORDER[acc['lastRisk']]]
            if _ORDER[level] < _ORDER[acc['lastRisk']]:
                level = acc['lastRisk']
                sticky = True
        elif _ORDER[level] < _ORDER[acc['lastRisk']]:
            level = acc['lastRisk']
            sticky = True
        if _ORDER[level] > _ORDER[acc['lastRisk']]:
            acc['lastRisk'] = level
            acc['lowStreak'] = 0
        reverify = False
        if away_info and away_info['awayMs'] >= self.cfg['idle']['reverifyAfterSec'] * 1000 and level == 'LOW':
            level = 'MEDIUM'
            reverify = True
            if _ORDER[level] > _ORDER[acc['lastRisk']]:
                acc['lastRisk'] = level
                acc['lowStreak'] = 0
        grace_ms = self.cfg['mfa']['graceSec'] * 1000
        if away_info:
            ses['mfaPassedAt'] = None
        grace = None
        if (grace_ms > 0 and level == 'MEDIUM' and not replay and not reverify and ses.get('mfaPassedAt')
                and now - ses['mfaPassedAt'] < grace_ms):
            grace = {'verifiedAgoSec': round((now - ses['mfaPassedAt']) / 1000), 'wasLevel': level}
            level = 'LOW'
            acc['lastRisk'] = 'LOW'
            eligible = False
        if keystroke_bypassed and level == 'LOW':
            acc['lowStreak'] = max(0, (acc['lowStreak'] or 1) - 1)
        top = [{'name': t['name'], 'z': t['z']} for t in B.top_features(xstd, self.cfg['features'], 3)]
        action = B.to_action(level)
        reasons = B.reasons_from(top)
        if keystroke_bypassed:
            reasons = ['keystroke evidence bypassed (autofill/paste) - the typing-rhythm block was not assessed'] + reasons
        if synthetic:
            reasons = ['%d inputs were made by a script (not a keyboard or mouse) - not counted as behavior, '
                       'this window does not train the model' % syn] + reasons
        if replay:
            reasons = ['behavior identical to an earlier session (distance %.4f) - likely a replay' % replay['distance']] + reasons
        if reverify:
            reasons = ['returned after %d minutes away (%s) - verify again'
                       % (round(away_info['awayMs'] / 60000), away_info['reason'])] + reasons
        if grace:
            reasons = ['model: MEDIUM, not asked again - verified %d minutes ago' % round(grace['verifiedAgoSec'] / 60)] + reasons
        if level == 'HIGH' and acc.get('template'):
            action = 'REQUIRE_CHALLENGE'
            reasons = reasons + ['challenge: retype the phrase, typing rhythm is checked']
        # The run rule counts THIS login's verdicts. The floor above is the account's, so after
        # someone else's HIGH the owner's next window is HIGH too and asks them to verify; but a
        # run counted across logins would make an attacker's two windows end the OWNER's login
        # on its very next window, before they could verify (a lock-out for free).
        ses['highRun'] = (ses.get('highRun') or 0) + 1 if level == 'HIGH' else 0
        blocked = False
        if level == 'HIGH' and ses['highRun'] >= self.cfg['blockAfterConsecutiveHigh']:
            action = 'BLOCK_SESSION'
            blocked = True
        evt = {**meta, 'level': level, 'score': score, 'action': action, 'blocked': blocked,
               'consecutiveHigh': ses['highRun'], 'reasons': reasons, 'topFeatures': top,
               'thresholds': thresholds, 'eligible': eligible, 'modelLevel': model_level,
               'modelScore': model_score, 'stickyFloor': sticky, 'resumedAfterAway': away_info,
               'reverifyAfterAway': reverify, 'stepUpGrace': grace,
               'partialEvidence': 'keystroke' if keystroke_bypassed else None,
               'automation': {'syntheticInputs': syn} if synthetic else None}
        self._push(acc, vec, level, score, eligible, now, ses, wid)
        train = self.training_vectors(acc)
        gate = self.cfg['ensembleMinSamples']['svm']
        if m.n < gate <= len(train):
            self.rebuild(acc, key)
            evt['gateReopened'] = True
        if eligible and level == 'LOW':
            acc['newSince'] += 1
        if acc['newSince'] >= self.cfg['retrainEvery']:
            recent = [w['risk'] for w in acc['windows'][-self.cfg['convergence']['window']:]]
            converged = len(recent) >= self.cfg['convergence']['window'] and all(r == 'LOW' for r in recent)
            evt['convergence'] = 'window-only'
            if not converged:
                self.rebuild(acc, key)
        else:
            evt['convergence'] = 'no-retrain'
            if self.eligible_count(acc) == self.cfg['baseline']:
                self.rebuild(acc, key)
        return self._finish(acc, ses, evt, wid, now)

    def _mark_away(self, ses, away_ms, reason, at):
        cur = ses.get('away')
        if cur and cur['awayMs'] >= away_ms:
            return
        ses['away'] = {'awayMs': away_ms, 'reason': reason, 'at': at}

    def _push(self, acc, vec, risk, score, eligible, now, ses, wid):
        acc['windows'].append({'v': vec, 'risk': risk, 'score': score, 'eligible': bool(eligible),
                               'mfa': False, 'ts': now, 'sid': ses.get('sid'), 'id': wid})

    def _finish(self, acc, ses, evt, wid, now):
        self._compact(acc)
        acc['seq'] = wid
        evt['id'] = wid
        evt['at'] = now
        ses['lastWindowId'] = wid
        ses['lastVerdict'] = {'level': evt['level'], 'action': evt['action'], 'score': evt.get('score'),
                              'blocked': bool(evt.get('blocked')), 'at': now, 'id': wid,
                              'reasons': list(evt.get('reasons') or [])[:3],
                              'enrollment': bool(evt.get('enrollment'))}
        return evt

    # ---------------------------------------------------------- verification
    def apply_verified(self, acc, ses, now, window_id=None, key=None):
        """A verification PASSED in this session (typing rhythm checked here, or the site's
        own server-checked factor). Clears the floor, starts the grace period for THIS login,
        and lets the window that triggered it train the model - only if it belongs to this
        session and is fresh: a verification proves who sits here now, not who sat here
        ten minutes ago."""
        ses['mfaPassedAt'] = now
        ses['away'] = None
        ses['rhythmFails'] = 0
        ses['highRun'] = 0
        acc['lastRisk'] = 'LOW'
        acc['lowStreak'] = 0
        acc['failStreak'] = 0
        sid = ses.get('sid')
        mine = [w for w in acc['windows'] if w.get('sid') == sid]
        target = None
        if mine:
            last = mine[-1]
            if window_id is not None:
                if last['id'] == window_id and now - last['ts'] <= 10 * 60 * 1000:
                    target = last
            elif now - last['ts'] <= 2 * self.cfg['session']['windowSec'] * 1000:
                target = last
        trained = False
        if target is not None and not target['mfa']:
            target['mfa'] = True
            self.rebuild(acc, key)
            trained = True
        return {'verified': True, 'trained': trained}

    def rhythm_verify(self, acc, ses, sample, now, window_id=None, key=None):
        tmpl = acc.get('template')
        lock_n = self.cfg['mfa']['lockAfterFailures']
        if not tmpl:
            return {'ok': False, 'unavailable': True, 'reason': 'no typing-rhythm template for this account'}
        if lock_n > 0 and acc['failStreak'] >= lock_n:
            return {'ok': False, 'locked': True, 'reason': 'typing-rhythm verification is locked after failures in a row'}
        res = rhythm.verify(sample, tmpl)
        if res['ok']:
            out = self.apply_verified(acc, ses, now, window_id, key)
            return {'ok': True, 'verified': True, 'trained': out['trained'], 'reasons': res['reasons']}
        if res.get('modeMismatch'):
            return {'ok': False, 'modeMismatch': True, 'reasons': res['reasons']}
        ses['rhythmFails'] = ses.get('rhythmFails', 0) + 1
        left = self.cfg['mfa']['attempts'] - ses['rhythmFails']
        out = {'ok': False, 'reasons': res['reasons'], 'attemptsLeft': max(0, left)}
        if left <= 0:
            ses['rhythmFails'] = 0
            acc['failStreak'] += 1
            out['attemptsExhausted'] = True
            out['failStreak'] = acc['failStreak']
            out['locked'] = lock_n > 0 and acc['failStreak'] >= lock_n
        return out

    def can_enroll_rhythm(self, acc, ses, now):
        if acc.get('template'):
            return False, 'already enrolled'
        away = ses.get('away')
        if acc['lastRisk'] != 'LOW' or (away and away['awayMs'] >= self.cfg['idle']['reverifyAfterSec'] * 1000):
            return False, 'session is under suspicion - verify first (stepUp)'
        last = ses.get('lastVerdict')
        if last and not last.get('enrollment') and last['level'] not in ('LOW', 'UNKNOWN'):
            return False, 'session is under suspicion - verify first (stepUp)'
        return True, None

    def rhythm_enroll(self, acc, ses, samples, now):
        ok, why = self.can_enroll_rhythm(acc, ses, now)
        if not ok:
            return {'enrolled': False, 'reason': why, 'already': why == 'already enrolled'}
        tmpl = rhythm.build_template(samples)
        if not tmpl:
            return {'enrolled': False, 'reason': 'template-rejected'}
        acc['template'] = tmpl
        return {'enrolled': True, 'mode': tmpl['mode']}

    def verified_recently(self, ses, now, within_ms=None):
        g = within_ms if within_ms is not None else self.cfg['mfa']['graceSec'] * 1000
        return bool(ses.get('mfaPassedAt') and now - ses['mfaPassedAt'] < g)

    # ---------------------------------------------------------- probe (assessNow)
    def probe(self, acc, ses, win, now, key=None):
        """A verdict right now, for a sensitive action. No side effects on the profile:
        nothing is trained, the floor does not move. The result is kept on the session so
        the site's server-side gate can read it."""
        grace_ms = self.cfg['mfa']['graceSec'] * 1000
        vr = self.verified_recently(ses, now)
        base = {'at': now, 'sensitive': True, 'verifiedRecently': vr,
                'verifiedAgoSec': round((now - ses['mfaPassedAt']) / 1000) if ses.get('mfaPassedAt') else None}
        if win.get('away') and _finite(win['away'].get('awayMs')):
            self._mark_away(ses, float(win['away']['awayMs']), str(win['away'].get('reason') or 'no-input')[:40], now)
        ses['lastActiveAt'] = now
        m = self.model(acc, key)
        if m is None or self.eligible_count(acc) < self.cfg['baseline']:
            out = {**base, 'level': 'UNKNOWN', 'action': 'REQUIRE_STEPUP', 'enrollment': True,
                   'reasons': ['enrollment not finished - nothing to compare against yet, verify another way']}
        else:
            events = int(win.get('events') or 0)
            need = self.cfg['probe']['minEvents']
            if events < need or not isinstance(win.get('vector'), list):
                out = {**base, 'level': 'UNKNOWN', 'action': 'REQUIRE_STEPUP',
                       'evidence': {'events': events, 'partial': True},
                       'reasons': ['not enough evidence (%d events) - treat as not verified' % events]}
            else:
                vec = [float(x) for x in win['vector']]
                xstd = m.std(vec)
                score = m.score(xstd)
                lv = B.to_risk(score, m.thresholds) if _finite(score) else 'HIGH'
                model_level = lv
                if _ORDER[acc['lastRisk']] > _ORDER[lv]:
                    lv = acc['lastRisk']
                away = ses.get('away')
                is_away = bool(away and away['awayMs'] >= self.cfg['idle']['reverifyAfterSec'] * 1000)
                if is_away and lv == 'LOW':
                    lv = 'MEDIUM'
                top = [{'name': t['name'], 'z': t['z']} for t in B.top_features(xstd, self.cfg['features'], 3)]
                out = {**base, 'level': lv, 'score': score if _finite(score) else None,
                       'action': B.to_action(lv), 'modelLevel': model_level,
                       'evidence': {'events': events, 'partial': events < self.cfg['session']['minEventsAssess']},
                       'reasons': (['returned after being away - verify again'] if is_away else []) + B.reasons_from(top),
                       'topFeatures': top}
        ses['probe'] = {'level': out['level'], 'at': now, 'verifiedRecently': vr}
        return out

    # ---------------------------------------------------------- status
    def status(self, acc, ses, now, key=None):
        Bn = self.cfg['baseline']
        el = self.eligible_count(acc)
        m = self.model(acc, key) if acc.get('modelVecs') else None
        grace_ms = self.cfg['mfa']['graceSec'] * 1000
        passed = ses.get('mfaPassedAt')
        left = max(0, grace_ms - (now - passed)) if passed else 0
        lock_n = self.cfg['mfa']['lockAfterFailures']
        can, _ = self.can_enroll_rhythm(acc, ses, now)
        tmpl = acc.get('template')
        return {
            'phase': 'learning' if el < Bn else 'protecting',
            'enrollment': {'done': min(el, Bn), 'need': Bn},
            'risk': acc['lastRisk'],
            'lastVerdict': ses.get('lastVerdict'),
            'model': {'trained': m is not None, 'pool': m.n if m else 0,
                      'mainDetector': bool(m and m.n >= self.cfg['ensembleMinSamples']['svm']),
                      'mainDetectorNeeds': self.cfg['ensembleMinSamples']['svm']},
            'mfa': {'enrolled': bool(tmpl), 'canEnroll': bool(can), 'mode': tmpl['mode'] if tmpl else None,
                    'verifiedAt': passed, 'graceLeftSec': round(left / 1000),
                    'verifiedAgoSec': round((now - passed) / 1000) if passed else None,
                    'failStreak': acc['failStreak'],
                    'locked': lock_n > 0 and acc['failStreak'] >= lock_n},
            'probe': ses.get('probe'),
        }
