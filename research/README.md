# Research

Everything behind the published numbers, kept apart from the library. Nothing in this folder
is needed to install or run BehaviorGuard.

The research database (raw events of 16 volunteers) is **not** in the repository. Scripts
that need it read the path from `BG_RESEARCH_DB`; exports go to the OS temp directory, never
into the repo.

## Measuring the shipped library

| Script | What it does |
|---|---|
| `eval_sdk.mjs` | Replays sessions through the real `sdk/` code path and reports FRR/FAR/AUC. Works on your own data too (`--data my_sessions.json --live`). |
| `export_sessions.py` | Exports the research sessions to JSON for `eval_sdk.mjs` (to the OS temp directory). |
| `eval_typing.mjs` | How well a short typed phrase separates people (the step-up's rhythm check). |
| `reproduce_db.py` | The thesis validation engine; `core/drift_check.py` checks it against the shipped engine. |
| `reproduce.py`, `reproduce.js`, `reproduce_simple.py` | Smaller reproductions of the headline numbers. |

## Experiments and ablations

| Script | What it does |
|---|---|
| `canonical_holdout.py` | Held-out check of the idle and compression changes (C-23, C-24). |
| `idle_ablation.py` | The idle-segmentation ablation. |
| `frr_levers.py` | Levers that lower the owner's false-reject rate, under the same protocol. |
| `experiment.py` | Alternatives to the centroid score. |
| `one_engine_replay.py`, `one_engine_explain.py` | One engine (bg_core + the SDK cycle) replayed per session, with reasons. |
| `make_tracker_maha.py` | Per-session progress table (written to the OS temp directory). |

## Notes and other material

- [notes/](notes/) - the measurement-validity audit, the context-and-idle proposal, and the
  held-out result logs.
- [accuracy-lab/](accuracy-lab/) - label your own sessions as owner or other and export CSV.
- [legacy-demos/](legacy-demos/) - the earlier local-mode demo sites.

The defects these experiments found, and the tests that now guard them, are in
[core/DRIFT.md](../core/DRIFT.md).
