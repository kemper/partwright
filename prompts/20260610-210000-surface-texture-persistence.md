---
session: "6sobw6"
timestamp: "2026-06-10T21:00:00Z"
tools: [playwright, vitest]
sequence: 2
---

## Human

Phase 3 of the "surface textures as code" direction (deferred by the original
implementation session and scoped in the hardening review): persist computed
`api.surface.*` textures with the saved version, so a saved, closed, reopened
session renders textured immediately instead of recomputing the chain (or
showing the base mesh) — and so the texture's appearance is pinned at save
time as modifier math evolves. Phase 4 (Surface panel emits code) follows as a
separate PR.

## Assistant

## Key decisions

**Persist `{ key, mesh }` and rehydrate by seeding the existing memo cache —
no new render path.** The version stores the full-chain memo key
(`surfaceChainKey`, new export from surfaceOps) plus the textured `MeshData`.
`loadVersionIntoEditor`'s cache-miss branch seeds the cache
(`seedSurfaceCache`) before the force-applying `runCodeSync`, so the load's
`surfaceCacheStatus` hits and renders the persisted mesh instantly. The key is
self-validating — it folds in code + customizer params + import identity, so
any drift means the seed is never read and the chain recomputes exactly as
before. This also delivers the appearance-pinning property for free: a hit
returns the saved mesh even when the modifier math has changed since.

**Save-time capture is identity-guarded, not recomputed.** A module-scoped
`lastAppliedSurface` is reset on every mesh-producing run by
`applySurfaceTextures` and set only when a texture was actually applied (cache
hit or forced compute). At save, `currentSurfaceTextureForSave()` requires the
tracked mesh to BE the live mesh object (`paintBaseMesh ?? currentMeshData`),
so a version restored from `partMeshCache` (a different object) can never
persist another run's texture. Wired into the three code-running save paths:
`saveCurrentVersion` (Save button, mod+S, console saveVersion), `runAndSave`,
and `forkVersion`. Deliberately NOT carried forward from the previous version
in `sessionManager.saveVersion` (unlike `importedMeshes`) — a texture is only
valid for the exact base identity it was computed under.

**Schema 1.14, additive on every layer.** `Version.surfaceTexture` is opaque
`unknown` at the db layer (typed arrays survive IndexedDB structured clone);
the typed shape (`PersistedSurfaceTexture`) lives in the dependency-free
`surfaceOpSpec.ts` leaf with the mesh fields declared inline so the spec stays
import-free and the graph acyclic. Session JSON export base64-encodes the
buffers (mirroring `serializeImportedMeshes`); import validates and degrades
to "recompute on demand" on any malformed field. `trimForShare` drops the
field like it drops `importedMeshes` (share links are size-capped; the
recipient recomputes).

**Size cap is a config knob, not a constant.**
`renderer.surfaceTexturePersistMaxTriangles` (default 1M, ≈18 B/tri) next to
the other triangle-budget knobs, exposed in Advanced Settings. Over the cap
the version still saves — it just recomputes on reopen, today's behavior.

**Review follow-up.** The work-reviewer pass came back clean with one
defense-in-depth nit, applied as its own commit: the IndexedDB seed guard now
validates `triVerts instanceof Uint32Array` alongside `vertProperties`,
matching the import-side validator, so a partially corrupt persisted record
can't reach `Manifold.ofMesh`.

**Verification.** Unit: seed/chain-key round-trip, the "pinned at save time"
resume-from-seed property, stale-key miss. E2e: IDB persistence + reload
renders textured with no pill; export → import round-trip restores live typed
arrays. Regression sweep over persist/autosave/parts/import-export/share-link
specs (33 green). Browser screenshot of the reloaded textured session posted
in chat (~2 s to textured render after reload, no progress modal).
