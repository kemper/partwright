# Curves & smooth shapes (manifold-js)

The `Curves` namespace provides helpers for smooth and organic geometry that the
base manifold-3d API doesn't ship: lofts between profiles, sweeps along 3D
paths, NACA airfoils, Bezier curves, polylines with corner fillets, and
arbitrary-axis revolves.

Use these instead of hand-rolling vertex-sampling math. Each helper validates
its inputs and throws a descriptive error if anything is off, so you fail fast
instead of producing weird meshes.

```js
const { Manifold, CrossSection, Curves } = api;
// MUST return a Manifold object
```

## When to reach for what

| Want this | Use this |
|---|---|
| Smooth profile from a few points | `Curves.bezier(controls)` -> points |
| Arc through two endpoints | `Curves.arc({from, to, radius})` -> points |
| Airfoil cross-section | `Curves.naca4("2412", {chord, samples})` -> points |
| Polygon with rounded corners | `Curves.polyline(points, {fillet: r})` -> CrossSection |
| Wing, hull, bottle neck (varying profile along axis) | `Curves.loft([profileA, profileB, ...], [zA, zB, ...])` |
| Handle, tube, propeller blade (constant profile along a 3D path) | `Curves.sweep(profile, pathPoints)` |
| Revolve around an axis other than Y | `Curves.revolveAxis(profile, [ax,ay,az])` |
| Round sharp edges on an existing solid | `Curves.fillet(solid, {angle: 60})` |
| N copies arranged in a circle | `Curves.ringCopy(part, n, {radius, axis})` |
| N copies in a line | `Curves.linearCopy(part, n, [dx,dy,dz])` |
| Object + its mirror | `Curves.mirrorCopy(part, [nx,ny,nz])` |

## Point/profile builders (2D)

### `Curves.arc({from, to, radius, segments?, cw?})`
Returns `Vec2[]` -- a polyline approximation of a circular arc. `cw=true` swings
to the opposite side of the chord. Chord length must not exceed `2 * radius`.

```js
const top = Curves.arc({ from: [-10, 0], to: [10, 0], radius: 15, segments: 24 });
// 25-point arc bowing upward.
```

### `Curves.bezier(controls, segments?)`
Returns `Vec2[]` -- de Casteljau evaluation of a Bezier curve of any order
(2 controls = line, 3 = quadratic, 4 = cubic, more = higher degree).

```js
const ctrl = [[0, 0], [10, 30], [30, 30], [40, 0]];  // cubic
const sampled = Curves.bezier(ctrl, 64);
```

### `Curves.naca4(code, {chord?, samples?, closeTrailingEdge?})`
Returns `Vec2[]` -- a closed CCW airfoil contour using the standard NACA 4-digit
formula. `code` is a 4-character string: digit 1 = max camber %, digit 2 =
camber location in tenths of chord, digits 3-4 = thickness %. `chord` defaults
to 100. `closeTrailingEdge: true` (default) nudges the polynomial to land
exactly at (chord, 0) so the loop is watertight.

```js
const root = Curves.naca4("2412", { chord: 200, samples: 80 });
const tip  = Curves.naca4("2410", { chord: 80,  samples: 80 });
```

