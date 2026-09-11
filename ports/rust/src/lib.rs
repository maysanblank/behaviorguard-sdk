#![allow(dead_code)]
// BehaviorGuard core - port acuan Rust (nol dependensi, std saja).
//
// Ini implementasi ketiga dari core/SPEC.md (setelah JS & Python). Ia membuktikan
// bahwa kontrak numerik BehaviorGuard benar-benar lintas-bahasa: menghasilkan angka
// yang SAMA dengan JS dan Python dari core/golden.json yang sama, toleransi 1e-9.
//
//   cargo run --release            # jalankan uji kesesuaian (319 pemeriksaan)
//
// Struktur mengikuti bg_core.py baris-demi-baris supaya mudah dibandingkan.

use std::collections::HashMap;

// ======================================================================
// Parser JSON minimal (std saja) - cukup untuk membaca golden.json
// ======================================================================
#[derive(Debug, Clone)]
enum J {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<J>),
    Obj(Vec<(String, J)>),
}

impl J {
    fn num(&self) -> f64 {
        match self {
            J::Num(n) => *n,
            _ => 0.0,
        }
    }
    fn str(&self) -> &str {
        match self {
            J::Str(s) => s,
            _ => "",
        }
    }
    fn arr(&self) -> &Vec<J> {
        match self {
            J::Arr(a) => a,
            _ => panic!("bukan array"),
        }
    }
    fn get(&self, key: &str) -> Option<&J> {
        match self {
            J::Obj(m) => m.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
}

struct P<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> P<'a> {
    fn new(s: &'a str) -> Self {
        P { b: s.as_bytes(), i: 0 }
    }
    fn ws(&mut self) {
        while self.i < self.b.len() && (self.b[self.i] as char).is_whitespace() {
            self.i += 1;
        }
    }
    fn parse(&mut self) -> J {
        self.ws();
        let c = self.b[self.i] as char;
        match c {
            '{' => self.obj(),
            '[' => self.array(),
            '"' => J::Str(self.string()),
            't' => {
                self.i += 4;
                J::Bool(true)
            }
            'f' => {
                self.i += 5;
                J::Bool(false)
            }
            'n' => {
                self.i += 4;
                J::Null
            }
            _ => self.number(),
        }
    }
    fn obj(&mut self) -> J {
        let mut m = Vec::new();
        self.i += 1; // {
        self.ws();
        if self.b[self.i] as char == '}' {
            self.i += 1;
            return J::Obj(m);
        }
        loop {
            self.ws();
            let k = self.string();
            self.ws();
            self.i += 1; // :
            let v = self.parse();
            m.push((k, v));
            self.ws();
            let c = self.b[self.i] as char;
            self.i += 1;
            if c == '}' {
                break;
            }
        }
        J::Obj(m)
    }
    fn array(&mut self) -> J {
        let mut a = Vec::new();
        self.i += 1; // [
        self.ws();
        if self.b[self.i] as char == ']' {
            self.i += 1;
            return J::Arr(a);
        }
        loop {
            let v = self.parse();
            a.push(v);
            self.ws();
            let c = self.b[self.i] as char;
            self.i += 1;
            if c == ']' {
                break;
            }
        }
        J::Arr(a)
    }
    fn string(&mut self) -> String {
        let mut s = Vec::new();
        self.i += 1; // opening "
        while self.b[self.i] as char != '"' {
            if self.b[self.i] as char == '\\' {
                self.i += 1;
                let e = self.b[self.i] as char;
                match e {
                    'n' => s.push(b'\n'),
                    't' => s.push(b'\t'),
                    'r' => s.push(b'\r'),
                    '"' => s.push(b'"'),
                    '\\' => s.push(b'\\'),
                    '/' => s.push(b'/'),
                    _ => s.push(self.b[self.i]),
                }
                self.i += 1;
            } else {
                s.push(self.b[self.i]);
                self.i += 1;
            }
        }
        self.i += 1; // closing "
        String::from_utf8_lossy(&s).into_owned()
    }
    fn number(&mut self) -> J {
        let start = self.i;
        while self.i < self.b.len() {
            let c = self.b[self.i] as char;
            if c == '-' || c == '+' || c == '.' || c == 'e' || c == 'E' || c.is_ascii_digit() {
                self.i += 1;
            } else {
                break;
            }
        }
        let s = std::str::from_utf8(&self.b[start..self.i]).unwrap();
        J::Num(s.parse::<f64>().unwrap())
    }
}

// ======================================================================
// Konfigurasi normatif (SPEC.md sec.3) - sama dengan bg_core DEFAULTS
// ======================================================================
const N_ESTIMATORS: usize = 100;
const MAX_SAMPLES: usize = 256;
const SEED: u32 = 42;
const W_IF: f64 = 0.30;
const W_SVM: f64 = 0.70;   // slot detektor-2 = Mahalanobis (bukan centroid) -> bobot mayoritas
const GATE_SVM: usize = 20;
const Q_LOW: f64 = 0.10;
const Q_MED: f64 = 0.033;
const K_LOW: f64 = 1.75;       // kalibrasi parametrik: low = mean - K_LOW*std (C-33: 3,3 -> 1,75)
const K_MED_EXTRA: f64 = 2.0;  // pita MFA lebar
const MAHA_SHRINK: f64 = 0.3;  // shrinkage diagonal
const STD_FLOOR_EPS: f64 = 1e-9;
const STD_FLOOR_VALUE: f64 = 1.0;
const SCORE_STD_MIN: f64 = 1e-3;
const SCORE_STD_MAX: f64 = 10.0;
const Z_CLAMP: f64 = 6.0;

// ======================================================================
// PRNG mulberry32 (SPEC.md sec.4) - wajib bit-exact u32
// ======================================================================
struct Mulberry32 {
    a: u32,
}
impl Mulberry32 {
    fn new(seed: u32) -> Self {
        Mulberry32 { a: seed }
    }
    fn next(&mut self) -> f64 {
        self.a = self.a.wrapping_add(0x6D2B79F5);
        let mut t = self.a;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

fn c_factor(n: usize) -> f64 {
    if n <= 1 {
        return 0.0;
    }
    if n == 2 {
        return 1.0;
    }
    let nf = n as f64;
    2.0 * ((nf - 1.0).ln() + 0.5772156649) - 2.0 * (nf - 1.0) / nf
}

// ======================================================================
// Statistik & standardisasi
// ======================================================================
struct Stats {
    mean: Vec<f64>,
    std: Vec<f64>,
}

fn compute_stats(vectors: &[Vec<f64>]) -> Stats {
    let d = vectors[0].len();
    let n = vectors.len() as f64;
    let mut mean = vec![0.0; d];
    for v in vectors {
        for i in 0..d {
            mean[i] += v[i];
        }
    }
    for i in 0..d {
        mean[i] /= n;
    }
    let mut var = vec![0.0; d];
    for v in vectors {
        for i in 0..d {
            let diff = v[i] - mean[i];
            var[i] += diff * diff;
        }
    }
    for i in 0..d {
        var[i] /= n;
    }
    let std: Vec<f64> = var
        .iter()
        .map(|&v| {
            if v.sqrt() < STD_FLOOR_EPS {
                STD_FLOOR_VALUE
            } else {
                v.sqrt()
            }
        })
        .collect();
    Stats { mean, std }
}

fn standardize(vec: &[f64], s: &Stats) -> Vec<f64> {
    (0..vec.len()).map(|i| (vec[i] - s.mean[i]) / s.std[i]).collect()
}

struct ScoreStat {
    mean: f64,
    std: f64,
}
fn score_stats(scores: &[f64]) -> ScoreStat {
    let n = scores.len() as f64;
    let m = scores.iter().sum::<f64>() / n;
    let mut s = (scores.iter().map(|v| (v - m) * (v - m)).sum::<f64>() / n).sqrt();
    if !s.is_finite() || s < SCORE_STD_MIN {
        s = SCORE_STD_MIN;
    }
    if s > SCORE_STD_MAX {
        s = SCORE_STD_MAX;
    }
    ScoreStat { mean: m, std: s }
}

fn z_score(val: f64, st: &ScoreStat) -> f64 {
    let z = (val - st.mean) / st.std;
    z.max(-Z_CLAMP).min(Z_CLAMP)
}

// ======================================================================
// Isolation Forest
// ======================================================================
enum Node {
    Leaf { size: usize },
    Split { feat: usize, split: f64, left: Box<Node>, right: Box<Node> },
}

struct IsolationForest {
    trees: Vec<Node>,
    n_features: usize,
    c: f64,
}

impl IsolationForest {
    fn fit(x: &[Vec<f64>]) -> Self {
        let n_features = x[0].len();
        let n = MAX_SAMPLES.min(x.len());
        let c = c_factor(n);
        let mut rng = Mulberry32::new(SEED);
        let max_depth = if n > 1 { (n as f64).log2().ceil() as i64 } else { 0 };
        let mut trees = Vec::with_capacity(N_ESTIMATORS);
        for _ in 0..N_ESTIMATORS {
            let mut idx: Vec<usize> = (0..x.len()).collect();
            let mut i = idx.len() as i64 - 1;
            while i > 0 {
                let j = (rng.next() * (i as f64 + 1.0)) as usize;
                idx.swap(i as usize, j);
                i -= 1;
            }
            let sample: Vec<&Vec<f64>> = idx[..n].iter().map(|&k| &x[k]).collect();
            trees.push(build(&sample, 0, max_depth, n_features, &mut rng));
        }
        IsolationForest { trees, n_features, c }
    }

    fn score_one(&self, x: &[f64]) -> f64 {
        if self.trees.is_empty() {
            return 0.0;
        }
        let avg_h: f64 =
            self.trees.iter().map(|t| path(x, t, 0)).sum::<f64>() / self.trees.len() as f64;
        let anom = if self.c != 0.0 {
            2f64.powf(-avg_h / self.c)
        } else {
            0.5
        };
        0.5 - anom
    }
}

fn build(points: &[&Vec<f64>], depth: i64, max_depth: i64, nf: usize, rng: &mut Mulberry32) -> Node {
    if depth >= max_depth || points.len() <= 1 {
        return Node::Leaf { size: points.len() };
    }
    let feat = (rng.next() * nf as f64) as usize;
    let mut mn = points[0][feat];
    let mut mx = points[0][feat];
    for p in points {
        if p[feat] < mn {
            mn = p[feat];
        }
        if p[feat] > mx {
            mx = p[feat];
        }
    }
    if mn == mx {
        return Node::Leaf { size: points.len() };
    }
    let split = mn + rng.next() * (mx - mn);
    let left: Vec<&Vec<f64>> = points.iter().filter(|p| p[feat] < split).cloned().collect();
    let right: Vec<&Vec<f64>> = points.iter().filter(|p| p[feat] >= split).cloned().collect();
    if left.is_empty() || right.is_empty() {
        return Node::Leaf { size: points.len() };
    }
    Node::Split {
        feat,
        split,
        left: Box::new(build(&left, depth + 1, max_depth, nf, rng)),
        right: Box::new(build(&right, depth + 1, max_depth, nf, rng)),
    }
}

fn path(x: &[f64], node: &Node, depth: i64) -> f64 {
    match node {
        Node::Leaf { size } => depth as f64 + c_factor(*size),
        Node::Split { feat, split, left, right } => {
            if x[*feat] < *split {
                path(x, left, depth + 1)
            } else {
                path(x, right, depth + 1)
            }
        }
    }
}

// ======================================================================
// OC-SVM (aproksimasi centroid-RBF) - LAMA, dipertahankan utk model2='centroid'
// ======================================================================
#[allow(dead_code)]
struct Ocsvm {
    gamma: f64,
    mean: Vec<f64>,
    threshold: f64,
}
impl Ocsvm {
    fn fit(x: &[Vec<f64>], n_features: usize) -> Self {
        let d = x[0].len();
        let mut mean = vec![0.0; d];
        for v in x {
            for i in 0..d {
                mean[i] += v[i];
            }
        }
        for i in 0..d {
            mean[i] /= x.len() as f64;
        }
        let gamma = 1.0 / n_features as f64;
        let raw = |xi: &Vec<f64>| -> f64 {
            let dist2: f64 = (0..d).map(|i| (xi[i] - mean[i]) * (xi[i] - mean[i])).sum();
            (-gamma * dist2).exp()
        };
        let mut scores: Vec<f64> = x.iter().map(|v| raw(v)).collect();
        scores.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let idx = (scores.len() as f64 * 0.10) as usize;
        let val = if idx < scores.len() { scores[idx] } else { 0.0 };
        let threshold = if val != 0.0 { val } else { 0.0 };
        Ocsvm { gamma, mean, threshold }
    }
    fn score_one(&self, x: &[f64]) -> f64 {
        let dist2: f64 =
            (0..x.len()).map(|i| (x[i] - self.mean[i]) * (x[i] - self.mean[i])).sum();
        (-self.gamma * dist2).exp() - self.threshold - 0.1
    }
}

// ======================================================================
// Mahalanobis + shrinkage diagonal (detektor-2 baru). Bit-identik bg_core.py.
// score_one = -sqrt((x-mu)^T Sigma^-1 (x-mu)); higher = lebih normal.
// ======================================================================
struct Mahalanobis {
    mean: Vec<f64>,
    inv: Vec<Vec<f64>>,
}
impl Mahalanobis {
    fn fit(x: &[Vec<f64>], shrink: f64) -> Self {
        let n = x.len();
        let d = x[0].len();
        let mut mean = vec![0.0; d];
        for v in x {
            for i in 0..d {
                mean[i] += v[i];
            }
        }
        for i in 0..d {
            mean[i] /= n as f64;
        }
        let mut cov = vec![vec![0.0f64; d]; d];
        for v in x {
            let dv: Vec<f64> = (0..d).map(|i| v[i] - mean[i]).collect();
            for i in 0..d {
                let di = dv[i];
                for j in 0..d {
                    cov[i][j] += di * dv[j];
                }
            }
        }
        let denom = if n > 1 { (n - 1) as f64 } else { 1.0 };
        for i in 0..d {
            for j in 0..d {
                cov[i][j] /= denom;
            }
        }
        let mut mu = 0.0;
        for i in 0..d {
            mu += cov[i][i];
        }
        mu /= d as f64;
        for i in 0..d {
            for j in 0..d {
                cov[i][j] = (1.0 - shrink) * cov[i][j] + if i == j { shrink * mu } else { 0.0 };
            }
            cov[i][i] += 1e-6;
        }
        Mahalanobis { mean, inv: Self::inv(&cov, d) }
    }
    // Gauss-Jordan pivot-parsial. Urutan operasi float dijaga identik lintas bahasa.
    fn inv(a: &[Vec<f64>], d: usize) -> Vec<Vec<f64>> {
        let mut m = vec![vec![0.0f64; 2 * d]; d];
        for i in 0..d {
            for j in 0..d {
                m[i][j] = a[i][j];
            }
            m[i][d + i] = 1.0;
        }
        for col in 0..d {
            let mut piv = col;
            let mut best = m[col][col].abs();
            for r in (col + 1)..d {
                if m[r][col].abs() > best {
                    best = m[r][col].abs();
                    piv = r;
                }
            }
            if m[piv][col].abs() < 1e-12 {
                m[piv][col] = 1e-12;
            }
            if piv != col {
                m.swap(col, piv);
            }
            let pv = m[col][col];
            for k in 0..(2 * d) {
                m[col][k] /= pv;
            }
            for r in 0..d {
                if r != col && m[r][col] != 0.0 {
                    let f = m[r][col];
                    for k in 0..(2 * d) {
                        m[r][k] -= f * m[col][k];
                    }
                }
            }
        }
        m.iter().map(|row| row[d..].to_vec()).collect()
    }
    fn score_one(&self, x: &[f64]) -> f64 {
        let d = x.len();
        let dv: Vec<f64> = (0..d).map(|i| x[i] - self.mean[i]).collect();
        let mut m2 = 0.0;
        for i in 0..d {
            let mut t = 0.0;
            for j in 0..d {
                t += self.inv[i][j] * dv[j];
            }
            m2 += dv[i] * t;
        }
        -(if m2 > 0.0 { m2 } else { 0.0 }).sqrt()
    }
}

// ======================================================================
// Ensemble
// ======================================================================
struct GatedW {
    isolation_forest: f64,
    svm: f64,
}
fn gate_weights(n: usize) -> GatedW {
    let svm = if n < GATE_SVM { 0.0 } else { W_SVM };
    let s = W_IF + svm;
    if s <= 0.0 {
        return GatedW { isolation_forest: W_IF, svm: W_SVM };
    }
    GatedW { isolation_forest: W_IF / s, svm: svm / s }
}

struct Ensemble {
    iforest: IsolationForest,
    det2: Mahalanobis,
    if_stats: ScoreStat,
    svm_stats: ScoreStat,
    gated: GatedW,
}
impl Ensemble {
    fn new(iforest: IsolationForest, det2: Mahalanobis, x_std: &[Vec<f64>], n: usize) -> Self {
        let if_scores: Vec<f64> = x_std.iter().map(|x| iforest.score_one(x)).collect();
        let svm_scores: Vec<f64> = x_std.iter().map(|x| det2.score_one(x)).collect();
        Ensemble {
            if_stats: score_stats(&if_scores),
            svm_stats: score_stats(&svm_scores),
            gated: gate_weights(n),
            iforest,
            det2,
        }
    }
    fn score_one(&self, x: &[f64]) -> f64 {
        let raw_if = self.iforest.score_one(x);
        let raw_svm = self.det2.score_one(x);
        let z_if = z_score(raw_if, &self.if_stats);
        let z_svm = z_score(raw_svm, &self.svm_stats);
        if self.gated.svm == 0.0 {
            return z_if;
        }
        self.gated.isolation_forest * z_if + self.gated.svm * z_svm
    }
}

// ======================================================================
// Ambang & vonis
// ======================================================================
fn quantile(sorted: &[f64], q: f64) -> f64 {
    if sorted.is_empty() {
        return -0.4;
    }
    let idx = q * (sorted.len() as f64 - 1.0);
    let lo = idx.floor() as usize;
    let hi = idx.ceil() as usize;
    if lo == hi {
        return sorted[lo];
    }
    let frac = idx - lo as f64;
    sorted[lo] * (1.0 - frac) + sorted[hi] * frac
}

fn calibrate_thresholds(baseline_scores: &[f64]) -> (f64, f64) {
    let mut s = baseline_scores.to_vec();
    s.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let low = quantile(&s, Q_LOW);
    let mut med = quantile(&s, Q_MED);
    if low - med < 0.15 {
        med = low - 0.25;
    }
    let low = low.max(-3.0).min(1.0);
    let med = med.max(-3.0).min(low - 0.05);
    (low, med)
}

// Kalibrasi PARAMETRIK: low = mean - K_LOW*std; MEDIUM lebih ketat. Bit-identik bg_core.py.
fn calibrate_thresholds_parametric(baseline_scores: &[f64]) -> (f64, f64) {
    let n = baseline_scores.len();
    if n == 0 {
        return (-0.4, -0.8);
    }
    let m: f64 = baseline_scores.iter().sum::<f64>() / n as f64;
    let var: f64 = baseline_scores.iter().map(|x| (x - m) * (x - m)).sum::<f64>() / n as f64;
    let sd = if var > 1e-12 { var.sqrt() } else { 1.0 };
    (m - K_LOW * sd, m - (K_LOW + K_MED_EXTRA) * sd)
}

fn to_risk(score: f64, low: f64, med: f64) -> &'static str {
    if score <= med {
        "HIGH"
    } else if score <= low {
        "MEDIUM"
    } else {
        "LOW"
    }
}
fn to_action(level: &str) -> &'static str {
    // HIGH tunggal -> step-up (bukan block). Block keras = aturan-run di lapisan SDK.
    match level {
        "HIGH" => "REQUIRE_STEPUP",
        "MEDIUM" => "REQUIRE_MFA",
        _ => "ALLOW_SESSION",
    }
}
fn top_feature(vec_std: &[f64], names: &[String]) -> String {
    let mut best = 0usize;
    let mut best_abs = vec_std[0].abs();
    for i in 1..vec_std.len() {
        if vec_std[i].abs() > best_abs {
            best_abs = vec_std[i].abs();
            best = i;
        }
    }
    names[best].clone()
}

struct Model {
    stats: Stats,
    ens: Ensemble,
    low: f64,
    med: f64,
}
fn build_model(vectors: &[Vec<f64>], n_features: usize) -> Model {
    let stats = compute_stats(vectors);
    let x_std: Vec<Vec<f64>> = vectors.iter().map(|v| standardize(v, &stats)).collect();
    let iff = IsolationForest::fit(&x_std);
    let _ = n_features; // Mahalanobis tak butuh n_features (gamma centroid saja)
    let det2 = Mahalanobis::fit(&x_std, MAHA_SHRINK);
    let ens = Ensemble::new(iff, det2, &x_std, vectors.len());
    let base_scores: Vec<f64> = x_std.iter().map(|x| ens.score_one(x)).collect();
    let (low, med) = calibrate_thresholds_parametric(&base_scores);
    Model { stats, ens, low, med }
}

// ======================================================================
// EKSTRAKSI FITUR (SPEC.md sec.8): event mentah -> vektor 34-float
// ======================================================================
fn num(e: &J, key: &str) -> f64 {
    match e.get(key) {
        Some(J::Num(n)) if n.is_finite() => *n,
        _ => 0.0,
    }
}
fn has_num(e: &J, key: &str) -> Option<f64> {
    match e.get(key) {
        Some(J::Num(n)) => Some(*n),
        _ => None,
    }
}
fn sstr(e: &J, key: &str) -> String {
    match e.get(key) {
        Some(J::Str(s)) => s.clone(),
        _ => String::new(),
    }
}
fn etype(e: &J) -> &str {
    e.get("event_type").map(|v| v.str()).unwrap_or("")
}
fn mean(a: &[f64]) -> f64 {
    if a.is_empty() {
        0.0
    } else {
        a.iter().sum::<f64>() / a.len() as f64
    }
}
fn std(a: &[f64]) -> f64 {
    if a.is_empty() {
        return 0.0;
    }
    let m = mean(a);
    (a.iter().map(|v| (v - m) * (v - m)).sum::<f64>() / a.len() as f64).sqrt()
}
fn safe(v: f64) -> f64 {
    if v.is_finite() {
        v
    } else {
        0.0
    }
}

fn f4_names() -> Vec<&'static str> {
    vec![
        "mouse_velocity_mean", "mouse_velocity_std", "mouse_velocity_max",
        "mouse_acceleration_std", "mouse_curvature_mean", "mouse_direction_changes",
        "mouse_pause_count", "mouse_click_interval_mean", "cursor_idle_ratio",
        "cross_mouse_keyboard_coordination", "keystroke_dwell_time_mean",
        "keystroke_dwell_time_std", "keystroke_flight_time_mean",
        "keystroke_transition_entropy", "keystroke_typing_speed",
        "keystroke_cross_field_cadence", "keystroke_burst_count",
        "temporal_time_of_day_score", "temporal_session_duration",
        "temporal_activity_bursts", "nav_page_transition_pattern", "nav_scroll_depth_mean",
        "nav_page_count", "nav_step_transition_count", "form_focus_count", "form_blur_count",
        "form_field_switch_rate", "cart_action_count",
        // SPEC 1.4 (C-44): ritme ketik
        "keystroke_flight_median", "keystroke_flight_iqr", "keystroke_backspace_ratio",
        "keystroke_cross_hand_ratio", "keystroke_dwell_median", "keystroke_shift_ratio",
    ]
}

