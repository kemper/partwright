# Retro — figure-modeling architecture (priority layering + thumb vocab)

Session: turned three review rounds of recurring figure-accessory bugs (armor
bleeding onto arms, belts on sleeves, necklace through dress, thumb-down grip)
into a root-cause architecture. Tracking #853, PR #830.

## Liked
- **Stepping back to the meta-question paid off.** The user asked "why do you fail
  so hard, fix the root cause" — diagnosing it as "authoring continuous geometry
  blind + no semantic vocabulary + verify-by-eyeball" led to `F.layers` + the
  `thumb` axis, which fix the *categories* instead of each figure.
- **The explore-agent pipeline map was decisive.** It revealed SDF `.label()` is
  *exact* (runOriginalID), so the "bleed" was geometric overextension, not a paint
  bug — which completely reframed the fix (carve the limb, don't rewrite paint).

## Lacked
- **A browser-side headless decompose.** `model:preview` (Node) said componentCount
  1 while the colour bake (browser) said 2 — I couldn't pin the loose piece without
  the app, so it became follow-up #856. A `partwright decompose <file>` headless
  command (browser/WASM) would have closed it in one step.
- **Fast iteration on heavy figures.** Each knight render/bake was ~1.5–2 min; the
  validate→fix→bake loop on componentCount burned several cycles. The warm-browser
  daemon exists but I didn't lean on it for the bakes.

## Learned
- **SDF occluders must be cheap + Lipschitz.** Subtracting `buildArms().round()` (a
  deep, non-Lipschitz tree) timed the knight out (>5min) AND left coincident-surface
  slivers + split it into 2 components. A 6-capsule arm chain cut the same region
  cleanly in 1.5min. Approximate-but-Lipschitz beats exact-but-deep for booleans.
- **Label propagation through `.subtract` needs a single labeled child.** F.layers'
  occludeArms subtract dropped the belt colour when the node's top op was an
  unlabeled `.union(...)`; wrapping the outer node in `.label()` fixed it. Worth a
  guard or doc note.
- **Node vs browser componentCount diverges at thin features.** Trust the browser
  bake for "is this one piece?"; Node under-reports.

## Longed for
- **The invariant gate (pillar 2) as a default build check** — single-component,
  nothing-below-base, no accessory-covers-limb (author-time SDF sampling). It would
  have caught #856 automatically instead of via a manual bake. Designed in #853;
  not yet built.
- **A capability registry** so a new `F.*` verb (band, layers) auto-surfaces in
  docs/console/AI-tools without hand-editing each — the UI↔API parity is manual.
