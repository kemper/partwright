# Gears (`api.gears`)

Involute **spur gears**, **meshing gear pairs**, and straight **racks** —
correct involute tooth flanks, computed for you. Available in the
**manifold-js** engine as `api.gears.*`. Read this before modeling any gear; the
involute math is fiddly and easy to get subtly wrong by hand.

All dimensions are millimetres, Z-up. A gear is built centred on the origin in
the XY plane, extruded along +Z from `z=0` to `z=thickness`. Builders **throw a
clear error** on bad input so you can self-correct.

## The one rule of meshing

Two gears mesh **iff they share the same `module` and `pressureAngle`.** The
`module` (mm of pitch diameter per tooth) is the metric tooth size:

```
pitch diameter = module · teeth
centre distance between two meshing gears = module · (teeth₁ + teeth₂) / 2
gear ratio = drivenTeeth / driverTeeth
```

`pressureAngle` defaults to 20° (the modern standard) — leave it unless you have
a reason. Bigger module = bigger, coarser teeth.

## Single gear

```js
const { gears } = api;
return gears.spur({ module: 2, teeth: 18, thickness: 6, bore: 6 });
```

`spur(opts)` options:

| key | meaning | default |
|---|---|---|
| `module` | tooth size (mm pitch dia / tooth) — **required** | — |
| `teeth` | number of teeth (≥ 4) — **required** | — |
| `thickness` | extrusion height along +Z — **required** | — |
| `pressureAngle` | involute pressure angle, degrees | `20` |
| `clearance` | dedendum clearance, as a fraction of module | `0.25` |
| `backlash` | tangential gap (mm) split across both flanks | `0` |
| `helix` | helix angle (degrees) for a helical gear; `0` = spur | `0` |
| `bore` | centre hole **diameter** (subtracted) | none |
| `hubDiameter` / `hubHeight` | solid hub boss on top, around the bore | none |
| `segments` | curve resolution for bore/hub | engine default |

## Meshing pair

`pair(opts)` builds two gears already positioned and phased to mesh. The
`pinion` (teeth1) sits at the origin; the `gear` (teeth2) is placed at +X by the
centre distance, rotated so its tooth valleys line up with the pinion's teeth.

```js
const { gears, labeledUnion } = api;
const p = gears.pair({ module: 2, teeth1: 12, teeth2: 24, thickness: 6, bore1: 5, bore2: 8 });
// p.pinion, p.gear (Manifolds), p.centerDistance, p.ratio
return labeledUnion([
  { name: 'pinion', shape: p.pinion, color: '#4f86c6' },
  { name: 'gear',   shape: p.gear,   color: '#e0a458' },
]);
```

A small default `backlash` (0.05 mm) keeps the two gears as **separate
components** where their teeth meet — verify with `componentCount === 2` (a
fused `1` means they collide; increase `backlash`).

## Rack (linear gear)

`rack(opts)` is the straight-line limit of a gear — it meshes with a spur gear
of the same `module`. It lies along +X, teeth pointing +Y, pitch line at `y=0`.

```js
return api.gears.rack({ module: 2, teeth: 10, thickness: 6 });
```

## Math helpers (no geometry)

```js
api.gears.dimensions({ module: 2, teeth: 20 })  // { pitchR, baseR, tipR, rootR, circularPitch }
api.gears.centerDistance(12, 24, 2)             // 36
api.gears.ratio(12, 24)                         // 2  (driven / driver)
```

## Tips

- **Want a planetary / gear train?** Build each stage with `pair` or place
  `spur` gears by hand `module·(t₁+t₂)/2` apart, all sharing one `module`.
- **Printability:** very fine modules (< ~1 mm) produce teeth thinner than an
  FDM extrusion width — the preview warns about sub-0.4 mm detail. Bump the
  module or print small gears in resin.
- A gear with a `bore` reports `genus: 1` (the through-hole) — that's expected,
  not an error.