fn extract_features(events: &[J], session_start_ts: f64) -> Vec<f64> {
    let names = f4_names();
    if events.is_empty() {
        return vec![0.0; names.len()];
    }
    let filt = |t: &str| -> Vec<&J> { events.iter().filter(|e| etype(e) == t).collect() };
    let mouse_move = filt("MOUSE_MOVE");
    let mouse_click = filt("MOUSE_CLICK");
    let mouse_scroll = filt("MOUSE_SCROLL");
    let mut mouse_ev: Vec<&J> = Vec::new();
    mouse_ev.extend(&mouse_move);
    mouse_ev.extend(&mouse_click);
    mouse_ev.extend(&mouse_scroll);
    let key_ev = filt("KEYSTROKE");
    let scroll_ev = &mouse_scroll;
    let focus_ev = filt("FORM_FOCUS");
    let blur_ev = filt("FORM_BLUR");
    let nav_ev: Vec<&J> =
        events.iter().filter(|e| etype(e) == "NAVIGATION" || etype(e) == "PAGE_STEP").collect();

    let mut velocities = Vec::new();
    let mut accelerations = Vec::new();
    let mut curvatures = Vec::new();
    let mut pauses = 0.0;
    let mut direction_changes = 0.0;
    let mut last_dir: Option<f64> = None;
    for i in 1..mouse_ev.len() {
        let p = mouse_ev[i - 1];
        let c = mouse_ev[i];
        let dt = num(c, "timestamp") - num(p, "timestamp");
        if dt <= 0.0 {
            continue;
        }
        let dx = num(c, "x") - num(p, "x");
        let dy = num(c, "y") - num(p, "y");
        let dist = dx.hypot(dy);
        let v = dist / dt;
        velocities.push(v);
        if dist > 0.0 {
            let dr = dy.atan2(dx);
            if let Some(ld) = last_dir {
                if (dr - ld).abs() > std::f64::consts::PI / 4.0 + 1e-9 { // SPEC 1.3 (C-34)
                    direction_changes += 1.0;
                }
            }
            last_dir = Some(dr);
        }
        if velocities.len() > 1 {
            let a = (v - velocities[velocities.len() - 2]) / dt;
            accelerations.push(a);
        }
        if i >= 2 {
            let p2 = mouse_ev[i - 2];
            let x0 = num(p2, "x");
            let y0 = num(p2, "y");
            let x1 = num(p, "x");
            let y1 = num(p, "y");
            let x2 = num(c, "x");
            let y2 = num(c, "y");
            let area = x0 * (y1 - y2) + x1 * (y2 - y0) + x2 * (y0 - y1);
            let sa = (x1 - x0).hypot(y1 - y0);
            let sb = (x2 - x1).hypot(y2 - y1);
            let sc = (x2 - x0).hypot(y2 - y0);
            if sa * sb * sc > 0.0 {
                curvatures.push((4.0 * area / (sa * sb * sc)).abs());
            }
        }
        if dt > 100.0 {
            pauses += 1.0;
        }
    }

    let mut click_intervals = Vec::new();
    for i in 1..mouse_click.len() {
        click_intervals.push(num(mouse_click[i], "timestamp") - num(mouse_click[i - 1], "timestamp"));
    }

    let mut cursor_idle = 0.0;
    if !mouse_move.is_empty() {
        let idle = mouse_move.iter().filter(|e| num(e, "velocity") < 0.5).count();
        cursor_idle = idle as f64 / mouse_move.len() as f64;
        if cursor_idle == 0.0 && !velocities.is_empty() {
            let slow = velocities.iter().filter(|&&v| v < 0.05).count();
            cursor_idle = slow as f64 / velocities.len() as f64;
        }
    }

    let mut all_mk: Vec<&J> = Vec::new();
    all_mk.extend(&mouse_ev);
    all_mk.extend(&key_ev);
    all_mk.sort_by(|a, b| num(a, "timestamp").partial_cmp(&num(b, "timestamp")).unwrap());
    let mut alternations = 0.0;
    let mut last_type: Option<&str> = None;
    for e in &all_mk {
        let cur = if etype(e).contains("MOUSE") { "mouse" } else { "keyboard" };
        if let Some(lt) = last_type {
            if lt != cur {
                alternations += 1.0;
            }
        }
        last_type = Some(cur);
    }
    let cross_coord = if all_mk.is_empty() { 0.0 } else { alternations / all_mk.len() as f64 };

    let hold_times: Vec<f64> = key_ev.iter().filter_map(|e| has_num(e, "hold_time")).collect();
    let mut flight_times = Vec::new();
    for i in 1..key_ev.len() {
        flight_times.push(num(key_ev[i], "timestamp") - num(key_ev[i - 1], "timestamp"));
    }
    let key_entropy = if key_ev.len() < 2 {
        0.0
    } else {
        let mut trans: HashMap<String, f64> = HashMap::new();
        for i in 1..key_ev.len() {
            let k = format!("{}->{}", sstr(key_ev[i - 1], "key"), sstr(key_ev[i], "key"));
            *trans.entry(k).or_insert(0.0) += 1.0;
        }
        let total = (key_ev.len() - 1) as f64;
        let mut h = 0.0;
        for cnt in trans.values() {
            let p = cnt / total;
            h -= p * (p + 1e-9).ln();
        }
        h
    };
    let mut burst_count = 0.0;
    let mut in_burst = false;
    for i in 1..key_ev.len() {
        let dt = num(key_ev[i], "timestamp") - num(key_ev[i - 1], "timestamp");
        if dt < 333.0 {
            if !in_burst {
                burst_count += 1.0;
                in_burst = true;
            }
        } else {
            in_burst = false;
        }
    }
    let mut focus_times: Vec<f64> = focus_ev.iter().map(|e| num(e, "timestamp")).collect();
    focus_times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut ks_times: Vec<f64> = key_ev.iter().map(|e| num(e, "timestamp")).collect();
    ks_times.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut cross_gaps = Vec::new();
    for &ft in &focus_times {
        let before = ks_times.iter().filter(|&&t| t < ft).last().copied();
        let after = ks_times.iter().find(|&&t| t >= ft).copied();
        if let (Some(b), Some(a)) = (before, after) {
            cross_gaps.push(a - b);
        }
    }

    let first_ts = {
        let f = num(&events[0], "timestamp");
        if f != 0.0 { f } else if session_start_ts != 0.0 { session_start_ts } else { 0.0 }
    };
    let last_ts = {
        let l = num(&events[events.len() - 1], "timestamp");
        if l != 0.0 { l } else { first_ts }
    };
    let duration = (last_ts - first_ts) / 1000.0;
    // temporal_time_of_day_score: UTC (SPEC sec.9 / F-1)
    let s = (first_ts / 1000.0).floor() as i64;
    let sod = ((s % 86400) + 86400) % 86400;
    let hour = (sod / 3600) as f64;
    let minute = ((sod % 3600) / 60) as f64;
    let time_of_day = (hour + minute / 60.0) / 24.0;

    let mut per_sec: HashMap<i64, f64> = HashMap::new();
    for e in events {
        let sec = (num(e, "timestamp") / 1000.0).floor() as i64;
        *per_sec.entry(sec).or_insert(0.0) += 1.0;
    }
    let counts: Vec<f64> = per_sec.values().copied().collect();
    let m_act = mean(&counts);
    let s_act = std(&counts);
    let bursts = counts.iter().filter(|&&c| c > m_act + 2.0 * s_act).count() as f64;

    let page_urls: Vec<String> =
        nav_ev.iter().map(|e| sstr(e, "page_url")).filter(|s| !s.is_empty()).collect();
    let unique_pages: std::collections::HashSet<&String> = page_urls.iter().collect();
    let all_pages: std::collections::HashSet<String> =
        events.iter().map(|e| sstr(e, "page_url")).filter(|s| !s.is_empty()).collect();
    let page_trans = if page_urls.is_empty() {
        0.0
    } else {
        unique_pages.len() as f64 / page_urls.len() as f64
    };
    let scroll_deltas: Vec<f64> = scroll_ev.iter().map(|e| num(e, "scroll_delta").abs()).collect();
    let mut focus_sorted: Vec<f64> = focus_ev.iter().map(|e| num(e, "timestamp")).collect();
    focus_sorted.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut field_gaps = Vec::new();
    for i in 1..focus_sorted.len() {
        let g = focus_sorted[i] - focus_sorted[i - 1];
        if g > 0.0 {
            field_gaps.push(g);
        }
    }
    let vmax = velocities.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
    let vmax = if velocities.is_empty() { 0.0 } else { vmax };

    let mut out: HashMap<&str, f64> = HashMap::new();
    out.insert("mouse_velocity_mean", safe(mean(&velocities)));
    out.insert("mouse_velocity_std", safe(std(&velocities)));
    out.insert("mouse_velocity_max", safe(vmax));
    out.insert("mouse_acceleration_std", safe(std(&accelerations)));
    out.insert("mouse_curvature_mean", safe(mean(&curvatures)));
    out.insert("mouse_direction_changes", safe(direction_changes));
    out.insert("mouse_pause_count", safe(pauses));
    out.insert("mouse_click_interval_mean", safe(mean(&click_intervals)));
    out.insert("cursor_idle_ratio", safe(cursor_idle));
    out.insert("cross_mouse_keyboard_coordination", safe(cross_coord));
    out.insert("keystroke_dwell_time_mean", safe(mean(&hold_times)));
    out.insert("keystroke_dwell_time_std", safe(std(&hold_times)));
    out.insert("keystroke_flight_time_mean", safe(mean(&flight_times)));
    out.insert("keystroke_transition_entropy", safe(key_entropy));
    out.insert(
        "keystroke_typing_speed",
        safe(if duration > 0.0 { key_ev.len() as f64 / duration } else { 0.0 }),
    );
    out.insert("keystroke_cross_field_cadence", safe(mean(&cross_gaps)));
    out.insert("keystroke_burst_count", safe(burst_count));
    out.insert("temporal_time_of_day_score", safe(time_of_day));
    out.insert("temporal_session_duration", safe(duration));
    out.insert("temporal_activity_bursts", safe(bursts));
    out.insert("nav_page_transition_pattern", safe(page_trans));
    out.insert("nav_scroll_depth_mean", safe(mean(&scroll_deltas)));
    out.insert("nav_page_count", safe(all_pages.len() as f64));
    out.insert("nav_step_transition_count", safe(nav_ev.len() as f64));
    out.insert("form_focus_count", safe(focus_ev.len() as f64));
    out.insert("form_blur_count", safe(blur_ev.len() as f64));
    out.insert("form_field_switch_rate", safe(mean(&field_gaps)));
    out.insert(
        "cart_action_count",
        safe(events.iter().filter(|e| etype(e) == "CART_ACTION").count() as f64),
    );

    keystroke_rhythm(&key_ev, &mut out); // SPEC 1.4 (C-44)

    names.iter().map(|k| safe(*out.get(*k).unwrap_or(&0.0))).collect()
}

