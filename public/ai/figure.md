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

> **Not a human?** A creature, monster, mascot or toy animal (big eyes, horns,
> bat ears, claws, a tail) doesn't fit this rig — use the creature kit,
> `api.sdf.creature` (`readDoc("creature")`), which has a full worked example.

> Coordinate convention (same as ai.md): **front = −Y**, **Z up**, figure's
> **left = +X**, right = −X. Sides are suffixed `L` / `R`.

## Shortcut: `buildCharacter(spec)` / the 🧍 Character panel

For a **standard humanoid or vinyl/chibi toy** (body proportions, pose, face,
hair, clothing, colours, a held ball) you don't have to hand-write the recipe
below — there's a no-code **Character Creator** panel (Tools ▸ 🧍 Character, or
the command palette) whose console twin is `partwright.buildCharacter(spec, { save })`
(in-app AI tool: `buildCharacter`). It generates exactly the kind of code shown
below from a plain spec object and (with `save: true`) commits a version. Every
field is validated — a bad one comes back in `{ error }` with its path — and
every field falls back to a sensible default, so a partial patch works
(`buildCharacter({ body:{ sex:'female' }, hair:{ style:'bun' } }, { save:true })`).

The spec (v2) mirrors this API:

```js
{
  body: { height, headsTall, build, sex, age, weight, muscle, bust, belly,
          proportions: 'realistic' | 'chibi' | 'funko',   // rig({ proportions }); realistic = none
          headScale: null | number | { x, y, z },          // null = the style's default
          headSink /* 0–1.5 × neck: head on the shoulders (Funko ≈ 0.4) */,
          mittens /* fingerless vinyl hands */ },
  pose: { preset, armL, armR, legL, legR: { raiseSide, raiseFwd, bend, twist }, spine, head,
          hold: { kind: 'none' | 'ball', radius, cup: 'sides' | 'under', color,  // color = ball panels
                  cupL, cupR /* null = cup */, handScale /* 0.5–2.5 */ } },
  face: { shape, lids, gaze, nose, expression, lipShape, ears, brows,
          layout: { eyeSpread: null | 0.5–2, eyeHeight: null | −0.6–0.6 },
          eyeSize /* 0.5–3 × the default radius */, mouth /* false = no lips */,
          eyeStyle: 'iris' | 'bead', eyeAspect, highlight /* bead: 0 = no glint */,
          browThickness /* 0.1–5 */, browWidth /* 0.3–2 */, jaw, chin, cheek /* head shape × */ },
  hair: { style /* … | 'mop' | 'anime' | 'shag' | 'captured' */, length, volume,
          lockShape, swoop /* anime only */, chunk, spike /* anime + shag */,
          crown /* 'spiky' | 'tousled' */, layers /* 1–3 */, raggedness, flare,
          notched, crownSize, backWidth, tipWidth /* shag only */,
          preset, spikiness, smooth, mirror, tilt, windowScale, capturedFringe /* captured only */,
          fringe, seed /* mop + anime + shag */ },
  clothing: {
    top: { on, sleeve, length,
           trim: { collar, cuffs },                      // contrast bands (colors.trim)
           print: [{ text, where: 'chest' | 'back', size, x, z, color, font }] },  // F.emboss lettering
    pants: { on, leg, rise, length: 'full' | 'shorts' | 'briefs', hem /* shorts: 0.2–1.2 of the thigh */ },
    socks: { on, height /* of the shin */, stripes /* 0 = plain, 1 = band, n = hoops */, stripeSpan },
    feet: { on, kind, style: 'fitted' | 'toy', size, height, cleats /* toy shoes: 0 | 2–12 */ },
  },
  colors: { skin, eyes, iris, pupil, lips, brows, hair, top, pants, feet, base, ball,
            trim, socks, sockStripe, sole /* null = feet */, eyeHighlight },
  base: true,
  place: true,   // finish with F.place(model, rig, { face: '+X' }) — bottom at z = 0, facing +X
}
```

**Kit details, all spec-driven.** `top.trim` splits the top with `F.trimZone`
(a neck-ring collar; cuffs at the short-sleeve hem or the wrist) into `top` +
`trim`. Each `top.print` item is an `F.emboss` on the top: `size`, `x` (+ = the
figure's left) and `z` (+ = up from the chest line) are in **chest
half-widths** (`rig.r.chestX`), so they scale with the figure — a chest
initial ≈ `{ text: 'N', x: 0.55, z: 0.24, size: 0.55 }`, a back number ≈
`{ text: '10', where: 'back', size: 0.95 }`; each paints its own `color`
(labels `print1`, `print2`, …). `socks` grow the shin skin proud from
`1 − height` along the lower-leg bone into the shoe; `stripes` bands share the
top `stripeSpan`. `feet.style: 'toy'` is the chunky vinyl sneaker (`size` ≈
1.3, `cleats` 6 for a footballer). `pants.length: 'shorts'` cuts the leg square
at `hem` × the thigh bone (0.9 ≈ just above the knee). Every one of these is
emitted only when set, so older specs regenerate the same code.

`body.proportions` switches the body plan (in the panel, **Style** also applies
fitting defaults: `funko` = `headsTall 3`, `build 'slim'`, bead-black eyes at
`eyeSize 1.8`, no mouth, no lids, arched brows). `pose.hold.kind: 'ball'`
solves both arms onto the ball (`armL`/`armR` are ignored), opens the hands, adds
`F.heldSphere(rig)` labelled `ball`, and paints it with
`api.paint.pattern({ pattern: 'soccer', withinPart: 'ball', colors: [colors.ball, hold.color] })`.
The generated code embeds the spec as a `// @character v2 {json}` header so the
panel can re-open it; `partwright.getCharacterSpec()` (AI tool
`getCharacterSpec`) reads it back as `{ spec }` so you can tweak a field and
rebuild. A `@character v1` header (or a spec object with `version: 1`) migrates
with defaults that regenerate its original code — including `place: false`
(the legacy builder frame: −Y front, soles at z = 0).

To start from something other than the default, `partwright.listCharacterPresets()`
returns the panel's starting characters (`{id, label, description, spec}` —
child, elder, chibi, Funko toy, athlete, elf, mannequin, …) and
`partwright.randomCharacter({ seed?, save? })` rolls a random but coherent one
(an age archetype and a body-plan style drive proportions; the seed is
returned, so the same seed re-creates the same character). In-app AI tools of the same names: `listCharacterPresets`
(pass `id` for one preset's spec) and `randomCharacter` (commits a version).

Reach for the **hand-written recipe below** when you need anything the spec
doesn't cover (props other than a ball, accessories, logos, garments other
than top / pants / socks / shoes, multi-figure scenes).

