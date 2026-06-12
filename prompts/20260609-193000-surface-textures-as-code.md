---
session: "1kdce9"
timestamp: "2026-06-09T19:30:00Z"
model: claude-opus-4-8
tools: [playwright, vitest, node]
sequence: 3
---

## Human

After the `api.paint.*` work, asked to "proceed with the memoization idea" — make
surface textures (`fuzzy`/`knit`/…) live in the model code as `api.surface.*`
calls instead of destructive bakes, recomputing the expensive texture only on
demand (memoized "sticky" nodes + a Re-apply control), single code buffer.
Confirmed the plan, then: "Sounds good. Proceed with the plan."

## Assistant

## Key decisions

**Mirror the `api.paint.*` architecture exactly.** Record ops in the Worker
sandbox (they don't touch the mesh), cross the boundary as plain
`MeshResult.surfaceOps`, and *apply on the main thread* after the run — reusing
the existing modifier math (`src/surface/modifiers.ts`), which is already
main-thread + WebGPU. Porting the modifiers into the Worker would have lost GPU
acceleration and duplicated code.

**A leaf spec module shared by both sides.** `src/surface/surfaceOpSpec.ts`
(no imports) holds the `SurfaceOpId` union, the `SurfaceOp` type, and the
per-modifier option allow-lists. The Worker sandbox imports it to *validate*
`api.surface.*` calls; the main thread imports it to *apply* them. This keeps the
heavy modifier math out of the Worker bundle and the graph acyclic (verified
with `lint:deps`). Scope: the mesh-producing modifiers only (fuzzy/knit/cable/
waffle/fur/woven/voronoi/smooth) — `voxelize`/`voronoiLamp(voxel)` change the
engine, so they stay bake-only.

**Memoization keyed by `hash(baseKey + op-chain prefix)`** where `baseKey =
simpleHash(src + params)`. No mesh hashing: the base mesh is a deterministic
function of code + customizer params, so any geometry-affecting edit re-keys the
chain. Prefix memoization means editing op[i] reuses op[0..i-1]. A 32-entry LRU
caps growth.

**Sticky gating, button-driven (v1).** On a render, a fully-cached chain renders
the textured mesh instantly; any miss renders the *base* mesh and raises a
persistent "⟳ Textures stale — Re-apply" pill (a status indicator like the
printability pill, not a toast). Pressing it computes the chain (async, with the
progress modal), warms the cache, then re-runs.

**The re-run must reuse the exact `src` string, not `getValue()`.** First attempt
re-ran via `runCode()` (which reads the editor) and missed the cache — CodeMirror
normalizes the buffer, so the recomputed base key differed. Fixed by storing the
run's `src` in `pendingSurface` and calling `runCodeSync(src)` directly, so the
key matches and the cache hits. (Caught in the browser, not by types.)

**On a cache hit, swap `result.mesh` and null `result.manifold`** so the existing
run-resolution path reconstructs the queryable Manifold from the textured mesh
(falling back to render-only if a displaced mesh isn't watertight, exactly like
the bake path's `Manifold.ofMesh`). Paint (`api.paint.*` / user regions) then
resolves against the textured mesh, so colour follows the texture.

**Scope = phases 1+2** (record→apply→memoize + sticky gating). Persistence on the
version (phase 3) and wiring the Surface *panel* to emit `api.surface.*` instead
of baking (phase 4) are follow-ups; an unchanged reopened session shows the pill
until Re-apply, which is acceptable.

**Verification.** Unit (`tests/unit/surfaceOps.test.ts`): spec invariants, memo
hit/miss, base-key invalidation, prefix reuse, progress. E2e
(`tests/surface-in-code.spec.ts`): base+pill → Re-apply → textured (1,152 →
294,912 tris, pill clears) + option validation. Browser screenshots posted.
`tsc`, full unit tier (936), `build`, `lint:deps` (acyclic), `lint:deadcode`
(no new), `lint:consistency` (no new errors) all green.
