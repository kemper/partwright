# Creatures, mascots & animals — `api.sdf.creature`

**When to reach for this:** the subject is a **creature, monster, mascot, toy
animal or cartoon character that is NOT a standard human** — a big-eyed
gremlin, a horned imp, a bat-eared cat, a plush-style monster, a movie
creature. The humanoid rig (`api.sdf.figure`, `readDoc("figure")`) can't
express those proportions, so the body is hand-built from **ellipsoid masses
welded with `smoothUnion`** (`readDoc("sdf")`). The masses are the easy part.
What makes a creature read as *sculpted* rather than *primitive soup* is the
**features**: the eyes, mouth, ears, hands and feet. Hand-rolling those is
where in-app attempts usually fail. Typical results are:
- eyes that aren't round, stair-step, or poke out of the skull,
- a mouth that is just a groove engraved along a line, where the subject has a
  puffy muzzle that pushes out of the face,
- flat-plate or generic ears that miss the subject's silhouette and slope,
- a face that reads as a mask glued onto a ball.

`api.sdf.creature` (`C` below) packages a proven recipe for each of those:

| Helper | What it gives you |
|---|---|
| `C.eyes({ at, radius, … })` | **Perfectly round** glossy eyes in soft **eyelids**: a thin shell hugging the eyeball, cut by a round, steep-walled opening. The lid edge is a slim rim concentric with the black disc, so the eye stays round, with no grey socket wall and no bite where a cheek or brow stands proud. The eyeball is clipped to the opening, so it can't poke out the side of the skull. |
| `C.muzzle({ at, width, … })` | A **puffy cat-like muzzle that pushes out of the face** (Dr Seuss / cat / gremlin), seated on the real face. Two plump upper-lip pads overhang a tucked lower lip, so the mouth line is the shadow of that overhang: a "w" that curls up into the cheeks. It also gives a philtrum cleft, a rounded-triangle **cat nose** (its own `'nose'` label) and optional whisker dots. |
| `C.crease(surface, path, …)` | A soft groove (fold, wrinkle, toe split, extra lip line) **seated on the real surface**. It can't float off the face or tunnel through to the back of the head. |
| `C.ears({ root, length, … })` | **Lobed bat / cat / imp ears**. The silhouette is an asymmetric leaf: a straight top edge out to a pointed tip, and a rounded lobe near the root (`belly`). It's a constant-thickness shell cupped across its width, with a separately-painted inner membrane whose ribs fan from the root. |
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
const { sdf } = api;
const C = sdf.creature;
const mir = (n) => n.mirrorPair('x');
const E = (rx, ry, rz, x, y, z) => sdf.ellipsoid(rx, ry, rz).translate(x, y, z);
const hc = 80;   // head centre height — write every head coordinate relative to it

// 1. MASSES — body as overlapping ellipsoids, limbs as capsules.
const belly = E(26, 22, 23, 0, -1, 37);
const chest = E(18, 15.5, 14, 0, 1, 56);
const legs  = mir(sdf.capsule([11.5, 1, 20], [12.5, -1, 6], 8));

// 2. HEAD — ONE tapered egg (wide jowls, narrower crown) + soft cheek pads.
const skull = sdf.ellipsoid(23, 21, 19).taper(-0.01, 'z').translate(0, -2, hc + 1);
const head  = skull.smoothUnion(mir(E(9, 5.5, 7, 10.5, -16.5, hc - 8.5)), 6);

// 3. WELD the skin (body + head + arms).
const arms = mir(sdf.capsule([17, 1, 62], [28, 1, 48], 4.6).smoothUnion(sdf.capsule([28, 1, 48], [30, -3.5, 36.5], 3.8), 2));
const skin = belly.smoothUnion(chest, 9).smoothUnion(legs, 5).smoothUnion(head, 9).smoothUnion(arms, 2);

// 4. FEATURES — +X side, mirrored for you; each seats itself on the real face.
const muzzle = C.muzzle({ at: [0, hc - 11], width: 22 });            // + the 'nose' part
const eyes   = C.eyes({ at: [10, -14.6, hc + 3], radius: 6.8 });
const ears   = C.ears({ root: [16, 3, hc + 6], length: 36, width: 26, lift: 8 });
const feet   = C.feet({ at: [13, -3], length: 36 });
const hands  = C.hands({ at: [30.5, -5, 32.5] });