### Figure from a photo — fill a spec, don't write code

Picking ~30 parameters costs far fewer tokens than writing, running and
debugging 100+ lines of figure code — and every spec build is valid,
manifold and painted by construction, so no turn is lost to a syntax error,
a buried eye or a missing label. A Funko soccer player that took ≈5.7 k
characters of hand-written code is a ≈0.9 k-character spec that scores within
a few points of it on `photoMatch`. The loop:

1. **View the photo once.** Note style (realistic / chibi / Funko), hair,
   clothing, colours and anything held.
2. **Fill in a CharacterSpec** — `proportions`, `headScale`, `headSink`, hair `style`
   (+ `fringe`/`spike`/`swoop` for anime; `'shag'` + `crown`/`layers`/`raggedness`/`flare`/`backWidth`
   for a shaggy layered jet-black mop; `'captured'` + `volume`/`capturedFringe` for the
   captured Tsubasa hairdo), sleeves / knee shorts (`pants.length: 'shorts'`) /
   socks / footwear (`style: 'toy'`, `cleats`), collar + cuff `trim`, chest / back
   `print` lettering, bead eyes, `colors` sampled from the photo, `pose.hold`
   (`cupL`/`cupR`, `handScale`) for a ball.
3. **Call `buildCharacter(spec)`** (it saves a version; the code is not echoed).
4. **Score with `photoMatch`** — text only (`exclude: ['base']`, the photo's
   camera; a placed figure faces +X, so azimuth 0 is the front, 180 the back).
5. **Adjust spec fields from `worst[]`** — "hair 29% shorter" → `hair.length`,
   "skin 10% narrower across bands 2–4" (the lower face) → `face.jaw` / `cheek`,
   "hair narrower from behind" → shag `backWidth` / `flare` or captured `volume`,
   "feet region smaller" → `feet.size` / toy shoes / legs apart, "ball region
   larger" → `hold.radius`, a colour mismatch → that `colors` entry.
   `getCharacterSpec()` returns the current spec to edit.
6. **Repeat**, looking at an image (`renderView`) only at checkpoints — every
   3–5 builds, and before finishing.
7. **Drop to hand-written code only for what the spec can't express** (logos,
   accessories, other props): `getCode()` gives the generated figure code to
   extend — it stays ordinary, editable `api.sdf.figure` code.

**Worked example — the Captain Tsubasa Funko, spec only (≈1.2 k characters).**
Scores 0.914 front / 0.899 back silhouette IoU against the toy's photos — level
with the ≈5.7 k-character hand-written figure (0.912 / 0.911):

