---
date: "2026-06-18T16:05:00Z"
task: "fix: cover the chest on tall floor-length figure gowns (no topless cone)"
pr: 742
areas: [figures, catalog, tooling, verification]
cost: low
---

## Liked / Worked
- **Rendering the garment geometry IN ISOLATION nailed the mechanism instantly.** After the colored bake showed a topless figure, `return F.clothing.top(rig, {...}).build()` (just the gown, nothing else) came back a bare cone — proving the bodice/coverage were never produced, not merely hidden behind skin. One throwaway snippet replaced a lot of code-reading.
- **Computing the clip condition analytically across ALL low-hem figures** (`hemZ + big < zTop`, dumped via `throw new Error(JSON.stringify(...))` through model:preview) turned "which catalog entries do I re-bake?" from guesswork into a table: 4 affected, 2 byte-identical. No blind re-baking.
- **Reintroducing the bug to prove the regression test fails** (temp-edit `hemH = big`, run the one test, restore) gave real confidence the guard works — not just that it passes today.

## Lacked
- **`model:preview` shades by face-normal, so "topless" was invisible there** — a covered bust and a bare bust are the same mound geometry; only the paint LABEL differs. Had to spin up the dev server + `xvfb-run scripts/build-catalog-entry.cjs --base` colored bake to SEE the defect. This is the second session to relearn "paint/label bugs need the colored bake, not model:preview." A `model:preview --colored` (apply a palette, shade by label) would collapse a 5-tool detour into one call.
- **`buildTop` wasn't in `__figureTestables__`** while every sibling (`buildPants`, `buildTorso`, …) was — so the one clothing builder with a shipped topless bug had no unit-test reachability. Added it; worth auditing that the testables list tracks the builder list.
- **The single-entry `build-catalog-entry.cjs` won't init headless in the sandbox** ("API never appeared") unless you pass `--base <running dev server>`; `catalog-regen.cjs` works headless but only does surgical thumbnail swaps (no geometry re-bake). For a geometry change you must hand-start `npm run dev` first. A `--headless` path on the single-entry baker (mirroring catalog-regen) would remove that friction.

## Learned
- The "guaranteed coverage by construction" clothing invariant is only as good as the **clip box that bounds it** — a finite `big`-tall half-space silently amputates anything taller than `big`. Half-spaces meant to be infinite should be sized off the actual content extent, not a radius-derived constant.

## Longed for
- A headless **colored** preview (`model:preview --palette x.json`) so paint/label-coverage defects (topless, buried eyes, color bleed) are catchable in the ~2s loop instead of only the ~75s xvfb bake.
