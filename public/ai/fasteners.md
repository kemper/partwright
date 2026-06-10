# Fasteners (`api.fasteners`)

Hardware-fit primitives for parts that have to **accept real screws and nuts**
— clearance holes sized to a real metric screw, tap/pilot bores, heat-set
insert bosses, captive-nut pockets, and a printer-calibration coupon, all
backed by a real M2–M8 fastener table. Available in the **manifold-js** engine
as `api.fasteners.*`. Read this before building anything that mates with
hardware. (Part-to-part joinery — pins, dovetails, snap-fits, hinges, ball
joints, snap rims — lives in the sibling `api.joints` namespace:
`readDoc("joints")`. The old `api.printFit.*` alias still works but is
deprecated; it spreads both namespaces.)

All dimensions are millimetres, Z-up. Builders **throw a clear error** on bad
input (unknown size, missing dimension) so you can self-correct.

## Two kinds of result — read this first

- **Negative tools** (`screwHole`, `tapHole`, `nutPocket`) return a Manifold
  you **subtract** from your part. They already poke ~0.1mm above their
  entrance face so the cut breaks the surface cleanly — position the entrance
  flush with (or just below) the face you're cutting into.
- **Solids** (`insertBoss`, `clearanceCoupon`) return a Manifold you **union**
  onto your part (or print stand-alone).

Position results with `.translate(...)`, `.rotate(...)`, or `meshOps.placeOn` /
`meshOps.alignTo`.

## Fastener data (no geometry)

```js
api.fasteners.fasteners            // frozen table, keys M2 M2_5 M3 M4 M5 M6 M8
api.fasteners.fastener('M3')       // { nominal, clearance:{close,normal,loose}, tap,
                                   //   socket:{dia,height}, countersunk:{dia,angleDeg},
                                   //   pan, nut:{width,height}, insert:{hole,depth} }
api.fasteners.clearance('snug')    // radial gap (mm): press 0 · snug 0.1 · normal 0.2
                                   //   · loose 0.35 · free 0.5 (or pass a number)
api.fasteners.clearanceHole('M3','normal')  // 3.4
```

Clearance presets are tuned for a typical 0.4mm-nozzle FDM printer. They are
sensible starting points — tune with `clearanceCoupon` for your machine.

## Builders

### `screwHole({ size, length, head?, fit?, headClearance?, through?, segments? })`
Negative tool. Axis = Z, head opening at z=0, shank descends to z=-length.

| key | meaning | default |
|---|---|---|
| `size` | metric size, `'M2'`…`'M8'` — **required** | — |
| `length` | shank depth below z=0 — **required** | — |
| `head` | `'socket'` (counterbore) · `'countersunk'` (90° cone) · `'pan'` (shallow counterbore) · `'none'` (plain shank) | `'socket'` |
| `fit` | clearance-hole class: `'close' \| 'normal' \| 'loose'` | `'normal'` |
| `headClearance` | extra gap around the head recess (mm) | `0.2` |
| `through` | also break the bottom face | `false` |

```js
const plate = api.Manifold.cube([40,30,6], false).translate([-20,-15,0]);
// Counterbored M3 from the top face (top at z=6):
return plate.subtract(api.fasteners.screwHole({ size:'M3', length:6 }).translate([0,0,6]));
```

### `tapHole({ size, length, through?, segments? })`
Negative tool — a plain pilot bore at the **thread-forming tap diameter**
(`fastener(size).tap`, smaller than the screw) so the screw cuts its own
thread directly into the plastic. No head recess. Same local frame as
`screwHole`: axis = Z, entrance at z=0, descending to z=-length, poking ~0.1mm
above z=0 so it cuts the top face cleanly. `through: true` also breaks the
bottom face.

Use it for blind holes a machine screw threads into without a nut or insert —
the cheapest fastening for low-stress joints. For joints that get reassembled
often, prefer `insertBoss` (plastic threads wear out).

```js
const boss = api.Manifold.cylinder(10, 5, 5);
// M3 screw threads itself into an 8 mm-deep pilot bore from the top:
return boss.subtract(api.fasteners.tapHole({ size:'M3', length:8 }).translate([0,0,10]));
```

### `insertBoss({ size, height?, wall?, depth?, taper?, holeDiameter?, segments? })`
Solid heat-set-insert boss + tapered bore from the top. Base at z=0, rises +Z.
Outer diameter = insert hole + 2·wall. Union it onto your part (overlap the
part by ≥0.5mm). Override `holeDiameter` to match your specific inserts.

| key | meaning | default |
|---|---|---|
| `size` | metric size — **required** | — |
| `height` | boss height | bore depth + 2 |
| `wall` | wall thickness around the bore | `2` |
| `depth` | insert bore depth | table `insert.depth` |
| `taper` | slight lead-in flare at the mouth | `true` |
| `holeDiameter` | override the insert bore diameter | table `insert.hole` |

```js
return api.fasteners.insertBoss({ size:'M3', height:8, wall:2 });
```

### `nutPocket({ size, depth?, fit?, captive?, slotLength?, segments? })`
Hex negative for a trapped nut. Mouth at z=0 descending to z=-depth, flats facing
±Y. `captive:true` adds a side slot (toward +Y) so the nut slides in.
`fit` takes the preset names (`'press' | 'snug' | 'normal' | 'loose' | 'free'`)
or a raw mm number.

```js
return block.subtract(api.fasteners.nutPocket({ size:'M3', captive:true }).translate([0,0,4]));
```

### `clearanceCoupon({ size, fits?, thickness?, segments? })`
A printer-calibration test bar: a row of through-holes at graduated radial
clearances for `size`, each **engraved** with its value. Print once, find which
hole your screw/pin fits best, then use that number as your `fit`.

```js
return api.fasteners.clearanceCoupon({ size:'M3', fits:[0, 0.1, 0.2, 0.3, 0.4] });
```

## Verification & printing

- A part with screw/tap holes should still report `isManifold: true`; a
  through-hole adds `genus` (expected, not an error).
- Keep boss walls ≥ 0.8mm (≥2 perimeters). Read `print-safety` before export.
- Hole clearances are printer-dependent — calibrate with `clearanceCoupon` and
  feed the measured value back as `fit`.
- These are mesh helpers (manifold-js). For true threaded holes use
  `api.threads` (`readDoc("threads")`) or OpenSCAD + BOSL2
  (`readDoc("bosl2")`); for exact CAD fillets use the BREP engine
  (`readDoc("replicad")`).
