# Stylized figurine builder — `api.sdf.figure`

**When to reach for this:** the subject is a **person, child, character, hero,
creature, mascot, or bust** and you want a *posed, recognizable* figure instead
of fighting raw primitives. This is the **default medium for humanoid figures** —
it sits on top of `api.sdf` and removes the three things that make hand-built
figures fail:

1. **No coordinate guessing.** Every joint and facial landmark comes from a
   deterministic **rig** — you never hand-type `[-4.5, 0, 42]` for a shoulder.
2. **No floating-part splits.** Limbs span `jointA → jointB`, so parts always
   overlap. The "`componentCount 2 > 1`" failure is structurally impossible.
3. **Localized blend.** Soft body joins (`figure.weld`) vs sharp face creases
   (`figure.face.assemble`) — not one uniform `k` that melts or glues.

Target aesthetic: a **stylized figurine** (art-toy / smooth posable mannequin).
It is not a photoreal-human generator — lean into the clean, simplified look.

> Coordinate convention (same as ai.md): **front = −Y**, **Z up**, figure's
> **left = +X**, right = −X. Sides are suffixed `L` / `R`.

## The one pattern

Build a **rig**, build **parts** off it, **weld** the body, **label** regions,
hard-union with clothes/hair/base, `.build()`:

```js
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — proportions + pose. Everything below derives from this.
const rig = F.rig({
  height: 60,          // total height, sole → crown
  headsTall: 5,        // master stylization knob (≈3 chibi, 5 child, 7.5 adult)
  build: 'average',    // 'slim' | 'average' | 'stocky'
  pose: {
    armR: { abduct: 92, elbow: 5 },     // right arm straight out to the side
    armL: { abduct: 78, elbow: 115 },   // left arm flexing the bicep
    legL: { abduct: 9 }, legR: { abduct: 9 },
    head: { turn: -12, tilt: -6 },
  },
});

// 2. HEAD + FACE — face features read rig.face anchors (no coords).
// Keep eyes OUT of the assemble (they get their own paint label in step 4).
const head = F.head(rig);
const face = F.face.assemble(head, rig, { eyes: false, mouth: { smirk: 0.4 } });

// 3. SKIN — weld the major masses with one soft k.
const skin = F.weld(rig, [
  F.torso(rig), F.neck(rig),
  F.arms(rig), F.hands(rig, { grip: 'fist' }),
  F.legs(rig), F.feet(rig),
  face,
]).label('skin');

// 4. EYES — hard-unioned at the TOP level with their own label, so they can
// be painted white/black separately from the skin.
const eyes = F.face.eyes(rig).label('eyes');

// 5. CLOTHES + HAIR + BASE — derived from the same rig, so they always fit.
const pants = F.clothing.pants(rig, { leg: 'cargo', rise: 'low' }).label('pants');
const hair  = F.hair(rig, { style: 'long' }).label('hair');
const base  = F.base(rig).label('base');

// 6. Hard-union the labelled regions and build. `detail: [F.faceDetail(rig)]`
// meshes the head finely (smooth carved smile, round eyes) while the body
// keeps the cheap 0.5 grid — always include it when the figure has a face.
return sdf.union(skin, eyes, pants, hair, base)
  .build({ edgeLength: 0.5, detail: [F.faceDetail(rig)] });
```

Then paint by label from a follow-up tool call:

```js
partwright.paintByLabels([
  { label: 'skin',  color: [0.95, 0.78, 0.66] },
  { label: 'eyes',  color: [0.98, 0.98, 0.98] },
  { label: 'pants', color: [0.15, 0.18, 0.35] },
  { label: 'hair',  color: [0.45, 0.26, 0.13] },
  { label: 'base',  color: [0.3, 0.3, 0.3] },
]);
```

## `figure.rig(opts)` — the rig

