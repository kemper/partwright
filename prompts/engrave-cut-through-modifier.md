---
session: "01NTQB"
timestamp: "2026-06-09T23:00:00Z"
---

## Human

Add an "Engrave / cut-through" volumetric surface modifier: cut TEXT or an
IMAGE into the model as real recessed channels or all-the-way-through holes (vs
the existing relief textures, which only displace the surface). Build on the
shared SDF pipeline, projecting a 2D stamp (planar onto a face, or cylindrical
around Z). Wire it like the Voronoi lamp (modifiers/surfaceModal/tools/docs),
honor UI↔JS API parity, add a golden-path spec + a unit test of the
mask/projection, and open a draft PR. Image upload needs local bytes, so the
AI-tool version may only support text — say so in the PR.

## Assistant

## Key decisions

**Split the stamp into pure data + pure field math, with the DOM steps at the
host edge.** The new `src/surface/engraveStamp.ts` is fully unit-testable: a
`StampMask` is just `{ width, height, data }` (a coverage grid), produced two
pure ways — `rasterizeContours` scan-fills opentype glyph outlines (even-odd, so
counters in O/A/B come out right) and `maskFromRGBA` reduces decoded image
pixels to ink. `engraveCombine(bbox, opts)` maps a world point → (u,v) → mask
coverage and returns the SDF `combine` for the shared `sdfModifierMesh`. The
only browser-only steps (font fetch, image decode) live in
`engraveStampHost.ts`, so the heavy logic stays node-testable.

**Field math.** `stampSDF = (0.5 − m)·scale` (negative where ink). Cut-through is
`max(d, −stampSDF)` — subtract the full prism wherever ink projects through the
wall. Engrave is `max(d, −max(stampSDF, depthInto − depth))` — intersect ink
with a **face-relative** depth band (`depthInto`, measured from the chosen face,
*not* `|d|`, so the back face is untouched). `engraveSdf.ts` picks the band:
engrave needs the band to reach the carve depth; a through-cut only needs a few
percent to mesh the skin (the cut walls are placed by the stamp at every sample
regardless of band).

**Sync preview vs async mask.** `buildSurfaceModifier` (the preview path) is
synchronous, so it consumes a pre-rasterized `opts.mask`. The modal rebuilds the
mask asynchronously (`api.buildEngraveStamp`) whenever the text/image/font
changes, caches it, and feeds it to every preview/apply until inputs change.
`engraveModel` (console/AI) rasterizes text internally then commits — so the AI
tool needs only `text`. Image stamps stay UI-only (need local bytes); the tool
schema and docs say so.

**Parity.** `engraveModel` on `window.partwright` (validated, returns `{ error }`
on bad input), an `engraveModel` AI tool (text-only, `SAVE_GATED`), the Surface
panel's Engrave tab (text input, image upload, projection/face, through/depth/
size/resolution), a command-palette entry, and the `textures` subdoc + `ai.md`
pointer. Surface modifiers aren't listed in the `help()` table (none of them
are — matched that precedent rather than adding only engrave).

**Fixed a latent region-gate bug.** Switching to a region-less tab
(voxelize/voronoiLamp/engrave) left the Apply button disabled and short-circuited
preview, because `regionBlocked()` only checked region mode and `renderTab`
never refreshed the Apply state on tab switch. `regionBlocked()` now returns
false for the region-less tabs and `renderTab` calls `updateApplyBtn()` — which
also repairs the voronoiLamp/voxelize tabs' preview/apply when reached after a
region-capable tab.

**Verification.** Unit test (`tests/unit/engrave.test.ts`) covers rasterize/
sample/maskFromRGBA and the engrave/cut-through/cylindrical field signs;
golden-path e2e (`tests/surface-engrave.spec.ts`) covers recess (volume drops,
stays one manifold solid), cut-through (genus rises, stays manifold), the empty
reject, and the panel typing→apply path. Browser check: "HELLO" engraved
(recessed channels, O counter preserved) and cut clean through (open holes,
genus 3, `isManifold:true`, `componentCount:1`).
