// Biner uji kesesuaian native. Otaknya ada di lib.rs (dipakai bersama WASM).
//   cargo run --release            # jalankan 319 pemeriksaan lawan golden.json
use bg_core::run_conformance;
use std::fs;

fn main() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../core/golden.json");
    let text = fs::read_to_string(path).expect("gagal baca golden.json");
    let r = run_conformance(&text);

    println!();
    println!("CONFORMANCE  spec {}", r.spec_version);
    println!("  passed {} / {}", r.passed, r.passed + r.failed);
    if !r.problems.is_empty() {
        println!("  FAILED:");
        for p in r.problems.iter().take(25) {
            println!("    - {}", p);
        }
    }
    println!("  RESULT: {}", if r.failed == 0 { "PASS" } else { "FAIL" });
    std::process::exit(if r.failed == 0 { 0 } else { 1 });
}
