# Joints (`api.joints`)

Part-to-part joinery primitives for printed parts that have to **physically
connect to each other** — alignment pins, sliding dovetails, cantilever
snap-fits, a print-in-place barrel hinge, a snap-together ball joint, and
annular snap rims for press-on lids. Available in the **manifold-js** engine as
`api.joints.*`. Read this before building any joint by hand; the clearances
and captive geometry are fiddly recipes these builders get right for you.
(Hardware fits — screw/tap holes, insert bosses, nut pockets, the metric
fastener table — live in the sibling `api.fasteners` namespace:
`readDoc("fasteners")`. The old `api.printFit.*` alias still works but is
deprecated; it spreads both namespaces.)

All dimensions are millimetres, Z-up. Builders **throw a clear error** on bad
input so you can self-correct.

## Two kinds of result — read this first

- **Negative tools** (`socket`, `dovetail().socket`, `snapFit().catch`,
  `snapRim().groove`) return a Manifold you **subtract** from your part. They
  already poke ~0.1mm past the faces they cut so the boolean breaks the
  surface cleanly.
- **Solids** (`pin`, `dovetail().tail`, `snapFit().clip`, `snapRim().bead`,
  `hinge`, `ballSocket().ball/.socket`) return a Manifold you **union** onto
  your part (or print stand-alone).

`fit` accepts a preset name (`'press' 0 · 'snug' 0.1 · 'normal' 0.2 ·
'loose' 0.35 · 'free' 0.5` mm radial) or a raw mm number — same presets as
`api.fasteners.clearance(fit)`. Position results with `.translate(...)`,
`.rotate(...)`, or `meshOps.placeOn` / `meshOps.alignTo`.

## Builders

### `pin({ diameter, length, chamfer?, segments? })` + `socket({ diameter, depth, fit?, chamfer?, segments? })`
Alignment pin (solid, lead-in chamfer, **nominal** diameter, base at z=0 rising
to z=length) and its socket (negative, mouth at z=0 descending to z=-depth,
bored to `diameter + 2·clearance(fit)`, chamfered mouth). Use the **same**
nominal `diameter` for both — the socket carries the clearance.

```js
const a = topHalf.add(api.joints.pin({ diameter:4, length:6 }).translate([10,0,0]));
const b = botHalf.subtract(api.joints.socket({ diameter:4, depth:6, fit:'snug' }).translate([10,0,0]));
```

### `dovetail({ length, width, depth?, angle?, fit?, segments? }) → { tail, socket }`
Sliding dovetail along **+X**. Cross-section narrow at the mouth (y=0), flaring
into the material (+y). `tail` = male solid (union onto part A); `socket` =
female negative (subtract from part B), widened by `fit` so it slides.

| key | meaning | default |
|---|---|---|
| `length` | slide length along +X — **required** | — |
| `width` | mouth width — **required** | — |
| `depth` | dovetail depth into the material | `0.6 · width` |
| `angle` | flare angle (degrees) | `15` |
| `fit` | preset name or mm | `'normal'` |

```js
const dt = api.joints.dovetail({ length:30, width:12, fit:'normal' });
const a = railA.add(dt.tail);
const b = railB.subtract(dt.socket);
```

### `snapFit({ width, length, thickness?, hookDepth?, leadAngle?, fit?, rounded? }) → { clip, catch }`
Cantilever snap. `clip` = flexible beam rising in +Z with a retention hook
jutting +Y at the tip and a `leadAngle` insertion ramp (union onto the moving
part). `catch` = a window negative the hook clicks through (subtract from the
mating wall). `rounded: true` bevels the retention edge for a smoother
snap-in/out (lower retention force).

```js
const sf = api.joints.snapFit({ width:8, length:14, hookDepth:1.5 });
const lid  = lidWall.add(sf.clip);
const body = bodyWall.subtract(sf.catch);
```