// ---- SPEC 1.4 (C-44): ritme ketik. Padanan keyClass()/keystrokeRhythm() di features.js.
fn key_class(e: &J) -> &'static str {
    if let Some(J::Str(kc)) = e.get("kc") {
        match kc.as_str() {
            "" => {}
            "L" => return "L",
            "R" => return "R",
            "D" => return "D",
            "S" => return "S",
            "P" => return "P",
            "E" => return "E",
            "H" => return "H",
            _ => return "O",
        }
    }
    let k = match e.get("key") {
        Some(J::Str(k)) => k.as_str(),
        _ => return "O",
    };
    let b = k.as_bytes();
    if b.len() == 1 && b[0] < 128 {
        let mut c = b[0];
        if (b'A'..=b'Z').contains(&c) {
            c += 32;
        }
        if b"qwertasdfgzxcvb".contains(&c) {
            return "L";
        }
        if b"yuiophjklnm".contains(&c) {
            return "R";
        }
        if (b'0'..=b'9').contains(&c) {
            return "D";
        }
        if c == b' ' {
            return "S";
        }
        return "P";
    }
    match k {
        "Backspace" | "Delete" => "E",
        "Shift" => "H",
        _ => "O",
    }
}
fn median(a: &[f64]) -> f64 {
    if a.is_empty() {
        return 0.0;
    }
    let mut b = a.to_vec();
    b.sort_by(|x, y| x.partial_cmp(y).unwrap());
    let m = b.len() / 2;
    if b.len() % 2 == 1 {
        b[m]
    } else {
        (b[m - 1] + b[m]) / 2.0
    }
}
fn keystroke_rhythm(key_ev: &[&J], out: &mut HashMap<&'static str, f64>) {
    let (mut fl, mut same, mut cross, mut dw) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let (mut back, mut shift, mut letters) = (0.0f64, 0.0f64, 0.0f64);
    for i in 0..key_ev.len() {
        let e = key_ev[i];
        let c = key_class(e);
        if c == "E" {
            back += 1.0;
        }
        if c == "H" {
            shift += 1.0;
        }
        if c == "L" || c == "R" {
            letters += 1.0;
        }
        if let Some(h) = has_num(e, "hold_time") {
            if h > 0.0 && h < 1000.0 {
                dw.push(h);
            }
        }
        if i > 0 {
            let p = key_ev[i - 1];
            let dt = num(e, "timestamp") - num(p, "timestamp");
            if dt > 0.0 && dt < 1000.0 {
                fl.push(dt);
                let pc = key_class(p);
                if (pc == "L" || pc == "R") && (c == "L" || c == "R") {
                    if pc == c {
                        same.push(dt);
                    } else {
                        cross.push(dt);
                    }
                }
            }
        }
    }
    let mut iqr = 0.0;
    if fl.len() > 3 {
        let mut b = fl.clone();
        b.sort_by(|x, y| x.partial_cmp(y).unwrap());
        let n = b.len() as f64;
        iqr = b[(n * 0.75).floor() as usize] - b[(n * 0.25).floor() as usize];
    }
    let (ms, mc) = (median(&same), median(&cross));
    let nk = key_ev.len() as f64;
    out.insert("keystroke_flight_median", safe(median(&fl)));
    out.insert("keystroke_flight_iqr", safe(iqr));
    out.insert("keystroke_backspace_ratio", safe(if nk > 0.0 { back / nk } else { 0.0 }));
    out.insert("keystroke_cross_hand_ratio", safe(if ms > 0.0 && mc > 0.0 { mc / ms } else { 0.0 }));
    out.insert("keystroke_dwell_median", safe(median(&dw)));
    out.insert("keystroke_shift_ratio", safe(if letters > 0.0 { shift / letters } else { 0.0 }));
}