```js
F.rig({
  height,      // number, total world height (default 60)
  headsTall,   // 2..12, head-count proportion (default 6). LOWER = bigger head.
  build,       // 'slim' | 'average' | 'stocky' — limb/torso thickness
  pose: {      // all optional; neutral standing defaults
    arms, legs, // SYMMETRIC shorthand — seeds BOTH sides at once (see below)
    armL, armR, // { abduct, flex, elbow, twist }   degrees — override per side
    legL, legR, // { abduct, flex, knee, twist }    degrees
    head,       // { turn, tilt, nod }
    spine,      // { lean, turn, side }
  },
})
```

**Symmetric shorthand:** `pose.arms` / `pose.legs` set BOTH sides at once;
`armL`/`armR` (`legL`/`legR`) override a single side. Use it for any symmetric
pose so you can't introduce an accidental L/R asymmetry:

```js
pose: { arms: { abduct: 95, elbow: 95, twist: 90 } }          // both arms, double-biceps
pose: { arms: { abduct: 90 }, armL: { abduct: 0 } }           // right arm out, left down
```

**Pose angles (degrees), zero = neutral standing:**

| Joint param | Meaning |
|---|---|
| `arm*.abduct` | raise arm sideways: 0 = hangs down, 90 = straight out, 180 = up |
| `arm*.flex` | swing arm forward −Y (+) / back +Y (−) at the shoulder |
| `arm*.elbow` | bend the forearm (0–160) — a bicep curl in the forearm-roll plane |
| `arm*.twist` | **roll the elbow-curl plane** about the upper-arm axis. 0 = curl forward. **For a raised arm, `twist ≈ 90` curls the fist UP** (double-biceps, ballet fifth, victory). Without it, a side-raised arm only curls backward — see recipe below. |
| `leg*.abduct` | spread the leg sideways (stance width) |
| `leg*.flex` | step the leg forward −Y (+) / back +Y (−) at the hip |
| `leg*.knee` | bend the shank toward the back +Y (0–150) |
| `head.turn` | yaw (look figure-left +/right −) |
| `head.tilt` | tip toward a shoulder |
| `head.nod` | look down (+) / up (−) |

> **Arms-overhead / fists-up poses need `twist`.** Elbow flexion alone curls the
> forearm *forward*; once the arm is raised to the side that "forward" points
> *backward*, so `elbow` by itself can't put the fist up by the head. Add
> `twist ≈ 90`: e.g. double-biceps is `arms: { abduct: 95, elbow: 95, twist: 90 }`;
> a rounded ballet-fifth "O" overhead is roughly `arms: { abduct: 150, elbow: 70, twist: 90 }`.

The rig exposes (read-only, for custom parts):
- `rig.joints.{shoulderL/R, elbowL/R, wristL/R, handL/R, hipL/R, kneeL/R,
  ankleL/R, pelvis, navel, chest, neckBase, headCenter, crown, chin}` — world `Vec3`.
- `rig.r.*` — radii / half-extents: `upperArm, foreArm, hand, thigh, shank,
  foot, neck, head, headX, headZ, chestX, chestY, pelvisX, pelvisY,` and
  **`waist`** (the garment-fitting radius at the natural waist — use this, not
  `pelvisX`, to size belts/skirts/tutus).
- `rig.dir.{headForward, headUp, headLeft, upperArmL/R, foreArmL/R, thighL/R,
  shankL/R}` — unit directions for orienting parts.
- `rig.face.{eyeL, eyeR, browL, browR, nose, mouth, earL, earR, chinTip}`.

**`build` scales every width:** `slim` ×0.82, `average` ×1.0, `stocky` ×1.22 —
so a `stocky` figure's `rig.r.upperArm` is 1.22× the average; size custom
accessories off `rig.r.*` and they track the build automatically.

## Parts — every builder takes `rig` first

```js
F.torso(rig)                  // chest + belly + pelvis masses, internally smooth
F.neck(rig)
F.arms(rig)                   // both arms: tapered limbs + deltoid caps
F.hands(rig, { grip })        // grip: 'fist' | 'open' | 'relaxed'
F.legs(rig)
F.feet(rig)
F.head(rig)                   // skull + jaw + cheeks (no features yet)
F.base(rig, { radius, thickness })   // flat disc under the feet (printability)
```

