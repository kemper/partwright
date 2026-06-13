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
    armR: { raiseSide: 92, bend: 5 },     // right arm straight out to the side
    armL: { raiseSide: 78, bend: 115 },   // left arm flexing the bicep
    legL: { raiseSide: 9 }, legR: { raiseSide: 9 },
    head: { yaw: -12, roll: -6 },
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

// 4. EYES — hard-unioned at the TOP level. The default 'iris' style labels
// itself ('eyes' white + 'iris' + 'pupil') — do NOT add .label() on top.
const eyes = F.face.eyes(rig);

// 5. CLOTHES + HAIR + BASE — derived from the same rig, so they always fit.
const pants = F.clothing.pants(rig, { leg: 'cargo', rise: 'low' }).label('pants');
const hair  = F.hair(rig, { style: 'long' }).label('hair');
const base  = F.base(rig).label('base');

// 6. Hard-union the labelled regions and build. `detail: F.faceDetail(rig)`
// meshes the head finely (smooth carved smile, round eyes) while the body
// keeps the cheap 0.5 grid — always include it when the figure has a face.
return sdf.union(skin, eyes, pants, hair, base)
  .build({ edgeLength: 0.5, detail: F.faceDetail(rig) });
```

Then paint by label from a follow-up tool call:

```js
partwright.paintByLabels([
  { label: 'skin',  color: [0.58, 0.34, 0.20] },   // pick from the FULL range — see Diversity below
  { label: 'eyes',  color: [0.97, 0.96, 0.94] },   // white of the eye
  { label: 'iris',  color: [0.29, 0.20, 0.13] },
  { label: 'pupil', color: [0.11, 0.11, 0.11] },
  { label: 'pants', color: [0.15, 0.18, 0.35] },
  { label: 'hair',  color: [0.10, 0.08, 0.07] },
  { label: 'base',  color: [0.3, 0.3, 0.3] },
]);
```

> **Skin tone is a deliberate choice, not a default.** The geometry is colourless
> until you paint it, so there is **no** default skin colour — *you* pick one, and
> the whole human range is equally valid. Don't reflexively reach for a light
> peach. `F.skin(name)` gives a curated ramp to choose from (`'porcelain'` →
> `'ebony'`, twelve stops): `api.paint.label('skin', F.skin('umber'))`, or
> `F.skin()` for the whole `{name: hex}` map. See [Diversity](#diversity--vary-the-whole-figure).

## `figure.rig(opts)` — the rig

```js
F.rig({
  height,      // number, total world height (default 60)
  headsTall,   // 2..12, head-count proportion (default 6). LOWER = bigger head.
  build,       // 'slim' | 'average' | 'stocky' — limb/torso thickness
  sex,         // 'neutral' (default) | 'male' | 'female' — silhouette balance
  pose: {      // all optional; neutral standing defaults
    arms, legs, // SYMMETRIC shorthand — seeds BOTH sides at once (see below)
    armL, armR, // { raiseSide, raiseFwd, bend, twist }   degrees — override per side
    legL, legR, // { raiseSide, raiseFwd, bend, twist }   degrees
    head,       // { yaw, pitch, roll }
    spine,      // { lean, turn, side }
  },
})
```

> **`headsTall` rescales the WHOLE figure coherently.** Every girth (shoulders,
> chest, waist, hips, limb thickness) is measured in **head-units** (the artistic
> "heads tall" canon, e.g. Loomis), so a low `headsTall` gives a chunky big-headed
> chibi and a high one a lean, small-headed adult — automatically, at any value.
> `headsTall` 6 is the calibrated default; ≈3 chibi, ≈7.5 adult.

> **`sex` shifts the silhouette along the same canon, independent of `build`.**
> `'male'` widens the shoulders and narrows the waist/hips; `'female'` narrows the
> shoulders and widens the hips with a smaller waist-to-hip ratio (the hourglass).
> `'neutral'` (default) sits between them. `build` (overall thickness) composes on
> top, so e.g. `{ sex: 'female', build: 'stocky' }` is a sturdy hourglass.

**Symmetric shorthand:** `pose.arms` / `pose.legs` set BOTH sides at once;
`armL`/`armR` (`legL`/`legR`) override a single side. Use it for any symmetric
pose so you can't introduce an accidental L/R asymmetry:

```js
pose: { arms: { raiseSide: 95, bend: 95, twist: 90 } }          // both arms, double-biceps
pose: { arms: { raiseSide: 90 }, armL: { raiseSide: 0 } }           // right arm out, left down
```

**Pose angles (degrees), zero = neutral standing.** The DOF vocabulary is plain
language: limbs take `raiseSide` (lift sideways), `raiseFwd` (swing forward/back),
`bend` (elbow/knee flexion), and `twist` (axial roll); the head takes `yaw`,
`pitch`, and `roll`. e.g. `armL: { raiseSide: 90, bend: 110 }`. These are the
only accepted names — an unknown key throws (see the Naming policy below).

| Joint param | Meaning |
|---|---|
| `arm*.raiseSide` | raise arm sideways: 0 = hangs down, 90 = straight out, 180 = up |
| `arm*.raiseFwd` | swing arm forward −Y (+) / back +Y (−) at the shoulder |
| `arm*.bend` | bend the forearm (0–160) — an anatomical curl: a hanging arm brings the fist forward and up |
| `arm*.twist` | **roll the elbow-curl plane** about the upper-arm axis. 0 = curl forward (−Y). **For a raised arm, `twist ≈ 90` curls the fist UP** (double-biceps, ballet fifth, victory) — see recipe below. |
| `leg*.raiseSide` | spread the leg sideways (stance width) |
| `leg*.raiseFwd` | step the leg forward −Y (+) / back +Y (−) at the hip |
| `leg*.bend` | bend the shank toward the back +Y (0–150) |
| `leg*.twist` | **hip turnout** — yaw the foot OUT (toe toward +X on the left, −X on the right) and roll a bent-knee plié outward. 0 = toes forward; `legs: { twist: 30 }` is a relaxed turnout, ~`45–60` a ballet first/fifth. |
| `head.yaw` | yaw (look figure-left +/right −) |
| `head.roll` | roll the head toward a shoulder (+ = toward the figure's LEFT shoulder) |
| `head.pitch` | look down (+) / up (−) |
| `spine.lean` | bend the upper body forward −Y (+) / back +Y (−) at the waist |
| `spine.side` | lean the upper body toward the figure's LEFT (+) / right (−) shoulder |
| `spine.turn` | twist the shoulders/upper body toward figure-left (+) / right (−) |

> **`spine.{lean,side,turn}` bend the whole upper body at the waist** — chest,
> neck, head, and both arms rotate together about the navel while the legs stay
> planted. Use it for a bow, a slouch, a weight shift, or a contrapposto twist
> (combine with `head.*` to counter-rotate the gaze). `head.roll` rolls only the
> head; `spine.side` leans the whole torso.

> **Arms-overhead / fists-up poses need `twist`.** `bend` alone curls the
> forearm *forward* (toward −Y); for a side-raised arm that plane is horizontal,
> so `bend` by itself can't put the fist up by the head. Add `twist ≈ 90`:
> e.g. double-biceps is `arms: { raiseSide: 95, bend: 95, twist: 90 }`;
> a rounded ballet-fifth "O" overhead is roughly `arms: { raiseSide: 150, bend: 70, twist: 90 }`.

> **Naming policy — one canonical vocabulary.** Poses use `raiseSide` / `raiseFwd`
> / `bend` / `twist` (head: `yaw` / `pitch` / `roll`); joints, radii, and
> directions use the VRM/Unity humanoid bone names (`upperArm`, `lowerArm`,
> `upperLeg`, `lowerLeg`, `hips`, `spine`, …). There are **no legacy aliases** —
> the older biomechanical names (`abduct`/`flex`/`elbow`/`knee`; `shoulder`/`hip`/
> `ankle`/`pelvis`/`navel`) are retired and an unknown key throws.

The rig exposes (read-only, for custom parts):
- `rig.joints.{upperArmL/R, lowerArmL/R, wristL/R, handL/R, upperLegL/R, lowerLegL/R,
  footL/R, hips, spine, chest, neck, head, crown, chin}` — world `Vec3`. Names follow
  the VRM/Unity humanoid skeleton (the single canonical vocabulary).

> **The rig names JOINTS (points between bones), in VRM/Unity humanoid terms.** A
> joint is the bone's ROOT point: `upperArmL` is the **glenohumeral joint** where
> the upper-arm bone starts (NOT the clavicle, which VRM confusingly calls the
> "shoulder" bone). `wristL` is the forearm end; `handL` is the hand-mass centre
> (use it — and `rig.grip` — for held props, not `wristL`). `footL` is the
> ankle/foot attach point.
- `rig.r.*` — radii / half-extents: `upperArm, lowerArm, hand, upperLeg, lowerLeg,
  foot, neck, head, headX, headZ, chestX, chestY, hipsX, hipsY,` and
  **`waist`** (the garment-fitting radius at the natural waist — use this, not
  `hipsX`, to size belts/skirts/tutus).
- `rig.dir.{headForward, headUp, headLeft, upperArmL/R, lowerArmL/R, elbowHingeL/R,
  upperLegL/R, lowerLegL/R, footL/R}` — unit directions for orienting parts (`footL/R`
  is the foot heading, yawed by `leg*.twist` turnout).
- `rig.grip.{L,R}` — **a full grip frame per hand, for connecting HELD props**
  (guitar neck, sword, staff, mug). Each has `{ point, palmNormal, gripAxis, reach }`:
  - `point` — the grip **cup** where a held cylinder's axis rests. This is **NOT**
    `joints.handL/R` (the hand *centre*): it's offset toward the palm, so a prop
    aimed here sits *in* the closed fingers instead of passing *through* the hand.
    Aim a held bar's contact line at `point`, not at `handL/R`.
  - `gripAxis` — unit axis a gripped bar lies **along** (finger-splay, pinky→index).
    A guitar neck / staff / sword grip runs parallel to this.
  - `palmNormal` — unit normal the palm faces (fingers curl toward it).
  - `reach` — unit forearm/finger direction.
- `rig.face.{eyeL, eyeR, browL, browR, nose, mouth, earL, earR, chinTip}`.

**`build` scales every width:** `slim` ×0.82, `average` ×1.0, `stocky` ×1.22 —
so a `stocky` figure's `rig.r.upperArm` is 1.22× the average; size custom
accessories off `rig.r.*` and they track the build automatically.

## Parts — every builder takes `rig` first

```js
F.torso(rig)                  // chest + belly + pelvis masses, internally smooth
F.neck(rig)
F.arms(rig)                   // both arms: tapered limbs + deltoid caps
F.hands(rig, { grip })        // grip: 'fist' | 'open' | 'relaxed' — sculpted 3-finger+thumb
F.legs(rig)
F.feet(rig)
F.head(rig, { faceShape, jaw, chin, cheek })  // skull + jaw + cheeks (no features yet)
F.base(rig, { radius, thickness })   // flat disc under the feet (printability)
```

**Hands are sculpted by default — pair them with `detail: F.handDetail(rig)`.**
Every grip builds a stylized three-finger + thumb hand (`open` splays straight
fingers, `relaxed` curls them toward the palm, `fist` is a ball with knuckle
ridges and a folded thumb). The fingers are finer than the recommended 0.4–0.6
figure grid, so add the hand detail spheres to the build or they alias away:

```js
.build({ edgeLength: 0.5, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] })
```

Pass `fingers: false` for the legacy mitten/paddle hands (no detail region
needed). The hand frame derives from the rig (fingers extend along the
forearm, palm faces the elbow-curl direction), so posed arms keep correct
hands automatically.

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

**Seating headwear ON the hair — `F.placeOnHead(node, rig, opts?)`.** `placeAt`
snaps to the *skull* crown joint, so a hat/crown placed there **embeds in the
hair** (the hair adds volume above the skull). `placeOnHead` is the headwear
analog of the hand grip frame: pass the **hair** as `opts.rest` and it rests the
accessory's bbox `anchor` (default `'bottom'`) on the TOP of the hair, centred on
the head. `clearance` floats it above; `embed` sinks it in a little so it welds
into one printable piece. Build the accessory **centred on the origin** (ring in
the z=0 plane, spikes up), then place it:

```js
const hair = F.hair(rig, { style: 'long' }).label('hair');
// coronet built at the origin; size the ring near the hair radius so it welds
const crown = F.placeOnHead(coronet, rig, { rest: hair, embed: rig.r.head * 0.4 }).label('crown');
```

Without `rest` it falls back to `rig.joints.crown` (the bare skull apex). A ring
sized to the skull sits *inside* the larger hair volume — keep the ring small
(a coronet on top) or grow it toward the hair radius so the band straddles the
hair surface and welds (a band tangent to the surface prints as a second
component).

**Putting a prop INTO a hand — `F.holdAt(prop, rig.grip.L|R, opts?)`.** `placeAt`
only positions; `holdAt` also **orients** a prop to the grip and seats it in the
finger cup. Build the prop centred at the origin with its long axis along local
`+Z`, and `holdAt` aligns that axis to `gripAxis` and drops the origin on the
grip `point`:

```js
// A wand/baton/sword grip, held in the right hand pointing along the fingers:
const wand = sdf.capsule([0,0,-8],[0,0,8], 0.4);
const held = F.holdAt(wand, rig.grip.R);        // axis → gripAxis, origin → grip cup
```

`opts.along` (`'x'|'y'|'z'`, default `'z'`) says which local axis is the prop's
length; `opts.flip: true` reverses it.

**Two-handed props — `F.spanGrips(a, b)`.** A guitar, barbell, bow, broom, or
rifle runs BETWEEN both hands, so a single `holdAt` can't orient it. `spanGrips`
is the two-anchor frame: pass two grips (or any two points) and it returns the
geometry of the line spanning them, so the bar is a one-liner and anything
growing off an end keys off the same axis:

```js
const s = F.spanGrips(rig.grip.L, rig.grip.R);   // {a, b, axis, length, mid}
const bar = sdf.capsule(s.a, s.b, 0.5);          // runs cup-to-cup, no crooked tilt
// plates/headstock past an end: s.b + s.axis*ext  ·  centre a prop on s.mid
```

`a`/`b` are the endpoints (each grip's `point`, or a raw `[x,y,z]`), `axis` is
the unit direction `a→b`, `length` the distance, `mid` the midpoint. Aiming at
the grip `point` (not `handL/R`) is what stops the bar passing through a hand.
`figure_rocker.js` builds its guitar neck + headstock on `spanGrips`;
`figure_staff_mage.js` seats a single-hand staff with `holdAt`.

**Reading a pose — `F.poseProbe(rig)`.** Returns a deterministic, rounded dump
of every world joint position, both grip frames, and the key directions, plus a
`.text` summary — use it instead of hand-rolled `JSON.stringify` probes when
tuning a pose. `throw new Error(F.poseProbe(rig).text)` (or `console.log` it)
prints the whole readout so you can read where a hand/grip actually landed
before aiming a prop at it.

## Face — reads `rig.face` anchors

```js
F.face.assemble(head, rig, {
  eyes:  true | { radius } | false,   // OFF by default — see note below
  nose:  true | { tipRadius, length, width, bridge, flare } | false,
  mouth: true | { style, width, smirk, open, fullness } | false,
  ears:  true | { size } | false,
  brows: { thickness, lift } | false, // off by default; pass {} or a tuning object to add
})
```

### Head shape — `F.head(rig, { faceShape, jaw, chin, cheek })`

The skull/jaw/cheekbones are the **first** axis of facial variety — vary them
before the features. `F.head` takes an options object (omit it for the neutral
oval head — existing figures are unchanged):

| Key | Effect |
|---|---|
| `faceShape` | `'oval'` (default) · `'round'` · `'square'` · `'long'` · `'heart'` · `'diamond'` — preset skull/jaw/cheek proportions |
| `jaw` | 0.5–1.6 jaw **width** (narrow tapered ↔ strong square jaw) |
| `chin` | 0.5–1.6 chin **length / projection** (soft receded ↔ long prominent) |
| `cheek` | 0.3–1.8 **cheekbone** prominence (flat ↔ high sculpted) |

The explicit knobs multiply **on top of** the preset, so `{ faceShape: 'square', jaw: 1.1 }` stacks.

### Nose & lips — strong variation axes

- **`nose.width`** (0.4–2.2) widens the tip + alae; **`nose.bridge`** (0.3–1.5)
  is the nasal-bridge projection — a **low** value (~0.5) reads broad and flat, a
  **high** value (~1.4) thin and prominent; **`nose.flare`** (0–1.5) adds nostril
  wings. (`tipRadius`/`length` unchanged.) These three vary the nose far more than
  size alone — e.g. `{ width: 1.4, bridge: 0.6, flare: 1.0 }` vs `{ width: 0.8, bridge: 1.3 }`.
- **`mouth.fullness`** (0.4–2.2) scales lip thickness independently of `width`
  (works on the `'lips'` ridge and the open-mouth lip ring).

> **Eyes default to OFF in `assemble`.** The recommended flow welds the face into
> the body and `.label('skin')`s it — which would flatten any in-face eyes into
> the skin region (their `eyes`/`iris`/`pupil` labels would resolve to **0
> paintable triangles**). So build eyes at the **top level** instead —
> `sdf.union(skin, F.face.eyes(rig), …)` — and only pass `eyes: true` to
> `assemble` when you are *not* re-labelling the result.

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
| `'open'` | an open mouth cavity (laughing / talking / singing). `open` (0..1) sets the gape; passing `open > 0` without a style selects this. Pair it with `mouthAccents` for teeth + lips. | carve |
| `'lips'` | a protruding lip ridge. | add |

```js
mouth: { smirk: 0.4 }                       // happy carved smile (default style)
mouth: { open: 0.7, width: rig.r.head*0.6 } // big laughing mouth
mouth: { style: 'lips', smirk: -0.3 }       // pouty sculpted lips
```

`F.face.mouth(rig, opts)` returns the mouth **geometry node**: for the carved
styles that's the *cutter* — `smoothSubtract` it from the head yourself, or
just let `assemble` handle the bookkeeping.

### Teeth & painted lips — `F.face.mouthAccents(rig, mouthOpts)`

Pre-labelled solid parts that complement the mouth. Build them from the **same
options object** you passed as `mouth:` so they always agree with the carve,
and hard-union them at the figure's TOP level (next to the eyes):

```js
const mouthOpts = { style: 'open', open: 0.65, width: rig.r.head * 0.6 };
const face = F.face.assemble(head, rig, { eyes: false, mouth: mouthOpts });
const mouthParts = F.face.mouthAccents(rig, mouthOpts);  // 'teeth' + 'lips'
return sdf.union(skin, eyes, mouthParts, hair, base).build({ ... });
```

- `'open'` style: a **`'teeth'`** band hanging from the cavity ceiling and a
  **`'lips'`** capsule ring around the opening (disable with `teeth: false` /
  `lips: false`).
- `'lips'` style: the ridge labelled `'lips'` — in this case pass
  `mouth: false` to `assemble` (a smooth-welded copy would swallow the
  labelled one).
- `'smile'` has no accents — the carved line needs no paint.

### Eyes — `style: 'iris'` (default) or `'solid'`

```js
F.face.eyes(rig)                              // white + 'iris' + 'pupil', SELF-labelled
F.face.eyes(rig, { style: 'solid' }).label('eyes')   // one-colour bead eyes
```

The default **`'iris'`** style builds white eyeball domes with a coloured iris
disc and black pupil dot, pre-labelled `'eyes'` / `'iris'` / `'pupil'` — do
**not** wrap it in `.label()` (the outer label wins and flattens the eye to
one colour). `'solid'` returns plain spheres for you to label.

The eyeball stays a **perfectly round white dome**; the iris (≈ 0.55·eyeRadius)
and pupil (≈ 0.27·eyeRadius) are **painted on as flush concentric discs**, not
raised lenses — so they read as recognizable centred eyes from the front
without protruding as beads. (Each disc is a deep plug clipped to a sphere a
hair larger than the eyeball, so its face follows the eyeball's curvature and
wins the union over its disc with no visible bump.) Colour them by their labels
(white sclera, mid iris, black pupil). Give the build `detail: F.faceDetail(rig)`
so the iris/pupil disc edges mesh crisply.

Either way, keep eyes OUT of the skin weld (`eyes: false` in `assemble`) and
hard-union them at the top level — smooth-welded features can't carry paint
labels, and an eye buried under the cheek welds resolves to a label with zero
paintable triangles. The eyeballs are pushed forward so the domes always
protrude. (Brows can use the same top-level pattern if you want them painted.)

## Face detail — `F.faceDetail(rig)` (use it on every figure with a face)

Face features are far smaller than the body, so at the recommended figure grid
(`edgeLength 0.4–0.6`) they mesh as angular slabs. `F.faceDetail(rig)` returns
`{ center, radius, edgeLength }` spheres — one covering the head, a finer one
over the mouth groove, and an extra-fine one over each eyeball front — for
`.build()`'s `detail` option (see `/ai/sdf.md#detail-regions`):

