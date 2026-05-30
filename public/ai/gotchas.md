# Partwright — Common Pitfalls & Gotchas

## Boolean operations: always use volumetric overlap, never flush placement

Shapes that merely touch at a face will NOT union correctly — they stay as separate components. Offset joining geometry by at least 0.5 units along the joining axis.

```js
// BAD — merlon sits exactly on wall top, stays disconnected
merlon.translate([x, y, wallTopZ])

// GOOD — merlon overlaps 0.5 units into wall body
merlon.translate([x, y, wallTopZ - 0.5])
```

## Spires on hollow shapes need a base wider than the inner void

A cone on top of a hollow cylinder/box floats inside the void unless its base radius exceeds the inner hollow radius, ensuring it intersects the wall material.

```js
// Keep outer half-width = 10, inner hollow half-width = 8
// Spire base radius must be > 8 to touch wall ring
Manifold.cylinder(spireH, 11, 0, 24).translate([0, 0, keepH - 0.5])
```

## Flag poles on cone tips need to start inside the cone body

A cylinder placed at the exact tip of a cone (where radius = 0) has nothing to union with. Start the pole 1-2 units below the tip so it overlaps solid cone geometry.

## Debugging disconnected components

When `componentCount > 1`, use `runAndExplain(code)` to identify which pieces are floating:

```js
const r = await partwright.runAndExplain(code);
// r.components = [
//   { index: 0, volume: 14800, centroid: [0, 0, 9], boundingBox: {...} },
//   { index: 1, volume: 12,    centroid: [29, 29, 26], boundingBox: {...} },
// ]
// r.hints = [
//   "1 tiny disconnected component(s) detected -- likely floating attachments...",
//   "Components 0 and 1 share a face or near-touch (gap: 0.00) -- need volumetric overlap"
// ]
```

## `paintRegion` flood-fill is bimodal on smooth surfaces

On capsules, hulled spheres, and other smooth (no-edge) geometry, the bend angle between adjacent triangles is roughly the angular subdivision (e.g. 7.5° for a 48-segment cylinder, ≈ cos 7.5° = 0.991). Any tolerance > 0.991 paints almost nothing; any tolerance ≤ 0.99 paints almost everything. There is no useful middle.

**Fix:** use `paintNear` (sphere selector) or `paintInBox` (AABB selector) for organic geometry. Both filter by world coordinates — predictable and bounded:

```js
// Don't:
partwright.paintRegion({ point: [...], normal: [...], color, tolerance: 0.95 }); // floods entire finger

// Do:
partwright.paintNear({ point: [...], radius: 4, color });               // bounded by radius
partwright.paintInBox({ box: { min, max }, normalCone: { axis, angleDeg: 25 }, color });
```

`paintRegion` is still the right tool for flat plates with crisp 90° edges (e.g. a cube face). For curved surfaces, prefer the position-based primitives.

## Trust `probeRay`'s hit normal — don't derive your own

`paintRegion`'s seed-resolution requires the seed normal to align with an actual triangle's normal within `tolerance`. Computed normals (e.g. derived from your construction math) are slightly off from the post-boolean-union mesh normals — they look right but won't match. The fix is one line:

```js
// Don't:
const dorsal = [0, -Math.cos(P), Math.sin(P)];                          // looks correct...
partwright.paintRegion({ point: derivedPoint, normal: dorsal, ... });   // ...silently misses

// Do:
const hit = partwright.probeRay(start, dir).hits[0];
partwright.paintRegion({ point: hit.point, normal: hit.normal, tolerance: 0.999, ... });
```

`probeRay` returns the same data the resolver looks at internally; using it eliminates an entire class of "no matching face found" failures.

## Manifold's `rotate` direction

Manifold uses `rotate([degX, degY, degZ])` applied X→Y→Z. The convention follows the standard right-hand rule about each axis. Quick verification snippet:

```js
const cube = api.Manifold.cube([2, 4, 4], false);          // x∈[0,2], y∈[0,4], z∈[0,4]
const rotated = cube.rotate([90, 0, 0]);                   // rotate +90° about X
// After rotation: y∈[-4,0], z∈[0,4]. (0,1,0) → (0,0,1) → (0,-1,0).
```

If your rotated geometry looks mirrored, negate the angle. This burned 10+ minutes of debugging in earlier sessions — the test snippet above runs in `runIsolated` and resolves it in seconds.

## Painting locks the editor — `clearColors()` to iterate

Once any region exists, the editor's Run button is disabled in the UI (re-running would change the triangle indices the colors were painted against). The programmatic `runAndSave` is *not* blocked, but re-running new geometry with colors still in memory leaves them resolved against the old triangles. So to change the geometry mid-session, call `partwright.clearColors()` first, *then* run new code — or use `forkVersion(...)`, which re-resolves the parent's colors onto the new geometry by descriptor (pass `carryColors: false` for an uncolored child).

## Verify before you commit

`paintPreview` is count-only by default — call it before any non-trivial paint as a free sanity check on selector geometry. If the count is surprising, opt into the visual:

```js
const dry = partwright.paintPreview({ point: [...], radius: 4 });
// dry.triangleCount > 0? if happy, call paintNear with the same args to commit.
// If the count is wildly off, add withImage: true to see what got selected:
partwright.paintPreview({ point: [...], radius: 4, withImage: true, view: { ortho: true, size: 240 } });
```

Use `assertPaint` to verify regions stayed where you expected after a re-render or version load:

```js
partwright.assertPaint({ region: 'Index nail', expectedTriangleCount: { min: 15, max: 60 } });
```

## `runAndSave` is for committed iterations; `runIsolated` is for sanity checks

`runAndSave` writes a version to the gallery (and the lock state, and the diff, etc.). For "does this code produce 1 component or 7" questions, prefer `runIsolated(code)` — it returns `{ geometryData, thumbnail }` without mutating anything.

```js
const r = await partwright.runIsolated(`
  const { Manifold } = api;
  return Manifold.cube([1, 1, 1], true).hull();
`);
// r.geometryData.componentCount, r.thumbnail (data URL)
```
