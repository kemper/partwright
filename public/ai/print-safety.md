# Print-safe geometry

If the output will be 3D-printed (FDM/FFF), geometry thinner than the nozzle's extrusion width is silently dropped by slicers. This is a real class of bug that passes every `geometry-data` check (volume, `componentCount`, `genus`, `isManifold` all correct) but renders the top of the model as "missing" on the physical print.

## The classic trap: `scaleTop` near zero

An extrusion with `scaleTop=[0.01, 0.01]` (or any small fraction) tapers linearly to a near-point. The last slices have areas well under 1 mm², which most slicers drop at typical nozzle widths. Example failure mode observed in the wild: a hook band extruded with `scaleTop=[0.01, 0.01]` had layer areas of 118 mm² at z=5.8 collapsing to 0.07 mm² at z=6.55 -- the slicer dropped every layer under ~0.4 mm² and the cap disappeared.

```js
// BAD -- lead-in chamfer via scaleTop=0, tapers to sub-extrusion-width
ring.extrude(6, 4, 0, [0.01, 0.01])

// GOOD -- explicit 45deg chamfer that stops at a flat-top ring of finite width.
// Stack a full-width body + a chamfer frustum whose smaller radius is still >= wall thickness.
const body    = ringCS.extrude(bodyH);
const chamfer = ringCS.extrude(chamferH, 1, 0, outerFrac)  // outerFrac chosen so top width >= wallT
                    .translate([0, 0, bodyH]);
const result  = body.add(chamfer);
```

## Rules of thumb (assume ~0.4 mm nozzle, ~0.2 mm layer height)

- **Minimum wall / feature thickness:** `>= 0.4 mm` (one nozzle width). Prefer `>= 0.8 mm` for anything load-bearing.
- **Minimum cross-sectional area on any printed layer:** `>= ~0.4 mm²` (roughly nozzle width x 1 mm of extruded line).
- **Never taper to a true point on a printed face.** Chamfers, drafts, and lead-ins must land on a flat plateau wider than the nozzle.
- **Decorative points** (spires, finials) either need to be printed as a separate top piece, or accept that the tip will be missing up to the slicer's minimum width.

## Catch this before the user does

After any change that uses `scaleTop` < 1, tapers via `hull`, or brings two surfaces toward a vanishing edge, dense-sample near `zMax` and flag sub-extrusion-width layers:

```js
const bb = partwright.getBoundingBox();
const zMax = bb.max[2];
const layerH = 0.2;
const minArea = 0.4;  // mm^2, assuming ~0.4mm nozzle

const problems = [];
for (let z = zMax - 2; z <= zMax - layerH; z += layerH) {
  const s = partwright.sliceAtZ(z);
  if (s && s.area > 0 && s.area < minArea) {
    problems.push({ z: +z.toFixed(2), area: +s.area.toFixed(3) });
  }
}
if (problems.length) {
  console.warn("Sub-extrusion-width layers detected:", problems);
}
```

Or batch it with `query({ sliceAt: [zMax - 2, zMax - 1.8, ..., zMax - 0.2] })` and check each slice's `area`. If any layer below the actual geometry end falls under threshold, redesign the top to terminate with a flat plateau instead of a near-point taper.