```js
buildCharacter({
  body: { height: 100, proportions: 'funko', headsTall: 3, build: 'slim', sex: 'male',
          headScale: { x: 2.3, y: 1.8, z: 2.1 }, headSink: 0.42, mittens: true },
  pose: { legL: { raiseSide: 8, twist: 26 }, legR: { raiseSide: 8, twist: 26 },
          hold: { kind: 'ball', radius: 10.5, cupR: 'under', handScale: 1.3, color: '#111111' } },
  face: { shape: 'round', lids: 'none', nose: 'straight', brows: 'arched', ears: 'round', mouth: false,
          eyeStyle: 'bead', eyeSize: 1.65, browThickness: 3, browWidth: 1.5, jaw: 1.4, cheek: 1.1 },
  hair: { style: 'shag', seed: 11, spike: 0.55, flare: 0.8, backWidth: 0.7 },   // or { style: 'captured', volume: 0.7, capturedFringe: 0.7 }
  clothing: {
    top: { sleeve: 'short', trim: { collar: true, cuffs: true },
           print: [{ text: 'N', x: 0.55, z: 0.24, size: 0.55, color: '#1f5fc8' },
                   { text: '10', where: 'back', z: 0.08, size: 0.95, color: '#1f5fc8' }] },
    pants: { length: 'shorts', hem: 0.94 },
    socks: { on: true, height: 1.12 },                     // one blue band at the top (colors.sockStripe)
    feet: { style: 'toy', size: 1.3, cleats: 6 },
  },
  colors: { skin: '#f0c9a2', eyes: '#0b0b0d', brows: '#0e0e10', hair: '#101012', top: '#f6f6f6',
            trim: '#1f5fc8', pants: '#1f5fc8', socks: '#f6f6f6', sockStripe: '#1f5fc8',
            feet: '#f4f4f4', sole: '#e6e6e6', base: '#8a8d92' },
});
```

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
  headScale,   // number or {x,y,z} (0.3..4, default 1) — enlarge the HEAD only (toys, chibis). See below.
  proportions, // 'funko' | 'chibi' — toy body-plan presets (defaults for headsTall/build/headScale/faceLayout). See below.
  faceLayout,  // { eyeSpread (default 1), eyeHeight (default 0, × head half-height) } — slide the eyes.
  headSink,    // 0..1.5 × neck length (default 0) — lower the head onto the shoulders ("no neck" toys).
  pose: {      // all optional; neutral standing defaults
    hold,       // { sphere: { radius, center? }, cup: 'sides'|'under', cupL?, cupR?, handScale?, height? } — both hands on a ball (solves the arms)
    arms, legs, // SYMMETRIC shorthand — seeds BOTH sides at once (see below)
    armL, armR, // { raiseSide, raiseFwd, bend, twist, palm | thumb }   degrees — override per side
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
  handSplayL/R, upperLegL/R, lowerLegL/R, kneeHingeL/R, footL/R}` — unit directions
  for orienting parts. `elbowHingeL/R` is the **bone** hinge (used by muscle bellies
  and the arm builder — doesn't rotate under `wristRoll`). `handSplayL/R` is the
  **hand** splay axis (= elbow hinge spun by `wristRoll` / `palmFacing` / `thumbAxis`)
  — what `rig.grip.{L,R}.gripAxis` and the placed hand consume. `kneeHingeL/R`
  is the knee bend axis; `footL/R` is the foot heading, yawed by `leg*.twist` turnout.
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

> **Toy heads — `headScale`, `proportions`, `faceLayout`.**
> - **`headScale`** (a number, or `{x, y, z}` = width / depth / height in the head
>   frame) grows the head **up from the chin**: crown, `r.head/headX/headZ` and
>   every `rig.face` anchor scale with it, so `F.head`, `F.face.*`, `F.faceDetail`,
>   `F.hair`, the neck blend and `F.placeOnHead` all follow — never mutate
>   `rig.r` / `rig.face` by hand. **`height` stays the TOTAL crown height**: the
>   body below the chin shrinks to make room (`{height:100, headScale:1.7}` is still
>   100 tall). The body's girth does *not* grow with the head.
> - **`proportions: 'funko'`** = `headsTall: 3`, `build: 'slim'`,
>   `headScale: {x: 2.5, y: 1.8, z: 1.7}` (head ≈ 45% of the height, ~1.3× wider
>   than tall), `faceLayout: {eyeSpread: 1.25, eyeHeight: -0.35}`, plus limb radii
>   ×0.82–0.9 (chest ×0.95) and feet ×1.15. **`'chibi'`** = `headsTall: 3`,
>   `build: 'average'`, `headScale: {x: 1.4, y: 1.25, z: 1.25}` (head ≈ 38%),
>   `faceLayout: {eyeSpread: 1.1, eyeHeight: -0.12}`, feet ×1.1. Any explicit
>   `headsTall` / `build` / `headScale` / `faceLayout` on the same call wins.
> - **`faceLayout`** — `eyeSpread` multiplies the eyes' (and brows') lateral
>   offset; `eyeHeight` moves the eyes along head-up (× head half-height; negative
>   = lower). Brows, nose and mouth follow at 60% of `eyeHeight`, so the eye→nose
>   gap stays readable and the mouth never lands on the chin.
>
> **Two-hand ball hold — `pose.hold`.** `pose: { hold: { sphere: { radius: 12 },
> cup: 'sides' } }` solves BOTH arms (shoulder, elbow, twist + wrist roll — a
> deterministic IK over the rig's own FK) so each palm rests on the ball:
> `'sides'` (default) = hands on its lower sides, fingers wrapping forward;
> `'under'` = cradled from below. `center` defaults to just in front of the torso
> at belly/chest height (`height` overrides the z). Don't also pass
> `arms`/`armL`/`armR` (rejected). **Per hand:** `cupL` / `cupR` (each
> `'sides'|'under'`, default `cup`) — e.g. `{ cupR: 'under', cupL: 'sides' }` puts
> the right hand under the ball and the left at its side. An `'under'` contact may
> slide a little up/around the ball (≈10–15°) to where a short toy arm actually
> reaches, so the palm lands ON it (residual ≈3–5% of the hand, was ~24%).
> **`handScale`** (0.5..2.5, default 1) is the hand size the solve assumes — big
> vinyl **mitten** hands: `handScale: 1.3` + `F.hands(rig, { grip: 'open',
> fingers: false })` (`F.hands` defaults its `size` to `hold.handScale`, so the
> built hands always match the solve). The result lands on **`rig.hold`**
> `{ center, radius, cup, cupL, cupR, handScale, contactL, contactR, residual }`
> (`residual` = worst palm-to-contact gap; ≲10% of the hand is a clean cup) and
> **`F.heldSphere(rig)`** returns the ball as an SDF sphere to label. Build
> `F.hands(rig, { grip: 'open' })`.
>
> **Head drop — `headSink`.** Funko / chibi toys often have no visible neck: the
> big head sits right on the shoulders. `F.rig({ headSink: 0.42 })` lowers the
> head centre, crown, chin and every face anchor by `headSink` × the neck length
> (1 = the chin on the shoulder line), so `F.head`, `F.face.*` (eyes, nose,
> brows, ears), `F.hair`, `F.faceDetail`, `F.placeOnHead` and `F.neck` all follow
> — no hand-translating the face, hair and eye nodes. The body is unchanged, so
> the crown (and the total height) drops by that much; `F.place(…, { height,
> heightOf: 'body' })` measures to the sunk crown.
>
> **Floor + facing — `rig.floorZ` / `F.place`.** `rig.floorZ` is the sole bottom
> (lowest `sole.*.groundZ`; `F.ground` keeps it current). Finish a figure with
> `return F.place(model, rig, { floor: 0, face: '+X' })` on the **built** mesh
> (after `.build({ detail })`, so the face-detail regions still line up): it drops
> the model's true bottom (base or soles; `drop: 'sole'` forces `rig.floorZ`) to
> `floor` and turns the builder's −Y front to `face` ('-Y' | '+X' | '+Y' | '-X').
> `height: 113` additionally rescales to that total height — measured to the
> top of the bounds, so tall crown spikes shrink everything else; pass
> `heightOf: 'body'` to measure floor → `rig.joints.crown` (the skull top as
> rigged) instead, so the hair/hat doesn't change the figure's size.
>
> **`F.surfacePoint(surface, point, dir, { reach })`** returns the first
> inside→outside crossing of any SDF node along the line through `point` — seat a
> custom feature on the REAL built face instead of an `evaluate` loop:
> `F.surfacePoint(face, rig.face.eyeL, rig.dir.headForward)` is the cheek-bulged
> face front at the eye (or `null`).

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

**Person holds a thing — `holds: '<direction>'` on the arm pose + `F.grasp(prop, grip)`.**
This is the recommended one-line API for any single-handed grasped prop (sword,
staff, hammer, mug, torch). **Build the prop centred at the origin along its
local +Z, with the BUSINESS END at +Z** (sword: blade at +Z, pommel at −Z;
hammer: head at +Z, handle butt at −Z). Then:

```js
// 1. Arm pose: declare the direction the held thing points in.
//    `holds: 'up' | 'down' | 'forward' | 'back' | 'in' | 'out' | [x,y,z]`
const rig = F.rig({ height: 66, pose: {
  armR: { raiseSide: 5, raiseFwd: 0, bend: 90, holds: 'up' },
}});

