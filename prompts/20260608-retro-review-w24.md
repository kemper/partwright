---
date: "2026-06-08"
task: "chore: weekly retro review 2026-W24"
pr: ~
areas: [docs, tooling, retro]
---

## Human

Run the /retro-review skill for 2026-W24: cluster and weight the 6 inbox entries, apply confident process diffs, file backlog items, write the durable report, archive entries, open a draft PR.

## Assistant

**Key decisions:**

1. **sdf.md `thickness` bug was the highest-priority correctness fix.** Two independent agents lost a full revision round following docs that said `thickness ≈ cellSize/6..cellSize/3`. The field is a threshold on a ~[-1.5, 1.5] scale — `thickness ≥ 1.1` is already near-solid. Replaced the entire paragraph with field-threshold semantics and concrete ranges. Also added TPMS edgeLength/triangle-budget guidance (tie to cellSize/14..16, ≤ 200k for catalog entries) since the same agents needed it and it's the right place.

2. **CLAUDE.md model:preview was stale.** The section only mentioned manifold-js but the 20260607 task had added `--lang voxel|scad` support. Updated to reflect the multi-engine flag, note replicad requires the Phase 2 daemon, cross-reference `partwright photo` and `docs/headless-cli.md`. Added the image-delegation note (model-sculpt subagent + SendUserFile) here rather than the Manual Verification section — that section is about UI/browser checks; this is where CLI geometry iteration lives.

3. **`componentCount > 1` for multi-part assemblies is correct.** 4+ agents wasted build rounds second-guessing legitimate counts. Updated visual-verification.md to distinguish single-body prints (expect 1) from assemblies (expect N). Added the "decompose and inspect, don't tune blindly" discipline note to mechanisms.md rather than visual-verification.md — it's more actionable there alongside the mechanism-building recipes.

4. **SCAD for-loop drops labels** — placed in bosl2.md Known Footguns because that's where agents look for SCAD surprises, not ai/gotchas.md (which is manifold-js-focused). The key guidance: "unroll every loop that contains label()" — the failure mode is silent.

5. **Fidget/twist cookbook in mechanisms.md** — 4 agents re-derived the same empirical rules independently. Added a compact section with the depth rule (±0.3·R) and flat-spiral-bloom aspect ratio. Deliberately brief; the full examples are already in the catalog.

6. **Headless preview backlog closed.** The CLI now exists (`model:preview` + `--lang`). Removed from backlog; only the `--compare` contact-sheet and `--explain-components` flags remain as tooling asks.

7. **agent-tooling.md already had both the new-agent-not-selectable gotcha AND the SendUserFile note.** No change needed. This is the anti-bloat check working: the retro ask was already satisfied by a prior task.