// ======================================================================
// Uji kesesuaian lawan golden.json
// ======================================================================
fn close(a: f64, b: f64, tol: f64) -> bool {
    a == b || (a - b).abs() <= tol * 1.0f64.max(a.abs()).max(b.abs())
}

fn to_vecvec(j: &J) -> Vec<Vec<f64>> {
    j.arr().iter().map(|row| row.arr().iter().map(|v| v.num()).collect()).collect()
}

fn chk(
    passed: &mut usize,
    failed: &mut usize,
    problems: &mut Vec<String>,
    id: &str,
    label: &str,
    got: f64,
    want: f64,
    tol: f64,
) {
    if close(got, want, tol) {
        *passed += 1;
    } else {
        *failed += 1;
        problems.push(format!("{} / {}: dapat {}, harus {}", id, label, got, want));
    }
}

fn chk_str(
    passed: &mut usize,
    failed: &mut usize,
    problems: &mut Vec<String>,
    id: &str,
    label: &str,
    got: &str,
    want: &str,
) {
    if got == want {
        *passed += 1;
    } else {
        *failed += 1;
        problems.push(format!("{} / {}: dapat {}, harus {}", id, label, got, want));
    }
}

/// Laporan hasil uji kesesuaian - dipakai native (main.rs) & WASM (run_golden).
pub struct Report {
    pub passed: usize,
    pub failed: usize,
    pub spec_version: String,
    pub problems: Vec<String>,
}

