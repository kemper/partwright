---
date: "2026-06-10T18:00:00Z"
task: "feat: SDF detail regions + figure mouth styles + paintable eyes"
areas: [geometry-api, sdf, figure, examples, docs]
---

## Human

After merging the `api.sdf.figure` builder, faces came out poorly: the AI
struggles to make mouths and to paint faces, and face features look like
angled flat surfaces rather than smooth SDF work ("I assume it's using
non-SDF for the faces"). Asked for an investigation, then approved a plan:
land high-quality faces (the top priority), better mouths, and paintable
face features, then upgrade the catalog figures to use them.

## Human (round 2)

Reviewed close-ups: still poor — solid-black-only eyes (wants white +
iris/pupil, solid as an option), bare shelf-like brows, no lips/teeth, and
visible distortion around carved mouths. Asked for faster headless iteration
via local CLI examples to review.

## Assistant (round 2)

- **Mouth "shrapnel" root cause:** the refine pass projected only NEW
  midpoints onto the SDF; the ORIGINAL marched vertices around sub-cell
  features are aliased, and mixing exact midpoints with aliased originals is
  the speckle. Fix: one-time re-projection of every in-sphere original
  vertex before the first split.
- **Sub-cell labelled regions vanish silently.** Separately-labelled small
  regions (eyes, iris, pupil) marched at the coarse global grid produce an
  EMPTY mesh — unrecoverable by refinement. Fix: march small regions
  directly at a fine edge. Two follow-up traps found by headless paint
  probes: (1) gating "small" by sphere CONTAINMENT failed borderline cases
  (the iris's margin-padded corner missed the face sphere by 0.01) — the
  cell BUDGET is the real cost gate, so containment was dropped; (2) the
  coarse margin's 1-unit floor dominated a pupil-sized region's fine grid
  (569k mostly-empty cells, blowing the budget) — the fine path now uses a
  margin of two fine cells. Budget set to 250k cells so medium regions
  (hair caps) stay on the cheaper refine path.
- **Eye styles:** default `'iris'` builds white sclera + iris disc + pupil
  dot as SELF-labelled regions ('eyes'/'iris'/'pupil'); `'solid'` keeps the
  bead look. Self-labelling is back-compatible: an outer `.label()` wins and
  flattens to one colour.
- **Mouth accents** (`F.face.mouthAccents`): 'teeth' band + 'lips' capsule
  ring for the open style (the first lip-ring attempt — an
  ellipsoid-minus-tunnel shell — shattered into 78 components when marched;
  capsule chains are unconditionally robust), labelled ridge for the lips
  style. Brows became skull-hugging arcs (sagitta pull-back) instead of a
  straight chord that left the middle proud.
- **Face lab** (`examples/faces/`): four self-painting bust snippets that
  render headlessly in ~5 s each with `stats.paintOps` proving label
  coverage — the fast-iteration surface the user asked for.

## Human (round 3)

In-app close-ups: eyes stick out too far, mouths still pixelated, wants
lips/teeth on catalog entries, busts not good enough — "look from more
angles". Also: clothes cover poorly — "inappropriate half naked figures".

## Assistant (round 3)

- **Eyes**: sank the whole stack (push 0.5R→0.28R; iris 0.66R r0.52; pupil
  0.97R r0.3) — reads as in-the-face, still protrudes enough to paint at
  every rig scale.
- **Mouth resolution**: `faceDetail` now returns an ARRAY — head sphere plus
  a much finer mouth sphere (`r.head*0.02` edge) — the carve was the
  smallest feature and stayed pixelated at the head-wide target.
- **Clothes**: three real bugs in the builders. (1) `top` was centred at
  y=0 while the chest mass sits forward at `j.chest[1]` — the body bulged
  straight through the shirt front; (2) `top`'s default hem stopped at the
  navel, leaving a bare midriff above mid-rise pants — now defaults below
  the navel; (3) `pants` had no crotch coverage — seat deepened + an
  explicit hip-to-hip gusset capsule.
- **Torso cap**: the chest ellipsoid climbed past the chin on stocky /
  few-heads rigs and buried the lower face INSIDE the torso (the strongman's
  mouth carve landed in solid chest — discovered because his teeth label
  resolved to 0 in the full figure but fine in a head-only bust). The chest
  mass is now capped at the shoulder line; the neck capsule provides the
  neck. This also gave every figure a visible neck/chin.
- **Boolean debris**: near-coincident accent surfaces (teeth vs cavity rim,
  mustache vs carve) shed zero-volume sliver components; `build()` now drops
  decomposed parts under ~2 march cells of volume after the union — debris
  below march resolution can't be intentional geometry.
- **Catalog variety**: kid = open laughing mouth + teeth + lips; strongman =
  gritted teeth (open 0.26, no lip ring under the mustache); ballerina =
  painted rose lips ('lips' style, mouth:false in assemble); warrior/wizard
  keep carved smiles. Multi-angle (front/¾/low) renders used for judging,
  per the user's prompt.

## Assistant (round 1)

Diagnosis: the faces ARE SDF — they're under-sampled. `build()` meshes every
region on one uniform levelSet grid, and at the documented figure default
(`edgeLength 0.4–0.6` for a 60-unit figure) a mouth ridge is ~1 grid cell
across. Going globally fine is unaffordable (the grid is O((H/e)³) JS evals),
so the fix had to be local.

Key decisions:

- **Refine-and-project over per-region edgeLength.** Two designs considered
  for localized detail: (a) mesh the head as its own levelSet region at a
  finer grid — simpler, but converts the head↔neck smooth weld into a hard
  seam, visible on exactly the shirtless figures the user wants; (b) a
  post-march pass that selectively subdivides triangles inside caller-given
  spheres and Newton-projects new vertices onto the SDF iso-surface. Chose
  (b) (`src/geometry/sdfRefine.ts`, `build({ detail: [...] })`): no seams,
  labels and welds unaffected, cost proportional to the sphere's surface
  area. Conformity is by construction (a global marked-edge set means both
  triangles sharing a split edge agree — 1/2/3-marked-edge patterns, no
  T-junctions). A micro-tolerance `simplify()` after `ofMesh` collapses the
  near-degenerate slivers projection can create.
- **`F.faceDetail(rig)`** packages the face sphere (centered on the head,
  edge target scaled to `r.head`) so figure authors pass one expression. The
  default lands in the one-subdivision-round bucket (~34k tris for a
  60-unit-figure head) after comparing one vs two rounds visually — two
  rounds tripled the cost for a barely visible gain; the override is
  documented for final passes.
- **Mouth: carved styles, additive kept.** The old mouth was only a
  protruding ridge, and its documented `open` option was parsed but never
  read (silent no-op — the likely cause of the AI "struggling with mouths").
  New `style: 'smile' | 'open' | 'lips'` where smile (carved arc groove,
  the cartoon default) and open (carved cavity, `open` 0..1 gape) are
  subtracted by `assemble`, lips remains the old additive ridge. Default
  changed to 'smile' deliberately — catalog entries are being regenerated in
  the same change.
- **Eye protrusion is a library guarantee, not an author knob.** The first
  catalog bake failed to paint the eyes: the label registered but resolved to
  zero triangles because the eye spheres (centred ON the surface anchor) were
  fully swallowed by the cheek welds. Fixed in `buildEyes` — spheres are
  pushed forward by half their radius so a dome always protrudes. Same root
  cause found and fixed for two pre-existing buried labels the new
  paintByLabel zero-triangle error message surfaced: the strongman's
  mustache (pushed forward) and the wizard's orb (was a duplicate
  fully-enclosed sphere "label workaround"; now the real orb is its own
  top-level label and the rod reaches the orb centre for overlap).
- **paintByLabel error split.** "no label X. Known labels: … X" was the
  message for a registered-but-empty label — replaced with an explicit
  zero-triangles explanation pointing at enclosure as the likely cause.
- **Catalog regeneration:** all 5 figure entries re-baked via
  `scripts/build-catalog-entry.cjs` under xvfb with their original palettes
  plus `eyes` (and the wizard's now-paintable `orb`). The four non-kid
  example upgrades were done by parallel model-sculpt agents against the
  updated `figure.md`, then label coverage was verified headlessly with
  `model:preview` paint-op probes before baking.
- **Paintable eyes via pattern, not partitioner surgery.** Considered letting
  nested labels split out of an outer-labelled region, but a label nested
  under a smoothUnion can't be split without changing geometry, and eyes sit
  under the body weld. The structural fix is already expressible: assemble
  with `eyes: false` and hard-union `F.face.eyes(rig).label('eyes')` at the
  top level. Made that the canonical documented pattern (figure.md "one
  pattern" + all examples) instead of the old "duplicate the eyes over the
  welded ones" workaround.

## Human (round 4)

Eyes still stick out — "just paint irises and pupils or have them protrude
by only a tiny fraction". Clothes better but with defects (warrior
screenshot). Wizard has "two little nub teeth in the corners of his mouth".

## Assistant (round 4)

- **Eyes as flat lenses.** The iris/pupil are now thin ellipsoid CAPS
  (~0.06R/0.05R proud) instead of stacked spheres — they read as painted-on
  circles. Key realisation: thin reliefs survive the union because booleans
  are exact on the meshed surfaces; only each region's own march must
  resolve its solid, and a lens is a chunky ellipsoid. A sphere-cap design
  fails geometrically (a small sphere on a big one only pokes near its
  axis). Tried sinking the eyeball further (0.28R→0.2R) but the white
  vanished on small-eyed rigs — restored 0.28R; the bug-eye look was the
  bead stack, not the eyeball.
- **Clothing defects**: sleeves now FOLLOW the arm chain (a straight
  shoulder→forearm capsule cut the corner at a bent elbow and skin poked
  through); shoulder yokes bridge the chest shell and sleeve tops (armpit
  wedge); default top/pants thickness raised — weld bulges (belly, knee)
  exceeded the thin shells on slim builds and showed as bare patches.
- **Wizard nubs**: the carved smile's upturned corners flanked the beard's
  top blob and read as teeth — narrowed the smile to sit clear of the beard.

## Human (round 5)

The wizard "nubs" are actually white hair/head bleeding through to the mouth.
The warrior pose model is still very messed up: missing clothes, and the pants
"deviated from the legs themselves — looks crazy". No screenshots this time —
asked the agent to find and fix the quality issues autonomously, including any
not-yet-reported ones, until the improvement is dramatic.

## Assistant (round 5)

Diagnosed everything headlessly (clip-box zooms, red-skin contrast renders,
and a `skin.subtract(pants)` "exposure probe" whose component list pinpoints
every spot a body pokes through a garment).

- **The knee hinge bent the wrong way** — the real "crazy legs" bug. The
  legChain comment promised "knee bends the shank backward (+Y)" but the
  rotation sign swung it FORWARD: the warrior lunge's front shin ended up
  horizontal, floating mid-air, ankle far in front of the figure. Sign
  flipped; the lunge (and the ballerina arabesque, whose authored pose was
  compensating) now reads anatomically.
- **Pant legs were pinned to a world height, not the leg.** The cuff endpoint
  `[ankle.x, ankle.y, cuffZ]` (cuffZ derived from the LEFT ankle for both
  legs) pulled the whole pant shank off any posed leg. Cuffs now live ON the
  knee→ankle bone (`cuffZ` projected per-leg); knee pads + hip-capsule pads +
  body-weld-scale garment joins close the remaining flex-corner exposures.
  The exposure probe over the waist-to-cuff band now meshes EMPTY.
- **Transforms above labelled unions silently killed every label** (found
  when lowering the lunge body onto its base). Rigid transforms (translate /
  rotate / scale / mirror) now carry a `rewrap` factory and the partitioner
  distributes them onto each labelled region.
- **Hair is a separate labelled region, so it survives the skin's mouth
  carve** — the wizard's "nub teeth" were pale hair VOLUME exposed inside the
  carved smile's corners. `buildHair` now subtracts a head-pose-oriented face
  window (above-the-brow hairline); every figure gained a framed face.
- **Robe hems never worked**: buildTop's chest ELLIPSOID recedes toward its
  tip, so a floor-length hem left bare legs poking out the front (the
  wizard). A hem below the pelvis now adds a flared cone skirt. Also added a
  clavicle bar (the chest shell's deep bare-sternum V read as a plunging
  neckline) and `pants length:'briefs'` (seat+gusset+hip pads) so the
  ballerina's leotard covers her pelvis under the tutu.
- **Strongman genus exploded 3 → 44.** Bisection (no-teeth vs bald) blamed
  the teeth band; close-up renders showed the real culprit: the gritted
  mouth's carved slot was ~1 coarse march cell tall, aliasing into
  half-sealed debris and micro-handles that refine-and-project can sharpen
  but never topologically fix. `mouthCavityFrame`'s cavH floor raised to
  0.1·R (≥ ~2 cells at documented figure edges) and the teeth band's
  clearances became absolute (march-cell-relative) rather than proportional.
  Also discovered `roundedBox` takes FULL sizes — the teeth band had been
  half its intended width since round 2 (the "two front teeth" look).
  Strongman genus is now 1, and the band fills the slot as a proper grit.
- Warrior base reworked: in a true lunge both ankles ride high, so the body
  is lowered into the slab and the higher front foot gets a stepping-stone
  (the old ankle-encasing posts propped up the buggy floating shin).
- All five entries re-baked: 1 component, manifold, genus ≤ 2, all labels
  painting (ballerina gained `leotard` coverage; 9–11 labels each).
