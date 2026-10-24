# Creatures, mascots & animals — `api.sdf.creature`

**When to reach for this:** the subject is a **creature, monster, mascot, toy
animal or cartoon character that is NOT a standard human** — a big-eyed
gremlin, a horned imp, a bat-eared cat, a plush-style monster, a movie
creature. The humanoid rig (`api.sdf.figure`, `readDoc("figure")`) can't
express those proportions, so the body is hand-built from **ellipsoid masses
welded with `smoothUnion`** (`readDoc("sdf")`). The masses are the easy part.
What makes a creature read as *sculpted* rather than *primitive soup* is the
**features**: the eyes, mouth, ears, hands and feet. Hand-rolling those is
where in-app attempts usually fail. Typical results are eyes that stair-step
or poke out of the skull, a mouth "engraved" as an outline, flat-plate ears,
and a face that reads as a mask glued onto a ball.

`api.sdf.creature` (`C` below) packages a proven recipe for each of those:

| Helper | What it gives you |
|---|---|
| `C.eyes({ at, radius, … })` | Eyes set in **steep-walled apertures** with a raised lid rim and an optional hooded upper lid; the eyeball is **clipped to the opening**, so the edge meshes crisp and the eyeball can't poke out the side of the skull. |
| `C.crease(surface, path, …)` | A soft groove (mouth line, philtrum, fold, wrinkle) **seated on the real surface**. It can't float off the face or tunnel through to the back of the head. |
| `C.ears({ root, length, … })` | **Cupped membrane ears** (bat / cat / fennec / imp): a constant-thickness curved shell clipped to a tapered leaf outline, concave face forward, plus a separately-painted inner membrane with raised veins. |
| `C.feet({ at, length, … })` | Long flat feet with toe pads, toe-split creases and claws. Soles land on the ground plane. |
| `C.hands({ at, size, … })` | Small relaxed hanging hands: palm, tapered fingers and thumb. |
| `C.build({ skin, features, parts, … })` | Attaches every feature, **flattens the soles**, labels the skin, **collects every feature's detail sphere** and meshes everything in one call. Returns a Manifold. |