/// Jalankan seluruh golden.json (teks) -> laporan. Ini otak yang dipakai di semua
/// permukaan: biner native, uji WASM, dan CI. Nol I/O di dalam sini.
pub fn run_conformance(text: &str) -> Report {
    let g = P::new(text).parse();
    let tol = g.get("tolerance").unwrap().num();
    let features: Vec<String> = g.get("features").unwrap().arr().iter().map(|v| v.str().to_string()).collect();
    let n_features = features.len();

    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut problems: Vec<String> = Vec::new();

    // --- SPEC v1.1: ekstraksi fitur ---
    if let Some(J::Arr(fcases)) = g.get("feature_cases") {
        for fc in fcases {
            let events = fc.get("events").unwrap().arr();
            let sst = fc.get("session_start_ts").map(|v| v.num()).unwrap_or(0.0);
            let got = extract_features(events, sst);
            let want: Vec<f64> = fc.get("expect_vector").unwrap().arr().iter().map(|v| v.num()).collect();
            let id = fc.get("id").unwrap().str();
            for i in 0..want.len() {
                if close(got[i], want[i], tol) {
                    passed += 1;
                } else {
                    failed += 1;
                    problems.push(format!(
                        "{} / vector[{}] ({}): dapat {}, harus {}",
                        id, i, features[i], got[i], want[i]
                    ));
                }
            }
        }
    }

    // --- SPEC v1.0: mesin (vektor -> vonis) ---
    for case in g.get("cases").unwrap().arr() {
        let id = case.get("id").unwrap().str();
        let baseline = to_vecvec(case.get("baseline").unwrap());
        let probes = to_vecvec(case.get("probes").unwrap());
        let exp = case.get("expect").unwrap();
        let model = build_model(&baseline, n_features);

        let th = exp.get("thresholds").unwrap();
        chk(&mut passed, &mut failed, &mut problems, id, "thresholds.low", model.low, th.get("low").unwrap().num(), tol);
        chk(&mut passed, &mut failed, &mut problems, id, "thresholds.medium", model.med, th.get("medium").unwrap().num(), tol);
        let smh = exp.get("stats_mean_head").unwrap().arr();
        for i in 0..smh.len() {
            chk(&mut passed, &mut failed, &mut problems, id, &format!("stats.mean[{}]", i), model.stats.mean[i], smh[i].num(), tol);
        }
        let ssh = exp.get("stats_std_head").unwrap().arr();
        for i in 0..ssh.len() {
            chk(&mut passed, &mut failed, &mut problems, id, &format!("stats.std[{}]", i), model.stats.std[i], ssh[i].num(), tol);
        }
        let ifs = exp.get("if_stats").unwrap();
        chk(&mut passed, &mut failed, &mut problems, id, "if_stats.mean", model.ens.if_stats.mean, ifs.get("mean").unwrap().num(), tol);
        chk(&mut passed, &mut failed, &mut problems, id, "if_stats.std", model.ens.if_stats.std, ifs.get("std").unwrap().num(), tol);
        let svs = exp.get("svm_stats").unwrap();
        chk(&mut passed, &mut failed, &mut problems, id, "svm_stats.mean", model.ens.svm_stats.mean, svs.get("mean").unwrap().num(), tol);
        chk(&mut passed, &mut failed, &mut problems, id, "svm_stats.std", model.ens.svm_stats.std, svs.get("std").unwrap().num(), tol);
        let gw = exp.get("gated_weights").unwrap();
        chk(&mut passed, &mut failed, &mut problems, id, "gated_weights.isolation_forest", model.ens.gated.isolation_forest, gw.get("isolation_forest").unwrap().num(), tol);
        chk(&mut passed, &mut failed, &mut problems, id, "gated_weights.svm", model.ens.gated.svm, gw.get("svm").unwrap().num(), tol);
        chk(&mut passed, &mut failed, &mut problems, id, "gated_weights.lstm", 0.0, gw.get("lstm").unwrap().num(), tol);

        let verdicts = exp.get("verdicts").unwrap().arr();
        for (i, probe) in probes.iter().enumerate() {
            let x_std = standardize(probe, &model.stats);
            let score = model.ens.score_one(&x_std);
            let level = to_risk(score, model.low, model.med);
            let action = to_action(level);
            let tf = top_feature(&x_std, &features);
            let w = &verdicts[i];
            chk(&mut passed, &mut failed, &mut problems, id, &format!("probe[{}].score", i), score, w.get("score").unwrap().num(), tol);
            chk_str(&mut passed, &mut failed, &mut problems, id, &format!("probe[{}].level", i), level, w.get("level").unwrap().str());
            chk_str(&mut passed, &mut failed, &mut problems, id, &format!("probe[{}].action", i), action, w.get("action").unwrap().str());
            chk_str(&mut passed, &mut failed, &mut problems, id, &format!("probe[{}].topFeature", i), &tf, w.get("topFeature").unwrap().str());
        }
    }

    Report {
        passed,
        failed,
        spec_version: g.get("spec_version").unwrap().str().to_string(),
        problems,
    }
}