```js
return sdf.union(skin, eyes, hair, base)
  .build({ edgeLength: 0.5, detail: F.faceDetail(rig) });
```

The head meshes ~3× finer (smooth smile groove) and the eyes finer still, so the
iris/pupil circles tessellate round instead of faceting into polygons — while
the body keeps the cheap global grid. Typically +30–60k triangles instead of the
~10× a globally fine grid would cost. Override per region:
`F.faceDetail(rig, { edgeLength: rig.r.head * 0.02, eyeEdgeLength: rig.r.head * 0.006 })`.

## Hair & clothing — derived from the rig, so they always fit

```js
F.hair(rig, { style, hairline, length, volume, part, texture })
//   style: 'short' | 'long' | 'bob' | 'bun' | 'bald' | 'bangs' | 'ponytail'
//          | 'afro' | 'braids' | 'spiked' | 'locs' | 'cornrows' | 'boxBraids'
//   hairline: 'high' | 'mid' | 'low' — where the face window's top edge sits.
//   'bangs' adds a straight fringe and defaults to 'low' (hair to the brows);
//   'ponytail'/'braids' add tails down the back; 'bob' frames the jaw; 'afro'
//   puffs a textured sphere around the skull; 'spiked' radiates anime spikes;
//   'locs' hangs rope strands all round (thicker, fewer); 'boxBraids' hangs
//   many thin braids; 'cornrows' lays raised braided rows tight to the scalp
//   with carved partings between them (front hairline → crown → nape puff).
//   length: 'short' | 'mid' (default) | 'long' — how far tails/manes/locs fall.
//   volume: 0.3..4 (default 1) — puffs the cap + tail girth (afro wants 1.5+).
//   part: 'none' (default) | 'left' | 'right' | 'center' — a shallow part groove.
//   texture: 'none' | 'strands' | 'curls' | 'coils' | 'wavy' — physical relief
//     displaced into the surface (the print-native hair-texture analog; real
//     geometry, not a screen shader). 'coils' is the tight springy 4c look —
//     usable on ANY style (e.g. a coily 'short' crop or 'afro'). 'afro'/'locs'
//     default to a fitting relief, the classic styles stay smooth. Mesh fine
//     enough (edgeLength ≤ ~0.4, faceDetail on the head) or the relief aliases
//     away; thin 'boxBraids' want edgeLength ≤ ~0.35 so the strands don't break.
F.clothing.pants(rig, { rise, leg, cuffZ, thickness, length })
//   rise: low|mid|high · leg: slim|cargo · length: 'full' (default) | 'briefs'
//   'briefs' = seat + gusset + hip coverage only (leotard bottoms, swimwear,
//   trunks) — union it into a top and label the pair as one garment.
F.clothing.top(rig, { sleeve, hemZ, thickness })        // sleeve: none|short|long
//   hemZ below the pelvis turns the top into a robe/dress: a flared skirt
//   cone is added down to the hem so legs stay covered all round.
```