Every feature is **mirrored by default**: give the **+X side** (the
creature's left) and you get both. Every feature also carries its own `detail`
refinement sphere, so the fine meshing that eyes, fingers and claws need comes
for free.

> Coordinate convention (same as ai.md): **front = −Y**, **Z up**, soles on
> **z = 0**. Model the +X half; mirror with `.mirrorPair('x')`.

## The pattern

```js
const { sdf, Manifold } = api;
const C = sdf.creature;
const mir = (n) => n.mirrorPair('x');
const E = (rx, ry, rz, x, y, z) => sdf.ellipsoid(rx, ry, rz).translate(x, y, z);
const hc = 80;   // head centre height — write every head coordinate relative to it

// 1. MASSES — body as overlapping ellipsoids, limbs as capsules.
const belly = E(26, 22, 23, 0, -1, 37);
const chest = E(18, 15.5, 14, 0, 1, 56);
const legs  = mir(sdf.capsule([11.5, 1, 20], [12.5, -1, 6], 8));

// 2. HEAD — ONE deep skull + features only 1–2 units proud of it.
let head = E(18.5, 18.5, 16, 0, 0, hc + 3)                       // cranium
  .smoothUnion(E(21.5, 17.5, 12.5, 0, -2, hc - 5), 11)           // jowls / cheeks
  .smoothUnion(mir(E(4.8, 3.8, 3.6, 3.6, -17.8, hc - 10.5)), 2.5) // muzzle pads
  .smoothUnion(E(13, 4, 3.6, 0, -15.5, hc + 8), 7);              // brow

// 3. CREASES on the head — [x, z] points, projected onto the FRONT face.
head = C.crease(head, [[-7.6, hc - 11.2], [-2.4, hc - 13.4], [0, hc - 13.1], [2.4, hc - 13.4], [7.6, hc - 11.2]],
  { radius: 0.9, depth: 0.7 });

// 4. WELD the skin (body + head + arms + tail).
const arms = mir(sdf.capsule([17, 1, 62], [28, 1, 48], 4.6).smoothUnion(sdf.capsule([28, 1, 48], [30, -3.5, 36.5], 3.8), 2));
const skin = belly.smoothUnion(chest, 9).smoothUnion(legs, 5).smoothUnion(head, 9).smoothUnion(arms, 2);

// 5. FEATURES — +X side, mirrored for you.
const eyes  = C.eyes({ at: [8.3, -13.3, hc + 1.5], radius: 6.6 });
const ears  = C.ears({ root: [14, 3, hc + 6], length: 44, lift: 18 });
const feet  = C.feet({ at: [13, -3], length: 36 });
const hands = C.hands({ at: [30.5, -5, 32.5] });

// 6. BUILD — attaches features, flattens soles, labels 'skin', meshes with all detail spheres.
const nose = E(2.9, 2.3, 2.2, 0, -21.4, hc - 4.6).label('nose');
const model = C.build({ skin, features: [eyes, ears, feet, hands], parts: [nose],
  edgeLength: 0.6, detail: [{ center: [0, -14, hc - 3], radius: 17, edgeLength: 0.22 }] });

api.paint.label('skin', '#eeeeee');
api.paint.label('eyes', '#060606');
api.paint.label('innerEar', '#a9d4ea');
api.paint.label('nose', '#e8b4a0');
return model;   // a Manifold — .add() a base plinth here if you want one
```

## Workflow that lands a likeness

1. **Measure the reference before writing code.** Write the ratios down
   (`addSessionNote("[MEASUREMENT] …")`). Wrong proportions are the #1 reason a
   creature doesn't look like its subject, and no amount of detail fixes them:
   - head height ÷ total height (a big-headed creature is often 0.33–0.45),
   - head width ÷ body width,
   - eye diameter ÷ head width, and eye spacing ÷ eye diameter
     (centre-to-centre ≈ 1.3–1.6 eye diameters for a cute creature),
   - eye height inside the head (fraction down from the crown),
   - mouth width (a closed, small creature mouth ≈ the eye spacing),
   - ear span ÷ head width, ear lift angle,
   - foot length ÷ body depth, how far the arms hang (to mid-belly? the hips?).
2. **Block the masses first** (step 1–2 above) and render **front, side and a
   3/4 view (`azimuth −50`)** before any feature. Fix the silhouette here.
3. **Add features** with the kit, then render the **same three views plus a
   close, high-resolution face shot**. The **3/4 view is the one that catches
   the two classic creature defects**: a face that reads as a flat mask (see
   the rules below) and an eyeball poking out of the side of the skull.
4. **Score against the photo** with `photoMatch` (text only, see
   `readDoc("reference-images")`) and adjust masses from its `worst[]`. Look
   at renders only at checkpoints.

## Rules that make it look sculpted (each one cost a render loop to learn)

- **One deep skull, features barely proud of it.** Start the head from one
  big cranium (+ a wider jowl ellipsoid for the cheeks, welded with a **large
  k ≈ 10**). Brow, cheek pads, muzzle and lids should stand only **1–2 units**
  proud of that skull. Features stacked far in front of a small skull read as
  a **flat mask** with a hard rim from 3/4.
- **Big blends on soft features.** Brow k ≈ 7, cheeks ≈ 4, lids ≈ 0.6 × eye
  radius (what `C.eyes` uses). A small k on a wide ellipsoid leaves a visible
  "hood line" across the forehead.
- **Eyes = aperture + clipped eyeball, never a socket ellipsoid around a
  sphere.** A socket nearly parallel to the eyeball grazes it, and that edge
  stair-steps at any mesh resolution. `C.eyes` cuts a hole that runs deep
  along the view axis, so the lid crosses the eyeball steeply (a crisp edge).
  Place `at` so the eyeball's front sits just behind the face surface. Too
  deep and the eyes disappear (a `0-triangle` label warning); too shallow and
  they bulge.
- **A mouth is a crease, not an outline.** One `C.crease` along the lip line
  (small: about the eye spacing), a shallow philtrum crease from the nose
  down, and optional soft nasolabial folds. Add a small pouty lower-lip
  ellipsoid below the line. A box/arc *cut* from the face reads as engraved
  text.
- **Ears are cupped shells, not flat plates.** `C.ears` gives the curvature
  and the rim. Set `lift` / `sweep` from the reference.
- **Arms hang free of the belly.** Keep the elbow/wrist capsules a little
  outside the belly's surface (blend k ≈ 2). An arm smoothed along its whole
  length looks like a relief carving.
- **Flat soles.** `C.build` clips everything below `ground` (default 0), so the
  figure stands and prints.
- **Hard parts are separate labels.** Eyeballs, nose tip, horns and inner ears
  are hard-unioned at the top level (`parts` / the features' own labels). Skin
  is one welded region. Never `smoothUnion` a labelled part into the skin: that
  drops the label.

## API reference

All options are validated: an unknown key or a bad value throws with the
option's name. Lengths are in model units. Every `mirror` defaults to `true`.

### `C.eyes(opts)` → feature

| Option | Default | Meaning |
|---|---|---|
| `at` | — (required) | +X eyeball centre `[x, y, z]`. |
| `radius` | `6` | Eyeball radius. |
| `aspect` | `[1.06, 0.98, 1]` | Per-axis multipliers on `radius` (x = width, y = depth, z = height). |
| `opening` | `0.85` | Aperture radius as a fraction of the eyeball (0.3–0.98). Smaller = more lid, more "deep-set". |
| `rim` | `1` | Lid-rim thickness multiplier (0 = no rim). |
| `hood` | `0.7` | Heavy upper lid (0 = none, 1 = heavy and sleepy, 2 = very heavy). |
| `tilt` | `0` | Degrees. Rolls the eye about its view axis; + drops the outer corner. |
| `yaw` | `0` | Degrees. + turns the eyes outward. |
| `label` | `'eyes'` | Paint label of the eyeballs. |
| `edgeLength` | `radius × 0.02` | Mesh size inside the eye's detail sphere. |

### `C.ears(opts)` → feature

| Option | Default | Meaning |
|---|---|---|
| `root` | — (required) | Where the +X ear meets the head. Put it ~2–4 units inside the skull. |
| `length` | `30` | Root → tip. |
| `width` | `0.68 × length` | Widest span of the leaf. |
| `cup` | `1` | Cup curvature (0.2 = nearly flat, 3 = deep bowl). |
| `thickness` | `0.045 × length` (≥ 0.8) | Membrane thickness (keep ≥ 0.8 for printing). |
| `lift` | `16` | Degrees the ear rises above horizontal. |
| `sweep` | `12` | Degrees the tip sweeps back. |
| `veins` | `3` | Raised veins fanning across the inner membrane (0–9). |
| `inner` | `true` | Add the inner membrane as its own paint label. |
| `innerLabel` | `'innerEar'` | That label's name. |
| `blend` | `1.6 × thickness` | smoothUnion k onto the skull. |

### `C.feet(opts)` → feature

| Option | Default | Meaning |
|---|---|---|
| `at` | — (required) | +X ankle point `[x, y]` on the ground, under the leg. |
| `ground` | `0` | Sole height. |
| `length` / `width` / `height` | `36` / `0.6 L` / `0.28 L` | Overall foot size. The toes reach about `0.85 × length` in front of `at`. |
| `toes` | `3` | Toe pads (0–6). Splits are creased between them. |
| `claws` | `true` | A claw per toe. Merged into the skin unless `clawLabel` is set. |
| `clawLabel` | — | Paint the claws as their own label. |
| `yaw` | `14` | Degrees of toe-out (+ turns the +X foot outward). |
| `blend` | `0.4 × min(width, height)` | smoothUnion k onto the leg. |

### `C.hands(opts)` → feature

| Option | Default | Meaning |
|---|---|---|
| `at` | — (required) | +X palm centre, just below the end of the forearm capsule. |
| `size` | `1` | Scale (1 ≈ 8.8 units long palm + fingers). |
| `fingers` | `3` | 1–5, spread front-to-back across the palm. |
| `thumb` | `true` | Thumb forward on the inner side. |
| `yaw` | `0` | Degrees about Z. |
| `blend` | `2 × size` | smoothUnion k onto the arm. |

Hands always **hang down** (fingers toward −Z). For raised or gripping hands,
build the hand by hand from `sdf.tube` fingers, or use the humanoid
`api.sdf.figure` hands.

### `C.crease(surface, path, opts?)` → node

Carves a soft groove into `surface` (any SDF node) and returns the carved
node. Each `path` point is either:

- `[x, z]`: projected along `dir` (default `[0, −1, 0]`, the front) onto the
  surface. This is the easy form for faces.
- `[x, y, z]`: a point on the line to project along `dir`. Use it for any
  other direction, e.g. `dir: [1, 0, 0]` for a wrinkle on the +X flank.

`dir` is the **outward** direction of the face you are carving. `radius`
(default `0.8`) is the groove's half-width, `depth` (default `0.75 × radius`)
sinks the path below the surface (0 = a shallow dent, negative = a raised
seam), and `soft` (default `1.5 × radius`) is the smoothSubtract k. A point
that misses the surface throws, and the error says which point. Carve creases
on the **head node before welding it to the body**: it's cheaper, and the
projection can't hit the arms.

### `C.build(opts)` → Manifold

| Option | Default | Meaning |
|---|---|---|
| `skin` | — (required) | The welded body SDF. |
| `features` | `[]` | Features from `C.eyes/ears/feet/hands`, attached in order. |
| `parts` | `[]` | Extra **labelled** SDF nodes (nose, horns, teeth…) to hard-union. |
| `ground` | `0` | Clip plane for flat soles. `null` = don't clip. |
| `skinLabel` | `'skin'` | Paint label of the skin. |
| `edgeLength` | auto | Global mesh size (0.5–0.8 for a ~100-unit creature). |
| `detail` | `[]` | Extra refinement spheres (add one over the face). Features add theirs; the total limit is 16. |

Each feature also exposes `attach(skin)`, `parts` and `detail`, if you'd
rather call `.build()` yourself.

## Worked example — Ned (twenty one pilots)

The complete figurine (also `examples/creature_ned.js`). It is one manifold
piece of about 290k triangles, and it builds in about 30 s.

```js
const { sdf, Manifold } = api;
const C = sdf.creature;
const mir = (n) => n.mirrorPair('x');
const E = (rx, ry, rz, x, y, z) => sdf.ellipsoid(rx, ry, rz).translate(x, y, z);
const hc = 80;

const belly = E(26, 22, 23, 0, -1, 37);
const chest = E(18, 15.5, 14, 0, 1, 56);
const legs = mir(sdf.capsule([11.5, 1, 20], [12.5, -1, 6], 8));

const cranium = E(18.5, 18.5, 16, 0, 0, hc + 3);
const jowls = E(21.5, 17.5, 12.5, 0, -2, hc - 5);
const cheekPads = mir(E(8, 5, 6.5, 8.8, -15, hc - 6.5));
const muzzle = mir(E(4.8, 3.8, 3.6, 3.6, -17.8, hc - 10.5));
const chin = E(6, 4, 3.4, 0, -15.5, hc - 16.5);
const brow = E(13, 4, 3.6, 0, -15.5, hc + 8);
const bridge = sdf.capsule([0, -17.5, hc + 4], [0, -20, hc - 3.5], 2.2);
let head = cranium.smoothUnion(jowls, 11).smoothUnion(cheekPads, 4).smoothUnion(muzzle, 2.5)
  .smoothUnion(chin, 3).smoothUnion(brow, 7).smoothUnion(bridge, 3);
head = C.crease(head, [[-7.6, hc - 11.2], [-5, hc - 12.6], [-2.4, hc - 13.4], [0, hc - 13.1],
  [2.4, hc - 13.4], [5, hc - 12.6], [7.6, hc - 11.2]], { radius: 0.9, depth: 0.7, soft: 1.3 });
head = C.crease(head, [[0, hc - 8], [0, hc - 12.6]], { radius: 0.8, depth: 0, soft: 1.6 });
for (const s of [1, -1]) {
  head = C.crease(head, [[4.8 * s, hc - 4.2], [8.4 * s, hc - 7.6], [9.4 * s, hc - 11]], { radius: 0.6, depth: 0, soft: 2 });
}
head = head.smoothUnion(E(4.2, 2.6, 1.9, 0, -16.6, hc - 14.6), 1.2);

const arms = mir(sdf.capsule([17, 1, 62], [28, 1, 48], 4.6).smoothUnion(sdf.capsule([28, 1, 48], [30, -3.5, 36.5], 3.8), 2));
const tail = sdf.tube([[0, 16, 26], [0, 23, 30], [0, 28, 37], [0, 29.5, 44]], 5, { taper: 0.12 });
const skin = belly.smoothUnion(chest, 9).smoothUnion(legs, 5).smoothUnion(head, 9)
  .smoothUnion(arms, 2).smoothUnion(tail, 3);

const eyes = C.eyes({ at: [8.3, -13.3, hc + 1.5], radius: 6.6, hood: 1 });
const ears = C.ears({ root: [14, 3, hc + 6], length: 44, width: 30, lift: 18, sweep: 10 });
const feet = C.feet({ at: [13, -3], length: 36, width: 22, height: 10, yaw: 14 });
const hands = C.hands({ at: [30.5, -5, 32.5] });
const nose = sdf.ellipsoid(2.9, 2.3, 2.2).rotate(-18, 0, 0).translate(0, -21.4, hc - 4.6).label('nose');
const horns = mir(sdf.tube([[8.6, -1, hc + 13.5], [9.6, -0.5, hc + 19], [11.6, 0.8, hc + 24]], 2.5, { taper: 0.14 })).label('horns');

const model = C.build({ skin, features: [eyes, ears, feet, hands], parts: [nose, horns],
  edgeLength: 0.6, detail: [{ center: [0, -14, hc - 3], radius: 17, edgeLength: 0.22 }] });
api.paint.label('skin', '#eeeeee');
api.paint.label('eyes', '#060606');
api.paint.label('nose', '#e8b4a0');
api.paint.label('horns', '#3e2c22');
api.paint.label('innerEar', '#a9d4ea');
// plinth top 0.4 ABOVE the ground so the flat soles overlap it (coplanar faces leave slivers)
const base = Manifold.cylinder(4, 1, 1, 96).scale([42, 38, 1]).translate([0, -6, -3.6]);
return model.add(api.label(base, 'base', { color: '#1b1b1d' }));
```

Adapting it to another creature is mostly a matter of re-measuring: scale the
belly/chest/head ellipsoids to the new ratios, then move `at`/`root` and the
crease points with them. Horns and tails are a tapered `sdf.tube` (see
`readDoc("sdf")#tube`).

## Gotchas

- **`eyes` label paints 0 triangles** → the eyeball sits behind the skin.
  Move `at` forward (−Y) until its front is ~0.5 behind the lid surface, or
  reduce `hood`.
- **An eye or ear shows through the back/side of the head** → `at`/`root` is
  too far out. Pull it toward the centre, or shrink `radius`/`length`. Check
  the 3/4 and back views.
- **`C.crease` throws "misses the surface"** → a point lies off the head's
  silhouette along `dir`. Keep `[x, z]` points inside the face outline.
- **A crease cuts too deep between points** → the groove runs *straight*
  between consecutive seated points, so on a strongly curved face it dips
  below the surface mid-span. Space points every few units along the line.
- **Creases show on the back of the head** → you passed `dir` pointing
  inward. `dir` is the outward normal of the face being carved (front =
  `[0, −1, 0]`).
- **"N detail spheres … limit is 16"** → each mirrored feature adds 2. Drop
  some of your own `detail` entries, or pass `mirror: false` on a feature
  you're mirroring by hand.
- **Genus in the hundreds / a "contained component"** → a thin shell (an ear)
  grazes another surface (the cheeks, the shoulders) with a hair-thin gap, and
  the march fills it with tiny tunnels. Raise `root` or `lift` until the ear
  clears the body by a few units, then re-check `genus` in the stats.
- **Zero-volume slivers at z = 0** → a plinth whose top face sits exactly on
  the ground plane is coplanar with the flat soles. Raise the plinth top ~0.4
  above `ground` so the soles sink into it.
- **Slow builds** → keep `edgeLength` ≥ 0.5 globally. The features' detail
  spheres already refine where it matters.