// 2. Build the prop centred at origin, long axis +Z, business end at +Z.
const sword = grip.union(guard).smoothUnion(blade);   // blade at +Z, pommel at −Z

// 3. Seat it. F.grasp auto-flips for the right hand so the blade end lands
//    at the thumb (no flip flags, no per-figure tuning).
const held = F.grasp(sword, rig.grip.R);
```

`F.grasp` puts the bar IN the finger cup, side-aware: thumb at the guard end
on either hand. The four success criteria (visible blade direction; thumb at
business end; bar in finger cup; fingers visibly wrap) are met by construction
when you use this pattern. **`examples/figure_knight.js` is the canonical
reference** — copy that pattern for any one-handed grasping figure.

> **Asymmetric props (axe, hammer, scythe, scalpel) — which local axis becomes
> "forward"?** Once you've built the prop along +Z with the business end at
> +Z, `F.grasp` + `holds: 'up'` on the right hand maps the prop's OTHER local
> axes like this:
>
> | prop local | world (after `F.grasp(prop, rig.grip.R)` with `holds: 'up'`) |
> |---|---|
> | `+Z` | `+Z` (up — the bar is vertical, business end at top) |
> | `+X` | `−Y` (FORWARD — toward the camera at the front of the figure) |
> | `+Y` | `+X` (figure-LEFT, across the body to the side) |
>
> So an axe whose **blade flares forward** needs the flare built along local
> `+X` (NOT `+Y`). A sword whose **flat edge faces the camera** has its flat
> normal along local `+X`. The mapping is symmetric on the left hand with
> sign flips. When unsure, probe before bake:
> `console.log({ gripAxis: rig.grip.R.gripAxis, palmNormal: rig.grip.R.palmNormal, reach: rig.grip.R.reach })`
> and read the world unit vectors (in the run result's `logs`) to confirm which way each local axis points.
> `examples/figure_lumberjack.js` uses this exact mapping for the axe blade.

**QC the grip BEFORE bake — `F.graspProbe(rig, 'R'|'L')`.** Catches grip
defects without rendering. Returns `{ gripDirection, barCupDistance, summary }`:
- `gripDirection` — world unit vector the prop's business end points in
  (after F.grasp's auto-flip). Assert it matches your `holds:` intent.
- `barCupDistance` — distance from bar to wrist in `r.hand` units. Healthy ≥ 0.7;
  a low value means the bar is at the wrist line (the old "sword at wrist" defect).
- `summary` — one-line verdict, ready for `throw new Error(q.summary)`.

```js
const q = F.graspProbe(rig, 'R');
if (q.gripDirection[2] < 0.9) throw new Error(q.summary);  // not visibly up
if (q.barCupDistance   < 0.7) throw new Error(q.summary);  // not in finger cup
```

**Low-level alternative — `F.holdAt(prop, rig.grip.L|R, opts?)`.** Same as
`F.grasp` but without the auto-flip and the AI-friendly defaults. Use this when
you need explicit control: a non-`z` long axis (`opts.along`), a manual flip
(`opts.flip`), or a prop that legitimately needs the OPPOSITE end at the thumb
(a torch held head-down, a candle). For ordinary "person holds a thing" reach
for `F.grasp`. `opts.up` (`'palm'` default | `'reach'`) picks which hand
direction the prop's +Y maps to; `opts.flip: true` reverses the axis;
`opts.along` (`'x'|'y'|'z'`) selects the long axis (non-`z` uses the legacy
single-axis align, roll unconstrained).

```js
// A sword: blade +Z, flat ±Y, guard ±X — held in the right fist, palm grasping:
const held = F.holdAt(sword, rig.grip.R);       // +Z→gripAxis, +Y→palmNormal, origin→cup
```

> **Aim a held prop by posing the arm + a hand-orient hint — don't fight `holdAt`.**
> How a hand is turned is set by the arm pose, not by `holdAt`. There are three
> entry points for the wrist-roll DOF (forearm pronation/supination), all writing
> the SAME degree of freedom — **pick one** (parseArm rejects setting more than one):
>
> - **`palmFacing`** — the most human-meaningful: "knuckles to camera" / "back of
>   hand outward" / "palm up". Accepts `'forward' | 'back' | 'in' | 'out' | 'up'
>   | 'down'` or an explicit `[x,y,z]` world direction. The solver picks the wrist
>   roll that lands the palm's normal as close as geometry allows to the target.
>   Use this for "show the back of the hand" / "show the palm" intent.
> - **`thumbAxis`** — for "thumb up at the top of the grip" / "thumb pointing
>   forward". Same value vocabulary as `palmFacing`; solves for the thumb axis
>   instead of the palm normal. The knight uses this implicitly via its pose +
>   `wristRoll: 90` (vertical-blade default).
> - **`wristRoll: degrees`** — raw numeric forearm rotation, mirrored by `side`.
>   Use only when you need precise numeric control (e.g. animating a sequence).
>
> Geometry to keep in mind — this coupling is real human anatomy and cannot be
> wished away: a held bar lies along `gripAxis`, which is **⊥ the forearm** (you
> grip across the palm). So:
> - **The forearm direction sets the blade direction.** Vertical blade requires a
>   horizontal forearm (forward, sideways, or anywhere in between).
> - **`wristRoll` then spins the hand AROUND the forearm**, independently picking
>   which side of the hand the camera sees — palm vs back, thumb up vs down.
> - **These two CAN combine**: vertical blade with knuckles directly to camera
>   requires the forearm to point to the SIDE (not forward), because cross(foreDir, +Z)
>   only lands on ±Y when foreDir is in the ±X direction. For a forearm-forward grip,
>   the camera sees the SIDE of the hand (thumb visible, fingertips wrapping toward
>   the camera) — that's anatomically correct, not a bug.
>
> The knight uses `armR: { raiseSide: 5, raiseFwd: 0, bend: 90, wristRoll: 90 }`
> — elbow at the side, forearm forward at chest height, sword vertical. To get
> knuckles directly to camera with a vertical blade, switch to an arm-out-to-side
> pose: `{ raiseSide: 70, raiseFwd: 0, bend: 5, palmFacing: 'back' }`.
>
> Probe with `F.poseProbe(rig).grips.R` — `thumbAxis · [0,0,1] > 0` ⇒ thumb up,
> `palmNormal · [0,1,0] > 0` ⇒ knuckles toward -Y camera, and `gripAxis` **is**
> the blade direction.
>
> Legacy `thumb` / `palm` keywords are retained and still work, but they solve a
> different DOF (upper-arm roll) that's anatomically incorrect — `thumb:'up'` on
> a low forward arm can fling the elbow out because the 1-DOF curve about the
> upper-arm axis can't reach +Z. Prefer `palmFacing` / `thumbAxis` for new code.

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

**Trim zones — collar, cuffs, sock bands: `F.trimZone(rig, opts)` + `F.trim(garment, zone)`.**
A trim is the same garment surface in another colour, so it's a REGION, not new
geometry: `F.trimZone` returns an unlabelled disc slab perpendicular to a limb
bone or a body ring, and `F.trim(garment, zone)` splits the garment into
`{ rest, band }` — label each and hard-union both.

```js
F.trimZone(rig, {
  bone: 'upperArm' | 'lowerArm' | 'upperLeg' | 'lowerLeg',   // both sides; + 'L' / 'R' for one ('lowerLegL')
  //  …OR ring: 'neck' | 'waist'                               // a band ⟂ the body axis at rig.ring.*
  at, width,        // bone: centre (0..1, root → tip) + band width (world units) — or:
  from, to,         // bone: span as fractions of the bone (may run past 0/1 a little)
  stripes,          // 1..12 (1): split the span into n bands with equal gaps (striped socks)
  radius,           // disc radius (≈2.4× the limb / 1.6× the ring radius) — keep it off other limbs
  offset,           // ring: move along the body axis (+ up); width = the band height
})
const top = F.garment.top(rig, { sleeve: 'short' });
const kit = F.trim(top.all, F.trimZone(rig, { ring: 'neck', width: r.neck * 0.7 })
  .union(top.sleeves.intersect(F.trimZone(rig, { bone: 'upperArm', from: 0.35, to: 1.4 }))));
