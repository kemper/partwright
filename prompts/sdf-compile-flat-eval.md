---
date: 2026-06-23
branch: claude/tender-darwin-hjjoe9
files_changed:
  - src/geometry/sdfCompile.ts
  - src/geometry/sdf.ts
  - src/config/appConfig.ts
  - tests/unit/sdfCompile.test.ts
---

## Human

Complex manifold-js figurines from the catalog render slowly (15–60s after a
fast preview). Investigate speeding up complex-model rendering, focusing on the
manifold-js figures; explore parallelism / GPU. After investigation we agreed
on a staged plan (tracked in #851) and chose to implement the first, cheapest
lever: compile the SDF distance function to flat JS.

## Assistant

Measurement (headless, real engine) showed ~49% of a figure's render time is the
JS SDF-eval callback `Manifold.levelSet` invokes per grid sample — the distance
tree is walked as per-node `_eval` closures (~8.6 µs/eval on the dominant
region). A spike proved flattening that tree to straight-line JS is ~6–11×
faster per eval and numerically identical, IF the codegen is chunked (a single
huge generated function deopts in V8 and runs slower past ~600 nodes).

Implementation — `src/geometry/sdfCompile.ts`:
- Walks an SdfNode tree and emits one flat JS function (params inlined, no
  per-node dispatch), threading the current point as plain coord vars so
  transforms/warps rewrite coordinates and primitives/booleans inline.
- **Opaque-leaf fallback**: any unsupported node is emitted as a call to its own
  `_eval` closure with the ancestor-transformed coords — so unknown ops never
  block compilation and never change the result. v1 emits the ~20 ops figures
  lean on (primitives, booleans incl. the hidden-`b` subtract family, transforms,
  round/shell, twist/bend/taper); displace/tube/repeat/tpms defer to leaves.
- **Chunking**: subtrees over a node threshold (`renderer.sdfCompileChunkNodes`,
  default 120) become their own sub-functions, keeping every generated function
  small enough for V8 to optimize.
- **Verification gate** (`compileSdfEval`): samples the compiled fn vs the real
  `_eval` at 96 points spanning the node's bounds and returns null on any
  mismatch — so a buggy emitter degrades to "no speedup", never wrong geometry.

Why this shape: the SDF op set is large (~40 factories) and figures bottom out in
a deep closure tree. Covering every op up front is brittle; the opaque-leaf +
gate design makes partial coverage *correct by construction* and lets the win
land now. Structured params are exposed via a new optional `NodeData.cp` on the
supported factories (additive — never changes `_eval`); the subtract family also
stashes its hidden `b` operand there since `_children` omits it for partitioning.

`buildSdf` now compiles each region's distance fn (gated) and hands the result to
`levelSet`; on any miss it uses the closure exactly as before. Kept the module
dependency-free of `sdf.ts` (local `SdfNodeLike` structural type) so no import
cycle forms (madge gate).

Verified: 10 new unit tests assert compiled == closure (maxDiff < 1e-9) across
every op, deep/chunked trees, and opaque-leaf mixes; full unit tier (1598) green;
typecheck + build + acyclic-deps clean. End-to-end A/B on real figures (compiler
on vs off) produced **byte-identical meshes** (same tri/vert counts and volume to
4 decimals) and **2.8–3.5× faster** builds (wizard 67s→19s, bodybuilder 25s→9s).
Browser check: a catalog figure (ballerina) loads and renders correctly with the
compiler active.

Remaining levers stay tracked in #851 (serializable per-brick parallelism, WGSL
GPU sampling, narrow-band mesher for the ~90% air-skip).
