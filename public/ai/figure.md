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

## Shortcut: `buildCharacter(spec)` / the 🧍 Character panel

For a **standard humanoid** (body proportions, pose, face, hair, clothing,
colours) you don't have to hand-write the recipe below — there's a no-code
**Character Creator** panel (Tools ▸ 🧍 Character, or the command palette) whose
console twin is `partwright.buildCharacter(spec, { save })`. It generates exactly
the kind of code shown below from a plain spec object and (with `save: true`)
commits a version. The spec mirrors this API: `{ body:{height, headsTall, build,
sex, age, weight, muscle, bust, belly}, pose:{preset, armL/armR/legL/legR:{raiseSide,
raiseFwd, bend, twist}, spine, head}, face:{shape, lids, gaze, nose, expression,
lipShape, ears, brows}, hair:{style, length, volume}, clothing:{top, pants, feet},
colors:{…}, base }` — every field falls back to a sensible default, so a partial
patch works (`buildCharacter({ body:{ sex:'female' }, hair:{ style:'bun' } }, { save:true })`).
The generated code embeds the spec as a `// @character` header so the panel can
re-open it. Reach for the **hand-written recipe below** when you need anything
the spec doesn't cover (props, accessories, custom geometry, multi-figure scenes).

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
  age,         // years, 1..90 (default 25). Shifts torso girth (baby/child/old).
  weight,      // 0..1 (default 0.5 = average; 0 = lean, 1 = heavy)
  muscle,      // 0..1 (default 0 = smooth; ~0.5 athletic, 1 = bodybuilder)
  bust,        // 0..2 chest mound (default 0; sex:'female' pre-fills ~0.35). Independent of sex.
  belly,       // 0..2 abdominal/pregnancy swell (default 0; ~0.5 tummy, ~0.7-1 pregnant). A dress/top drapes over it automatically.
  pose: {      // all optional; neutral standing defaults
    arms, legs, // SYMMETRIC shorthand — seeds BOTH sides at once (see below)
    armL, armR, // { raiseSide, raiseFwd, bend, twist, palm | thumb, roll }   degrees — override per side
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

> **`sex`, `age`, and `weight` reshape the torso girth — and compose.** They
> multiply per-region multipliers (shoulder / chest / waist / hip) onto the
> head-unit widths, on top of `build` (overall thickness). At the defaults
> (`sex:'neutral'`, `age:25`, `weight:0.5`) every multiplier is exactly 1, so an
> un-set figure is unchanged.
> - **`sex`** — `'male'` widens the shoulders and narrows the waist/hips;
>   `'female'` narrows the shoulders, widens the hips (smaller waist-to-hip ratio
>   = the hourglass), and **pre-fills a default `bust` (≈0.35)**; `'neutral'` sits
>   between. The bust itself is the separate `bust` knob (below), not baked into
>   `sex` — so you can dial it on any figure regardless of `sex`.
> - **`bust`** (0..2, default 0) — the chest-mound size, a *continuous* knob
>   kept deliberately **independent of `sex`** (set it on any figure; `sex:'female'`
>   only supplies a default when you omit it). The mound blends into the chest and
>   the areola/nipple landmarks ride its apex. See the bare-torso section below.
> - **`belly`** (0..2, default 0) — an abdominal swell for a **pregnant or
>   soft-bellied** figure (~0.5 a tummy, ~0.7–1 a pronounced pregnant bump). It
>   grows the abdomen **forward** (and modestly in girth/height) while raising its
>   centre so the swell's bottom stays put — it reads as a belly and can never drop
>   between the legs. Because the torso masses feed both the body **and** the
>   coverage layer of `figure.clothing.top`, **a dress or top drapes over the bump
>   automatically** — no hand-rolled bump or drape needed (just set `belly` and add
>   the garment). The navel landmark rides the swell too.
> - **`age`** (years) shifts torso girth toward the baby/child/old proportions.
>   It does **not** change `headsTall` (the head-to-body ratio) — for a full
>   baby/child look, lower `headsTall` too (≈3–4).
> - **`weight`** (0..1) widens or narrows the waist, hips, and chest **and their
>   front-back depth**, so a heavy figure reads as 3D bulk, not just wider.
>
> So `{ sex: 'female', weight: 0.7, age: 60 }` is a fuller, older woman, and
> `{ sex: 'male', build: 'stocky', weight: 0.8 }` a heavyset man.

> **`muscle` (0..1) adds anatomical muscle definition** — and is **orthogonal to
> `weight`** (muscle vs fat). At `0` (default) no muscle masses are added, so
> every existing figure is unchanged; raise it for tone. It welds
> anatomically-anchored bellies onto the body, all derived from the rig so they
> track the pose:
> - **torso** — pectorals, a tight abdominal panel, lats (the V-taper) and traps.
> - **arms** — a capped deltoid, biceps + triceps, and a forearm flexor swell.
>   The biceps sit on the flexor side, so a raised/flexing arm bulges correctly.
> - **legs** — quadriceps (front), hamstrings + calves (back), and glutes.
>
> Combine with the other axes for any physique: `{ muscle: 0.55, weight: 0.35 }`
> is a lean, toned athlete; `{ sex: 'male', muscle: 0.9 }` a bodybuilder;
> `{ build: 'stocky', muscle: 0.6, weight: 0.7 }` a powerlifter (big AND soft).
> Useful values: ~0.3 trim, ~0.5 athletic, ~0.7 very fit, 1 heroic/competition.
> This is the first-class replacement for hand-rolling chest/bicep/trap masses
> onto a figure (as `figure_strongman.js` used to) — reach for `muscle` instead.
>
> **Muscle raises the minimum torso depth.** Muscle bellies need core to seat
> into, so `muscle` lifts a floor on the front-back torso depth — you can't be
> both maximally lean *and* maximally muscled (the masses would have nothing to
> merge into, pinching holes). A lean athlete stays trim; the floor only keeps
> the very thinnest muscled combos from going paper-thin. At `muscle: 0` the
> floor sits below every build's natural depth, so non-muscled figures are
> unchanged.
>
> **Provenance.** The `age` and `weight` ratios are **mined from MakeHuman's CC0
> macrodetail morph targets** (github.com/makehumancommunity/makehuman, released
> CC0 2020) — see `scripts/mine-makehuman-anthropometry.mjs`, which applies each
> target to MakeHuman's base mesh and measures torso circumference at landmark
> heights. MakeHuman's *macro gender* delta turned out to be <1% (the gendered
> look there comes from its muscle/proportion sliders, not gender alone), too
> subtle to read on a stylized figurine, so the `sex` breadth values are
> anthropometry-informed stylization; the one strong CC0 sex signal — the
> female breast target — is reflected in the female chest.

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
| `arm*.roll` | **wrist roll about the held prop's long axis** (= gripAxis), applied AFTER bend/palm/thumb. The sword/staff/etc. stays put; the hand swings to the OTHER side of it. Use this when you want a 180° flip of the wrist around the grip and the palm/thumb knobs keep moving the rest of the arm. Degrees, ±360. |
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
  upperLegL/R, lowerLegL/R, kneeHingeL/R, footL/R}` — unit directions for orienting
  parts (`elbowHingeL/R` and `kneeHingeL/R` are the limb bend axes; `footL/R`
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
- `rig.sole.{L,R}` — **a full sole frame per foot, for connecting things UNDER
  the feet** (footwear, skates, skis, snowshoes, a platform/base). The foot analog
  of `rig.grip`. Each has `{ point, normal, heading, length, width, groundZ }`:
  - `point` — the footprint **centre on the ground-contact plane**. Drop anything
    that attaches under the foot here (see `F.standOn`) instead of guessing a sole Z.
  - `groundZ` — the Z of the ground-contact plane (underside of the bare sole).
    The **lower** of `sole.L.groundZ` / `sole.R.groundZ` is where a floor/base sits.
  - `heading` — toe direction (== `dir.footL/R`), so attachments track turnout.
  - `length` / `width` — footprint extents. `normal` is ground-up `[0,0,1]`.
- `rig.face.{eyeL, eyeR, browL, browR, nose, mouth, earL, earR, chinTip}`.
- `rig.torso.{nippleL, nippleR, navel}` — **front-of-torso surface landmarks**,
  the torso analog of `rig.face`. Each is a world `Vec3` on the torso front
  (`−Y`) surface, tracking the build/sex/weight/**bust** proportions: the nipple
  anchors ride the **breast-mound apex** when `bust > 0`, else the bare chest.
  `F.nipples` and `F.torso({ navel })` build on them, but they're also the anchors
  for attaching your own detail there — a pendant on the chest, a navel gem, a
  superhero emblem, body-paint discs.

**`build` scales every width:** `slim` ×0.82, `average` ×1.0, `stocky` ×1.22 —
so a `stocky` figure's `rig.r.upperArm` is 1.22× the average; size custom
accessories off `rig.r.*` and they track the build automatically.

## Parts — every builder takes `rig` first

```js
F.torso(rig, { navel })       // chest + belly + pelvis masses (+ bust mound, from rig.bust)
F.nipples(rig, { size, nipple })  // flush paintable areolae + tiny nipples — TOP-LEVEL part
F.neck(rig)
F.arms(rig)                   // both arms: tapered limbs + deltoid caps
F.arm(rig, 'L' | 'R')         // ONE arm — conform/clear surface for a one-sided
                              //   vambrace/bracer/armband (can't reach the far arm)