// 5. BUILD — attaches features, flattens soles, labels 'skin', meshes with all detail spheres.
const model = C.build({ skin, features: [muzzle, eyes, ears, feet, hands], edgeLength: 0.6 });

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
4. **Compare side by side with the photo at the same angle**, feature by
   feature:
   - Are the eyes round discs?
   - Does the muzzle push out of the face in profile?
   - Does the ear silhouette match? Check where it leaves the head, the slope
     of its top edge, where the lobe sits and how pointed the tip is.
   - Is the ear span about right relative to the head width?

   Also score with `photoMatch` (text only, see `readDoc("reference-images")`)
   and adjust masses from its `worst[]`. Look at renders only at checkpoints.

## Rules that make it look sculpted (each one cost a render loop to learn)

- **One skull shape, not a stack.** Build the head from ONE tapered egg
  (`ellipsoid(...).taper(-0.01, 'z')`: wide jowls, narrower crown). Then add
  soft cheek pads with a large k (≈ 6) on top.
  - Two overlapping skull ellipsoids (a cranium plus a wider jowl) leave a
    visible "hood" crease where one emerges from the other.
  - Brows or rims stacked 2–3 units in front of the skull read as a flat mask
    with a hard rim from 3/4.
- **Eyes = lids around a clipped eyeball.** Use `C.eyes`; never a socket
  ellipsoid around a sphere or a broad rim blob.
  - A socket nearly parallel to the eyeball grazes it, and that edge
    stair-steps.
  - A big rim blob with a large k merges both eyes into a goggle plateau.
  - `C.eyes` hugs the eyeball with a thin lid shell and cuts a round, deep
    opening through it, so the eye is a crisp, perfect circle.
  - Place `at` so the eyeball's front sits about 1 unit in front of the
    face.
- **A muzzle is volume, not a groove.** A creature mouth reads from the
  upper-lip pads pushing out of the face and overhanging the lower lip. The
  mouth line is the shadow of that overhang. Use `C.muzzle`: `puff` pushes it
  out further, `smile` curls the corners. Engraving a line or an arc into a
  flat face reads as a drawing, not a mouth.
- **Ears: match the silhouette and the slope.** `C.ears` gives a lobed leaf.
  Set it from the reference:
  - `lift`: the slope of the ear axis (≈ 0–10 for ears that stick straight
    out, 20–30 for perky ones).
  - `belly`: the size of the lower lobe. Too much belly squares off the tip.
  - `length` / `width`: tip-to-tip span ≈ 1.6–1.8 × head width for a
    big-eared creature.
  - `root`: high on the side of the head, so the top edge leaves the head near
    the crown and the lobe sits around eye level.
- **Arms hang free of the belly.** Keep the elbow/wrist capsules a little
  outside the belly's surface (blend k ≈ 2). An arm smoothed along its whole
  length looks like a relief carving.
- **Flat soles.** With feet, `C.build` clips the skin (and unlabelled claws)
  at the feet's `ground`, so the figure stands and prints. Labelled parts
  (horns, a labelled tail tip) are not clipped, so keep them above the ground.
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
| `at` | — (required) | +X eyeball centre `[x, y, z]`. Put the eyeball's front ~1 unit in front of the face. |
| `radius` | `6` | Eyeball radius. |
| `aspect` | `[1, 1, 1]` (round) | Per-axis multipliers on `radius` (x = width, y = depth, z = height). |
| `opening` | `0.85` | Radius of the round opening as a fraction of the eyeball (0.3–0.98). Smaller = more lid, more "deep-set". |
| `rim` | `1` | Eyelid thickness multiplier (× 0.12 × radius; 0 = no lid). |
| `hood` | `0` | Heavy upper lid (0 = none, 1 = heavy and sleepy, 2 = very heavy). |
| `tilt` | `0` | Degrees. Rolls the eye about its view axis; + drops the outer corner. |
| `yaw` | `0` | Degrees. + turns the eyes outward. |
| `label` | `'eyes'` | Paint label of the eyeballs. |
| `edgeLength` | `max(0.08, radius × 0.02)` | Mesh size inside the eye's detail sphere. |

### `C.muzzle(opts)` → feature

