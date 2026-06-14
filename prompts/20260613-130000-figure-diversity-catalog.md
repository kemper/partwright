---
session: "wauien"
timestamp: "2026-06-13T13:00:00Z"
model: claude-opus-4-8
tools: [build-catalog-entry, model-preview]
sequence: 2
---

## Human

(Continuing the figure-builder diversity work.) After approving the prototype
previews, chose to do the full build-out and to BOTH diversify the existing
catalog figures AND add new diverse ones.

## Assistant

## Key decisions

**Two new catalog figures**, each verified clean in the *browser* bake (the
catalog source of truth, not just headless): `cornrows_runner` (deep skin, round
face, broad low-bridge nose, full lips, cornrows) and `locs_musician`
(medium-deep skin, deliberately a *long* face + narrower nose under the locs —
mixing axes so the catalog reads as individuals, per the new docs guidance).

**The browser bake caught a real interaction the headless preview missed:** an
over-inflated cheek (`cheek: 1.2`) on a round face let the browser mesher swallow
the eyeballs (paintByLabel resolved 0 triangles). Fix was to stop over-inflating
and bump the eye radius — re-verified in the browser, not just `model:preview`.

**Engine robustness:** locs strands fragmented at the figure grid on a slim build
(strand radius ≈ one march cell), so bumped the default loc thickness
(`0.13 → 0.155 r.head`). Box braids already stay smooth-by-default to avoid the
displacement-necking trap.

**Diversified existing figures the SAFE way — palette-only re-bakes.** Changed
only the `skin` hex in six committed palettes (afro_funk, warrior_pose,
superhero, karate, flexing_strongman, staff_mage) to span medium→deep, then
re-baked with the *unchanged* example code. Because every new engine param is
byte-identical at its default, the re-baked geometry is identical to before
(confirmed: all six came back `componentCount: 1`, low genus) — only the colour
changed. Left six figures light so the catalog as a whole spans the full range
rather than swinging to the opposite extreme. Added both new entries to
`manifest.json`.
