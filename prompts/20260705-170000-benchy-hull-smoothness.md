---
session: "inverse-cad"
timestamp: "2026-07-05T17:00:00Z"
model: claude-fable-5
sequence: 54
---

## Human

"The benchy via code is definitely not as smooth as the original...
can we apply functions that model a smooth hull like the original?"

## Assistant

## Key decisions

**Prototyped 4 variants and let the evidence pick, per the
subjective-work rule** (demo-and-pick beats blind iteration). A
model-sculpt agent built the matrix with per-variant gate evals and
1200px hull crops. Root cause was NOT the levelSet field or the
measured sections — it was my `simplify(0.04)` catalog decimation.

- smoothOut+refine post-pass: catastrophic (hausdorff 0.16 → 4.34mm,
  wavy scribble) — second confirmation of the dummy13-hands failure,
  now a PLAYBOOK §7 trap with numbers.
- edge 0.10 finer field: WASM OOM at this bbox — dead end.
- Catmull-Rom smooth-sections: right idea (smooth the modeled function,
  which is what the user asked), works on corner-free hull regions, but
  blanket z-cutoff erodes real corners past the hausdorff gate — filed
  as #887 (needs per-vertex turning-angle awareness).
- **Adopted: simplify(0.033)** — 494,888 tris (under the 500k budget),
  chamfer 0.0118mm, hausdorff max 0.158mm, visually indistinguishable
  from the original at 1200px. One-constant change; entry re-baked.

The generic lesson (PLAYBOOK): visual smoothness of levelSet results is
governed by the simplify tolerance, not smoothing passes — pick the
loosest tolerance that still looks smooth in a high-res crop.