const jersey = kit.rest.label('jersey'), cuffs = kit.band.label('trim');
// Socks with a band at the top (or `stripes: 3` for hoops):
const shins = F.legs(rig).round(1).intersect(F.trimZone(rig, { bone: 'lowerLeg', from: -0.1, to: 1.1 }));
const sock = F.trim(shins, F.trimZone(rig, { bone: 'lowerLeg', from: -0.1, to: 0.22 }));
const socks = sock.rest.label('socks'), sockband = sock.band.label('sockband');
```

**Lettering on a garment — `F.emboss(shape, on, opts)`.** A chest initial or a
back number, **conformal** to the cloth: the 2D shape is projected along the
surface normal at `at` and cut from `on` grown outward by `depth`, so every
stroke follows the garment's curvature and stands `depth` proud of it.
`shape` is a **string** (laid out in Liberation Sans — needs `size`), a
**CrossSection** (anything with `toPolygons()`, e.g. `api.textSection(…)` or a
`CrossSection.circle(…)` logo), or raw `[[x, y], …][]` contours (even-odd, so
counters/holes work). Self-labelled — hard-union it at the top level:

```js
const N   = F.emboss('N',  top.all, { at: [7, -r.chestY * 1.6, j.chest[2] + 3], size: 7,  depth: 0.7, label: 'numeral' });
const ten = F.emboss('10', top.all, { at: [0,  r.chestY * 1.6, j.chest[2] + 1], size: 12, depth: 0.7, label: 'numeral' });
// opts: { at (required — a point on/just off the surface where the lettering
//   centres), size (overall height; required for text), depth (relief, default
//   ≈ 0.08·size), label ('emboss'), font ('bold' | 'regular' | 'italic' |
//   'bold-italic'), spacing (letter spacing ×), up (which way the lettering
//   reads, default world +Z), dir (projection direction, default the surface
//   normal), mirror (flip it) }
```

Reads the right way round from outside on any side (front or back). Small
strokes want a detail sphere over them (`detail: [{ center, radius, edgeLength }]`)
if your global `edgeLength` is coarse.

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
tuning a pose. `console.log(F.poseProbe(rig).text)` returns the whole readout
in the run result's `logs` (the model still builds) so you can read where a hand/grip actually landed
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

### Eyes — `style: 'iris'` (default), `'solid'` or `'bead'`

```js
F.face.eyes(rig)                              // white + 'iris' + 'pupil', SELF-labelled
F.face.eyes(rig, { style: 'solid' }).label('eyes')   // one-colour round eyes
F.face.eyes(rig, { style: 'bead', on: face })  // glossy vinyl-toy bead + glint: 'eyes' + 'eyeHighlight'
```

**`'bead'`** is the Funko / vinyl-toy eye: a flattened black ellipsoid bead per
eye, seated on the **real** face front (`on`: the face or skin node you union —
the cheek-bulged surface, not the rig anchor) and sunk a quarter of its width in,
plus a **specular highlight** — a big round glint up and to the viewer's left
and a small one below right (the same light on both eyes), each a small sphere
on the bead's surface, self-labelled **`'eyeHighlight'`** (paint it white).
Knobs: `radius` (the bead's half-width, default 0.24 × `rig.r.head`), `aspect`
(height ÷ width, 1.06), `highlight` (`true` default | `false` | a size
multiplier). `lids` / `gaze` don't apply to a bead (rejected). Pair with
`detail: F.faceDetail(rig)` so the glints mesh round. To seat a custom feature
yourself, **`F.face.surfaceY(face, x, z)`** returns the world Y of the face's
front at world x / z (builder frame — the front is −Y, before `F.place`), or
`null` where the line misses it.

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

The `on` brow **seats on the real surface**: if the welded forehead isn't where
the rig anchors expect (a `cheek` ≳ 1.2 weld or a `headScale`'d Funko head pushes
it forward), each brow arc is projected onto the actual surface along
`headForward`; and a face **translated after building** carries its brows along —
`on: face.translate(0, 0, dz)`, or the **whole weld** that holds that moved face
(`on: skin`): the brow finds the translate inside the union (the most specific
translated part sitting on the rig head — a primitive merely *positioned* at the
head isn't mistaken for a move). Simpler still: lower the head with the rig's
`headSink` and nothing needs translating. If the brow still
can't reach the `on` surface (wrong node), `F.face.brows` **throws** ("…would
paint 0 triangles") instead of silently returning a buried, invisible brow. The
same guard covers `F.nipples(rig, { on })`.

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
//   ears: 'cover' (default, hair over the ears; 'over' is an alias) | 'behind' (tucked behind them,
//         so ears protrude — see the hair⇄ear section under Face above).
//   style: 'short' | 'long' | 'bob' | 'bun' | 'bald' | 'bangs' | 'ponytail'
//          | 'afro' | 'braids' | 'spiked' | 'locs' | 'cornrows' | 'boxBraids' | 'mop' | 'anime' | 'shag'
//          | 'captured'
//   'mop' — shaggy anime / vinyl-toy hair: a cap hugging the real head (pass
//     `on: head`, your F.head node, for a non-default faceShape) + N irregular
//     tapered locks: a zig-zag fringe ending just above the brows, sideburns and
//     outward side flicks, a shaggy mid layer, layered nape locks and crown
//     tufts — no bald temple strip. Extra keys (mop only):
//     { locks: 8..64 (28), spread: 0..3 (1, how far tips lift/lean), seed (1 —
//       same seed ⇒ identical hair), flick: 0..3 (1, side flicks outward),
//       fringe: 0..1.5 (1 = to the brows; lower = shorter), on: headNode }
//     `length` drops the nape locks; `volume` thickens cap + locks.
//   'anime' — the classic anime / vinyl-toy mop (Funko hair): a THIN cap
//     hugging the real (headScale'd) skull, trimmed by a tilted hairline plane
//     (high at the face, low at the nape) with an arched face window, plus a
//     FEW big, flat RIBBON locks that lie on the skull and come to sharp
//     points: 4–6 broad fringe locks sweeping sideways over the forehead and
//     overlapping like shingles, per side a sideburn curving forward to a point
//     at cheek level + an over-the-ear lock + a temple flare kicking out, 3–5
//     crown locks running back over the top and flicking up, and layered back
//     locks pointing down to the nape. Pass `on: head`.
//     Extra keys: { locks: 8..40 (14 ≈ 16 visible locks), seed (1), on: headNode,
//       fringe: 0..1.5 (1 = tips just above the brows; lower = shorter),
//       spike: 0..3 (1, how far crown locks flick up), swoop: −1..3 (1, how
//       far the fringe sweeps sideways; 0 = straight down),
//       lockShape: 'ribbon' (default — flat lens-section locks ~3:1 wide:thick,
//         wide axis tangent to the skull) | 'tube' (round tapered tubes, same layout),
//       chunk: 0.4..2.5 (1, lock width multiplier) }
//     `length` drops sideburns/nape; `volume` widens the crown + thickens locks.
//     Locks are hard-unioned and welded into the cap once (small smooth blend,
//     no root seams).
//   'shag' — a shaggy LAYERED vinyl-toy mop (the jet-black spiky-mop look): the
//     anime cap + many MEDIUM ribbon locks — an uneven, messy fringe (seeded
//     length / lean / width per lock) over a NOTCHED hairline (a crisp pointed
//     tooth of cap under each fringe lock, so the fringe reads as separate locks
//     with V-gaps), up to 3 overlapping layers over the sides + back each hanging
//     lower than the last to a jittered ragged hem, a temple "flare" mop mass
//     above the ears, and a crown. Side/back tails keep a chunky tip.
//     Pass `on: head`. Extra keys:
//     { crown: 'spiky' (default — 7 big needle-pointed spikes round the back and
//         sides of the crown, pushing out of the dome so the top silhouette is
//         spiky) | 'tousled' (7 small random crown locks),
//       spike: 0..3 (1, crown-spike lift; ~0.5 for small tufts),
//       crownSize: 0.3..2.5 (1, spike width + reach),
//       notched: true (default) | false (the plain smooth-blended fringe edge),
//       backWidth: 0.3..1.6 (1, how far the side/back layers + puffs stand off
//         the skull — < 1 narrows the silhouette from behind),
//       layers: 1..3 (3, integer — 1 = the
//         high side layer only, 2 + the ear-level layer, 3 + the nape layer),
//       locks: 0.5..2 (1, lock DENSITY multiplier — not a count here),
//       fringe: 0..1.5 (1 = tips just above the brows; lower = shorter),
//       raggedness: 0..2 (1, jitter of lock length / lean / hem; 0 = tidy),
//       flare: 0..3 (1, mop mass above the ears — widens the head at temple
//         height; 0 = skull-hugging), tipWidth: 0..0.8 (0.4, side/back tail
//         tip half-width × root width), chunk: 0.4..2.5 (1, lock width),
//       seed (1 — same seed ⇒ identical hair), on: headNode }
//     `length` drops the hem; `volume` thickens the cap + locks. (Each lock is
//     bounding-box culled at build time, so 'shag' meshes about as fast as 'anime'.)
//     F.hair(rig, { style: 'shag', crown: 'spiky', on: head, seed: 11 })
//   'captured' — a hairdo CAPTURED from a real mesh and replayed onto this head:
//     a radial height field of the hair's outer surface + a coverage mask (face
//     window, hem), smooth-interpolated, so spikes stay crisp with no stair
//     steps. Measured on the real head (face front, face width, eye-to-chin) so
//     it follows headScale / proportions / faceShape / head pose; where the head
//     is bigger than the source's the hair is lifted (layers kept), never
//     clipped. Much faster to build than the lock styles (one field, no locks).
//     Pass `on: head`. Defaults reproduce the capture literally. Extra keys:
//     { preset: 'tsubasa' (default — the Captain Tsubasa Funko's shaggy mop:
//         a messy fringe of pointed locks, layered sides, a deep back to the nape),
//       spikiness: 0..3 (1, amplifies the detail — spike height, point depth of
//         the fringe + hem; < 1 calms it), smooth: 0..1 (0, softens tips and
//         points), fringe: 0.3..2 (1, stretches the front hair below its roots;
//         < 1 lifts the fringe off the brows), mirror: true (flip left↔right —
//         the part / sweep goes the other way), tilt: −40..40 (0, deg — pitches
//         the whole hairdo about the ear-to-ear axis; + sweeps it back),
//       windowScale: 0.5..2 (1, face-window size — > 1 shows more face),
//       on: headNode }
//     `volume` scales the thickness ABOVE the skull (1 = literal);
//     `length` ('short' | 'mid' | 'long') stretches the side/back hem;
//     `thickness` sets the minimum cover where the head outgrows the capture.
//     Overhangs fill in (the field is star-shaped from the head centre: a lock
//     lying over the forehead keeps no gap beneath it; under-flaring tails are
//     solid to the head) and rounded locks resting on the hair read as ridges.
//     F.hair(rig, { style: 'captured', preset: 'tsubasa', on: head })
//     F.hair(rig, { style: 'captured', on: head, volume: 1.35, spikiness: 1.8 })   // bigger + spikier
//     Capture another hairdo (CLI, from a segmented session export or a hair-only STL):
//       node scripts/capture-hair.mjs model.partwright.json --out src/geometry/hairCapture/presets/<name>.ts
//         [--hair hair --skin skin --eyes eyes] [--forward +X --up +Z] [--grid 128x64]
//       node scripts/capture-hair.mjs hair.stl --out … --origin x,y,z --width W --chin H
//     (a session export needs accepted part labels — Part Detection → Accept —
//     naming the hair, skin and eyes; an STL must be hair only and gives the
//     landmarks by hand: face front at eye height on the midline, face
//     half-width at eye height, eye-to-chin drop). Then add the preset to
//     src/geometry/hairCapture/presets/index.ts. ≈ 24 KB of source per preset.
//   Helpers for hand-built hairdos (same pieces 'anime' uses):
//     F.hair.cap(rig, { on, thickness, crown, hairlinePlane: { front, back },
//       window: { width, top, tilt, notches, depth, span } | false })   // heights in head-Z radii above the head centre
//       // notches: 0..24 (0) — a JAGGED hairline: that many pointed teeth of cap
//       // hanging into the window's top edge (crisp hard points, unlike a
//       // smooth-blended fringe); depth: tooth length × headZ (0.15);
//       // span: ±degrees of azimuth they spread over (≈52).
//       // The window is cut RADIALLY (its walls run toward the head centre), so
//       // the hair ends at the face in a clean full-thickness step — no knife-edge
//       // sliver at the temples, even where proud painted brows meet the hairline.
//     F.hair.tuft(rig, { base, dir, length, width, thickness, curve, shape, twist, tipWidth })
//     F.hair.tuft(rig, { from: { az, el }, to: { az, el, out }, via?, on: head, width, … })
//       // surface endpoints — no hand-written ray-march helpers: each point is
//       // { az: deg (0 = face, +90 = figure's left, 180 = back), el: deg
//       // elevation (radial march) OR h: height above the head centre × headZ
//       // (horizontal march — use on the face side), out: units outside the
//       // skin (from defaults slightly buried, to 0) }. via = an optional
//       // surface mid point the lock passes through (else `curve` bends it).
//       // tipWidth (ribbon only) = tip half-width floor, so tails stay chunky.
//       // one lock tapering to a point. shape: 'ribbon' (default) — a flat lock
//       // whose wide axis lies tangent to the head (⊥ the ray from the head
//       // centre); width = root HALF-width (default 0.28 head radii), thickness =
//       // root half-thickness (default width/3.6), twist = degrees the section
//       // turns root→tip. shape: 'tube' — round; width = root radius (no
//       // thickness/twist). curve: number = flick toward head-up (× length), or
//       // a Vec3 mid offset. Bury the base a little inside the cap so it welds.
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
F.clothing.pants(rig, { rise, leg, cuffZ, thickness, length, hem })
//   rise: low|mid|high · leg: slim|cargo · length: 'full' (default) | 'shorts' | 'briefs'
//   'shorts' = knee-length: the leg cut square across each thigh at `hem`
//   (0.2..1.2 of the hip→knee bone, default 0.9 = just above the knee),
//   perpendicular to the bone so it follows a posed leg.
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
F.clothing.shoes(rig, { size, thickness, label, sole, style, height, cleats })  // sole + upper over each foot
//   style: 'fitted' (default — hugs the foot) | 'toy' (a chunky, rounded vinyl-toy
//     sneaker — Funko: a big rounded body + fat toe cap well past the foot on a
//     thick flat sole; `size` 1.2–1.4 for a Funko). Toy-only: `height` (0.4..2.5,
//     upper height ×) and `cleats` (true = 6 studs, or 2..12) — studs under the
//     sole that protrude below the ground plane (they weld into a base; without
//     one the figure stands on them).
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

## Funko / chibi figure — the recipe

All four toy primitives together (a vinyl-pop soccer player holding a ball):

```js
const { sdf } = api, F = sdf.figure;
const rig = F.rig({ height: 100, proportions: 'funko', sex: 'male', headSink: 0.4,   // head on the shoulders
  pose: { hold: { sphere: { radius: 12 }, cupR: 'under', cupL: 'sides', handScale: 1.3 }, legs: { raiseSide: 5 } } });