// ======================================================================
// EKSPOR WASM (wasm32-unknown-unknown, nol dependensi, C ABI)
// ----------------------------------------------------------------------
// Artefak `.wasm` yang sama bisa dipanggil dari environment apa pun yang punya
// runtime WASM: browser, Node, Deno, Go (wazero), Python (wasmtime), edge worker,
// dll. Ini "satu otak" dalam bentuk paling harfiah - satu berkas biner.
//
// Kontrak memori:
//   let p = alloc(len);                     // minta buffer di memori linear WASM
//   <tulis `len` byte teks golden ke p>
//   let packed = run_golden(p, len);        // -> (out_ptr<<32) | out_len
//   let out_ptr = packed >> 32; let out_len = packed & 0xffffffff;
//   <baca `out_len` byte JSON hasil dari out_ptr>
//   dealloc(out_ptr, out_len); dealloc(p, len);
// ======================================================================

/// Alokasikan `size` byte di memori linear WASM, kembalikan pointernya.
#[no_mangle]
pub extern "C" fn alloc(size: usize) -> *mut u8 {
    let mut buf: Vec<u8> = Vec::with_capacity(size);
    let ptr = buf.as_mut_ptr();
    std::mem::forget(buf);
    ptr
}

/// Bebaskan buffer yang dialokasikan `alloc` / dikembalikan `run_golden`.
///
/// # Safety
/// `ptr`/`size` harus persis pasangan dari `alloc` atau keluaran `run_golden`.
#[no_mangle]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, size: usize) {
    let _ = Vec::from_raw_parts(ptr, 0, size);
}

/// Baca teks golden.json dari (`ptr`,`len`), jalankan 319 pemeriksaan, kembalikan
/// hasil sebagai JSON. Nilai balik = `(out_ptr << 32) | out_len` (little-packed u64).
///
/// # Safety
/// `ptr`/`len` harus menunjuk ke `len` byte UTF-8 valid di memori linear WASM.
#[no_mangle]
pub unsafe extern "C" fn run_golden(ptr: *const u8, len: usize) -> u64 {
    let slice = std::slice::from_raw_parts(ptr, len);
    let text = String::from_utf8_lossy(slice);
    let r = run_conformance(&text);
    let verdict = if r.failed == 0 { "SESUAI" } else { "TIDAK SESUAI" };
    let out = format!(
        "{{\"passed\":{},\"total\":{},\"spec\":\"{}\",\"verdict\":\"{}\"}}",
        r.passed,
        r.passed + r.failed,
        r.spec_version,
        verdict
    );
    let bytes = out.into_bytes();
    let out_len = bytes.len() as u64;
    let mut b = bytes;
    let out_ptr = b.as_mut_ptr() as u64;
    std::mem::forget(b);
    (out_ptr << 32) | out_len
}