**`F.base` auto-sizes to the pose.** It widens to cover the stance footprint and
rises to meet the *lowest* foot, so a wide or lunging stance still lands one
foot on the base — keeping the whole welded figure one component. You rarely
need to pass `radius`/`thickness`. (Feet also *follow their ankle*, so a posed /
elevated leg never detaches the foot.)

**Snapping accessories to the rig — `F.placeAt`.** To put a hat on the crown, a
staff in a hand, a sword on a hip, etc., let `placeAt` handle the
center-vs-base offset instead of computing it by hand:

```js
const hat = sdf.cylinder(rig.r.head * 0.7, rig.r.head * 2).taper(-0.9, 'z');
const hatPlaced = F.placeAt(hat, rig.joints.crown, { anchor: 'bottom' }); // base sits on the crown
const staff = sdf.capsule([0,0,-20],[0,0,20], 0.5);
const staffPlaced = F.placeAt(staff, rig.joints.handR);                   // centered on the hand
```

`anchor` is `'bottom'` (min-Z point lands on the joint), `'top'`, or `'center'`
(default). **Weld accessories onto the figure** (small `smoothUnion`/`union`)
so they stay one printable piece — a staff floating next to the hand is a
second component.

## Face — reads `rig.face` anchors

```js
F.face.assemble(head, rig, {
  eyes:  true | { radius } | false,
  nose:  true | { tipRadius, length } | false,
  mouth: true | { style, width, smirk, open } | false,
  ears:  true | { size } | false,
  brows: { } | false,        // off by default; pass {} to add
})
```

`assemble` welds features onto the head with **small** `k` so the nose bridge
and ear margins stay crisp (vs the soft body weld), and **carves** the carved
mouth styles with a matching small `k`. Pass a feature key as `false` to skip
it, `true` for defaults, or an options object to tune it. The individual
builders (`F.face.eyes(rig)`, `.nose`, `.mouth`, `.ears`, `.brows`) are also
exposed if you want to place a feature yourself.

### Mouth styles

| `style` | What you get | Add or carve |
|---|---|---|
| `'smile'` (default) | a curved smile **line** carved into the face — the classic cartoon mouth. `smirk` (−1..1) skews it. | carve |
| `'open'` | an open mouth cavity (laughing / talking / singing). `open` (0..1) sets the gape; passing `open > 0` without a style selects this. | carve |
| `'lips'` | the protruding lip ridge (the pre-2026-06 default). | add |

```js
mouth: { smirk: 0.4 }                       // happy carved smile (default style)
mouth: { open: 0.7, width: rig.r.head*0.6 } // big laughing mouth
mouth: { style: 'lips', smirk: -0.3 }       // pouty sculpted lips
```

`F.face.mouth(rig, opts)` returns the mouth **geometry node**: for the carved
styles that's the *cutter* — `smoothSubtract` it from the head yourself, or
just let `assemble` handle the bookkeeping.

### Paintable eyes — the `eyes: false` + top-level-label pattern

Smooth-welded features can't carry their own paint label (labels turn smooth
blends into hard seams — see `/ai/sdf.md`), but eyes are a **hard** union, so
they can. Don't bury them inside the `'skin'` weld; lift them to the top-level
union with their own label, as in the pattern up top:

```js
const face = F.face.assemble(head, rig, { eyes: false, ... });  // no eyes here
const eyes = F.face.eyes(rig).label('eyes');                    // own region
return sdf.union(skin, eyes, hair, base).build({ ... });
```

Then `paintByLabels` can make them white/black/any color independently of the
skin. (Brows and `'lips'`-style mouths can use the same pattern if you want
them painted; the carved mouth styles need no paint at all.)

## Face detail — `F.faceDetail(rig)` (use it on every figure with a face)

Face features are far smaller than the body, so at the recommended figure grid
(`edgeLength 0.4–0.6`) they mesh as angular slabs. `F.faceDetail(rig)` returns
a `{ center, radius, edgeLength }` sphere covering the head, sized off
`rig.r.head`, for `.build()`'s `detail` option (see
`/ai/sdf.md#detail-regions`):