| Option | Default | Meaning |
|---|---|---|
| `at` | — (required) | `[x, z]` of the upper-lip centre as seen from the front (just below the nose). The muzzle finds the face surface there itself. |
| `width` | `20` | Span of the two upper-lip pads (≈ the eye-centre distance). Everything scales with it. |
| `puff` | `1` | How far the pads push out of the face (0 = flush, 2 = very Seuss). |
| `smile` | `1` | Corner curl (0 = straight, negative = frown, 2 = big grin). |
| `lowerLip` | `1` | Size of the tucked lower lip (0 = none). |
| `cleft` | `1` | Philtrum cleft width (0 = none). |
| `mouth` | `true` | Crease the "w" mouth line under the pads. |
| `dots` | `0` | Rows of whisker dots on each pad (0–4), for texture. |
| `nose` | `true` | Add a rounded-triangle cat nose seated above the cleft (its own label). |
| `noseSize` | `1` | Nose scale. |
| `noseLabel` | `'nose'` | The nose's paint label. |

Its `parts` (the nose) and `detail` sphere are filled in when it attaches,
because they depend on where the face actually is.

### `C.ears(opts)` → feature

| Option | Default | Meaning |
|---|---|---|
| `root` | — (required) | Where the +X ear meets the head. Put it ~2–4 units inside the skull. |
| `length` | `30` | Root → tip. |
| `width` | `0.55 × length` | Span of the leaf at its root (the lobe adds more below). |
| `belly` | `1` | Size of the rounded lower lobe (0 = straight lower edge, 2 = big lobe; too much squares off the tip). |
| `cup` | `1` | Curvature across the width (0.2 = nearly flat, 3 = deep channel). |
| `thickness` | `0.045 × length` (≥ 0.8) | Membrane thickness (keep ≥ 0.8 for printing). |
| `lift` | `16` | Degrees the ear rises above horizontal. |
| `sweep` | `12` | Degrees the tip sweeps back. |
| `veins` | `3` | Raised ribs fanning from the root across the inner membrane (0–9). |
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
| `size` | `1` | Scale (1 ≈ 11 units from the top of the palm to the fingertips). |
| `fingers` | `3` | 1–5, spread side to side (along X) across the palm, curling forward. |
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
| `features` | `[]` | Features from `C.muzzle/eyes/ears/feet/hands`, attached in order (put `muzzle` first). |
| `parts` | `[]` | Extra **labelled** SDF nodes (nose, horns, teeth…) to hard-union. |
| `ground` | the feet's `ground`; no clip without feet | Clip plane for flat soles (skin + unlabelled claws only). `null` = don't clip. |
| `skinLabel` | `'skin'` | Paint label of the skin. |
| `edgeLength` | auto | Global mesh size (0.5–0.8 for a ~100-unit creature). |
| `detail` | `[]` | Extra refinement spheres (add one over the face). Features add theirs; the total limit is 24. |

Each feature also exposes `attach(skin)`, `parts` and `detail`, if you'd
rather call `.build()` yourself.

## Worked example — Ned (twenty one pilots)

The complete figurine (also `examples/creature_ned.js`). It is one manifold
piece of about 300k triangles, and it builds in about 30 s.

