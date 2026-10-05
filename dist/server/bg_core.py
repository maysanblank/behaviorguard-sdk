#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bg_core.py - MESIN INTI BehaviorGuard, bebas-runtime, tanpa dependensi.

Ini implementasi acuan dari core/SPEC.md. Input dan output cuma angka:
tidak ada DOM, tidak ada browser, tidak ada storage, tidak ada jaringan.

    vektor 34-float  +  kolam baseline  ->  verdict

Semua konstanta numerik (epsilon, clamp, seed) mengikuti SPEC.md secara harfiah.
Kalau SPEC dan file ini beda, SPEC yang benar dan file ini yang bug.

Dipakai oleh:
  - core/conformance.py  (uji kesesuaian lawan core/golden.json)
  - port bahasa lain     (JS/Go/Kotlin/Swift wajib lulus golden yang sama)
"""
import math

# ---------------------------------------------------------------- konfigurasi
F4 = [
    'mouse_velocity_mean', 'mouse_velocity_std', 'mouse_velocity_max',
    'mouse_acceleration_std', 'mouse_curvature_mean', 'mouse_direction_changes',
    'mouse_pause_count', 'mouse_click_interval_mean', 'cursor_idle_ratio',
    'cross_mouse_keyboard_coordination', 'keystroke_dwell_time_mean',
    'keystroke_dwell_time_std', 'keystroke_flight_time_mean',
    'keystroke_transition_entropy', 'keystroke_typing_speed',
    'keystroke_cross_field_cadence', 'keystroke_burst_count',
    'temporal_time_of_day_score', 'temporal_session_duration',
    'temporal_activity_bursts', 'nav_page_transition_pattern', 'nav_scroll_depth_mean',
    'nav_page_count', 'nav_step_transition_count', 'form_focus_count', 'form_blur_count',
    'form_field_switch_rate', 'cart_action_count',
    # SPEC 1.4 (C-44): ritme ketik yang lebih tajam
    'keystroke_flight_median', 'keystroke_flight_iqr', 'keystroke_backspace_ratio',
    'keystroke_cross_hand_ratio', 'keystroke_dwell_median', 'keystroke_shift_ratio',
]

DEFAULTS = {
    'baseline': 10,
    'retrainEvery': 6,
    # W-MAHA: slot detektor ke-2 ('svm') kini menjalankan Mahalanobis, bukan
    # centroid-RBF. Mahalanobis jauh lebih diskriminatif -> dia diberi bobot
    # mayoritas (0.70) dan IF jadi pendukung (0.30). Kunci bobot tetap 'svm'
    # demi kompatibilitas gating/konfigurasi; artinya "detektor kedua".
    'weights': {'isolation_forest': 0.30, 'svm': 0.70, 'lstm': 0.00},
    'features': F4,
    'thresholds': {'low': -0.4, 'medium': -0.8},
    'calibrateThresholds': True,
    # Kalibrasi pita risiko. Mode default = 'parametric' (mean - k*std skor
    # baseline) yang jauh lebih efisien titik-operasinya daripada kuantil.
    # C-33: k_low 1,75 dipilih ulang dengan SDK sungguhan (tools/eval_sdk.mjs --live).
    # Nilai lama 3,3 dipilih di atas data riset yang eventnya kembar (C-29).
    'calibrationMode': 'parametric',
    # k_med_extra melebarkan pita MEDIUM(MFA): makin besar -> lebih banyak
    # salah-tolak pemilik jadi "minta MFA" ketimbang "BLOCK" (FAR tak berubah).
    # 2.0 = setelan lunak (block keras owner ~turun setengah vs 0.6).
    'k_low': 1.75, 'k_med_extra': 2.0,   # C-33: 3,3 -> 1,75 (lihat sdk/core/config.js)
    'q_low': 0.10, 'q_med': 0.033,  # dipakai bila calibrationMode='quantile'
    'convergence': {'window': 6, 'cohortLowRate': 0.35, 'minSessions': 10},
    'iforest': {'n_estimators': 100, 'max_samples': 256, 'seed': 42},
    'model2': 'mahalanobis',            # 'mahalanobis' | 'centroid'
    'mahalanobis': {'shrink': 0.3},     # shrinkage diagonal (Ledoit-Wolf sederhana)
    # Kebijakan aksi: HIGH satu sesi = minta step-up (bukan blokir). Blokir keras
    # hanya dipicu RENTETAN HIGH berturut (tanda pengambilalihan nyata, bukan
    # pemilik yang sesekali off-day). Held-out: block owner 9.7% -> 2.4%, FAR tetap.
    'blockAfterConsecutiveHigh': 2,
    'ocsvm': {'gamma': None, 'seed': 42},
    'ensembleMinSamples': {'isolation_forest': 8, 'svm': 20, 'lstm': 24},
    'progressiveMaxPool': 30,
    'progressiveDupEps': 1e-3,
    # SPEC S-1: lantai simpangan baku per-fitur. Normatif = perilaku SDK JS.
    'stdFloorEps': 1e-9, 'stdFloorValue': 1.0,
    # SPEC S-2: clamp simpangan baku skor + clamp z. Normatif = perilaku SDK JS.
    'scoreStdMin': 1e-3, 'scoreStdMax': 10.0, 'zClamp': 6.0,
}


def normalize_weights(w):
    s = (w.get('isolation_forest') or 0) + (w.get('svm') or 0) + (w.get('lstm') or 0)
    if s <= 0:
        return dict(DEFAULTS['weights'])
    return {
        'isolation_forest': (w.get('isolation_forest') or 0) / s,
        'svm': (w.get('svm') or 0) / s,
        'lstm': (w.get('lstm') or 0) / s,
    }


# ------------------------------------------------------------------- PRNG
def _imul(a, b):
    return (a * b) & 0xFFFFFFFF


def mulberry32(seed):
    """Setara persis dengan mulberry32 di sdk/core/isolation_forest.js."""
    a = seed & 0xFFFFFFFF

    def rng():
        nonlocal a
        a = (a + 0x6D2B79F5) & 0xFFFFFFFF
        t = a
        t = _imul(t ^ (t >> 15), t | 1)
        t = (t ^ (t + _imul(t ^ (t >> 7), t | 61))) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296.0

    return rng


def c_factor(n):
    if n <= 1:
        return 0.0
    if n == 2:
        return 1.0
    return 2 * (math.log(n - 1) + 0.5772156649) - 2 * (n - 1) / n


# ------------------------------------------------------------ standardisasi
def compute_stats(vectors, cfg=None):
    cfg = cfg or DEFAULTS
    if not vectors:
        return {'mean': [], 'std': []}
    d = len(vectors[0])
    mean = [0.0] * d
    for v in vectors:
        for i in range(d):
            mean[i] += v[i]
    for i in range(d):
        mean[i] /= len(vectors)
    var = [0.0] * d
    for v in vectors:
        for i in range(d):
            diff = v[i] - mean[i]
            var[i] += diff * diff
    for i in range(d):
        var[i] /= len(vectors)
    eps = cfg.get('stdFloorEps', DEFAULTS['stdFloorEps'])
    floor = cfg.get('stdFloorValue', DEFAULTS['stdFloorValue'])
    std = [(floor if math.sqrt(v) < eps else math.sqrt(v)) for v in var]
    return {'mean': mean, 'std': std}


def standardize(vec, stats):
    return [(vec[i] - stats['mean'][i]) / stats['std'][i] for i in range(len(vec))]


def standardize_batch(X, stats):
    return [standardize(v, stats) for v in X]


def score_stats(scores, cfg=None):
    cfg = cfg or DEFAULTS
    m = sum(scores) / len(scores)
    s = math.sqrt(sum((v - m) ** 2 for v in scores) / len(scores))
    lo = cfg.get('scoreStdMin', DEFAULTS['scoreStdMin'])
    hi = cfg.get('scoreStdMax', DEFAULTS['scoreStdMax'])
    if not math.isfinite(s) or s < lo:
        s = lo
    if s > hi:
        s = hi
    return {'mean': m, 'std': s}


def z_score(val, st, cfg=None):
    cfg = cfg or DEFAULTS
    k = cfg.get('zClamp', DEFAULTS['zClamp'])
    z = (val - st['mean']) / st['std']
    return max(-k, min(k, z))


# --------------------------------------------------------- isolation forest
class IsolationForest:
    def __init__(self, n_estimators=100, max_samples=256, seed=42):
        self.n_estimators = n_estimators
        self.max_samples = max_samples
        self.seed = seed
        self.trees = []
        self.n_features = 0
        self.c = 1.0

    def fit(self, X):
        if not X:
            return
        self.n_features = len(X[0])
        n = min(self.max_samples, len(X))
        self.c = c_factor(n)
        rng = mulberry32(self.seed)
        self.trees = []
        max_depth = math.ceil(math.log2(n)) if n > 1 else 0
        for _ in range(self.n_estimators):
            idx = list(range(len(X)))
            for i in range(len(idx) - 1, 0, -1):
                j = int(rng() * (i + 1))
                idx[i], idx[j] = idx[j], idx[i]
            sample = [X[i] for i in idx[:n]]
            self.trees.append(self._build(sample, 0, max_depth, rng))

    def _build(self, points, depth, max_depth, rng):
        if depth >= max_depth or len(points) <= 1:
            return {'leaf': True, 'size': len(points)}
        feat = int(rng() * self.n_features)
        vals = [p[feat] for p in points]
        mn, mx = min(vals), max(vals)
        if mn == mx:
            return {'leaf': True, 'size': len(points)}
        split = mn + rng() * (mx - mn)
        left = [p for p in points if p[feat] < split]
        right = [p for p in points if p[feat] >= split]
        if not left or not right:
            return {'leaf': True, 'size': len(points)}
        return {
            'leaf': False, 'feat': feat, 'split': split,
            'left': self._build(left, depth + 1, max_depth, rng),
            'right': self._build(right, depth + 1, max_depth, rng),
        }

    def _path(self, x, node, depth):
        if node['leaf']:
            return depth + c_factor(node['size'])
        nxt = node['left'] if x[node['feat']] < node['split'] else node['right']
        return self._path(x, nxt, depth + 1)

    def score_one(self, x):
        if not self.trees:
            return 0.0
        avg_h = sum(self._path(x, t, 0) for t in self.trees) / len(self.trees)
        anom = math.pow(2, -avg_h / self.c) if self.c else 0.5
        return 0.5 - anom

    def predict(self, X):
        return [self.score_one(x) for x in X]


# ------------------------------------------------------------------- OC-SVM
class OCSVM:
    """Aproksimasi centroid-RBF - padanan persis sdk/core/ocsvm.js.

    Satu-satunya rumus SVM di pustaka ini: portabel, nol dependensi, jalan di
    browser. Akurasinya masih akan diperbaiki (lihat core/DRIFT.md).
    """

    def __init__(self, gamma=None, n_features=28):
        self.gamma = gamma if gamma is not None else 1.0 / n_features
        self.mean = None
        self.threshold = 0.0

    def fit(self, X):
        if not X:
            return
        d = len(X[0])
        self.mean = [0.0] * d
        for v in X:
            for i in range(d):
                self.mean[i] += v[i]
        for i in range(d):
            self.mean[i] /= len(X)
        scores = sorted(self._raw(x) for x in X)
        idx = int(len(scores) * 0.10)
        val = scores[idx] if idx < len(scores) else None
        self.threshold = val if val else 0.0

    def _raw(self, x):
        dist2 = sum((x[i] - self.mean[i]) ** 2 for i in range(len(x)))
        return math.exp(-self.gamma * dist2)

    def score_one(self, x):
        if self.mean is None:
            return 0.0
        return self._raw(x) - self.threshold - 0.1

    def predict(self, X):
        return [self.score_one(x) for x in X]


class Mahalanobis:
    """Detektor jarak Mahalanobis + shrinkage diagonal (Ledoit-Wolf sederhana).

    Ganti centroid-RBF: alih-alih meng-collapse kolam baseline jadi SATU titik
    rata-rata (buang bentuk distribusi -> FAR 36%), Mahalanobis memperhitungkan
    kovarians antar-fitur sehingga penyusup di dekat rata-rata tetap tertangkap.

    Browser-trainable, NOL dependensi, deterministik: kovarians dari kolam
    (<=30 vektor), shrink ke diagonal biar non-singular di 28 dim, inversi via
    Gauss-Jordan pivot-parsial. score_one = -sqrt((x-mu)^T Sigma^-1 (x-mu));
    higher = lebih normal, sebanding IF. Padanan persis sdk/core/mahalanobis.js.
    """

    def __init__(self, shrink=0.3, n_features=28):
        self.shrink = shrink
        self.mean = None
        self.inv = None

    def fit(self, X):
        if not X:
            return
        n = len(X)
        d = len(X[0])
        mean = [0.0] * d
        for v in X:
            for i in range(d):
                mean[i] += v[i]
        for i in range(d):
            mean[i] /= n
        cov = [[0.0] * d for _ in range(d)]
        for v in X:
            dv = [v[i] - mean[i] for i in range(d)]
            for i in range(d):
                di = dv[i]
                row = cov[i]
                for j in range(d):
                    row[j] += di * dv[j]
        denom = n - 1 if n > 1 else 1
        for i in range(d):
            for j in range(d):
                cov[i][j] /= denom
        mu = sum(cov[i][i] for i in range(d)) / d
        a = self.shrink
        for i in range(d):
            for j in range(d):
                cov[i][j] = (1 - a) * cov[i][j] + (a * mu if i == j else 0.0)
            cov[i][i] += 1e-6
        self.mean = mean
        self.inv = self._inv(cov, d)

    @staticmethod
    def _inv(A, d):
        # Gauss-Jordan pivot-parsial. Urutan operasi tetap -> bit-identik lintas bahasa.
        M = [row[:] + [1.0 if i == j else 0.0 for j in range(d)]
             for i, row in enumerate(A)]
        for col in range(d):
            piv = col
            best = abs(M[col][col])
            for r in range(col + 1, d):
                if abs(M[r][col]) > best:
                    best = abs(M[r][col]); piv = r
            if abs(M[piv][col]) < 1e-12:
                M[piv][col] = 1e-12
            if piv != col:
                M[col], M[piv] = M[piv], M[col]
            pv = M[col][col]
            M[col] = [x / pv for x in M[col]]
            for r in range(d):
                if r != col and M[r][col] != 0.0:
                    f = M[r][col]
                    Mr, Mc = M[r], M[col]
                    M[r] = [Mr[k] - f * Mc[k] for k in range(2 * d)]
        return [row[d:] for row in M]

    def score_one(self, x):
        if self.mean is None or self.inv is None:
            return 0.0
        d = len(x)
        dv = [x[i] - self.mean[i] for i in range(d)]
        tmp = [sum(self.inv[i][j] * dv[j] for j in range(d)) for i in range(d)]
        m2 = sum(dv[i] * tmp[i] for i in range(d))
        return -math.sqrt(m2 if m2 > 0.0 else 0.0)

    def predict(self, X):
        return [self.score_one(x) for x in X]


# ----------------------------------------------------------------- ensemble
def gate_weights(weights, n, cfg=None):
    cfg = cfg or DEFAULTS
    min_s = cfg['ensembleMinSamples']
    w = dict(weights)
    if n < min_s['svm']:
        w['svm'] = 0
    if n < min_s['lstm']:
        w['lstm'] = 0
    return normalize_weights(w)


class Ensemble:
    def __init__(self, iforest, ocsvm, weights=None, n=0, cfg=None):
        self.cfg = cfg or DEFAULTS
        self.iforest = iforest
        self.ocsvm = ocsvm
        self.weights = normalize_weights(weights or self.cfg['weights'])
        self.if_stats = None
        self.svm_stats = None
        self.n = n or 0
        self.gated_weights = self.weights

    def calibrate(self, X_std, n=None):
        if n is not None:
            self.n = n
        self.if_stats = score_stats(self.iforest.predict(X_std), self.cfg)
        self.svm_stats = score_stats(self.ocsvm.predict(X_std), self.cfg)
        self.gated_weights = gate_weights(self.weights, self.n, self.cfg)

    def score_one(self, x_std):
        raw_if = self.iforest.score_one(x_std)
        raw_svm = self.ocsvm.score_one(x_std)
        z_if = z_score(raw_if, self.if_stats, self.cfg) if self.if_stats else raw_if
        z_svm = z_score(raw_svm, self.svm_stats, self.cfg) if self.svm_stats else raw_svm
        w = self.gated_weights or self.weights
        if not self.svm_stats:
            return z_if
        if w['svm'] == 0:
            return z_if
        return w['isolation_forest'] * z_if + w['svm'] * z_svm

    def predict(self, X_std):
        return [self.score_one(x) for x in X_std]


# --------------------------------------------------------------------- risk
def to_risk(score, thresholds=None):
    t = thresholds or DEFAULTS['thresholds']
    if score <= t['medium']:
        return 'HIGH'
    if score <= t['low']:
        return 'MEDIUM'
    return 'LOW'


def to_action(level):
    """Aksi PER-SESI (stateless). HIGH tidak langsung memblokir: satu sesi
    menyimpang -> minta verifikasi STEP-UP (pemilik lolos, penyusup gagal).
    Pemblokiran keras hanya dipicu RENTETAN HIGH -> ditentukan di lapisan
    stateful BehaviorGuard.assess (aturan blockAfterConsecutiveHigh)."""
    if level == 'HIGH':
        return 'REQUIRE_STEPUP'
    if level == 'MEDIUM':
        return 'REQUIRE_MFA'
    return 'ALLOW_SESSION'


def _quantile(sorted_vals, q):
    if not sorted_vals:
        return -0.4
    idx = q * (len(sorted_vals) - 1)
    lo, hi = int(math.floor(idx)), int(math.ceil(idx))
    if lo == hi:
        return sorted_vals[lo]
    frac = idx - lo
    return sorted_vals[lo] * (1 - frac) + sorted_vals[hi] * frac


def calibrate_thresholds(baseline_scores, q_low=None, q_med=None):
    """Mode kuantil (lama). Dipertahankan untuk calibrationMode='quantile'."""
    q_low = 0.15 if q_low is None else q_low
    q_med = 0.05 if q_med is None else q_med
    s = sorted(baseline_scores)
    low = _quantile(s, q_low)
    med = _quantile(s, q_med)
    if low - med < 0.15:
        med = low - 0.25
    low = max(-3.0, min(1.0, low))
    med = max(-3.0, min(low - 0.05, med))
    return {'low': low, 'medium': med}


def calibrate_thresholds_parametric(baseline_scores, k_low=1.75, k_med_extra=2.0):  # = DEFAULTS (C-33)
    """Pita risiko parametrik: low = mean - k_low*std, medium lebih ketat.

    Jauh lebih efisien titik-operasinya daripada kuantil-10-sampel: mengikuti
    sebaran skor owner, bukan satu titik kuantil rapuh. k_low men-set trade-off
    FRR<->FAR (kecil=ketat/FAR turun, besar=longgar/FRR turun)."""
    n = len(baseline_scores)
    if n == 0:
        return {'low': -0.4, 'medium': -0.8}
    m = sum(baseline_scores) / n
    var = sum((x - m) ** 2 for x in baseline_scores) / n
    sd = math.sqrt(var) if var > 1e-12 else 1.0
    return {'low': m - k_low * sd, 'medium': m - (k_low + k_med_extra) * sd}


def top_features(vec_std, feature_names, k=3):
    arr = [{'name': n, 'z': vec_std[i], 'abs': abs(vec_std[i])}
           for i, n in enumerate(feature_names)]
    arr.sort(key=lambda a: -a['abs'])
    return arr[:k]


def reasons_from(top):
    return ['%s z=%.2f' % (t['name'], t['z']) for t in top]


# ---------------------------------------------------------------- lifecycle
def should_retrain(session_count, retrain_every, cfg=None):
    base = (cfg or DEFAULTS)['baseline']
    if session_count < base:
        return False
    return (session_count - base) % retrain_every == 0


def is_converged(recent_risks, cohort_low_rate_val, cfg=None):
    c = (cfg or DEFAULTS)['convergence']
    win, thr = c['window'], c['cohortLowRate']
    if len(recent_risks) < win:
        return False
    if not all(r == 'LOW' for r in recent_risks[-win:]):
        return False
    return cohort_low_rate_val <= thr


def cohort_low_rate(cohort_scores, thresholds=None):
    if not cohort_scores:
        return 0.0
    thr = (thresholds or DEFAULTS['thresholds'])['low']
    return sum(1 for s in cohort_scores if s > thr) / len(cohort_scores)


# --------------------------------------------------------------------- model
def build_model(vectors, cfg=None):
    """Bangun model lengkap dari kolam vektor baseline. Deterministik."""
    cfg = cfg or DEFAULTS
    stats = compute_stats(vectors, cfg)
    X_std = standardize_batch(vectors, stats)
    iff = IsolationForest(**cfg['iforest'])
    iff.fit(X_std)
    if cfg.get('model2', 'mahalanobis') == 'mahalanobis':
        det2 = Mahalanobis(shrink=cfg['mahalanobis']['shrink'],
                           n_features=len(cfg['features']))
    else:
        det2 = OCSVM(gamma=cfg['ocsvm'].get('gamma'), n_features=len(cfg['features']))
    det2.fit(X_std)
    ens = Ensemble(iff, det2, cfg['weights'], len(vectors), cfg)
    ens.calibrate(X_std, len(vectors))
    thresholds = dict(cfg['thresholds'])
    if cfg.get('calibrateThresholds'):
        base_scores = [ens.score_one(x) for x in X_std]
        if cfg.get('calibrationMode', 'parametric') == 'parametric':
            thresholds = calibrate_thresholds_parametric(
                base_scores, cfg['k_low'], cfg['k_med_extra'])
        else:
            thresholds = calibrate_thresholds(base_scores, cfg['q_low'], cfg['q_med'])
    return {'stats': stats, 'ensemble': ens, 'thresholds': thresholds}


def score_vector(model, vec, cfg=None):
    """vektor 34-float -> verdict. Permukaan yang harus sama di semua bahasa."""
    cfg = cfg or DEFAULTS
    x_std = standardize(vec, model['stats'])
    score = model['ensemble'].score_one(x_std)
    level = to_risk(score, model['thresholds'])
    top = top_features(x_std, cfg['features'], 3)
    return {
        'level': level,
        'score': score,
        'action': to_action(level),
        'reasons': reasons_from(top),
        'topFeatures': top,
        'thresholds': dict(model['thresholds']),
    }


# ======================================================================
# EKSTRAKSI FITUR (SPEC v1.1) - event mentah -> vektor 34-float
# ----------------------------------------------------------------------
# Padanan persis sdk/core/features.js:extractF4. Ini melengkapi separuh
# jalur yang belum tercakup v1.0.0:
#     event mentah  --[ BAGIAN INI ]-->  34 angka  --[ v1.0.0 ]-->  vonis
#
# Kontrak: fungsi murni, deterministik, hanya angka masuk-keluar. Satu-satunya
# sumber non-determinisme di JS asli - waktu-lokal via getHours() - diseragamkan
# ke UTC di sini DAN di features.js, supaya vektor identik di zona waktu mana pun.
# Lihat SPEC.md sec.9 dan DRIFT.md (D-3).
# ======================================================================
import datetime as _dt


def _n(v):
    """Padanan `x || 0` di JS untuk nilai numerik (0/None/non-angka -> 0)."""
    if isinstance(v, bool):
        return 0
    if isinstance(v, (int, float)) and math.isfinite(v):
        return v
    return 0


def _mean(a):
    return (sum(a) / len(a)) if a else 0.0


def _std(a):
    if not a:
        return 0.0
    m = _mean(a)
    return math.sqrt(sum((v - m) ** 2 for v in a) / len(a))


def _safe(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else 0


# ---- SPEC 1.4 (C-44): ritme ketik. Padanan keyClass()/keystrokeRhythm() di features.js.
_HAND_L = 'qwertasdfgzxcvb'
_HAND_R = 'yuiophjklnm'


def key_class(e):
    kc = e.get('kc')
    if isinstance(kc, str) and kc:
        return kc
    k = e.get('key')
    if not isinstance(k, str):
        return 'O'
    if len(k) == 1 and ord(k) < 128:
        c = chr(ord(k) + 32) if 65 <= ord(k) <= 90 else k
        if c in _HAND_L:
            return 'L'
        if c in _HAND_R:
            return 'R'
        if '0' <= c <= '9':
            return 'D'
        if c == ' ':
            return 'S'
        return 'P'
    if k in ('Backspace', 'Delete'):
        return 'E'
    if k == 'Shift':
        return 'H'
    return 'O'


def _median(a):
    if not a:
        return 0
    b = sorted(a)
    m = len(b) // 2
    return b[m] if len(b) % 2 else (b[m - 1] + b[m]) / 2


def _keystroke_rhythm(key_ev):
    fl, same, cross, dw = [], [], [], []
    back = shift = letters = 0
    for i, e in enumerate(key_ev):
        c = key_class(e)
        if c == 'E':
            back += 1
        if c == 'H':
            shift += 1
        if c in ('L', 'R'):
            letters += 1
        h = e.get('hold_time')
        if h is not None and 0 < h < 1000:
            dw.append(h)
        if i > 0:
            p = key_ev[i - 1]
            dt = _n(e.get('timestamp')) - _n(p.get('timestamp'))
            if 0 < dt < 1000:
                fl.append(dt)
                pc = key_class(p)
                if pc in ('L', 'R') and c in ('L', 'R'):
                    (same if pc == c else cross).append(dt)
    iqr = 0
    if len(fl) > 3:
        b = sorted(fl)
        iqr = b[int(math.floor(len(b) * 0.75))] - b[int(math.floor(len(b) * 0.25))]
    ms, mc = _median(same), _median(cross)
    return {
        'keystroke_flight_median': _safe(_median(fl)),
        'keystroke_flight_iqr': _safe(iqr),
        'keystroke_backspace_ratio': _safe(back / len(key_ev) if key_ev else 0),
        'keystroke_cross_hand_ratio': _safe(mc / ms if ms > 0 and mc > 0 else 0),
        'keystroke_dwell_median': _safe(_median(dw)),
        'keystroke_shift_ratio': _safe(shift / letters if letters else 0),
    }


def extract_features(events, session_start_ts=None):
    """Ubah daftar event mentah jadi dict 34 fitur bernama (selalu finit).

    Setiap event = dict dengan setidaknya `event_type` dan `timestamp` (epoch ms).
    Kolom lain yang dibaca: x, y, key, kc, hold_time, velocity, page_url, scroll_delta.
    Urutan keluaran mengikat F4. Padanan persis extractF4() di features.js.
    """
    if not events:
        return {k: 0 for k in F4}

    def is_t(e, t):
        return e.get('event_type') == t

    mouse_move = [e for e in events if is_t(e, 'MOUSE_MOVE')]
    mouse_click = [e for e in events if is_t(e, 'MOUSE_CLICK')]
    mouse_scroll = [e for e in events if is_t(e, 'MOUSE_SCROLL')]
    mouse_ev = mouse_move + mouse_click + mouse_scroll
    key_ev = [e for e in events if is_t(e, 'KEYSTROKE')]
    scroll_ev = mouse_scroll
    focus_ev = [e for e in events if is_t(e, 'FORM_FOCUS')]
    blur_ev = [e for e in events if is_t(e, 'FORM_BLUR')]
    nav_ev = [e for e in events if is_t(e, 'NAVIGATION') or is_t(e, 'PAGE_STEP')]

    # --- mouse velocity / acceleration / curvature ---
    velocities, accelerations, curvatures = [], [], []
    pauses = 0
    direction_changes = 0
    last_dir = None
    for i in range(1, len(mouse_ev)):
        p, c = mouse_ev[i - 1], mouse_ev[i]
        dt = _n(c.get('timestamp')) - _n(p.get('timestamp'))
        if dt <= 0:
            continue
        dx = _n(c.get('x')) - _n(p.get('x'))
        dy = _n(c.get('y')) - _n(p.get('y'))
        dist = math.hypot(dx, dy)
        v = dist / dt
        velocities.append(v)
        if dist > 0:
            dr = math.atan2(dy, dx)
            # SPEC 1.3 (C-34): toleransi 1e-9 - atan2 lintas-libm beda 1-2 ulp tepat di pi/4
            if last_dir is not None and abs(dr - last_dir) > math.pi / 4 + 1e-9:
                direction_changes += 1
            last_dir = dr
        if len(velocities) > 1:
            a = (v - velocities[-2]) / dt
            accelerations.append(a)
        if i >= 2:
            p2 = mouse_ev[i - 2]
            x0, y0 = _n(p2.get('x')), _n(p2.get('y'))
            x1, y1 = _n(p.get('x')), _n(p.get('y'))
            x2, y2 = _n(c.get('x')), _n(c.get('y'))
            area = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1)
            sa = math.hypot(x1 - x0, y1 - y0)
            sb = math.hypot(x2 - x1, y2 - y1)
            sc = math.hypot(x2 - x0, y2 - y0)
            if sa * sb * sc > 0:
                curvatures.append(abs(4 * area / (sa * sb * sc)))
        if dt > 100:
            pauses += 1

    click_intervals = []
    for i in range(1, len(mouse_click)):
        click_intervals.append(_n(mouse_click[i].get('timestamp')) - _n(mouse_click[i - 1].get('timestamp')))

    # cursor_idle_ratio
    cursor_idle = 0.0
    if mouse_move:
        idle = sum(1 for e in mouse_move if _n(e.get('velocity')) < 0.5)
        cursor_idle = idle / len(mouse_move)
        if cursor_idle == 0 and velocities:
            slow = sum(1 for v in velocities if v < 0.05)
            cursor_idle = slow / len(velocities)

    # cross_mouse_keyboard_coordination
    all_mk = sorted(mouse_ev + key_ev, key=lambda e: _n(e.get('timestamp')))
    alternations = 0
    last_type = None
    for e in all_mk:
        cur = 'mouse' if 'MOUSE' in (e.get('event_type') or '') else 'keyboard'
        if last_type and last_type != cur:
            alternations += 1
        last_type = cur
    cross_coord = alternations / len(all_mk) if all_mk else 0.0

    # keystroke
    hold_times = [e.get('hold_time') for e in key_ev if e.get('hold_time') is not None]
    flight_times = []
    for i in range(1, len(key_ev)):
        flight_times.append(_n(key_ev[i].get('timestamp')) - _n(key_ev[i - 1].get('timestamp')))
    if len(key_ev) < 2:
        key_entropy = 0.0
    else:
        trans = {}
        for i in range(1, len(key_ev)):
            k = (key_ev[i - 1].get('key') or '') + '->' + (key_ev[i].get('key') or '')
            trans[k] = trans.get(k, 0) + 1
        total = len(key_ev) - 1
        key_entropy = 0.0
        for cnt in trans.values():
            p = cnt / total
            key_entropy -= p * math.log(p + 1e-9)
    burst_count = 0
    in_burst = False
    for i in range(1, len(key_ev)):
        dt = _n(key_ev[i].get('timestamp')) - _n(key_ev[i - 1].get('timestamp'))
        if dt < 333:
            if not in_burst:
                burst_count += 1
                in_burst = True
        else:
            in_burst = False
    focus_times = sorted(_n(e.get('timestamp')) for e in focus_ev)
    ks_times = sorted(_n(e.get('timestamp')) for e in key_ev)
    cross_gaps = []
    for ft in focus_times:
        before = [t for t in ks_times if t < ft]
        before = before[-1] if before else None
        after = next((t for t in ks_times if t >= ft), None)
        if before is not None and after is not None:
            cross_gaps.append(after - before)

    # temporal
    first_ts = _n(events[0].get('timestamp')) or session_start_ts or 0
    last_ev_ts = _n(events[-1].get('timestamp')) or first_ts
    duration = (last_ev_ts - first_ts) / 1000
    d = _dt.datetime.utcfromtimestamp(first_ts / 1000)
    time_of_day = (d.hour + d.minute / 60) / 24
    per_sec = {}
    for e in events:
        s = math.floor(_n(e.get('timestamp')) / 1000)
        per_sec[s] = per_sec.get(s, 0) + 1
    counts = list(per_sec.values())
    m_act, s_act = _mean(counts), _std(counts)
    bursts = sum(1 for c in counts if c > m_act + 2 * s_act)

    # navigasi & form
    page_urls = [e.get('page_url') for e in nav_ev if e.get('page_url')]
    unique_pages = len(set(page_urls))
    all_pages = len(set(e.get('page_url') for e in events if e.get('page_url')))
    page_trans = unique_pages / len(page_urls) if page_urls else 0.0
    scroll_deltas = [abs(_n(e.get('scroll_delta'))) for e in scroll_ev]
    focus_times_sorted = sorted(_n(e.get('timestamp')) for e in focus_ev)
    field_gaps = []
    for i in range(1, len(focus_times_sorted)):
        g = focus_times_sorted[i] - focus_times_sorted[i - 1]
        if g > 0:
            field_gaps.append(g)

    vmax = max(velocities) if velocities else 0

    out = {
        'mouse_velocity_mean': _safe(_mean(velocities)),
        'mouse_velocity_std': _safe(_std(velocities)),
        'mouse_velocity_max': _safe(vmax),
        'mouse_acceleration_std': _safe(_std(accelerations)),
        'mouse_curvature_mean': _safe(_mean(curvatures)),
        'mouse_direction_changes': _safe(direction_changes),
        'mouse_pause_count': _safe(pauses),
        'mouse_click_interval_mean': _safe(_mean(click_intervals)),
        'cursor_idle_ratio': _safe(cursor_idle),
        'cross_mouse_keyboard_coordination': _safe(cross_coord),
        'keystroke_dwell_time_mean': _safe(_mean(hold_times)),
        'keystroke_dwell_time_std': _safe(_std(hold_times)),
        'keystroke_flight_time_mean': _safe(_mean(flight_times)),
        'keystroke_transition_entropy': _safe(key_entropy),
        'keystroke_typing_speed': _safe(len(key_ev) / duration if duration > 0 else 0),
        'keystroke_cross_field_cadence': _safe(_mean(cross_gaps)),
        'keystroke_burst_count': _safe(burst_count),
        'temporal_time_of_day_score': _safe(time_of_day),
        'temporal_session_duration': _safe(duration),
        'temporal_activity_bursts': _safe(bursts),
        'nav_page_transition_pattern': _safe(page_trans),
        'nav_scroll_depth_mean': _safe(_mean(scroll_deltas)),
        'nav_page_count': _safe(all_pages),
        'nav_step_transition_count': _safe(len(nav_ev)),
        'form_focus_count': _safe(len(focus_ev)),
        'form_blur_count': _safe(len(blur_ev)),
        'form_field_switch_rate': _safe(_mean(field_gaps)),
        'cart_action_count': _safe(sum(1 for e in events if e.get('event_type') == 'CART_ACTION')),
    }
    out.update(_keystroke_rhythm(key_ev))
    return {k: _safe(out.get(k) or 0) for k in F4}


def features_to_vector(feat_obj):
    """dict fitur -> list 34-float terurut F4. Padanan featuresToVector()."""
    return [feat_obj.get(k) or 0 for k in F4]


# ======================================================================
# SDK BACKEND (SPEC v1.1) - API tingkat-tinggi buat dipanggil di server
# ----------------------------------------------------------------------
# Developer tinggal `from bg_core import BehaviorGuard`. Kelas ini mengelola
# baseline per user + skor, dengan persistensi JSON opsional. Fungsi matematika
# di atas (build_model / score_vector / extract_features) tetap jadi intinya.
#
#   bg = BehaviorGuard(store_path="bg_data.json")
#   bg.observe(user_id, vector)     # tambah 1 sesi ke baseline (enrollment)
#   v = bg.assess(user_id, vector)  # skor sesi login -> {level, score, action, ...}
# ======================================================================
import json as _json
import os as _os


class BehaviorGuard:
    """SDK backend BehaviorGuard: kelola baseline per user + penilaian.

    - `observe(user_id, vector)` menambah satu vektor sesi ke kolam baseline user
      (dipakai saat enrollment / sesi tepercaya). Bukan penilaian.
    - `assess(user_id, vector)` menilai satu vektor sesi (mis. saat login) tanpa
      mengubah baseline. Mengembalikan verdict yang sama dengan `score_vector`,
      plus `enrolled`/`sessions`.

    Persistensi: kalau `store_path` diisi, baseline disimpan sebagai JSON
    (`{user_id: [vektor, ...]}`). Kalau tidak, semuanya di memori (hilang saat restart).
    """

    def __init__(self, store_path=None, cfg=None):
        self.cfg = cfg or DEFAULTS
        self.baseline_n = self.cfg['baseline']
        self.max_pool = self.cfg.get('progressiveMaxPool', 30)
        self.store_path = store_path
        self._db = {}
        # jejak HIGH berturut per user (in-memory, urut-sesi). Produksi lintas-
        # proses sebaiknya persist ini; untuk satu proses cukup di memori.
        self._runs = {}
        self.block_after = self.cfg.get('blockAfterConsecutiveHigh', 2)
        if store_path and _os.path.exists(store_path):
            try:
                with open(store_path, encoding='utf-8') as f:
                    self._db = _json.load(f)
            except Exception:
                self._db = {}

    def _save(self):
        if not self.store_path:
            return
        with open(self.store_path, 'w', encoding='utf-8') as f:
            _json.dump(self._db, f)

    def sessions(self, user_id):
        return len(self._db.get(user_id, []))

    def enrolled(self, user_id):
        return self.sessions(user_id) >= self.baseline_n

    def observe(self, user_id, vector):
        """Tambah satu vektor sesi ke baseline user (enrollment / retrain)."""
        pool = self._db.setdefault(user_id, [])
        pool.append([float(x) for x in vector])
        if len(pool) > self.max_pool:              # kolam progresif, tak tumbuh tanpa batas
            del pool[:-self.max_pool]
        self._save()
        return {'sessions': len(pool), 'enrolled': len(pool) >= self.baseline_n}

    def absorb_verified(self, user_id, vector, mfa_passed):
        """TRUST-LOOP (padanan sisi-server dari behaviorguard.js).

        Serap `vector` ke baseline HANYA bila sesi terbukti pemilik lewat MFA
        (`mfa_passed=True`). Pola: assess() -> (bila non-LOW) MFA -> absorb_verified().
        Sesi menyimpang yang GAGAL/belum MFA tidak pernah melatih model -> cegah
        peracunan baseline sekaligus izinkan adaptasi drift pemilik yang aman.
        Reset juga hitungan HIGH-berturut karena identitas sudah terbukti."""
        if not mfa_passed:
            return {'absorbed': False, 'sessions': self.sessions(user_id)}
        self._runs[user_id] = 0
        r = self.observe(user_id, vector)
        r['absorbed'] = True
        return r

    def assess(self, user_id, vector):
        """Nilai satu vektor sesi login. Tidak mengubah baseline."""
        vecs = self._db.get(user_id, [])
        if len(vecs) < self.baseline_n:
            self._runs[user_id] = 0
            return {'level': 'LOW', 'score': 0.0, 'action': 'ALLOW_SESSION',
                    'enrolled': False, 'sessions': len(vecs),
                    'need': self.baseline_n - len(vecs),
                    'reasons': ['masih enrollment']}
        model = build_model(vecs, self.cfg)
        v = score_vector(model, [float(x) for x in vector], self.cfg)
        v['enrolled'] = True
        v['sessions'] = len(vecs)
        # --- lapisan stateful: eskalasi berbasis rentetan HIGH ---
        run = self._runs.get(user_id, 0)
        run = run + 1 if v['level'] == 'HIGH' else 0
        self._runs[user_id] = run
        v['consecutiveHigh'] = run
        # HIGH tunggal -> step-up (dari to_action). Hanya rentetan >= ambang -> blokir.
        if v['level'] == 'HIGH' and run >= self.block_after:
            v['action'] = 'BLOCK_SESSION'
            v['blocked'] = True
        else:
            v['blocked'] = False
        return v

    def reset(self, user_id):
        """Hapus baseline satu user."""
        self._db.pop(user_id, None)
        self._save()
