---
date: 2026-07-07
task: "Bambu 3MF plate-layout options (separate/grid/group) + shelf packing"
pr: 904
---

## Liked

- The `assignBambuPlates` grouping logic was already pure and exported for the
  first cut, so when the packing bug came in, adding `packPlates` as a second pure
  stage was a clean split (bins → physical plates) with zero churn to the builder's
  colour/UUID/settings code.
- The one-part-per-plate `separate` default reduced to `packPlates([k])` centring a
  single part — the existing per-axis-stride e2e test kept passing untouched, which
  gave instant confidence the refactor didn't disturb the validated Bambu layout.

## Lacked

- No visual render path for an exported 3MF plate layout. I verified packing by
  parsing `<item>` transforms out of the XML and asserting bed-bounds numerically —
  correct, but I couldn't *show* the user the packed plate the way `model:preview`
  shows geometry. A "render the plate arrangement" probe would make layout bugs
  obvious at a glance.

## Learned

- The reported symptom ("armor fit, frame didn't") was the tell: a **uniform
  max-pitch grid** silently works for uniform-sized parts and only balloons when one
  part is much larger. When a layout "works for some inputs but not others," suspect
  a global constant (here: pitch = max over ALL parts) that should have been
  per-item.

## Longed for

- A headless way to rasterize a build-plate arrangement (parts as footprint rects in
  the bed) to a PNG — the packing equivalent of `model:preview`. It would have
  turned "parse the XML and assert spanX < bedW" into a glanceable before/after.
