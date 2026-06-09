---
session: "fc5979"
timestamp: "2026-06-09T12:00:00Z"
sequence: 1
model: claude-opus-4-8
---

## Human

(After a research discussion about thi.ng's ~350 libraries and what could add
value to Partwright.) Let's add the voronoi shell surface modifier.

## Assistant

## Decision: cellular (Worley) relief, not a full Voronoi diagram

A Partwright surface modifier displaces vertices along their normals — it cannot
change topology (cut through-holes). So a "Voronoi shell" here is a *relief
texture*: a network of raised ridges tracing cell boundaries with flat cell
interiors, not an open strut lattice. The right tool for that is a cellular
(Worley) **F2−F1** distance field over jittered grid seeds, computed per
triplanar projection — exactly the structure the sibling fabric textures
(`waffleStitch`, `wovenFabric`) already use. This is deterministic and seedable
with no new dependency, so vendoring `@thi.ng/geom-voronoi` (which I'd floated in
the research phase) was unnecessary: it solves the wrong problem (a true 2D
diagram) for a normal-displacement effect. The docs/tool descriptions call this
limitation out explicitly so callers don't expect a perforated shell.

## Implementation

`src/surface/voronoiShell.ts` mirrors `waffleStitch` line-for-line: subdivide to
a wall-band-relative edge length, then for each vertex compute the cellular wall
intensity (`1 − smoothstep(0, wallWidth, (F2−F1)/2)`) blended across the three
triplanar planes (seed offset per plane to avoid mirrored seams) and push along
the normal. `raised` flips the sign for engraved channels; `jitter` interpolates
between a full irregular Voronoi (1) and a regular grid (0).

## Parity (the same-PR rule)

Closed the UI↔API↔docs↔AI loop in one change, following the six existing
texture modifiers as the template: `applyVoronoi`/`applyVoronoiPatch` +
`defaultVoronoiOptions` in `modifiers.ts`; `buildSurfaceModifier` branch,
`textureWarnings` branch, and the `applyVoronoiShell` console method in
`main.ts`; a Voronoi tab in `surfaceModal.ts` (+ command-palette entry); the
`applyVoronoiShell` AI tool schema, dispatch case, and `SAVE_GATED` membership in
`ai/tools.ts`; the textures table/section in `public/ai/textures.md` and the
subdoc pointer in `public/ai.md`. The surface texture methods are intentionally
**not** in `help()` — none of the six siblings are; they live in
`ai/textures.md` — so I matched that convention rather than adding only this one.

## Verification

Unit: added `voronoiShell` to the parameterized fabric-texture invariants table
plus focused tests (seed reshuffles layout, jitter 0≠1, raised grows / engraved
stays within bounds). E2E: a golden-path spec drives both the API
(watertight + single-component assert) and the Surface-panel UI (Voronoi tab →
whole-model Apply → ofMesh wrapper). Manually applied to a sphere and confirmed
the raised + engraved renders look right (watertight, genus 0, componentCount 1).
