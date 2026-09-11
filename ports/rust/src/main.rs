// Biner uji kesesuaian native. Otaknya ada di lib.rs (dipakai bersama WASM).
//   cargo run --release            # jalankan 319 pemeriksaan lawan golden.json
use bg_core::run_conformance;
use std::fs;

fn main() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../core/golden.json");
    let text = fs::read_to_string(path).expect("gagal baca golden.json");
    let r = run_conformance(&text);

    println!();
    println!("KESESUAIAN  spec {}", r.spec_version);
    println!("  lulus {} / {}", r.passed, r.passed + r.failed);
    if !r.problems.is_empty() {
        println!("  GAGAL:");
        for p in r.problems.iter().take(25) {
            println!("    - {}", p);
        }
    }
    println!("  HASIL: {}", if r.failed == 0 { "SESUAI" } else { "TIDAK SESUAI" });
    std::process::exit(if r.failed == 0 { 0 } else { 1 });
}