Clothing is the body region **inflated and trimmed**, and **coverage is
guaranteed by construction**: under the shaped garment sits the actual body
mass, offset outward by the garment `thickness` and clipped to the garment zone.
A body can't poke through its own offset, so there are **no bare-skin patches** —
the spots that used to escape (flexed-hip and knee weld bulges, the sternum V,
the armpit wedge) are filled automatically. The shaped shell on top still gives
the silhouette and follows the **posed** bones (pant legs track each leg's own
hip→knee→ankle chain; `cuffZ` is projected onto the bone, so a lunge's diagonal
shank keeps its cuff at the ankle). Raise `thickness` for a bulkier, looser
garment; lower it for a skin-tight one. Hair carves out a **face window** (an
above-the-brow hairline), so it never bleeds through carved mouths or face
features. Give each garment its own `.label()` so it paints separately from skin.

> **The waist is `rig.joints.spine` (radius `rig.r.waist`), not the hips.** The
> leg roots (`rig.joints.upperLegL/upperLegR`) are the *leg-insertion* points and
> sit lower; a skirt/belt/tutu anchored there cuts through the thighs. Anchor
> waist garments at `spine` and size them off `rig.r.waist`. Example tutu:
> `sdf.cylinder(rig.r.waist * 3, rig.r.waist * 0.4).taper(0.5,'z').translate(rig.joints.spine).label('tutu')`.

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
2. **Match the pose with joint angles, not coordinates.** Arm out = `raiseSide 90`;
   flexing = `bend 110–130`; sitting = `legs raiseFwd 90, bend 90`.