const r = rig.r, j = rig.joints;
const head = F.head(rig, { faceShape: 'round', cheek: 1.1 });
const face = F.face.assemble(head, rig, { eyes: false, mouth: false, brows: false, ears: false,
  nose: { type: 'straight', tipRadius: 2.1, projection: 1.7 } });
const skin = F.weld(rig, [F.torso(rig), F.neck(rig), F.arms(rig), F.hands(rig, { grip: 'open', fingers: false }),
  F.legs(rig), F.feet(rig), face]).label('skin');   // mitten hands, sized to hold.handScale
// Glossy bead eyes seated on the REAL face front, with a white specular glint.
const eyes = F.face.eyes(rig, { style: 'bead', on: face, radius: 5.3 });   // 'eyes' + 'eyeHighlight'
// Brows seat on the real face — pass the node you union (a weld holding a moved face works too).
const brows = F.face.brows(rig, { shape: 'arched', thickness: 3, width: 1.5, on: skin });
// Shaggy layered mop: notched fringe, spiky crown ('anime' for a spiky bob, 'mop' for curls).
const hair = F.hair(rig, { style: 'shag', crown: 'spiky', on: head, seed: 7, spike: 0.5 }).label('hair');
const top = F.garment.top(rig, { sleeve: 'short' });
const kit = F.trim(top.all, F.trimZone(rig, { ring: 'neck' })              // collar…
  .union(top.sleeves.intersect(F.trimZone(rig, { bone: 'upperArm', from: 0.35, to: 1.4 }))));   // …and cuffs