### `hinge({ width?, leaf?, thickness?, knuckles?, pinD?, clearance?, segments? })`
**Print-in-place barrel hinge** — returns **ONE Manifold made of exactly TWO
free components** that prints already assembled and folds straight off the
plate. It lies open flat (180°) on z=0: barrel axis along +X spanning
x∈[0, width], the two leaf plates extending ±Y, the barrel resting tangent to
the plate so no supports are needed. One leaf's knuckles carry an **integral
pin** spanning the full width; the other leaf's knuckles are bored
`pinD + 2·clearance` and wrap it. Knuckles alternate along the barrel —
the odd count means the pin leaf owns **both ends**, so the pin is captive.

| key | meaning | default |
|---|---|---|
| `width` | extent along the barrel axis | `30` |
| `leaf` | depth of each leaf plate | `12` |
| `thickness` | leaf plate thickness | `3` |
| `knuckles` | knuckle count — must be **odd, ≥ 3** | `5` |
| `pinD` | pin diameter | `4` |
| `clearance` | radial + axial moving gap (preset name or mm) | `0.3` |

```js
return api.joints.hinge({ width: 40, knuckles: 5, pinD: 4 });
```

**Verify the two components survive**, then commit with the assertion:

```js
runAndSave(code, 'barrel hinge', { maxComponents: 2 })
```

`componentCount` **must** be 2 — the pin leaf and the wrap leaf. A fused `1`
means the clearance closed up somewhere; raise `clearance`. The `0.3` default
is deliberately looser than an assembly fit: print-in-place gaps also have to
survive **first-layer squish** (the squashed first layer bulges sideways and
can weld parts that clear everywhere else). Below ~0.25 mm most FDM printers
fuse the barrel; go to 0.4–0.5 for a coarse nozzle or if a test print won't
break free.

### `ballSocket({ ballD?, clearance?, openingRatio?, retention?, slots?, screwD?, stemD?, stemL?, baseD?, baseT?, segments? }) → { ball, socket }`
**Articulating ball-and-socket joint** — TWO separate Manifolds, printed apart
and assembled afterwards (not print-in-place). `ball` is a sphere on a
cylindrical stem rising from a mounting disc (base on z=0), with a conical
fillet at the stem root so it doesn't snap. `socket` is a cylindrical housing
(base on z=0) whose spherical cavity (`ballD + 2·clearance`) opens upward
through a circular mouth of `openingRatio · ballD` with a conical entry chamfer.

**`retention` picks how the ball is held** — a plain solid socket can't be both
easy to insert AND hold a pose, so choose:

- **`'friction'` (default)** — the rim is split into `slots` springy fingers.
  They splay on insertion (low force, so the stem survives) then clamp the ball,
  so it **holds the angle you set it to**. No hardware. Grip rises as
  `openingRatio` shrinks or `slots` decreases.
- **`'clamp'`** — a single pinch slot + a pair of lugs bored for an M-screw
  (Ø `screwD`). The ball drops in free; tighten the screw to set friction up to
  a hard lock (camera-ball-head style). Add your own screw + nut.
- **`'snap'`** — the legacy solid retention lip: the ball is forced past a mouth
  smaller than itself and stays captive but **swivels freely** (no friction).
  High insertion force — drives load through the stem. Smaller `openingRatio` =
  harder to snap in, harder to pop out.

| key | meaning | default |
|---|---|---|
| `ballD` | ball diameter | `10` |
| `clearance` | radial articulation gap (mm) | `0.15` |
| `openingRatio` | opening ⌀ as a fraction of `ballD`, 0.7..0.95 | `0.85` |
| `retention` | `'friction'` \| `'clamp'` \| `'snap'` | `'friction'` |
| `slots` | finger count for `'friction'` (min 2) | `4` |
| `screwD` | clamp-screw bore Ø for `'clamp'` (mm) | `3.4` (M3 clearance) |
| `stemD` / `stemL` | stem diameter / length (stem must fit through the opening) | `0.4·ballD` / `0.6·ballD` |
| `baseD` / `baseT` | mounting-disc diameter / thickness | `1.6·ballD` / `3` |

> Friction/clamp grip is printer- and material-dependent — start at the
> defaults, print, and dial `openingRatio`/`slots` (friction) or screw torque
> (clamp) to taste.