F.hands(rig, { grip })        // grip: 'fist' | 'open' | 'relaxed' — sculpted 3-finger+thumb
F.legs(rig)
F.leg(rig, 'L' | 'R')         // ONE leg — for a one-sided greave/garter/knee pad
F.feet(rig, { toes })         // flat, real-foot sole; toes: true adds a sculpted toe row
F.head(rig, { faceShape, jaw, chin, cheek })  // skull + jaw + cheeks (no features yet)
F.base(rig, { radius, thickness })   // flat disc under the feet (printability)
```

**Bare-torso anatomy — areolae, navel, and the bust.** Three distinct pieces:

1. **Bust mound — the `bust` RIG knob** (continuous, `0`..`2`). Like `sex`/`age`/
   `weight`, it's a *rig proportion*: `F.torso(rig)` shapes the mound
   automatically, so you set it on the rig, not the part. `0` (the default for
   every non-female figure) leaves the torso flat and byte-identical.
   **`bust` is independent of `sex`** — any figure can carry any value;
   `sex:'female'` merely *pre-fills* a sensible default (`≈0.35`) when you omit
   `bust`. Override it on any figure: `F.rig({ bust: 0.7 })`, `F.rig({ sex:'female', bust: 0 })`.
2. **Areolae + nipple — `F.nipples(rig)`**, a **top-level part** (like
   `F.face.eyes`), NOT a torso option — because it carries its own **paint
   label** (`'areola'`), and a label can't survive the smooth body weld. So
   hard-union it at the top level and **don't** wrap it in `.label()`. **Pass
   `on: skin`** (the body weld) so the areolae seat on the real surface:
   ```js
   const skin    = F.weld(rig, [ F.torso(rig, { navel: true }), … ]).label('skin');
   const nipples = F.nipples(rig, { on: skin });    // self-labels 'areola', seats on `skin`
   return sdf.union(skin, F.face.eyes(rig), nipples, …).build({ … });
   ```
   With `on`, each areola is a **conformal offset of the torso** — the body's own
   surface grown outward by a thin, uniform amount (`.round(t)`) and clipped to
   the nipple region, like a layer of clothing hugging the chest. So it follows
   whatever chest is actually there (bare, pectoral, mound, fat) *perfectly* and
   sits **near-flush** (≈2.5% of torso depth), with a subtle central nipple. The
   region is `smoothIntersect`-clipped so its rim rolls off as a **gentle dome**
   (no hard disc edge) — it slopes back into the skin gradually. The
   thin offset is essential — a perfectly **flush** (coincident) layer can't
   paint, because the bake assigns each triangle to the nearest source shape and
   a coincident areola dithers between `'areola'` and `'skin'` (a hatched, faded
   blob). The offset clears one nipple-local detail triangle so the `'areola'`
   label cleanly owns its surface → a solid, round, paintable areola that's still
   near-flush. (Omit `on` and it falls back to an approximating clipped coin that
   rides the bust/pec/bare anchor — finicky; prefer `on`.) `opts`: `{ size }`
   (areola radius, default ≈ `chestX·0.16`), `{ nipple }` (nub radius, default ≈
   `chestX·0.04`; `0` for none), `{ on }` (the body `Node` to offset).
3. **Navel — `F.torso(rig, { navel })`** (opt-in). A shallow dimple carved into
   the belly front. `navel: true` or `{ size, depth }` (`depth` 0–1.5, default
   0.5). Off by default so an unset torso is byte-identical.

**Paint the areola a slightly darker shade of the skin — `F.areolaColor(skin)`**
derives it for you (a `#rrggbb` hex or a curated `skin` name; optional second arg
0.1–1 sets how much darker, default 0.72). Overridable — paint `'areola'` any
colour:
```js
partwright.paintByLabels([
  { label: 'skin',   color: F.skin('sand') },
  { label: 'areola', color: F.areolaColor('sand') },   // auto darker shade
  … ]);
```

All positions are **calculated, not guessed** — projected onto the torso surface
from the rig (see `rig.torso` below), so they track every proportion knob: the
bust spreads the nipples and projects them forward; a `weight:1` belly bulges the
navel out. Mesh at the figure grid (`edgeLength ≤ ~0.5` with `F.faceDetail`) or
the shallow relief aliases away.

> **Custom torso geometry?** If you sculpt your own pecs/chest on top of
> `F.torso` (extra muscle ellipsoids, a barrel chest), `F.nipples` rides the
> *base* chest — which then sits behind your added mass. In that case place the
> areolae on your own surface (clip a flush coin from a sphere a hair larger than
> your ellipsoid, label it `'areola'`), as `figure_strongman.js` does.

**Hands are sculpted by default with four fully-separated fingers + a thumb,
and self-mesh — no detail spheres needed.** A `grip` picks a configuration:
`open`/`spread`/`wave` splay the straight fingers, `relaxed`/`claw`/`clutch`
curl them, `point`/`peace`/`thumbsup`/`fist`/`ok` fold the rest. The fingers are
far finer than the 0.4–0.6 figure grid, so a single coarse march would web them
together; `F.hands` tags each hand as a *fine-hands region* that the build
meshes on its own uniform fine grid and hard-unions onto the forearm at the
wrist (a clean overlap, no seam). That happens automatically — you do **not**
add hand detail spheres:

```js
const skin = F.weld(rig, [F.torso(rig), F.arms(rig), F.hands(rig, { grip: 'open' }), ...]).label('skin');
// build needs only faceDetail; hands resolve themselves:
.build({ edgeLength: 0.5, detail: [...F.faceDetail(rig)] })
```

`F.handDetail(rig)` is now a deprecated no-op (it returns no spheres) — existing
`detail: [...F.handDetail(rig)]` keeps working but contributes nothing. Optional
`hands` knobs: `size` (overall hand scale, 1 = default; e.g. `size: 1.3` for
bigger hands), `count` (finger count), `length` (finger length multiplier),
`palmThickness`. Pass `fingers: false` for the legacy mitten/paddle hands. The
hand frame derives from the rig (fingers extend along the forearm, palm faces
the elbow-curl direction), so posed arms keep correct hands automatically.