### `Curves.polyline(points, {closed?, fillet?})`
Returns a `CrossSection`. `closed` defaults to `true` (required for now;
open polylines aren't supported). `fillet: r` rounds every corner by an
offset-shrink-then-expand pass.

```js
// Rounded rectangle.
const rect = Curves.polyline([
  [0, 0], [40, 0], [40, 20], [0, 20]
], { fillet: 5 });
return rect.extrude(10);
```

## 3D constructors

### `Curves.loft(profiles, heights, {resolution?, smooth?, refine?})`
Build a manifold by lofting between N cross-sections placed at given Z heights.
Profiles can be `CrossSection`, `Vec2[]` (closed loop), or `Vec2[][]` (first
contour used). They're resampled to `resolution` (default 64) points each so
side strips line up cleanly. `heights` must be strictly increasing. `smooth:
true` calls `.smoothOut(60)` on the result; `refine: n` subdivides.

```js
// Airplane wing: bigger NACA at root, smaller NACA at tip, 800mm span.
const root = Curves.naca4("2412", { chord: 200, samples: 64 });
const tip  = Curves.naca4("2410", { chord: 80,  samples: 64 });
const wing = Curves.loft([root, tip], [0, 800], { resolution: 64, smooth: true, refine: 2 });
return wing.rotate([90, 0, 0]);  // lie it flat on the XY plane
```

Profiles are aligned by walking the second profile so its first vertex is
closest to the first profile's first vertex -- this prevents twisted side
strips when point orders are offset. If your loft looks twisted anyway, pass
profiles with similar starting orientation.

Triangulation uses `module.triangulate()` (ear-clipping), so non-convex
profiles work for the caps.

### `Curves.sweep(profile, path, {closed?, refine?})`
Sweep a 2D `profile` along a 3D `path` (`Vec3[]`). Frames are computed by
parallel transport from the first tangent, which keeps the profile orientation
consistent through bends.

```js
// Question-mark handle: arc in the XZ plane.
const profile = CrossSection.circle(3, 24);
const path = [];
for (let i = 0; i <= 32; i++) {
  const t = i / 32;
  const a = (-Math.PI / 2) + t * Math.PI;       // -90deg -> +90deg
  path.push([20 * Math.cos(a), 0, 20 + 20 * Math.sin(a)]);
}
return Curves.sweep(profile, path);
```

`closed: true` treats the path as a loop (no end caps, last segment wraps to
first). Use this for torus-like sweeps.

### `Curves.revolveAxis(profile, axis, {angle?, segments?})`
Like `Manifold.revolve`, but the axis can be any `[x,y,z]` direction instead of
just +Y. Useful when the natural axis of your part is X or skew.

```js
// Revolve around the X axis instead of Y.
const profile = CrossSection.ofPolygons([
  [[0, 0], [10, 0], [10, 5], [3, 5]]
]);
return Curves.revolveAxis(profile, [1, 0, 0], { segments: 48 });
```

## Mesh smoothing

### `Curves.fillet(solid, {angle?, refine?})`
Wrapper around `.smoothOut(angle).refine(n)`. `angle` (default 60) is the sharp-edge
threshold in degrees -- edges sharper than this are smoothed; flatter edges are
kept crisp. `refine` (default 3) subdivides the result so the smoothed surface
actually shows curvature.

```js
const cube = Manifold.cube([20, 20, 20], true);
const rounded = Curves.fillet(cube, { angle: 60, refine: 4 });
```

### `Curves.chamfer(solid, angle?)`
Like `fillet` but without the refine step -- gives a soft bevel instead of a
smooth arc.

## Pattern arrays

### `Curves.ringCopy(part, count, {axis?, radius?, angle?})`
Arrange `count` copies of `part` evenly around an axis (`"x"`, `"y"`, or `"z"`,
default `"z"`). `radius` offsets each copy outward before rotating. `angle`
(default 360) is the total spread; for a 360° ring the copies are evenly spaced
with no overlap; for partial spreads (e.g. 90°) they're spaced inclusively.

```js
const tooth = Manifold.cube([2, 2, 5]).translate([12, -1, 0]);
const gear  = Manifold.cylinder(5, 12, 12, 64).add(Curves.ringCopy(tooth, 20));
```

### `Curves.linearCopy(part, count, [dx,dy,dz])`
`count` copies stepped by `[dx,dy,dz]` each.

### `Curves.mirrorCopy(part, [nx,ny,nz])`
Union of `part` and its mirror across the plane with the given normal. Handy
for left/right symmetric assemblies.

## Limits & gotchas

- **Loft profiles need consistent winding.** If your profiles are mixed CW/CCW
  the side strips will invert. Use `Curves.polyline(points)` to canonicalize.
- **Loft profiles must be topologically simple.** Each profile contributes one
  outer contour; holes inside profiles aren't lofted through. For shapes with
  holes, loft the outer surface, loft the inner surface, then `.subtract()`.
- **Sweep paths can't be too tight.** Sharp path corners cause parallel-transport
  frames to flip; smooth the path with `Curves.bezier` and lift to 3D, or
  insert more interpolated points around the corner.
- **`Curves.fillet` is global.** It rounds every edge sharper than the given
  angle; there's no per-edge control. For local rounding, use a boolean
  subtract with a smoothed cutter.
- **Caps use ear-clipping.** Cap triangle quality is fine for typical shapes,
  but if you stack thousands of profiles it's worth profiling.
