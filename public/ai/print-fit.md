# Print-Fit helpers (`api.printFit`)

Parametric joinery & hardware primitives for parts that have to **physically
assemble** — clearance holes sized to a real screw, heat-set insert bosses,
captive-nut pockets, alignment pins, sliding dovetails, cantilever snaps, and a
printer-calibration coupon. Available in the **manifold-js** engine as
`api.printFit.*`. Read this before building anything that mates with hardware or
another printed part.

All dimensions are millimetres, Z-up. Builders **throw a clear error** on bad
input (unknown size, missing dimension) so you can self-correct.

## Two kinds of result — read this first

- **Negative tools** (`screwHole`, `socket`, `nutPocket`, `dovetail().socket`,
  `snapFit().catch`) return a Manifold you **subtract** from your part. They
  already poke ~0.1mm above their entrance face so the cut breaks the surface
  cleanly — position the entrance flush with (or just below) the face you're
  cutting into.
- **Solids** (`insertBoss`, `pin`, `dovetail().tail`, `snapFit().clip`,
  `clearanceCoupon`) return a Manifold you **union** onto your part.

Position results with `.translate(...)`, `.rotate(...)`, or `meshOps.placeOn` /
`meshOps.alignTo`.

## Fastener data (no geometry)

```js
api.printFit.fasteners            // frozen table, keys M2 M2_5 M3 M4 M5 M6 M8
api.printFit.fastener('M3')       // { nominal, clearance:{close,normal,loose}, tap,
                                  //   socket:{dia,height}, countersunk:{dia,angleDeg},
                                  //   pan, nut:{width,height}, insert:{hole,depth} }
api.printFit.clearance('snug')    // radial gap (mm): press 0 · snug 0.1 · normal 0.2
                                  //   · loose 0.35 · free 0.5 (or pass a number)
api.printFit.clearanceHole('M3','normal')  // 3.4
```

Clearance presets are tuned for a typical 0.4mm-nozzle FDM printer. They are
sensible starting points — tune with `clearanceCoupon` for your machine.

## Builders

### `screwHole({ size, length, head?, fit?, headClearance?, through?, segments? })`
Negative tool. Axis = Z, head opening at z=0, shank descends to z=-length.
- `head`: `'socket'` (counterbore, default) · `'countersunk'` (90° cone) ·
  `'pan'` (shallow counterbore) · `'none'` (plain through-shank).
- `fit`: `'close' | 'normal' | 'loose'` clearance-hole class (default `normal`).
- `through`: also break the bottom face.

```js
const plate = api.Manifold.cube([40,30,6], false).translate([-20,-15,0]);
// Counterbored M3 from the top face (top at z=6):
return plate.subtract(api.printFit.screwHole({ size:'M3', length:6 }).translate([0,0,6]));
```

### `insertBoss({ size, height?, wall?, taper?, holeDiameter?, depth?, segments? })`
Solid heat-set-insert boss + tapered bore from the top. Base at z=0, rises +Z.
Outer diameter = insert hole + 2·wall. Union it onto your part (overlap the part
by ≥0.5mm). Override `holeDiameter` to match your specific inserts.

```js
return api.printFit.insertBoss({ size:'M3', height:8, wall:2 });
```

### `nutPocket({ size, depth?, fit?, captive?, slotLength?, segments? })`
Hex negative for a trapped nut. Mouth at z=0 descending to z=-depth, flats facing
±Y. `captive:true` adds a side slot (toward +Y) so the nut slides in.

```js
return block.subtract(api.printFit.nutPocket({ size:'M3', captive:true }).translate([0,0,4]));
```

### `pin({ diameter, length, chamfer?, segments? })` + `socket({ diameter, depth, fit?, chamfer?, segments? })`
Alignment pin (solid, lead-in chamfer, **nominal** diameter) and its socket
(negative, bored to `diameter + 2·clearance(fit)`, chamfered mouth). Use the
**same** nominal `diameter` for both — the socket carries the clearance.

```js
const a = topHalf.add(api.printFit.pin({ diameter:4, length:6 }).translate([10,0,0]));
const b = botHalf.subtract(api.printFit.socket({ diameter:4, depth:6, fit:'snug' }).translate([10,0,0]));
```

### `dovetail({ length, width, depth?, angle?, fit?, segments? }) → { tail, socket }`
Sliding dovetail along **+X**. Cross-section narrow at the mouth (y=0), flaring
into the material (+y). `tail` = male solid (union onto part A); `socket` =
female negative (subtract from part B), widened by `fit` so it slides.

```js
const dt = api.printFit.dovetail({ length:30, width:12, fit:'normal' });
const a = railA.add(dt.tail);
const b = railB.subtract(dt.socket);
```

### `snapFit({ width, length, thickness?, hookDepth?, leadAngle?, fit? }) → { clip, catch }`
Cantilever snap. `clip` = flexible beam rising in +Z with a retention hook
jutting +Y at the tip and a `leadAngle` insertion ramp (union onto the moving
part). `catch` = a window negative the hook clicks through (subtract from the
mating wall).

```js
const sf = api.printFit.snapFit({ width:8, length:14, hookDepth:1.5 });
const lid  = lidWall.add(sf.clip);
const body = bodyWall.subtract(sf.catch);
```

### `clearanceCoupon({ size, fits?, thickness?, segments? })`
A printer-calibration test bar: a row of through-holes at graduated radial
clearances for `size`, each **engraved** with its value. Print once, find which
hole your screw/pin fits best, then use that number as your `fit`.

```js
return api.printFit.clearanceCoupon({ size:'M3', fits:[0, 0.1, 0.2, 0.3, 0.4] });
```

## Notes for printable results

- Keep boss/clip walls ≥ 0.8mm (≥2 perimeters). Read `print-safety` before export.
- Snap-fit and dovetail clearances are printer-dependent — calibrate with
  `clearanceCoupon` and feed the result back as `fit`.
- These are mesh helpers (manifold-js). For true threaded holes use OpenSCAD +
  BOSL2 (`readDoc("bosl2")`); for exact CAD fillets use the BREP engine
  (`readDoc("replicad")`).