const shirt = kit.rest.label('shirt'), trim = kit.band.label('trim');
const number = F.emboss('10', top.all, { at: [0, r.chestY * 1.6, j.chest[2]], size: 12, label: 'numeral' });
const shoes = F.clothing.shoes(rig, { style: 'toy', size: 1.3 });       // chunky vinyl sneakers ('shoes' + 'sole')
const ball = F.heldSphere(rig).label('ball');
const base = F.base(rig, { radius: 36 }).label('base');
const model = sdf.union(skin, eyes, brows, hair, shirt, trim, number, shoes, ball, base)
  .build({ edgeLength: 0.78, detail: F.faceDetail(rig) });
return F.place(model, rig, { face: '+X' });   // floor at z = 0, facing +X
```

> **Previewing a `+X`-facing figure headlessly.** `model:preview --view az,el`
> puts the camera at azimuth `az` measured from **+X** (toward +Y): for a figure
> placed with `face: '+X'`, **az 0 = front (face), 180 = back, 90 = the figure's
> LEFT profile, 270 (or −90) = its RIGHT profile**, and e.g. −40 a 3/4 view of the
> figure's right temple — `--view "0,8;180,8;270,8;-35,20"`. (`F.place` turns the
> builder's −Y front to +X, so the builder's +X — the figure's left — ends up on
> +Y.) The *named* views are fixed to the builder's −Y front (`--views front` =
> az −90), so on a `+X` figure the named `front` is a profile and `right` is the
> face. An UNplaced figure (builder frame, facing −Y) is the opposite: az −90 is
> the face, 90 the back.

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
   sufficient. With a reference photo attached, run **`photoMatch`** each pass
   (text only — silhouette IoU, per-band widths, per-part size/offset/colour,
   and a `worst[]` list such as "hair: model 27% narrower across bands 0–1") and
   fix what it names; look at rendered images only at checkpoints. Exclude the
   display base (`exclude: ['base']`) when the photo shows none. See
   `/ai/reference-images.md#photo-match`.

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
