# Partwright — Visual Verification

**CRITICAL: Stats alone cannot catch visual defects.** A roof can be mangled, a spire twisted,
or proportions wrong — all while volume, componentCount, and genus look correct. You see the
model only by rendering it (there is no live screenshot), so call the render tools after every
structural change:

1. **Iterate cheap with `renderViews()`** — one composite PNG of several labeled angles. The
   default `views: "auto"` picks angles from the bounding box; keep `size` small while iterating.

```js
await partwright.renderViews()                       // auto angle set, cheap
await partwright.renderViews({ views: "tri" })       // front + top + iso
```

2. **Do a guaranteed all-faces check before declaring done with `views: "box"`.** It renders all
   six orthographic faces — front, back, left, right, top, AND bottom. `auto`/`tri`/`all` never
   show the back, left, or bottom, which is exactly where an unseen mistake hides. Bump `size` for
   a sharper final read:

```js
await partwright.renderViews({ views: "box", size: 640 })   // final all-faces inspection
```

3. **Target specific angles** — pass an explicit `angles` list to `renderViews`, or use
   `renderView()` for a single angle:

```js
await partwright.renderViews({ angles: [               // any custom set in one composite
  { elevation: 0, azimuth: 180, ortho: true, label: "back" },
  { elevation: -90, ortho: true, label: "underside" },
] })
partwright.renderView({ elevation: 0, azimuth: 0, ortho: true })   // front elevation
partwright.renderView({ elevation: 90, ortho: true })             // top-down plan view
partwright.renderView({ elevation: 30, azimuth: 315 })            // isometric (default)
```

4. **Use `sliceAtZVisual(z)` for cross-section thumbnails:**

```js
const s = partwright.sliceAtZVisual(10);  // returns {svg, area, contours}
// svg = visual rendering of the cross-section profile at z=10
```

5. **Feature-specific checks:**
   - Added a roof? Check side elevation — should be a clean triangle/gable profile.
   - Cut a door/window? Check front elevation — opening should be visible.
   - Added a tower? Check top-down — should be circular, properly positioned.
   - Made something hollow? Slice at mid-height — should show wall ring, not solid fill.
   - Anything asymmetric front-to-back or left-to-right? Use `views: "box"` — the back and left
     faces are invisible to every other preset.

## Edge overlay (`edges`)

Both `renderView` and `renderViews` take an `edges` option controlling what is drawn
on top of the shaded surface:

- **`'crease'`** (default for uncolored models) — only feature edges: corners and the
  silhouette. Sharpens shape-reading without spraying facet noise across tessellated
  curves. This is what you want almost always.
- **`'none'`** — plain shaded surface, no overlay. Default for painted models, since an
  overlay competes with the colors you're checking. Use it on uncolored models too when you
  want the cleanest read of form and surface.
- **`'wireframe'`** — every triangle edge (full topology). Reach for this only to inspect
  tessellation density or debug a failed boolean (stray edges, non-manifold artifacts); on a
  dense mesh it compounds into a dark mass, so it's the wrong default for shape verification.

```js
await partwright.renderViews({ views: "box", edges: "none" })       // cleanest shape read
partwright.renderView({ elevation: 30, azimuth: 315, edges: "wireframe" })  // inspect topology
```

## Render tiers

- **While iterating:** `renderViews()` (auto) or `renderView()` at the default size — cheap.
- **Final check:** `renderViews({ views: "box", size: 512-768 })` — every face, high resolution.
  More angles × larger size = more input tokens, so spend it on the final pass, not every turn.

## Stat-based verification

Check these after every run — `getGeometryData()` returns them all:

1. `status:"ok"` — no error
2. `volume`, `boundingBox.dimensions` — plausible size
3. `componentCount: 1` — no disconnected floating pieces (failed booleans often produce extras)
4. `isManifold: true` — watertight geometry
5. `crossSections` quartiles (z25/z50/z75) — expected profile at each height
6. `partwright.validate(code)` — quick syntax check without running
7. `partwright.runAndAssert(code, assertions)` — structured validation with explicit bounds