```js
return sdf.union(skin, eyes, hair, base)
  .build({ edgeLength: 0.5, detail: [F.faceDetail(rig)] });
```

The head meshes ~3× finer (smooth smile groove, round eye domes) while the
body keeps the cheap global grid — typically +30–60k triangles instead of the
~10× a globally fine grid would cost. For a final extra-fine pass, halve it:
`F.faceDetail(rig, { edgeLength: rig.r.head * 0.02 })`.

## Hair & clothing — derived from the rig, so they always fit

```js
F.hair(rig, { style })          // 'short' | 'long' | 'bun' | 'bald'
F.clothing.pants(rig, { rise, leg, cuffZ, thickness })  // rise: low|mid|high, leg: slim|cargo
F.clothing.top(rig, { sleeve, hemZ, thickness })        // sleeve: none|short|long
```

Clothing is the body region **inflated and trimmed** — it reuses the rig's
joints, so a garment can never drift off the limb it covers. Give each garment
its own `.label()` so it paints separately from skin.

> **The waist is `rig.joints.navel` (radius `rig.r.waist`), not the hips.** Hips
> (`rig.joints.hipL/hipR`) are the *leg-insertion* points and sit lower; a
> skirt/belt/tutu anchored there cuts through the thighs. Anchor waist garments
> at `navel` and size them off `rig.r.waist`. Example tutu:
> `sdf.cylinder(rig.r.waist * 3, rig.r.waist * 0.4).taper(0.5,'z').translate(rig.joints.navel).label('tutu')`.

## `figure.weld(rig, parts[], opts?)`

Smooth-welds the major body masses with one rig-derived soft `k` (≈8–10 % of the
thinner limb radius). Override with `{ k }` if joints look too glued (raise) or
too melted (lower). **`weld.k` controls the part-to-part (torso↔limb↔head) joins
only** — within-limb smoothness (the elbow/knee bend) is fixed inside the limb
builders, so raising `weld.k` won't change a knee that looks kinked. **Label the result** (`.label('skin')`) so the whole welded
body is one paint region — labelling individual parts would degrade the welds to
hard seams (see `/ai/sdf.md` paint-by-label).

## Workflow that lands a likeness

1. **Block with the rig first.** Pick `height`, `headsTall`, `build`, and the
   pose. Render front + side + iso (`renderViews`) and check the *silhouette and
   pose* against the reference before any face detail.
2. **Match the pose with joint angles, not coordinates.** Arm out = `abduct 90`;
   flexing = `elbow 110–130`; sitting = `legs flex 90, knee 90`.
3. **Add the face via `face.assemble`** (with `eyes: false` + a top-level
   labelled `F.face.eyes(rig)`), then hair and clothes — all off the same rig.
4. **Weld, label, union, build.** `edgeLength: 0.4–0.6` is a good figure
   default — and always pass `detail: [F.faceDetail(rig)]` so the face meshes
   finely. Don't drop the global edgeLength for face quality; that's what the
   detail region is for.
5. **Judge against the reference**, not just `isManifold`. Resemblance is the
   success criterion; `componentCount === 1` + manifold is necessary, not
   sufficient.

## Gotchas

- **Don't label individual parts you want welded together** — label the welded
  result. Labels turn smooth blends into hard seams (this is the SDF paint
  trade-off, not a figure-specific quirk).
- **Pose, don't translate.** Re-pose a limb with `arm*.abduct/flex/elbow`, not by
  translating the part afterward — translating breaks the joint overlap that
  keeps the figure one component.
- **`headsTall` is the stylization dial.** Want a cuter/chibi figure? Lower it
  (3–4). Want a lankier hero? Raise it (7–8). It rescales the whole figure
  coherently.
- **Front faces −Y.** For a catalog thumbnail (camera at the +X/−Y corner) the
  default front already points the right way; use `head.turn` for a 3/4 look.
- Everything is plain `api.sdf` underneath, so you can still `smoothUnion` your
  own extra primitives (a hat, a sword, wings) onto the welded body.
