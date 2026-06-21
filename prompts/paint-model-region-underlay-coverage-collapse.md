---
session: "keen-wozniak"
timestamp: "2026-06-21T18:55:00Z"
---

## Human

While testing the buried-triangle fix, reported a second artifact via screenshots:
purple "triangle junk" near the apex of a painted coarse square pyramid — the
`api.label` color (`#a855f7`) showing through where the painted surface color
should be. Said the original session was lost and couldn't be shared. Pointed at
the purple upper triangles and asked to investigate the corruption.

## Assistant

## Key decisions

**Separated this from the merged buried-triangle fix (#815).** The purple was the
`api.label` *underlay* leaking through subdivided triangles — a color-propagation
bug, distinct from #815's classification fix. Confirmed #815 worked (reporter no
longer saw unpainted inner triangles).

**Reproduced by direct measurement after visual repros failed.** Six visual
repros (import-rebuild, import+stroke, byLabel-then-strokes, 5 apex strokes,
strokes-then-byLabel) all rendered clean — because in each, the paint layer
covered the whole mesh and hid the underlay. Instead of chasing pixels I measured
`getModelRegions()[0].triangles.size` across successive incremental strokes on the
coarse pyramid: **6 → 6033 → 2372 → 773** — the `api.label` underlay's coverage
*collapsed* with each stroke instead of tracking the growing subdivided mesh.

**Root cause.** `reresolveModelRegions` (`src/main.ts`) re-resolved each model
region's `byLabel` descriptor via `resolveDescriptorTriangles`, which remaps
`currentLabelMap` — and `currentLabelMap` indexes the **base** mesh (only set on a
code run, lines 6028/16573, never updated as painting subdivides). In the
incremental paint path the `parentToChildren` map indexes the **current** mesh, so
after the 2nd stroke the stale base ids `{0..5}` were remapped through a
current-mesh map and the underlay collapsed onto a shrinking, wrong cluster.
Wherever the paint layer didn't cover (e.g. a geodesic-gated brush that can't
cross a coarse pyramid's sharp apex), the mis-resolved underlay showed through as
purple. It also broke live==reload determinism (a reload re-resolves to full
coverage).

**Fix.** In `reresolveModelRegions`, carry explicit/`byLabel` model regions
forward via `remapTriangleIds(region.triangles, parentToChildren)` during an
incremental subdivision — exactly what the paint regions a few lines up already
do — and only re-resolve by descriptor on a full rebuild (`parentToChildren ===
null`, where `currentLabelMap` matches the freshly built mesh). Coverage now grows
6 → 6033 → 11975 → 17881 (tracks the mesh) instead of collapsing.

**Verification.** New engine-backed e2e `tests/paint-model-region-coverage.spec.ts`
asserts the underlay coverage never shrinks across incremental strokes — fails on
the old code (773 < 6033), passes on the fix. Typecheck, all 1558 unit tests, and
the paint-render-color / paint-in-code / save-after-paint / surface-paint-survival
e2e specs all pass. Could not reproduce the exact visible purple (the reporter's
specific paint mechanism + lost session), but the collapse is a confirmed
coverage+determinism bug that directly explains the symptom domain.