```js
const bs = api.joints.ballSocket({ ballD: 12 });
return api.labeledUnion([
  { name: 'ball',   shape: bs.ball,                          color: '#4f86c6' },
  { name: 'socket', shape: bs.socket.translate([25, 0, 0]),  color: '#e0a458' },
]);
```

### `snapRim({ diameter, beadD?, clearance?, sweepDeg?, segments? }) → { bead, groove }`
**Annular snap rim for press-on lids** — the click a deodorant cap or paint-pot
lid makes. Same pair convention as `dovetail`:

- `bead` — a **POSITIVE** torus ring. **Union it onto the MALE wall** (e.g.
  the outside of a lid's skirt) so half the bead protrudes from the wall
  surface at `diameter`.
- `groove` — a **NEGATIVE** torus ring at bead radius + `clearance`.
  **Subtract it from the FEMALE wall** (e.g. the inside of the box mouth) at
  the **same `diameter`**, at the height where the lid seats.

Local frame: ring centred on the Z axis, with the bead/groove centreline
circle of diameter `diameter` lying in the z=0 plane — translate each ring to
its seating height. `sweepDeg < 360` makes a partial arc (e.g. two opposing
snap bumps instead of a full ring).

| key | meaning | default |
|---|---|---|
| `diameter` | wall interface ⌀ the centreline sits on — **required** | — |
| `beadD` | bead cross-section diameter | `1.2` |
| `clearance` | radial growth of the groove over the bead (mm) | `0.15` |
| `sweepDeg` | arc angle; 360 = full ring | `360` |
| `segments` | resolution of the **revolve sweep** around Z (the bead's circular cross-section is fixed at 32 verts) | engine default |

The key is using **one interface diameter** for both halves — the wall surface
where lid skirt meets box mouth:

```js
const { Manifold, joints } = api;
const iface = 40;                                   // lid skirt outer ⌀ = box mouth inner ⌀
const rim = joints.snapRim({ diameter: iface, beadD: 1.2 });
// Lid: skirt wall at the interface diameter, bead unioned on near the skirt's lower edge.
const lid = Manifold.cylinder(8, iface/2, iface/2)
  .subtract(Manifold.cylinder(8.1, iface/2 - 1.6, iface/2 - 1.6))
  .add(Manifold.cylinder(2, iface/2 + 1.6, iface/2 + 1.6).translate([0,0,8]))
  .add(rim.bead.translate([0, 0, 2]));              // bead 2 mm above the skirt edge
// Body: subtract the groove from inside the box mouth at the matching seat height.
const body = Manifold.cylinder(30, iface/2 + 2, iface/2 + 2)
  .subtract(Manifold.cylinder(28, iface/2, iface/2).translate([0,0,2]))
  .subtract(rim.groove.translate([0, 0, 28 - 2])); // seats when the lid is pressed home
return lid.translate([0, 0, 40]).add(body);
```

## Verification & printing

- **`hinge` is the one print-in-place builder here**: always commit with
  `runAndSave(code, label, { maxComponents: 2 })` so the two-component
  invariant is asserted on every rerun. `dovetail`, `snapFit`, `ballSocket`,
  and `snapRim` pairs are meant to be printed as parts of *separate* bodies
  (or separate parts of a `labeledUnion`).
- Keep clip beams and knuckle walls ≥ 0.8mm (≥2 perimeters). Read
  `print-safety` before export.
- Snap-fit, dovetail, and snap-rim clearances are printer-dependent —
  calibrate with `api.fasteners.clearanceCoupon` and feed the measured value
  back as `fit`/`clearance`.
- Print snap-fit clips with the beam's bend axis in the layer plane where
  possible — layer boundaries are weak in tension, and a clip flexing across
  layers snaps off.
- These are mesh helpers (manifold-js). For free-form print-in-place
  mechanisms (screws, spinners, captive balls in custom cages) read
  `readDoc("mechanisms")`; for exact CAD fillets use the BREP engine
  (`readDoc("replicad")`).