3. **Add the face via `face.assemble`** (with `eyes: false` + a top-level
   labelled `F.face.eyes(rig)`), then hair and clothes — all off the same rig.
4. **Weld, label, union, build.** `edgeLength: 0.4–0.6` is a good figure
   default — and always pass `detail: F.faceDetail(rig)` so the face meshes
   finely. Don't drop the global edgeLength for face quality; that's what the
   detail region is for.
5. **Judge against the reference**, not just `isManifold`. Resemblance is the
   success criterion; `componentCount === 1` + manifold is necessary, not
   sufficient.

## Diversity — vary the whole figure

People are not one default body with a tinted skin swatch. When you build a
person — and *especially* when you build several — vary the axes **together and
independently**, so the set looks like a real crowd rather than one model
recoloured:

- **Skin tone** spans the full range. There is no default; choose deliberately
  from `F.skin('porcelain' … 'ebony')` (or any RGB). Don't default to peach.
- **Face shape** — `F.head(rig, { faceShape })` across oval / round / square /
  long / heart / diamond, plus `jaw` / `chin` / `cheek`.
- **Nose** — `width` / `bridge` / `flare`. A broad low-bridge nose and a narrow
  high-bridge nose are different *people*, not the same face shaded darker.
- **Lips** — `mouth.fullness`.
- **Hair** — match texture and style to the person: `coils`/`afro`/`locs`/
  `cornrows`/`boxBraids` are first-class, not edge cases. Any hair texture works
  on any skin tone.