**Feet are flat and real-foot shaped, with optional toes.** `F.feet(rig)`
builds a low, flat-soled foot (instep crown, ball, rounded heel) that sits flat
on the ground in any pose — not the old rounded blob. Foot **length** is a
realistic stature proportion (≈0.15·height, like the limb lengths), so feet read
long and natural rather than stubby; footwear tracks the same footprint. Pass `{ toes: true }` to
add a sculpted toe row (big toe on the medial side tapering to the pinky). Toes
are finer than the figure grid, so — exactly like sculpted hands — pair them
with the foot detail region or they alias away:

```js
F.feet(rig, { toes: true })
// …then in the build:
.build({ edgeLength: 0.5, detail: [...F.faceDetail(rig), ...F.footDetail(rig)] })
```

Toes are a barefoot detail: omit them (the smooth default) when the figure wears
`F.clothing.shoes`/`boots`, which wrap the foot with their own coverage. The
foot heading follows `leg*.twist` turnout, so posed/turned-out legs keep their
feet pointed correctly. Footwear also tracks a **lifted foot's plantarflexion**:
when a foot is raised clear of the ground its toe points down along the leg
(pointed foot), and the shoe/boot pivots with it, so a kicking, lunging, or
tip-toe foot stays fully shod instead of poking out of a flat shoe.

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

**Seating headwear — `F.placeOnHead(node, rig, opts?)`.** Build the accessory
**centred on the origin** (brim in the z=0 plane, crown up +Z). **Default (no
`rest`): the hat sits DOWN on the head** — its bottom anchor lands at
`head.z + r.headZ · sit` (`sit` default 0.35 ≈ the brow/temple line), with the
crown enclosing the skull, so a brimmed hat reads worn rather than perched high.
This is the recommended path for hats. Raise `sit` for a higher perch
(tiara/halo), lower it (or go negative) to pull the hat down over the ears.

```js
const hat = F.placeOnHead(hatLocal, rig).label('hat');        // sits on the head
const tiara = F.placeOnHead(tiaraLocal, rig, { sit: 0.7 }).label('tiara'); // higher
```

`clearance` lifts it, `embed` sinks it further. **Legacy: pass the hair as
`opts.rest`** to instead rest the anchor on the hair's TOP (centred on the head);
combine with `embed` to sink into the hair. A skull-sized ring sits *inside* the
larger hair volume — keep it small or grow it toward the hair radius so the band
straddles the surface and welds (a tangent band prints as a second component).

**Putting a prop INTO a hand — `F.holdAt(prop, rig.grip.L|R, opts?)`.** `placeAt`
only positions; `holdAt` **fully orients** a prop to the grip and seats it in the
finger cup. Build the prop centred at the origin with its **long axis +Z** and its
**"up"/edge +Y** (for a sword: blade up +Z, flat facing ±Y, guard along ±X), and
`holdAt` aligns +Z → `gripAxis` AND +Y → the hand's `palmNormal`, then drops the
origin on the grip `point`. Binding BOTH axes is what makes the palm actually
grasp the prop (rather than it rolling to a palm-down/back-of-hand orientation —
the hand's palm normal is now used, not just the grip axis).

```js
// A sword: blade +Z, flat ±Y, guard ±X — held in the right fist, palm grasping:
const held = F.holdAt(sword, rig.grip.R);       // +Z→gripAxis, +Y→palmNormal, origin→cup
```

`opts.up` (`'palm'` default | `'reach'`) picks which hand direction the prop's +Y
maps to; `opts.flip: true` reverses the axis; `opts.along` (`'x'|'y'|'z'`) selects
the long axis (non-`z` uses the legacy single-axis align, roll unconstrained).

> **Aim a held prop by posing the arm + a `thumb` hint — don't fight `holdAt`.**
> How a hand is turned is set by the arm pose, not by `holdAt`. The human-meaningful
> handle is the **thumb**: people grasp a weight with the thumb **up or pointing
> inward**, never thumb-down. Set **`thumb: 'in'`** (recommended) or `'up' | 'down'
> | 'forward' | 'back' | 'out'` on the arm pose and the wrist roll is solved so the
> grip's `thumbAxis` points that way. The knight holds his sword with
> `armR: { raiseSide: 12, raiseFwd: 35, bend: 80, thumb: 'in' }` — thumb toward the
> body, blade rising up-and-forward.
>
> Geometry to keep in mind: a held bar lies along `gripAxis`, which is **⊥ the
> forearm** (you grip across the palm), and the **thumb is ⊥ the bar** (it curls
> over the front, ≈ along reach+palm). So "thumb up" and "blade up" are *coupled* —
> you can't choose both independently for a fist. Pick the thumb direction (the
> human constraint) and let the blade fall where the forearm pose puts it; raise/
> bend the arm to aim the blade. Probe with `F.poseProbe(rig).grips.R` —
> `thumbAxis` is assertable (`thumbAxis·[0,0,1] > 0` ⇒ thumb up) and `gripAxis`
> **is** the blade direction. (`thumb`/`palm` are mutually exclusive; `palm` —
> targeting the palm normal — is retained for back-compat but `thumb` is preferred.
> Note `thumb:'up'` on a low arm can fling it out: the fist thumb physically can't
> point straight up while gripping, so the solve over-rotates — use `'in'`.)

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

**Putting something UNDER a foot — `F.standOn(node, rig.sole.L|R, opts?)`.** The
foot analog of `holdAt`: it drops a node onto a foot's sole frame so you never
guess the sole Z — for a skate, ski, snowshoe, platform, or a per-foot base.
`opts.anchor` ∈ `top` (default — the node's top meets the sole, hanging it below
the foot) | `bottom` (rests the node ON the sole point) | `center`.

```js
// A flat platform flush under each foot (tracks turnout via the sole heading):
const plat = () => sdf.roundedBox([rig.r.foot * 2.8, rig.r.foot * 3.4, rig.r.foot * 0.8], rig.r.foot * 0.2);
const skates = sdf.union(F.standOn(plat(), rig.sole.L), F.standOn(plat(), rig.sole.R)).label('skates');
```

`F.clothing.shoes`/`boots` already key off the sole frame, so their soles come
out **flat** on the ground plane (they sit flush on `F.base` and print flat) and
track turnout — you don't hand-roll footwear. `F.base` rises to meet the lower of
the two `groundZ`, so at least one foot always welds to it (one component).

**Wrapping a band around the body — `F.ring(frame, opts?)`.** A necklace, collar,
choker, or belt. The rig exposes two band-wrap frames: `rig.ring.neck` and
`rig.ring.waist` (a {@link RingFrame}: `center`, `axis`, `xAxis`/`yAxis`, the body
semi-axes `rx`/`ry`, and `hang` = world-down). `F.ring` sweeps a closed elliptical
tube that conforms to the body's (non-circular) cross-section and rides
`clearance + tube` OUTSIDE the surface — raise `clearance` to clear clothing.
`opts`: `{ tube, clearance, segments, drop, surface }` (`drop` lowers a necklace
below the neck). Give it its own `.label(...)` so it meshes crisply and paints
separately.

> **Pass `surface` to CONFORM the band to the real (clothed) body** — the node
> the belt/necklace wraps (e.g. `sdf.union(skin, shirt, pants)`). The band then
> ray-marches to the actual surface at each azimuth and sits flush ON it, over
> the clothing — instead of an analytic ellipse that floats off the body in
> places (unprintable) or embeds through a dress. **Always pass `surface` for a
> belt/necklace over clothing.** `F.ringPoint(frame, az, { surface })` conforms
> the same way, so a buckle or a hung-scabbard anchor sits on the clothed surface.

