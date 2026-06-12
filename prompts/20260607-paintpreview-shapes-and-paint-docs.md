---
session: "QoRxL"
timestamp: "2026-06-07T17:10:00Z"
model: claude-opus-4-8
tools: [explore, playwright]
---

## Human

User shared a retro from an in-app AI agent whose mug-modeling session went
poorly, plus follow-up feedback with five concrete asks (paint regions
silently invalidated by retessellation; no paintInCylinder preview; a
radial-vs-box selection heuristic missing from docs; revolve axis convention;
api.label rejecting Curves.sweep output). Asked: do I agree, and are there
features to implement? After verifying the claims against source, the user
chose to ship the doc fixes + the paintInCylinder/Slab preview as a single PR.

## Assistant

## Key decisions

**Verified the retro before acting — two of its confident claims were wrong**,
so I did NOT build fixes premised on them:

- "Smooth paint silently zeros earlier raw-triangle regions via subdivision" —
  inaccurate. Subdivision carries regions forward via a parent→children remap
  (`remapTriangleIds`, `src/main.ts`). What actually invalidates a
  `kind:'triangles'` region is a **model re-run** (new base mesh), a different
  trigger. So no "retessellation invalidated N regions" warning was added — it
  would chase the wrong cause. Documented the real distinction instead.
- "`Curves.sweep` output isn't label-able" — false. `Curves.sweep` returns a
  real `Manifold` (`Manifold.ofMesh(...)`, `src/geometry/curves.ts`), which
  `api.label` accepts. The clean `paintByLabel("handle")` workflow already
  works; the agent passed the wrong thing. Documented this to correct the
  misconception rather than changing code.

**Found and fixed a doc bug**: `colors.md` listed `paintInCylinder` among the
id-baking, non-smoothable selectors, but it actually persists a re-resolvable
`cylinder` descriptor and smooths by default (confirmed in source). Rewrote the
section to group selectors by durability: re-resolvable analytic descriptors
(`paintSlab`/`paintInOrientedBox`/`paintInCylinder`/`paintStroke`) + `byLabel`
(most durable) vs. id-baking (`paintInBox`/`paintNear`/`paintFaces`/
`paintConnected`, die on re-run). Added the ordering heuristic and the
radial-vs-box ("paint a feature past a round body by radius, not a box plane")
guidance the agent wished for.

**Revolve convention**: `ai.md` was already correct (Y internal → Z-up remap);
the misleading line was `curves.md`'s "just +Y" for `revolveAxis`. Reconciled
it to state the Z-up convention explicitly (matches the precise code comment in
`curves.ts`). Added a note that `Curves.sweep`/`loft`/`revolveAxis` return
label-able Manifolds.

**Feature — `paintPreview` cylinder/slab forms** (`src/main.ts`): extended the
selector chain to accept `{ cylinder: {center?, rMin, rMax, zMin, zMax} }` and
`{ slab: {axis|normal, offset, thickness} }`, reusing the same
`collectTrianglesByCylinder` / `findSlabTriangles` collectors the real paint
ops use. Preview is **unsmoothed by design** (never subdivides) — it's the
cheap dry-run before committing the smoothing paint. Updated the tool schema in
`src/ai/tools.ts` and the paintInCylinder/paintSlab empty-result error hints to
point at the new preview forms.

**Verification**: New golden-path spec `tests/paint-preview-shapes.spec.ts`
asserts the cylinder preview count exactly equals `paintInCylinder({smooth:false})`
on a hollow tube, the slab band selects from z=0, and a reversed shell errors.
Dumped the `withImage` thumbnail to confirm the inner wall highlights yellow.
`npm run build` + `npm run test:unit` (718) green.
