# Retro — figure invariant gate (F.sharedSolid) + F.layers fold-in

4-Ls, one agent, continuation of the figure-modeling architecture (#853).

## Liked
- The "map the pipeline before designing" explore-agent pass paid off twice: it
  proved the armor "bleed" was geometric overextension (labels are EXACT via
  runOriginalID), not a paint bug — which redirected the whole fix from
  rewriting triangle→label to F.layers occlusion. Don't guess the mechanism;
  read it.
- Validating F.sharedSolid on REAL figure geometry (band-vs-arms: 125.8u³ → 10.6
  after occludeArms) caught that the capsule occluder leaves a deltoid residual —
  a defect no render angle showed. The invariant primitive earned its keep on its
  first real run.

## Lacked
- No browser-side `componentCount` gate, so #856 (knight splits into 2 pieces in
  the bake but 1 in Node) shipped silently and cost 3 blind bake cycles (~6 min)
  chasing the wrong piece. Node model:preview under-reports components vs the
  browser bake — there's a CLAUDE.md note about this, but no automatic gate. A
  `maxComponents` gate in build-catalog-entry would have failed the bake loudly.
- Each heavy-figure render/bake is 1.5–2 min; tuning by re-bake is painfully slow.
  A faster component-diagnosis path (decompose + per-island bbox in the bake
  output) would beat guess-thicken-rebake.

## Learned
- SDF labels are open surface patches, so you CANNOT boolean-intersect them to
  measure overlap — the invariant check has to sample the SDF FIELDS directly
  (F.sharedSolid). And it must be author-time (per-part SDFs), not mesh-level.
- "Higher priority wins" can't be global: a limb must win over a torso plate in
  its own space, so limbs are special occluders, not just another layer. And
  carving the base body buries the fine-hands marker in a subtract (breaks
  sculpted hands) — base layers must be carve:false.
- A deep non-Lipschitz occluder (buildArms().round()) blows up levelSet time AND
  leaves coincident-surface slivers/extra components. Cheap Lipschitz capsules cut
  clean and fast. Occluder shape matters as much as correctness.
- Label propagation through `.subtract` only survives from a SINGLE labeled child
  — an unlabeled `.union()` on top drops it (scholar belt rendered grey). Label
  the OUTER node you hand to a layer.

## Longed for
- A `maxComponents` / invariant gate wired into the catalog bake (browser ground
  truth), so loose-piece and overlap defects fail the build instead of shipping.
  This is #853 pillar 2's "automatic" half — the primitive exists; the gate doesn't.
- A registry/parity so new F.* authoring primitives (layers/band/sharedSolid/thumb)
  are auto-listed where agents discover them, without hand-editing figure.md.
