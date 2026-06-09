---
session: "1kdce9"
timestamp: "2026-06-09T21:45:00Z"
model: claude-opus-4-8
tools: [playwright, vitest, subagent]
sequence: 5
---

## Human

Asked to implement phases 3, 4, and 5 of the surface-textures-as-code plan as a
series of stacked PRs (or independent if clean). This is phase 3 — persistence.

## Assistant

## Key decisions

**Content-addressed persistent cache, not a Version field.** The plan suggested
reusing the `importedMeshes` slot, but that's the wrong fit: `api.surface.*`
models are non-baking and don't use `api.imports[0]`, so stuffing the textured
mesh there would (a) leak it into the sandbox as a phantom import and (b) collide
with models that genuinely use STL imports. Instead, a new IndexedDB store
(`surfaceCache`, DB v9) keyed by the **same memo key** the in-memory cache uses —
`hash(code + params + op-chain)`. This keeps the code as the artifact: the cache
is derived and local, NOT part of a saved Version or session export, so a fresh
machine simply recomputes. LRU-capped at 64 entries (savedAt index).

**The key depends on the recorded ops, so seeding can't happen before the run.**
Ops are only known after the code evaluates. So the persistent store is consulted
inside the force path of `applySurfaceTextures`, on an in-memory miss: read
IndexedDB by `fullChainKey(baseKey, ops)`; on a hit, seed the in-memory cache and
use it; on a miss, compute and write back (fire-and-forget). Version loads are
explicit (force) runs, so reopening a textured session hits this path and renders
instantly.

**Deterministic test via a compute counter.** A persistent hit and a recompute
both yield a textured mesh, so timing isn't a reliable signal. Added
`__surfaceComputeCalls()` (increments per op actually computed); the e2e runs a
textured model, waits for the persistent write, clears the in-memory cache, re-
runs the same code, and asserts the compute-call delta is **0** while the
triangle count is unchanged — proving the persisted texture was reused, not
recomputed.

## Verification

`tests/surface-persistence.spec.ts` (the round-trip above) + the existing
surface-in-code e2e + 936 unit tests + build + lint:deps (acyclic) +
lint:deadcode (no new) all green. New IDB store add is idempotent in
`onupgradeneeded` and added to `clearAllData`.