```js
const { sdf, Manifold } = api;
const C = sdf.creature;
const P = api.params({
  earColor: { type: 'select', default: 'blue', options: ['blue', 'peach'], label: 'Inner ear color' },
});
const mir = (n) => n.mirrorPair('x');
const E = (rx, ry, rz, x, y, z) => sdf.ellipsoid(rx, ry, rz).translate(x, y, z);
const hc = 80; // head centre height

// ===== BODY — a bottom-heavy egg, short stumpy legs =====
const belly = E(26, 22, 23, 0, -1, 37);
const chest = E(18, 15.5, 14, 0, 1, 56);
const legs = mir(sdf.capsule([11.5, 1, 20], [12.5, -1, 6], 8));

// ===== HEAD — ONE tapered egg (wide jowls, narrower crown) =====
// Two overlapping skull ellipsoids leave a visible "hood" crease where one
// emerges from the other; features stacked far in front of the skull read as a
// flat mask from 3/4. The face details come from the kit below.
const skull = sdf.ellipsoid(23, 21, 19).taper(-0.01, 'z').translate(0, -2, hc + 1);
const cheekPads = mir(E(9, 5.5, 7, 10.5, -16.5, hc - 8.5));
const chin = E(6, 4, 3.4, 0, -19, hc - 19);
const bridge = sdf.capsule([0, -21, hc + 4], [0, -23.5, hc - 4], 2.2);
let head = skull.smoothUnion(cheekPads, 6).smoothUnion(chin, 3).smoothUnion(bridge, 3);

// ===== ARMS — thin, hanging free of the belly =====
const arms = mir(sdf.capsule([17, 1, 62], [28, 1, 48], 4.6).smoothUnion(sdf.capsule([28, 1, 48], [30, -3.5, 36.5], 3.8), 2));
const tail = sdf.tube([[0, 16, 26], [0, 23, 30], [0, 28, 37], [0, 29.5, 44]], 5, { taper: 0.12 });

const skin = belly.smoothUnion(chest, 9).smoothUnion(legs, 5).smoothUnion(head, 9)
  .smoothUnion(arms, 2).smoothUnion(tail, 3);

// ===== FEATURES (each mirrored; each brings its own detail spheres) =====
const eyes = C.eyes({ at: [10, -14.6, hc + 3], radius: 6.8 });
const ears = C.ears({ root: [16, 3, hc + 6], length: 36, width: 26, lift: 8, sweep: 12, cup: 1.2, veins: 4 });
const feet = C.feet({ at: [13, -3], length: 36, width: 22, height: 10, yaw: 14 });
const hands = C.hands({ at: [30.5, -5, 32.5] });
const muzzle = C.muzzle({ at: [0, hc - 11], width: 22 });   // also adds the 'nose' part

// ===== HARD PARTS =====
const horns = mir(sdf.tube([[9.6, -1.5, hc + 15.5], [10.8, -1, hc + 21], [13, 0.3, hc + 26]], 2.7, { taper: 0.14 })).label('horns');

const model = C.build({
  skin,
  features: [muzzle, eyes, ears, feet, hands],
  parts: [horns],
  edgeLength: 0.6,
  detail: [{ center: [0, -15, hc - 2], radius: 18, edgeLength: 0.25 }], // cheeks + brow
});

api.paint.label('skin', '#eeeeee');
api.paint.label('eyes', '#060606');
api.paint.label('nose', '#e8b4a0');
api.paint.label('horns', '#3e2c22');
api.paint.label('innerEar', P.earColor === 'blue' ? '#a9d4ea' : '#f2c4ae');
// plinth top 0.4 ABOVE the ground so the flat soles overlap it (coplanar faces leave slivers)
const base = Manifold.cylinder(4, 1, 1, 96).scale([42, 38, 1]).translate([0, -6, -3.6]);
return model.add(api.label(base, 'base', { color: '#1b1b1d' }));
```

Adapting it to another creature is mostly a matter of re-measuring: scale the
belly/chest/skull ellipsoids to the new ratios, then move `at`/`root` with
them and re-tune the muzzle `width`/`puff` and the ear `lift`/`belly`. Horns
and tails are a tapered `sdf.tube` (see `readDoc("sdf")#tube`).

## Gotchas

- **`eyes` label paints 0 triangles** → the eyeball sits behind the skin.
  Move `at` forward (−Y) until its front is ~1 unit in front of the face, or
  reduce `hood`.
- **A grey ring between the black disc and the lid** → the eyeball sits too
  deep, so the socket wall shows. Move `at` forward, or lower `opening`.
- **`C.muzzle` throws "misses the face"** → `at` is outside the head's
  outline as seen from the front. It is `[x, z]` on the face, not a 3-D
  point.
- **An eye or ear shows through the back/side of the head** → `at`/`root` is
  too far out. Pull it toward the centre, or shrink `radius`/`length`. Check
  the 3/4 and back views.
- **`C.crease` throws "misses the surface"** → a point lies off the surface's
  silhouette along `dir`. Keep `[x, z]` points inside the face outline as seen
  from the front. The line is cast through the middle of the surface's
  bounding box, so it works wherever the head sits in Y.
- **A crease cuts too deep between points** → the groove runs *straight*
  between consecutive seated points, so on a strongly curved face it dips
  below the surface mid-span. Space points every few units along the line.
- **Creases show on the back of the head** → you passed `dir` pointing
  inward. `dir` is the outward normal of the face being carved (front =
  `[0, −1, 0]`).
- **"N detail spheres … limit is 24"** → each mirrored feature adds 2. Drop
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