- **Body** — `build` (slim/average/stocky), `sex`, `headsTall`.

> **Vary the axes independently — don't bundle them into a stereotype.** A dark
> skin tone does not imply a particular nose, hair, or build, and vice versa.
> The point is *range*: mix the axes freely (a light-skinned figure with coily
> hair, a deep-skinned figure with a narrow nose and straight hair, etc.). Treat
> every combination as ordinary.

## Gotchas

- **Don't label individual parts you want welded together** — label the welded
  result. Labels turn smooth blends into hard seams (this is the SDF paint
  trade-off, not a figure-specific quirk).
- **Pose, don't translate.** Re-pose a limb with `arm*.raiseSide/raiseFwd/bend`, not by
  translating the part afterward — translating breaks the joint overlap that
  keeps the figure one component.
- **`headsTall` is the stylization dial.** Want a cuter/chibi figure? Lower it
  (3–4). Want a lankier hero? Raise it (7–8). It rescales the whole figure
  coherently.
- **Front faces −Y.** For a catalog thumbnail (camera at the +X/−Y corner) the
  default front already points the right way; use `head.yaw` for a 3/4 look.
- Everything is plain `api.sdf` underneath, so you can still `smoothUnion` your
  own extra primitives (a hat, a sword, wings) onto the welded body.
