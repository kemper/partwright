---
date: 2026-06-20
task: diva long sleeves + organic SDF hands (PR #780, review round 2)
---

## Liked
- `model:preview` + `sharp` native crops made both defects reproducible and
  fixable in the fast loop — zoomed finger crops at 1400px showed the blocky
  palm slab the default tile hid, and ¾ renders proved both sleeves reach the
  wrist. No browser round-trip needed for geometry.
- Checking `componentCount`/`isManifold` across open/spread/fist grips after a
  `smoothUnion` change caught the topology risk cheaply (all stayed 1-component).

## Lacked
- A headless **colored** bake. `build-catalog-entry.cjs` needs headed WebGL and
  fails ("API never appeared") in this container, so I could never see the purple
  sleeve-vs-skin boundary the user sees — I had to infer it from normal-shaded
  renders + geometry reasoning. The shaded-normal preview genuinely can't show
  the bug class the user reports in color.

## Learned
- **The previous "quick fix" patched the wrong code path.** The diva renders
  long-looking sleeves but is authored `sleeve: 'short'` (the fat elbow cap just
  bulges down a straight forearm). The earlier fix edited the `'long'` branch the
  diva never executes — so it shipped green and the user still saw the bug. Lesson:
  before fixing a parameterized path, confirm *which* branch the reported subject
  actually takes (grep the subject's params), don't assume from the rendered look.
- **Opening a catalog entry re-executes the version `code`** (`loadVersionIntoEditor`
  → `runCodeSync`); stored `geometryData` is only paint/printability metadata, never
  the mesh source. So engine + code-string fixes reach the editor with no re-bake —
  only the static `/catalog` grid `thumbnail` stays stale (#751).

## Longed for
- A headless colored thumbnail path (offscreen WebGL / software GL, or a
  normal-shaded preview that *also* applies label palette colors) so color-coverage
  defects (sleeve vs skin, paint bleed) are verifiable in the ~2s loop instead of
  only via the flaky xvfb bake.