> **Layering — conform + occlude.** A worn band should sit on its base layer AND
> be cut by the things physically in front of it, so it doesn't balloon around
> limbs or jut over hair. Two knobs:
> - **Conform to the right base surface.** For a belt, pass a TORSO-CORE surface
>   (`sdf.union(F.torso(rig), pants)`, *no arms*) + `clearance` for the shirt — if
>   you conform to a surface that includes the arms, the band wraps the arms.
> - **`occlude`** (a node or array) subtracts the objects in front of / draped
>   over the band — so it **terminates at them** and re-wraps when they move.
>   Passing **`rig`** adds the default occluders automatically (arms for any band;
>   arms+hair for a neck ring). A belt: `F.ring(rig.ring.waist, { surface: core,
>   clearance, rig })` wraps the torso and stops at the down-arms (full wrap when
>   raised — no pose special-casing). A necklace: occlude the actual hair so it
>   drapes over (`occlude: [hair]`). Same `occlude`/`rig` on `F.strap`.
>
> **`drape`** dips the FRONT of a ring down the body axis (tapering to 0 at the
> back). For a **draping pendant necklace**, prefer a small neck-hugging `F.ring`
> (occluded by hair) PLUS a separate pendant drop sampled with `F.ringPoint` (see
> below) — a big `drape` on the ring itself spreads it across the chest at neckline
> width (it reads as a collar trim, not a necklace).

**Garment PARTS — the structural fix for "belt/armor on the arms" (`F.garment`).**
This is the #1 recurring failure and it has a **root cause, not a tuning knob**: a
belt is `surface.round(clearance+thickness)` sliced to a band, and `round()` is
**isotropic** — it offsets *every* surface in `surface` outward equally. If
`surface` includes the sleeves (e.g. `union(skin, coat, pants)`), the **sleeves get
dilated into the band**, so the band literally wraps each arm. No amount of
subtracting the arms back cleanly fixes a band that was *built* around the sleeves.

**The fix: conform the band to the garment's TORSO panel, which excludes the
sleeves.** `F.garment.top(rig, opts)` and `F.garment.pants(rig, opts)` return the
clothing decomposed into parts:

- `F.garment.top(...)` → `{ all, torso, sleeves }` — `all` is identical to
  `F.clothing.top(...)` (the full worn garment you union + label); `torso` is the
  torso-only panel (no sleeves); `sleeves` is the sleeve solids (or `null`).
- `F.garment.pants(...)` → `{ all, hips, legs }` — `hips` is the seat/waistband
  region only (no leg sleeves).

Conform a belt to `union(top.torso, pants.hips)`: the band's `round()` now follows
**only the torso silhouette** and can never be dilated onto a sleeve. Add
`clear: F.arms(rig)` as a hard guarantee — it subtracts the **exact** arm (no tuned
dilation allowance), zeroing any residual interpenetration. `F.band` opts:
`{ surface (required), height, thickness, clearance, drop, clear, occlude, rig }`.

```js
// Build the coat as PARTS — `.all` is the worn garment, `.torso` the conform panel.
const coatG = F.garment.top(rig, { sleeve: 'long', thickness: r.chestX * 0.13 });
const coat  = coatG.all.label('coat');
const pantsG = F.garment.pants(rig, { leg: 'slim', rise: 'mid' });
const pants  = pantsG.all.label('pants');

// FLUSH belt conformed to the TORSO panel (NOT the sleeves) + a hard arm clear:
const beltSurface = sdf.union(coatG.torso, pantsG.hips);
const belt = F.band(rig.ring.waist, {
  surface: beltSurface, thickness: r.waist * 0.10, height: r.chestX * 0.6,
  clearance: r.chestX * 0.02, clear: F.arms(rig),
}).label('belt');
// Seat a buckle / hang a scabbard with F.ringPoint(frame, azDeg, opts?):
//   az 0 = front (−Y), 90 = figure-left (+X), 180 = back, −90 = right.
const fp = F.ringPoint(rig.ring.waist, 0, { surface: beltSurface, clearance: r.chestX * 0.02 });
const buckle = sdf.roundedBox([2.4, 1.2, 2.0], 0.3).translate(fp).label('belt');
const beltWithBuckle = belt.union(buckle.label('belt')).label('belt');
```

The same principle drives **plate armor**: build the cuirass from `top.torso.round(gap)`
(NOT `top.all.round(gap)`), so the plate offsets only the torso and never the
sleeves. A pauldron/shoulder cap that *legitimately* sits on the arm is a separate
solid built on the arm — leave it as its own piece.

**Accessories conform to the BODY PART they wrap.** Conform an accessory to the
single bare-body part it sits on (`F.torso(rig)`, `F.neck(rig)`, `F.arms(rig)`, …,
all already top-level builders) and it can't reach a part it shouldn't. A **choker**
conforms to the neck column alone — `F.ring(rig.ring.neck, { surface: F.neck(rig),
occlude: [hair] })` — so every azimuth hits the neck at the same tight radius and it
can't spread onto the shoulders or terminate through the dress (conforming to the
whole `skin`/`clothed` body lets a side azimuth march out to the trapezius/gown
shoulder). The pendant *drop* still rides the clothed front (`surface: clothed`):

```js
const collar = F.ring(rig.ring.neck, { tube: r.neck * 0.06, surface: F.neck(rig), occlude: [hair] });
const clothed = sdf.union(skin, gown);
const pts = [];
for (let i = 0; i <= 7; i++) pts.push(F.ringPoint(rig.ring.neck, 0, { surface: clothed, drop: r.neck * 3 * (i / 7) }));
let chain = collar;
for (let i = 0; i < 7; i++) chain = chain.union(sdf.capsule(pts[i], pts[i + 1], r.neck * 0.06));
const necklace = chain.subtract(hair).label('jewelry');
```

For a **one-sided** accessory use the per-side surface `F.arm(rig, 'R')` /
`F.leg(rig, 'L')`. A vambrace conformed to the right arm alone is a flush forearm
shell that *structurally cannot* appear on the left arm — offset the arm proud and
clip it to the forearm bone:

```js
const lerp3 = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const E = j.lowerArmR, W = j.wristR;                       // right forearm bone
const zone = sdf.capsule(lerp3(E, W, 0.10), lerp3(E, W, 0.96), r.lowerArm * 2.4);
const vambrace = F.arm(rig, 'R').round(r.lowerArm * 0.16).intersect(zone).label('armor');
```

**Composite the stack with a plain `sdf.union`.** Because each garment is built as
parts (the belt/sash conformed to `top.torso`, the cuirass offset from
`top.torso.round()`), nothing bleeds onto a limb and no garment contests another's
space — so you just union the whole stack. There is no special layer/priority
primitive: the parts approach removed the need for one (the old `F.layers` /
`occludeArms` limb-occluder is gone — if you find it in an old prompt, replace it
with parts + `sdf.union`).

```js
// Belt + cuirass each built against the TORSO panel (+ `clear: F.arms`), so neither
// reaches the arms; the cuirass offsets strictly outward from the shirt. Plain union:
const body = sdf.union(skin, shirt, pants, belt, cuirass, pauldrons);
// Standalone props (eyes, a held sword, the base) union on top too.
return sdf.union(body, eyes, sword, scabbard, hair, base).build({ /* … */ });
```

> One thing the old layer compositor handled that a plain union does not: the
> **fine-hands marker must never be buried inside a `.subtract`** (it breaks
> sculpted hands). With parts there's nothing to subtract the hands by, so a plain
> union is safe — just don't introduce a `.subtract` that carves the skin/hands.

