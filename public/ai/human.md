# Parametric human — `api.human` (experimental)

**When to reach for this:** the subject is a **person**: a realistic
anatomical body and face (adult or child), or the same body restyled as an
anime character, a chibi, a Funko-style toy or a comic hero (`style`).
`api.human` starts from MakeHuman's artist-made base mesh (CC0), shapes it with
morph targets, poses it with a real skeleton, dresses it, and returns one
watertight, printable Manifold. You write numbers, not geometry: every result
is a valid body.

> Status: in progress (kemper/partwright#1151). Hair, beards, clothing, armor,
> props, hats and style presets (anime, chibi, Funko-style toy, heroic) are
> built in (below).

> Coordinates: same as the figure rig. **Z up, front −Y, figure's left +X.**
> Soles sit at z = 0 (the base, when on, sits below them).

## One call

```js
return api.human({
  height: 60,                                       // print height, soles → crown (unposed)
  body:  { gender: 0.2, age: 30, muscle: 0.6, weight: 0.45, stature: 0.5, breast: 0.4 },
  face:  { jawWidth: 0.3, cheekbones: 0.5, noseWidth: -0.2, eyeSize: 0.2 },
  morphs: { 'nose-hump': 0.5, 'r-ear-lobe': 0.3, 'l-ear-lobe': 0.3 },   // any MakeHuman slider
  expression: 'smile',                              // or { smile: 0.6, browRaise: 0.3, … }
  pose:  { armR: { raiseSide: 140, bend: 40, twist: 60 }, head: { yaw: -10 } },
  hair:  { style: 'bob', color: '#6b3a1e', beard: 'none' },
  wear:  ['tshirt', 'jeans', 'sneakers', { item: 'belt', color: '#3b2a1e' }],
  hold:  { R: 'sword' },                            // closes the hand round the grip
  accessories: ['cap', 'sunglasses', 'backpack'],
  base:  true,                                      // disc under the feet (or { radius, thickness })
  colors: { skin: '#c68642', iris: '#3b6ea5' },     // optional; defaults paint every label
});
```

Every field is optional and validated. Unknown keys and out-of-range values
throw with the allowed range.

## Body (`body`)

| key | range | meaning |
|---|---|---|
| `gender` | 0–1 | 0 = female, 1 = male (blends in between) |
| `age` | 1–90 | years: 1 baby, 11 child, 25 young adult, 90 old, blended in between |
| `muscle` | 0–1 | 0.5 = average |
| `weight` | 0–1 | 0.5 = average |
| `stature` | 0–1 | real-world proportions of a tall/short person (print size is `height`) |
| `breast` | 0–1 | bust (female side of `gender`; fades out below ~16 years) |
| `ethnicity` | `{ african, asian, caucasian }` | relative mix, normalized (default equal thirds; at least one must be > 0) |

## Face and torso (`face`, `torso`): each −1…1, 0 = neutral

`face`: `jawWidth`, `chin` (prominence), `cheekbones`, `noseWidth`,
`noseLength`, `mouthWidth`, `eyeSize`; plus `headSquare`, which is 0–1.
`torso`: `vShape` (shoulder-to-waist taper), `belly`. These are shortcuts onto
the MakeHuman sliders below (they add to the same keys).

## Morphs (`morphs`) — every MakeHuman modelling slider {#morphs}

`morphs: { key: value }` sets any of MakeHuman's 238 modelling sliders.
Two-way sliders take −1…1 (negative = the first direction, positive = the
second); one-way sliders (marked 0–1) take 0…1. Left/right features have
separate `l-…` / `r-…` keys — set both for symmetry.

| group | keys |
|---|---|
| `head` | `head-age` (decr↔incr), `head-angle` (in↔out), `head-fat` (decr↔incr), `head-oval` (0–1), `head-round` (0–1), `head-rectangular` (0–1), `head-square` (0–1), `head-triangular` (0–1), `head-invertedtriangular` (0–1), `head-diamond` (0–1), `head-scale-depth` (decr↔incr), `head-scale-horiz` (decr↔incr), `head-scale-vert` (decr↔incr), `head-trans-out` (in↔out), `head-trans-up` (down↔up), `head-trans-forward` (backward↔forward), `head-back-scale-depth` (decr↔incr) |
| `forehead` | `forehead-trans` (backward↔forward), `forehead-scale-vert` (decr↔incr), `forehead-nubian` (decr↔incr), `forehead-temple` (decr↔incr) |
| `eyebrows` | `eyebrows-trans-forward` (backward↔forward), `eyebrows-angle` (down↔up), `eyebrows-trans-up` (down↔up) |
| `neck` | `neck-double` (decr↔incr), `neck-scale-depth` (decr↔incr), `neck-scale-horiz` (decr↔incr), `neck-scale-vert` (decr↔incr), `neck-trans-out` (in↔out), `neck-trans-up` (down↔up), `neck-trans-forward` (backward↔forward), `neck-back-scale-depth` (decr↔incr) |
| `eyes` | `r-eye-bag-incr` (decr↔incr), `r-eye-bag-out` (in↔out), `r-eye-bag-height` (decr↔incr), `r-eye-eyefold-angle` (down↔up), `r-eye-epicanthus` (in↔out), `r-eye-eyefold-convex` (concave↔convex), `r-eye-eyefold-up` (down↔up), `r-eye-height1` (decr↔incr), `r-eye-height2` (decr↔incr), `r-eye-height3` (decr↔incr), `r-eye-push1` (in↔out), `r-eye-push2` (in↔out), `r-eye-trans-out` (in↔out), `r-eye-trans-up` (down↔up), `r-eye-scale` (decr↔incr), `r-eye-corner1` (down↔up), `r-eye-corner2` (down↔up), `l-eye-bag-incr` (decr↔incr), `l-eye-bag-out` (in↔out), `l-eye-bag-height` (decr↔incr), `l-eye-eyefold-angle` (down↔up), `l-eye-epicanthus` (in↔out), `l-eye-eyefold-convex` (concave↔convex), `l-eye-eyefold-up` (down↔up), `l-eye-height1` (decr↔incr), `l-eye-height2` (decr↔incr), `l-eye-height3` (decr↔incr), `l-eye-push1` (in↔out), `l-eye-push2` (in↔out), `l-eye-trans-out` (in↔out), `l-eye-trans-up` (down↔up), `l-eye-scale` (decr↔incr), `l-eye-corner1` (down↔up), `l-eye-corner2` (down↔up) |
| `nose` | `nose-trans-up` (down↔up), `nose-trans-forward` (backward↔forward), `nose-trans-out` (in↔out), `nose-scale-vert` (decr↔incr), `nose-scale-horiz` (decr↔incr), `nose-scale-depth` (decr↔incr), `nose-nostrils-width` (decr↔incr), `nose-point-width` (decr↔incr), `nose-base` (down↔up), `nose-width1` (decr↔incr), `nose-width2` (decr↔incr), `nose-width3` (decr↔incr), `nose-compression` (compress↔uncompress), `nose-curve` (concave↔convex), `nose-greek` (decr↔incr), `nose-hump` (decr↔incr), `nose-volume` (decr↔incr), `nose-nostrils-angle` (down↔up), `nose-point` (down↔up), `nose-septumangle` (decr↔incr), `nose-flaring` (decr↔incr) |
| `mouth` | `mouth-scale-horiz` (decr↔incr), `mouth-scale-vert` (decr↔incr), `mouth-scale-depth` (decr↔incr), `mouth-trans-out` (in↔out), `mouth-trans-up` (down↔up), `mouth-trans-forward` (backward↔forward), `mouth-lowerlip-height` (decr↔incr), `mouth-lowerlip-width` (decr↔incr), `mouth-upperlip-height` (decr↔incr), `mouth-upperlip-width` (decr↔incr), `mouth-cupidsbow-width` (decr↔incr), `mouth-dimples` (in↔out), `mouth-laugh-lines` (in↔out), `mouth-lowerlip-ext` (down↔up), `mouth-angles` (down↔up), `mouth-lowerlip-middle` (down↔up), `mouth-lowerlip-volume` (decr↔incr), `mouth-philtrum-volume` (decr↔incr), `mouth-upperlip-volume` (decr↔incr), `mouth-upperlip-ext` (down↔up), `mouth-upperlip-middle` (down↔up), `mouth-cupidsbow` (decr↔incr) |
| `ears` | `r-ear-trans-forward` (backward↔forward), `r-ear-scale` (decr↔incr), `r-ear-trans-up` (down↔up), `r-ear-scale-vert` (decr↔incr), `r-ear-lobe` (decr↔incr), `r-ear-shape-triangle` (pointed↔triangle), `r-ear-rot` (backward↔forward), `r-ear-shape-round` (square↔round), `r-ear-scale-depth` (decr↔incr), `r-ear-wing` (decr↔incr), `r-ear-flap` (decr↔incr), `l-ear-trans-forward` (backward↔forward), `l-ear-scale` (decr↔incr), `l-ear-trans-up` (down↔up), `l-ear-scale-vert` (decr↔incr), `l-ear-lobe` (decr↔incr), `l-ear-shape-triangle` (pointed↔triangle), `l-ear-rot` (backward↔forward), `l-ear-shape-round` (square↔round), `l-ear-scale-depth` (decr↔incr), `l-ear-wing` (decr↔incr), `l-ear-flap` (decr↔incr) |
| `chin` | `chin-jaw-drop` (decr↔incr), `chin-cleft` (decr↔incr), `chin-prominent` (decr↔incr), `chin-width` (decr↔incr), `chin-height` (decr↔incr), `chin-bones` (decr↔incr), `chin-prognathism` (decr↔incr) |
| `cheek` | `l-cheek-volume` (decr↔incr), `l-cheek-bones` (decr↔incr), `l-cheek-inner` (decr↔incr), `l-cheek-trans` (down↔up), `r-cheek-volume` (decr↔incr), `r-cheek-bones` (decr↔incr), `r-cheek-inner` (decr↔incr), `r-cheek-trans` (down↔up) |
| `torso` | `torso-scale-depth` (decr↔incr), `torso-scale-horiz` (decr↔incr), `torso-scale-vert` (decr↔incr), `torso-trans-out` (in↔out), `torso-trans-up` (down↔up), `torso-trans-forward` (backward↔forward), `torso-vshape` (decr↔incr), `torso-muscle-dorsi` (decr↔incr), `torso-muscle-pectoral` (decr↔incr) |
| `hip` | `hip-scale-depth` (decr↔incr), `hip-scale-horiz` (decr↔incr), `hip-scale-vert` (decr↔incr), `hip-trans-out` (in↔out), `hip-trans-up` (down↔up), `hip-trans-forward` (backward↔forward), `hip-waist` (down↔up) |
| `stomach` | `stomach-navel-out` (in↔out), `stomach-tone` (decr↔incr), `stomach-pregnant` (decr↔incr), `stomach-navel-up` (down↔up) |
| `buttocks` | `buttocks-volume` (decr↔incr) |
| `pelvis` | `pelvis-tone` (decr↔incr), `bulge` (decr↔incr) |
| `armslegs` | `r-hand-fingers-distance` (decr↔incr), `r-hand-fingers-diameter` (decr↔incr), `r-hand-fingers-length` (decr↔incr), `r-hand-scale` (decr↔incr), `r-hand-trans` (in↔out), `l-hand-fingers-distance` (decr↔incr), `l-hand-fingers-diameter` (decr↔incr), `l-hand-fingers-length` (decr↔incr), `l-hand-scale` (decr↔incr), `l-hand-trans` (in↔out), `r-foot-scale` (decr↔incr), `r-foot-trans-out` (in↔out), `r-foot-trans-forward` (backward↔forward), `l-foot-scale` (decr↔incr), `l-foot-trans-out` (in↔out), `l-foot-trans-forward` (backward↔forward), `r-lowerarm-scale-depth` (decr↔incr), `r-lowerarm-scale-horiz` (decr↔incr), `r-lowerarm-scale-vert` (decr↔incr), `r-lowerarm-fat` (decr↔incr), `r-lowerarm-muscle` (decr↔incr), `r-upperarm-scale-depth` (decr↔incr), `r-upperarm-scale-horiz` (decr↔incr), `r-upperarm-scale-vert` (decr↔incr), `r-upperarm-fat` (decr↔incr), `r-upperarm-shoulder-muscle` (decr↔incr), `r-upperarm-muscle` (decr↔incr), `l-lowerarm-scale-depth` (decr↔incr), `l-lowerarm-scale-horiz` (decr↔incr), `l-lowerarm-scale-vert` (decr↔incr), `l-lowerarm-fat` (decr↔incr), `l-lowerarm-muscle` (decr↔incr), `l-upperarm-scale-depth` (decr↔incr), `l-upperarm-scale-horiz` (decr↔incr), `l-upperarm-scale-vert` (decr↔incr), `l-upperarm-fat` (decr↔incr), `l-upperarm-shoulder-muscle` (decr↔incr), `l-upperarm-muscle` (decr↔incr), `r-leg-valgus` (decr↔incr), `r-lowerleg-scale-depth` (decr↔incr), `r-lowerleg-scale-horiz` (decr↔incr), `r-lowerleg-fat` (decr↔incr), `r-lowerleg-muscle` (decr↔incr), `r-upperleg-scale-depth` (decr↔incr), `r-upperleg-scale-horiz` (decr↔incr), `r-upperleg-scale-vert` (decr↔incr), `r-upperleg-fat` (decr↔incr), `r-upperleg-muscle` (decr↔incr), `l-leg-valgus` (decr↔incr), `l-lowerleg-scale-depth` (decr↔incr), `l-lowerleg-scale-horiz` (decr↔incr), `l-lowerleg-fat` (decr↔incr), `l-lowerleg-muscle` (decr↔incr), `l-upperleg-scale-depth` (decr↔incr), `l-upperleg-scale-horiz` (decr↔incr), `l-upperleg-scale-vert` (decr↔incr), `l-upperleg-fat` (decr↔incr), `l-upperleg-muscle` (decr↔incr), `lowerlegs-height` (decr↔incr), `upperlegs-height` (decr↔incr) |
| `breast` | `breast-trans` (down↔up), `breast-dist` (decr↔incr), `breast-point` (decr↔incr), `breast-volume-vert` (down↔up), `nipple-size` (decr↔incr), `nipple-point` (decr↔incr) |
| `genitals` | `penis-length` (decr↔incr), `penis-circ` (decr↔incr), `penis-testicles` (decr↔incr) |

## Expression (`expression`)

A preset name — `'neutral' | 'smile' | 'grin' | 'laugh' | 'frown' | 'sad' |
'angry' | 'surprised' | 'wink' | 'sleepy' | 'kiss'` — or a channel mix, each
0–1: `smile`, `frown`, `browRaise`, `browFurrow`, `blinkL`, `blinkR`,
`squint`, `jawOpen`, `pucker`. Expressions move the face bones, so they work
on any face shape and age. An open jaw shows the mouth interior (`mouth`
label).

## Pose (`pose`): the same vocabulary as `api.sdf.figure`

`armL` / `armR` / `legL` / `legR`: `{ raiseSide, raiseFwd, bend, twist }` in degrees.
- `raiseSide`: 0 = hanging down, 90 = straight out, 180 = overhead.
- `raiseFwd`: + swings the limb forward (−Y).
- `bend`: elbow curls the forearm forward; knee folds the shin backward.
- `twist`: rolls the bend plane (arms: lets a raised fist curl up; legs: turnout).

`spine: { lean, turn, side }` (lean + = forward) and `head: { yaw, pitch, roll }`.

`handL` / `handR`: `'relaxed' | 'open' | 'fist' | 'grip' | 'point'`, or a
number 0–1 (0 = open, 1 = fist). `hold` sets `'grip'` for you.

Arms default to relaxed at the sides; legs keep the natural stance unless
set. `pose: 'rest'` gives MakeHuman's A-pose. Skinning is dual-quaternion by
default (`skinning: 'dq'`), which keeps volume through bent and twisted
elbows; `skinning: 'linear'` is plain linear blending.

## Printability: `weld`

- `weld: 'mesh'` (default) keeps the exact skinned surface, which gives the
  crispest detail. Good whenever the pose doesn't push skin through skin.
- `weld: 'voxel'` re-solidifies the body through a signed-distance lattice
  (`voxel`, default `height/300`; only valid with this weld). Overlaps from
  deep bends (a fully folded knee, an arm pressed into the torso) merge into
  one clean solid. You lose detail at about the voxel size and get more
  triangles (~300k at the default). Paint labels carry across.

Either way the result should report `isManifold: true` and
`componentCount: 1`. Check with `runAndSave(code, label, { isManifold: true, maxComponents: 1 })`.

## Style presets (`style`)

`style` restyles the figure — anime, chibi, a Funko-style vinyl toy, heroic
comic proportions — while every other option (body, face, pose, expression,
hair, clothes, props) keeps working, because the style reshapes the rest pose
before the skeleton, clothing and hair are built.

```js
style: 'chibi'                                     // 'realistic' | 'anime' | 'chibi' | 'funko' | 'heroic'
style: { preset: 'chibi', head: 2.3, legs: 0.5 }   // a preset with some knobs changed
```

| key | meaning (1 = MakeHuman's proportions) |
|---|---|
| `head` | head size (0.3–3) |
| `eyes` | eye size |
| `legs`, `legGirth` / `arms`, `armGirth` | limb length and thickness |
| `hands`, `feet` | hand / foot size |
| `torso` | trunk height |
| `smooth` | 0–100 smoothing passes over the head (drops small anatomy) |
| `simplify`, `headShape` | 0–1 pull of the head toward a superellipsoid; its exponent 1.5–6 (2 round, 3+ boxy) |
| `eyeShape` | `'real'` eyeballs, `'anime'` (white, iris, pupil, highlight and lash line — labels `eyes`, `iris`, `pupil`, `highlight`, `lashes`) or `'toy'` (one solid bead, label `eyes`) |
| `iris`, `pupil` | iris / pupil size on real eyeballs (cone half-angle, degrees) |

Presets also add a few MakeHuman sliders (bigger eye openings, smaller nose
and mouth, rounder or squarer head) under your own `morphs`, and `funko`
paints the eyes black and the lips / brows skin-coloured unless you set
`colors`. Big-headed styles stay one printable piece; expect more triangles
(the head is bigger at the same print height).

## Hair and beards (`hair`)

```js
hair: 'ponytail'                                   // just a style
hair: { style: 'long', color: '#c8c8c4', length: 1.2, volume: 1, fringe: 'bangs',
        beard: 'full', beardColor: '#b0b0aa', beardLength: 1.3 }
```

| key | values |
|---|---|
| `style` | `'bald' \| 'buzz' \| 'short' \| 'bob' \| 'long' \| 'ponytail' \| 'pigtails' \| 'bun' \| 'afro' \| 'mohawk' \| 'spiky'` (`spiky` = anime spikes) |
| `color` | `'#rrggbb'` (default dark brown) |
| `length` | 0.3–2.5: bob / long / tails length (1 = natural) |
| `volume` | 0.3–2.5: thickness off the scalp, curtain fullness, spike size |
| `fringe` | `'none' \| 'bangs' \| 'side'` |
| `beard` | `'none' \| 'stubble' \| 'mustache' \| 'goatee' \| 'short' \| 'full'` (own `beard` label) |
| `beardColor`, `beardLength` | beard colour (defaults to `color`); 0.3–3 length of a full beard |

Hair is a smooth solid (hairline that tapers into the skin, locks, ponytail
ties) meshed from a signed-distance field, then carried rigidly by the head,
so it follows `head` / `spine` in any pose. Long hair falls down the back and
over the shoulders. Hats and helmets sit over it; tall styles (afro, mohawk,
spiky, bun) poke through a hat by design.

## Clothing (`wear`)

`wear` is a list, innermost first: each entry is an item name or
`{ item, …options }`. Items are shells over the skin (or over the layer
beneath), so they fit any body, age and pose and stay printable. Each item is
its own label (the item name, or `label`), coloured by default.

| item | notes |
|---|---|
| `shirt` `top` `tshirt` `sweater` `jacket` `coat` | `sleeve: 'none'\|'cap'\|'short'\|'elbow'\|'three-quarter'\|'long'`, `neckline: 'crew'\|'scoop'\|'v'\|'turtle'\|'boat'`, `length: 'crop'\|'waist'\|'hip'\|'tunic'`; a coat's tails hang free: `length: 'hip'\|'knee'\|'full'` |
| `pants` `jeans` `shorts` `leggings` `briefs` | `length: 'briefs'\|'shorts'\|'knee'\|'capri'\|'full'`, `rise: 'low'\|'mid'\|'high'` |
| `skirt` | `length: 'mini'\|'knee'\|'midi'\|'maxi'`, `flare: 0–1` (0 = straight, 0.3 = A-line, 1 = bell); worn over a top, it reads as a dress |
| `shoes` `sneakers` `boots` | moulded over the foot with the toes closed into one toe box, a sole, and a heel (shoes, boots); `thickness` scales the upper |
| `socks` `gloves` | thin, follow the skin |
| `belt` `straps` `scarf` | `width` (fraction of the torso height); `straps` = backpack straps / suspenders |

Common options: `color`, `label`, `thickness` (multiplier, 0.2–5), `fit`
(0 = tight … 1 = loose). `length` also takes a number, but its meaning is
item-specific (a fraction up the torso for tops, a position along the leg for
trousers); prefer the named lengths.

Under a top or a cuirass the nipples are softened automatically (MakeHuman's
`nipple-size` / `nipple-point` sliders; set them in `morphs` to override).

## Armor (`wear`, too)

`breastplate` (front), `backplate`, `cuirass` (both), `pauldrons`,
`vambraces`, `gauntlets`, `cuisses`, `greaves`, `sabatons` (armored shoes), `gorget`,
`tassets`, `helmet` (open face). Plates are stiff: thicker, smoothed so the
anatomy underneath disappears, with a rim along their edges. They default to
steel grey; layer them over clothing:

```js
wear: [{ item: 'sweater', color: '#5a2a2a' }, 'pants', 'boots',
       'cuirass', 'pauldrons', 'vambraces', 'gauntlets', 'greaves', 'helmet']
```

## Props, hats and accessories (`hold`, `accessories`)

- `hold: { R: 'sword', L: 'shield' }` puts a prop in a hand and curls the
  fingers round it. Props: `sword`, `dagger`, `axe`, `spear`, `staff`,
  `wand`, `torch`, `bow`, `shield` (`style: 'kite'` for a kite shield). Each
  can be `{ item, color, size, label }`.
- `accessories: [...]` adds `tophat`, `cap`, `beanie`, `wizardhat`, `crown`,
  `tiara`, `glasses`, `sunglasses`, `necklace`, `backpack`, `cape`, or a prop
  (with `hand`). Each is placed from the figure's own measurements and joints,
  so it fits any head size and follows the pose.
- **Your own shape:** `{ shape: myManifold, socket: 'hand.R', offset: [x, y, z], rotate: [rx, ry, rz], label, color }`.
  Sockets: `head`, `face`, `neck`, `chest`, `back`, `waist`, `hip.L/R`,
  `shoulder.L/R`, `forearm.L/R`, `foot.L/R`, `hand.L/R` (the grip: origin
  inside the fist, +x along the fingers, +z out of the palm) — or any
  skeleton bone name (`upperarm01.L`, `spine03`, …). The shape is built in the
  socket's local frame and rides with that bone.

Every prop and accessory gets its own label (`sword`, `hilt`, `shield`,
`boss`, `cap`, …).

## Labels (paint)

`skin`, `lips`, `mouth` (inside the mouth), `brows`, `eyes` (sclera), `iris`,
`pupil`, `highlight` / `lashes` (anime eyes), `hair`, `beard`, each worn item / accessory by name, and `base`. Each
is coloured by default; override with `colors: { skin, lips, mouth, brows,
eyes, iris, pupil, highlight, lashes, base, hair }`, an item's own `color`, or
`api.paint.label('iris', '#3b6ea5')`.

`api.removePart('eyes')` drops the eyeballs (the face is closed behind them).
Removing `iris` or `pupil` can't cut a hole in a closed eyeball, so that region
merges into the label around it (pupil → iris → sclera); removing `lips`,
`mouth` or `brows` merges them into `skin`. Removing `hair`, `beard`, or an
item / accessory label leaves it out.

## Fit to a photo (CLI: `npm run human:fit`)

For agents working in the repo (the in-app AI can't run it yet): fit the body
sliders and arm/leg spread to a full-body photo's silhouette.

```bash
npm run human:fit -- --photo person.png                       # front photo
npm run human:fit -- --photo front.png --photo side.png@0,0   # + a side photo (separates gender, bust, belly)
npm run human:fit -- --photo p.png --base outfit.json --fit gender,weight,armL,armR --out me.js --png me.png
```

It builds candidates headlessly (~0.4 s each), scores each one's silhouette
against the photo (the photo-match segmentation, re-aligned sideways so one
raised arm doesn't throw the score), and runs a bounded coordinate descent
(`--budget`, default 120 builds). `--base` is a JSON file of `api.human`
options the fit keeps (hair, wear, style); `--fit` picks the dimensions:
`gender`, `weight`, `muscle`, `age`, `breast`, `vShape`, `belly`, `shoulders`,
`hips`, `legs`, `head`, `headWidth`, `armL`, `armR`, `legSpread`. The output
is ordinary `api.human` code. Dress it, style it, and refine the face by eye.
A plain backdrop gives the cleanest silhouette. Use `--match-bg` or
`--match-mask` as with `model:preview --match-photo`.

## Sliders in the Parameters panel

Declare `api.params` and feed the values in — the Customizer panel then shows
live sliders for the figure:

```js
const p = api.params({
  gender: { type: 'number', default: 0.5, min: 0, max: 1, step: 0.05 },
  age:    { type: 'number', default: 30, min: 1, max: 90, step: 1 },
  smile:  { type: 'number', default: 0, min: 0, max: 1, step: 0.05 },
  armR:   { type: 'number', default: 10, min: 0, max: 170, step: 5, label: 'Right arm raise' },
});
return api.human({
  body: { gender: p.gender, age: p.age },
  expression: { smile: p.smile },
  pose: { armR: { raiseSide: p.armR } },
  base: true,
});
```

## Data packs

The data loads on first use, in three packs so a simple figure stays light:
`core` (~5 MB, always), `morphs` (~2.5 MB, when the code mentions `face`,
`torso`, `morphs`, `expression`, `style` or `wear`), `young` (~4 MB, when it
mentions `age`). If you build options dynamically, keep those words in the source.

## Combining with other geometry

It's a Manifold, so union anything else onto it. Anything you add must overlap
the body by 0.5+ units to fuse. To attach a shape to a body part so it follows
the pose, prefer `accessories: [{ shape, socket }]` over hand-placing it.