**Check your work — `F.sharedSolid(a, b, opts?)` (the invariant primitive).** The
failures above (armor on the arm, necklace through the gown, scabbard through the
leg) are all *unwanted overlap* you can't see in the source. `F.sharedSolid`
measures it directly on the SDF **fields** — no closed mesh needed — by sampling
both over their bbox intersection and counting points inside BOTH. It returns
`{ overlaps, sharedVolume, point, samples }` (`point` = an example overlap location
to inspect). **Assert the specific pairs that MUST stay clear** — that's what
sidesteps the expected-overlap problem (clothing is *supposed* to overlap skin):

```js
// A worn band/plate must be clear of the arms — conform to top.torso + clear:F.arms:
if (F.sharedSolid(belt, F.arms(rig)).overlaps) throw new Error('belt bleeds onto the arm — conform to top.torso, add clear:F.arms(rig)');
if (F.sharedSolid(cuirass, F.arms(rig)).overlaps) throw new Error('cuirass bleeds onto the arm — build from top.torso.round(gap)');
// A necklace must not penetrate the gown (only the hair should cover it):
const hit = F.sharedSolid(necklace, gown, { tol: 0.5 });
if (hit.overlaps) console.warn('necklace in gown near', hit.point);
```

Pair it with the cheap, unambiguous checks for a full invariant battery:
`runAndSave(..., { maxComponents: 1 })` (one printable piece — catches a loose
scabbard/sword), `model.bounds().min[2] >= baseTopZ` (nothing below the base), and
`F.poseProbe(rig).grips.R.thumbAxis[2] > 0` (a held prop gripped thumb-up). Run
these as assertions while authoring; raise `samples` for thin features.

**A band CROSSING the body — `F.strap(a, b, opts?)`.** A bandolier (shoulder →
opposite hip), sash, suspender, or backpack strap. `a`/`b` accept grip frames,
`rig.shoulder.L/R`, sole frames, or raw points (and `F.ringPoint` output). **Pass
`surface`** to lay the band ON the body — each sample projects forward (−Y) onto
the real surface, so the strap hugs the chest instead of bowing through it or
burying under clothing. Without `surface` it falls back to a forward-bowed arc
(`opts.bow`), which buries on a clothed torso — so prefer `surface`.

```js
const sash = F.strap(rig.shoulder.L, F.ringPoint(rig.ring.waist, -90), { tube: r.chestX * 0.12, surface: clothed }).label('sash');
```

**Hanging something from an anchor — `F.hangFrom(node, point, opts?)`.** The
gravity analog of `holdAt`: a scabbard off a belt, a pendant off a necklace, a
pouch off a hip. Drops the node's `anchor` (default `top`) onto `point` lowered by
`opts.drop`, after tilting it `opts.tilt`° forward. Build the item vertical/centred
on the origin first.

```js
const hip = F.ringPoint(rig.ring.waist, 75, { clearance: r.chestX * 0.18 }); // left hip
const sheathed = F.hangFrom(scabbard, hip, { tilt: 15 }).label('scabbard');
```

**Perching on the face — `F.onFace(rig)`.** Eyeglasses, sunglasses, masks,
eyepatches. Returns `{ eyeL, eyeR, bridge, templeL, templeR, forward, up, lateral }`
(all tracking head pose): build a lens ring at `eyeL`/`eyeR` pushed out along
`forward`, a `bridge` between them, and temple arms back to `templeL`/`templeR`.

> **Thin accessory features (glasses temples, chains, straps, blades) FRAGMENT on
> the coarse march, and the `detail` REFINE pass FRAYS them** (the same failure as
> over-refined fingers). Three rules: keep any tube/bar radius ≳ 1.3× your
> `edgeLength`; route thin arms so they HUG/rest on the body surface (a supported
> tube survives, a floating diagonal frays); and prefer a finer global
> `edgeLength` over covering a thin tube with a big refine `detail` sphere.
> Print-chunky is correct for a figurine. **Fuse every accessory into the figure**
> (overlap it ≥0.5 units and `union`) so the result stays one printable piece
> (`componentCount` 1). Other rig frames for accessories: `rig.shoulder.L/R`
> (pauldrons, epaulets), `rig.back` (`{point, normal}` — backpacks, capes,
> quivers), `rig.forearm.L/R` (bracers, vambraces).

**Reading a pose — `F.poseProbe(rig)`.** Returns a deterministic, rounded dump
of every world joint position, both grip frames, both sole frames, and the key
directions, plus a `.text` summary — use it instead of hand-rolled `JSON.stringify` probes when
tuning a pose. `throw new Error(F.poseProbe(rig).text)` (or `console.log` it)
prints the whole readout so you can read where a hand/grip actually landed
before aiming a prop at it.

## Face — reads `rig.face` anchors

```js
F.face.assemble(head, rig, {
  eyes:  true | { radius, style, lids, gaze, gazeL, gazeR } | false,  // OFF by default — see note below
  nose:  true | { type, projection, length, width, bridge, bridgeWidth, profile, tipSize, tipShape, flare, upturn, nostrilSize, nostrils, tipRadius } | false,
  mouth: true | { style, expression, curve, width, smirk, open, fullness, lipShape, divided, render, teeth } | false,
  ears:  true | { size, type, tilt } | false,   // type: 'detailed'(default) | 'round' | 'pointed'; tilt deg (+back)
  brows: { shape, thickness, lift, width, taper, relief, spacing } | false, // off by default; see "Brows" below
})
```

> **In-assemble brows are SKIN-COLOURED.** The `brows:` key above welds flush
> brows into the face, but the usual `.label('skin')` weld flattens them to skin
> tone. For **dark, painted-on brows**, leave them out of the assemble (`brows:
> false`) and union `F.face.brows(rig, { … })` at the **top level**, exactly like
> the eyes — see [Brows](#brows--flush-painted-on-shape-presets) below.

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

Every nose is a sculpted form — a recessed bridge **root**, a defined ridge
(taller than wide, with sidewalls), a distinct **tip bulb**, fleshy **alae**
(nostril wings), and two **carved nostril cavities** (rounded, outward-splayed,
with a columella/septum between them) — that **projects off the face**, not a
smooth bump. Reach for a **preset** first, then tune with the axes:

- **`nose.type`** — `'straight'` (default · neutral) · `'button'` (small, short,
  upturned) · `'snub'` (short, strongly upturned) · `'roman'` (long, high bridge,
  convex hump) · `'aquiline'` (long, hooked, prominent hump) · `'broad'` (wide,
  low bridge, big flare) · `'pointed'` (narrow, sharp tip) · `'bulbous'` (big
  round tip). Each preset is a full set of axis values; the explicit keys below
  **override** the preset (they don't multiply), so `{ type: 'broad', flare: 0.5 }`
  is the broad nose with a tamer flare.
- **Bridge** — **`nose.length`** (0.3–2) dorsum length; **`nose.bridge`**
  (0.3–1.5) bridge height/prominence (low ≈ flat, high ≈ thin prominent);
  **`nose.bridgeWidth`** (0.4–1.8) pinched ↔ broad bridge; **`nose.profile`**
  (−1..1) the dorsal slope — **−** concave/scooped (ski-jump), **0** straight,
  **+** convex roman hump. (Legacy **`nose.bump`** 0..1 is the positive-only
  alias for `profile`.)
- **Tip** — **`nose.projection`** (0.4–2) how far the tip stands **off the
  face**; **`nose.tipSize`** (0.4–2) the end-bulb scale; **`nose.tipShape`**
  (`'round'` · `'pointed'` · `'bulbous'` · `'cleft'`) the silhouette;
  **`nose.width`** (0.4–2.2) overall tip+alae width; **`nose.upturn`** (−1..1)
  rotates the tip (**+** snub/upturned shows the nostrils, **−** droopy/hooked);
  **`nose.tipRadius`** sets the absolute base tip size.
- **Nostrils** — **`nose.flare`** (0–1.5) sizes the alar wings;
  **`nose.nostrilSize`** (0–1.5) scales the carved openings independently. Small
  noses (tip radius below ~0.46, i.e. button/chibi) **auto-skip the carve by
  default** — it would alias into a torn crater at that size, so they render a
  clean smooth bulb instead. **`nose.nostrils: false`** force-skips at any size;
  **`nose.nostrils: true`** force-carves even a small nose (accepting the risk).
- These vary the nose far more than size alone — `{ type: 'broad' }` vs
  `{ type: 'aquiline' }` are different *people*. **Pair `F.faceDetail(rig)`** with
  `build({ detail })` so the nostril rims and septum mesh crisply (it includes a
  fine nose sphere + an extra-fine nostril sphere; tune via
  `faceDetail({ noseEdgeLength, nostrilEdgeLength })`).
- **`mouth.fullness`** (0.4–2.2) scales lip thickness independently of `width`
  (works on the `'lips'` ridge and the open-mouth lip ring).
- **`mouth.expression`** picks the emotion *level*: `'bigSmile'` · `'smile'` ·
  `'slightSmile'` · `'neutral'` · `'slightFrown'` · `'frown'` · `'deepFrown'`.
  Or set **`mouth.curve`** directly (−1 deep frown … 0 neutral … +1 big smile;
  the numeric `curve` overrides the preset). It bows EVERY style — the carved
  line, the lip ridge, and the open mouth's opening all smile or frown. Un-set,
  each style keeps its historical bend (smile bows up, lips/open stay straight).

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

`style` is the *representation*; `expression`/`curve` is the *emotion* (it bows
any style — see above). `render` chooses how the mouth meets the head.

| `style` | What you get | Add or carve |
|---|---|---|
| `'smile'` (default) | a smile/frown **line** through the face — the classic cartoon mouth. Carved as a groove when the head is big enough, else raised as a clean ridge (`render` overrides). `smirk` (−1..1) skews it; `expression`/`curve` bows it. | carve / add |
| `'open'` | an open mouth (laughing / talking / singing). `open` (0..1) sets the gape; passing `open > 0` without a style selects this. Pair it with `mouthAccents` for teeth + lips. | carve / add |
| `'lips'` | sculpted lips. Pick a **`lipShape`** preset for a refined cupid's-bow upper + fuller lower + parting groove; `divided: true` is shorthand for `lipShape: 'natural'`. Bare `'lips'` (no shape) is a plain ridge. | add |

**`lipShape`** (with `style: 'lips'`) — the lip silhouette, independent of size
(`width`/`fullness`) and mood (`expression`/`smirk`), so any shape can smile,
frown, be wider, or fuller:

| `lipShape` | Look |
|---|---|
| `'natural'` | thin upper + full lower — the everyday balance (also what `divided: true` gives) |
| `'full'` | plump both lips, sharp defined cupid's bow |
| `'thin'` | slim, elegant, sharp bow set into the face |
| `'wide'` | wide, medium fullness, moderate bow |
| `'rosebud'` | narrow, small, soft rounded bow — petite |
| `'flat'` | wide, thin, near-flat upper (no bow) — the masculine/neutral mouth; pair with `expression: 'slightFrown'` for a stern set |

```js
mouth: { expression: 'bigSmile' }                      // super-smiley
mouth: { expression: 'deepFrown' }                     // sad
mouth: { curve: -0.4, smirk: 0.2 }                     // mild frown, skewed
mouth: { style: 'lips', lipShape: 'full', fullness: 1.3 }            // glamorous full lips
mouth: { style: 'lips', lipShape: 'natural', expression: 'slightSmile' } // natural, gently smiling
mouth: { style: 'lips', lipShape: 'flat', expression: 'slightFrown' }    // masculine, stern
mouth: { open: 0.5, expression: 'smile', render: 'painted', teeth: 'both' } // toothy grin
```

**`render`** — `'auto'` (default) carves the mouth into the head when the head
is big enough for a clean carve, and otherwise paints it additively; `'carved'`
forces the groove/cavity; `'painted'` forces a flat, additive, **print-safe**
mouth (no carved-out cavity, so no support material lands inside the mouth).
*Small / high-`headsTall` heads auto-fall-back to painted* — that's the fix for
the carved-mouth tearing on tiny heads. Use `render: 'painted'` whenever you
want a clean print of a toothy or open mouth.

`F.face.mouth(rig, opts)` returns the mouth **geometry node**: for the carved
styles that's the *cutter* — `smoothSubtract` it from the head yourself, or
just let `assemble` handle the bookkeeping.

### Teeth & painted lips — `F.face.mouthAccents(rig, mouthOpts)`

Pre-labelled solid parts that complement the mouth. Build them from the **same
options object** you passed as `mouth:` so they always agree, and hard-union
them at the figure's TOP level (next to the eyes). For a clean print of a toothy
smile use `render: 'painted'` and pass `mouth: false` to `assemble` (so the skin
doesn't also weld a lip ring that buries the painted parts):

```js
const mouthOpts = { style: 'open', open: 0.5, expression: 'bigSmile', render: 'painted', teeth: 'both' };
const face = F.face.assemble(head, rig, { eyes: false, mouth: false });
const mouthParts = F.face.mouthAccents(rig, mouthOpts);  // 'teeth' + 'lips'
return sdf.union(skin, eyes, mouthParts, hair, base).build({ ... });
```

- `'open'` style: a **`'teeth'`** band (`teeth: 'upper'` (default) · `'lower'` ·
  `'both'` · `false`) and a **`'lips'`** ring around the opening (skip with
  `lips: false`), both bowed by the expression so a grin's opening smiles. Under
  `render: 'painted'` the teeth sit as a flat plate flush in the opening (no
  cavity, prints support-free); carved, they recess behind the rim.
- `'lips'` style: the lips labelled `'lips'` (honours `lipShape` / `divided`) —
  pass `mouth: false` to `assemble` (a smooth-welded copy would swallow the label).
- `'smile'` style: a paintable lip **line** labelled `'lips'` — the additive
  form of the groove, for a coloured expressive mouth line (frown → smile). Pass
  `mouth: false` to `assemble` if you want *only* the painted line.

### Ears & the hair⇄ear relationship

`F.face.ears(rig, { size, type })` welds ears at the `rig.face.earL/earR`
anchors (pose-tracked). Each is a thin, ear-shaped plate that stands proud of
the skull with a **shallow concha scoop** (a real rim + bowl, never a punched
"keyhole" hole). Three **types**:

| `type` | Shape | Use for |
|---|---|---|
| `'detailed'` (default) | the cupped ear plus a **tragus + antitragus** — reads as a real ear | most figures, realistic busts |
| `'round'` | a clean cupped ear: comma plate + shallow concha + earlobe, no inner detail | simpler / cartoon figures |
| `'pointed'` | a triangular pinna sloping up to a **rounded point** | elves, fae, fantasy |

`size` scales the ears; **`tilt`** (degrees, −45..45, **+ = back**) angles the top
toward the nape — most useful on `'pointed'` to sweep the elf point back.

```js
ears: { type: 'pointed', size: rig.r.head * 0.4, tilt: 22 }   // swept-back elf ears
```

**Whether hair covers or exposes the ears is a `F.hair` knob, not an ear knob** —
the hair owns the silhouette. `F.hair(rig, { ears })`:

- **`'cover'` (default)** — the hair cap flows over the ears (they hide under a
  bob, long hair, etc.). Carves nothing, so existing bakes are byte-identical.
- **`'behind'`** — the hair is worn *behind* the ears: an ear-clearance pocket is
  scooped out of the cap at each ear anchor so the skin ears protrude in front.

```js
// elf ears left fully visible: pointed ears + hair worn behind them
const face = F.face.assemble(head, rig, { ears: { type: 'pointed' }, eyes: false });
const hair = F.hair(rig, { style: 'long', ears: 'behind' }).label('hair');
```

So the head (ear `type` + `size`), the ears, and the hair (`ears: cover|behind`)
compose: pick the ear shape on the face, then choose on the hair whether it sits
over or behind them. See `examples/figure_elf_archer.js` (pointed/behind),
`figure_topknot_sensei.js` (detailed/behind), `figure_pixie_skater.js`
(round/behind).

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

#### Gaze — `gaze`, `gazeL`, `gazeR` (where the eyes point)

By default the irises/pupils look straight ahead. Aim them with `gaze` — a
named preset, or a `{ yaw, pitch }` pair in **degrees** (`yaw` > 0 = the
**figure's own left**, `pitch` > 0 = **up**; both follow the head pose). The
nine presets are the cardinal + corner directions:

```js
F.face.eyes(rig, { gaze: 'up' })                   // both eyes look up
F.face.eyes(rig, { gaze: 'lower-right' })           // both look down-and-right
F.face.eyes(rig, { gaze: { yaw: -12, pitch: 8 } })  // exact angle: right + up
```

| `gaze` preset | Look |
|---|---|
| `'middle'` (default) / `'center'` | straight ahead |
| `'left'` / `'right'` | toward the figure's own left / right |
| `'up'` / `'down'` | up / down |
| `'upper-left'` · `'upper-right'` · `'lower-left'` · `'lower-right'` | the four corners |

`gaze` sets **both** eyes. To aim each eye separately — cross-eyed, wall-eyed,
or one lazy eye — override a single side with **`gazeL`** (the figure's left
eye) and/or **`gazeR`** (its right). Each takes the same preset-or-`{yaw,pitch}`
value, and falls back to `gaze` when omitted:

```js
F.face.eyes(rig, { gazeL: 'right', gazeR: 'left' })    // cross-eyed (both toward the nose)
F.face.eyes(rig, { gaze: 'down', gazeR: 'lower-left' }) // both down; right eye drifts in
```

Gaze only steers the iris/pupil (`style: 'iris'`); a `'solid'` bead has nothing
to aim. Keep angles modest so the iris stays within the eye opening — under
`lids`, a far look correctly tucks partly behind the lid.

#### Eyelids — `lids` (off by default)

Add eyelids with `lids`. There are TWO independent lids — an upper and a lower —
each a thin skin shell that wraps the eyeball and sweeps in from its pole. Give
either a `{ upper, lower }` pair (each `0`…`1`, how far that lid has closed) or a
named preset. The region is pre-labelled **`'lids'`** so you paint it (skin tone,
or tint for eyeshadow).

```js
F.face.eyes(rig, { lids: { upper: 0.3, lower: 0.1 } })  // alert eye, defined upper lid
F.face.eyes(rig, { lids: { upper: 0.25, lower: 0.25 } })// a squinted slit
F.face.eyes(rig, { lids: 'almond' })                    // a named preset (shorthand)
```

The eye is **open between the two margins**; when `upper + lower ≥ 1` the lids
meet and the eye is **closed** — so `{0.75, 0.25}` and `{0.5, 0.5}` both read
shut, while `{0.25, 0.25}` is a slit. This lets you do blinks, winks, sleepy,
and squints, not just the presets.

| preset | `{ upper, lower }` | Look |
|---|---|---|
| `'none'` (default) | — | bare round eyeball — unchanged |
| `'upper'` | `{0.30, 0.06}` | alert, open eye with a defined upper lid |
| `'hooded'` | `{0.46, 0.06}` | heavier upper hood |
| `'half'` | `{0.40, 0.12}` | sleepy / half-closed |
| `'closed'` | `{0.56, 0.50}` | lids meet → shut |
| `'almond'` | `{0.30, 0.20}` | both lids visible, almond opening |
| `'tapered'` | `{0.38, 0.28}` | narrower, more drawn-out |

Paint the new region alongside the eyes — e.g. `{ label: 'lids', color: skinRgb }`.
With `style: 'solid'`, adding `lids` makes the result **self-labelled** (`'eyes'` +
`'lids'`), so don't wrap it in `.label()`. Lids follow the head pose like the
iris/pupil and need no extra `detail` beyond `F.faceDetail(rig)`.

### Brows — flush, painted-on `shape` presets

Eyebrows are **flush** strips that hug the forehead above the eyes — *not* a
raised brow ridge. Like the iris/pupil, the colour does the work: the brow is
geometry sunk almost flat into the skin and self-labelled **`'brows'`**, so you
paint it dark. Build it at the **top level** and hard-union it (keep it out of
the skin weld), exactly like the eyes — a brow welded into a `.label('skin')`
mass loses its `'brows'` colour:

```js
const skin  = F.weld(rig, [ … ]).label('skin');
const brows = F.face.brows(rig, { shape: 'natural', on: skin }); // self-labelled 'brows'
return sdf.union(skin, eyes, brows, lips, hair, base)
  .build({ edgeLength: 0.5, detail: F.faceDetail(rig) }); // detail keeps the strip crisp
```

**Pass `on: skin`** (the body/face weld), exactly like `F.nipples(rig, { on: skin })`:
each brow is then a thin **conformal offset of the real forehead** — a proud strip
of the actual surface clipped to the brow arc — so it follows any skull with no
curvature guess, and the `'brows'` label paints cleanly. (Omit `on` and it falls
back to a sunk capsule strip positioned by an analytic skull approximation —
fine for default heads, less robust on unusual proportions.)

Pick a **`shape`** preset (individual knobs override it):

| `shape` | Look |
|---|---|
| `'natural'` (default) | soft, even brow with a gentle arch |
| `'thin'` | fine, plucked line |
| `'bushy'` | thick, fuller brow with a touch more relief |
| `'arched'` | high, expressive curve |
| `'flat'` | low, level brow (concentration/intensity) |
| `'angled'` | apex shifted toward the tail — a raised/sharp angle |
| `'rounded'` | soft semicircular brow, little taper |
| `'straight'` | level, even-weight bar |

Knobs (each overrides the preset): `width` (lateral span ×), `taper` (0–0.9, how
much the tail thins), `relief` (0 = dead flush … up to a whisper-proud edge),
`spacing` (multiplier on the **eye** spacing — default 1 sits each brow directly
over its eyeball; >1 spreads the pair apart, <1 draws them in), `on` (the body
weld to seat the brow conformally on — see above), plus the back-compat
multipliers `thickness` (brow weight) and `lift` (arch). The
old `F.face.assemble(…, { brows: {} })` path still works but paints the brow
**skin-coloured** (it's inside the skin weld) — use the top-level union above for
dark brows. Always give `.build()` `detail: F.faceDetail(rig)` so the thin strip
and its colour edge mesh crisply (the detail set includes a per-brow sphere).

## Face detail — `F.faceDetail(rig)` (use it on every figure with a face)

Face features are far smaller than the body, so at the recommended figure grid
(`edgeLength 0.4–0.6`) they mesh as angular slabs. `F.faceDetail(rig)` returns
`{ center, radius, edgeLength }` spheres — one covering the head, finer ones over
the mouth groove, the nose (plus an extra-fine nostril sphere), each eyeball
front, and each **brow** (so the flush brow strip doesn't fray), plus two over
the chest **areola discs** so the flush coin's rim doesn't sliver at the coarse
torso grid — for `.build()`'s `detail` option (see `/ai/sdf.md#detail-regions`):

```js
return sdf.union(skin, eyes, hair, base)
  .build({ edgeLength: 0.5, detail: F.faceDetail(rig) });
```

The head meshes ~3× finer (smooth smile groove) and the eyes finer still, so the
iris/pupil circles tessellate round instead of faceting into polygons — while
the body keeps the cheap global grid. Typically +30–60k triangles instead of the
~10× a globally fine grid would cost. Override per region:
`F.faceDetail(rig, { edgeLength: rig.r.head * 0.02, eyeEdgeLength: rig.r.head * 0.006 })`.
Pass `chest: false` to drop the areola spheres on a figure with no bare chest, or
`brows: false` to drop the brow spheres; `browEdgeLength` / `chestEdgeLength` /
`nostrilEdgeLength` tune those.

## Hair & clothing — derived from the rig, so they always fit

```js
F.hair(rig, { style, hairline, length, volume, part, texture, ears })
//   ears: 'cover' (default, hair over the ears) | 'behind' (tucked behind them,
//         so ears protrude — see the hair⇄ear section under Face above).
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
F.garment.top(rig, opts)   → { all, torso, sleeves }    // parted form of clothing.top
F.garment.pants(rig, opts) → { all, hips, legs }        // parted form of clothing.pants
//   `all` === the F.clothing.* Node. Conform a belt/sash to union(top.torso,
//   pants.hips) — the torso-only panels — so the band never reaches the sleeves.
//   For a bare-body accessory, conform to the part it wraps (choker → F.neck(rig)).
F.clothing.shoes(rig, { size, thickness, label, sole })  // sole + upper over each foot
F.clothing.boots(rig, { size, shaftZ, thickness, label, sole })  // + a shaft up the lower leg
//   Footwear keys off rig.sole.{L,R}, so it tracks leg*.twist turnout like
//   F.feet AND comes out with a FLAT-bottomed sole that fully encloses the skin.
//   The sole is a horizontal SLICE of the shoe's own shape, so it follows the
//   foot's curvature (not a cuboid welded on). It OWNS its paint regions (like
//   F.face.eyes): the upper is labeled `label` (default 'boots'/'shoes') and the
//   sole is its OWN region (default label 'sole') — so DON'T add .label() on top
//   (an outer label would swallow the sole). `sole` defaults ON; pass sole:false
//   to fold it into the upper, or tune it:
//     sole: { style, thickness, lip, label }
//       style: 'welt' (default — sole sits proud of the upper, like a real shoe)
//              | 'flush' (sole hugs the upper's outline, no overhang)
//       lip:   how far a welt sole is proud (alias: overhang); ignored for flush
//       label: 'boots' = same colour as the boot.
//   `size` scales the footprint, `thickness` the shell. For boots, `shaftZ` is a
//   world-Z target projected onto each leg's own ankle→knee bone.
F.clothing.panel(rig, { side, top, bottom, wrap, thickness, over, fit, label })
//   A front/back-panel garment — apron, bib, tabard, loincloth, cape. Two fits:
//   fit:'drape' (DEFAULT) — a flat cloth SHEET that hangs. It sits just in front
//     of the body's MEASURED forward-most point (so it clears the body/under-
//     garments and can't pass through), rests on the belly, and hangs straight
//     DOWN — below the belly the legs recede, so the sheet hangs away from them
//     (real "body separation"). This is the apron/cape look.
//   fit:'hug' — the conforming skin-tight shell (lies ON the body), for a tabard
//     or bib pressed flat to the chest rather than hanging off it.
//   side:   'front' (−Y, default) | 'back' (+Y) | 'both'
//   top:    'neck' | 'chest' (default) | 'waist'                       — or a world Z
//   bottom: 'waist' | 'hip' | 'thigh' (default) | 'knee' | 'shin' | 'ankle' — or Z
//   wrap:   half-width × the hip half-width (default 1.0; 1 ≈ hip-wide)
//   thickness: SHEET thickness — set it above your slicer's min wall so it prints;
//              the default is a sturdy, print-safe value.
//   over:   a node or [nodes] (e.g. the under-jacket/pants) the drape hangs OVER —
//           folded into the apex measurement so the sheet clears them. Pass your
//           under-garments here, else a thick under-garment can bury the sheet.
//   Recipes:  bib       = panel({ side:'front', top:'neck',  bottom:'waist' })
//             tabard    = panel({ side:'both',  top:'chest', bottom:'thigh', fit:'hug' })
//             loincloth = panel({ side:'both',  top:'waist', bottom:'thigh', wrap:0.8 })
//             cape      = panel({ side:'back',  top:'neck',  bottom:'ankle', wrap:1.3 })
F.clothing.apron(rig, { top, bottom, wrap, thickness, over, ties, label })
//   Draping chef's BIB apron preset: a narrow bib flaring into a wider skirt that
//   hangs to the shin (default chest → shin), held by a NECK halter + WAIST ties
//   (ties:true by default). Pass `over:[jacket,pants]` so it clears the whites.
```

> **Aprons/bibs/capes — ALWAYS use `F.clothing.panel`/`apron`, never a hand-rolled
> flat box.** A flat slab at a fixed Y can't follow the body: it plunges into the
> chest and floats off the receding thigh — it **passes through the body** (and a
> shell that conforms all the way down looks like skin-tight underwear). `panel`
> drapes from the body's *measured* forward-most point and hangs straight down, so
> it clears the body AND reads as hanging cloth. On a clothed figure, pass the
> under-garments as `over:[...]`; if a panel paints 0 triangles (model:preview's
> 0-label warning) it's buried under a garment — pass it via `over` or raise
> `thickness`.

**Standing on a surface — `F.ground(rig, { mode, surface?|z?, tolerance? })`.** Feet
posed at different heights end up with soles at different Z. `F.ground` returns a
**new rig** whose feet share one ground plane; build feet/footwear/base from it and
the soles come out coplanar with the base meeting them. The plane is `z`, else the
top of `surface` (an SDF node), else the lowest foot. Two modes:
- `'plant'` (default) — feet within `tolerance` of the plane are leveled onto it
  (their footwear sole thickens to reach it); feet beyond tolerance stay **lifted**
  (off the ground — natural for a takeoff/walk pose).
- `'drop'` — re-poses each leg (2-bone IK, hips fixed) so **every** foot lands on
  the plane. Use it to make a figure stand flat-footed regardless of the pose.

```js
const rig = F.ground(F.rig({ pose: {...} }), { mode: 'drop' });   // both feet on the floor
const boots = F.clothing.boots(rig, { label: 'boots' });          // sole region paints separately
const base  = F.base(rig);                                        // meets the shared plane
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
- **Nose** — `type` (`straight`/`button`/`snub`/`roman`/`aquiline`/`broad`/
  `pointed`/`bulbous`), then `width` / `bridge` / `flare` / `upturn` / `bump`. A
  broad low-bridge nose and a narrow high-bridge hooked nose are different
  *people*, not the same face shaded darker.
- **Lips** — `mouth.fullness`.
- **Hair** — match texture and style to the person: `coils`/`afro`/`locs`/
  `cornrows`/`boxBraids` are first-class, not edge cases. Any hair texture works
  on any skin tone.
- **Body** — `build` (slim/average/stocky), `sex`, `headsTall`, plus `weight`
  (fat) and `muscle` (tone) as independent axes.

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
