---
session: "bambu-multipart-export-options"
timestamp: "2026-07-07T00:40:24Z"
model: claude-opus-4-8
sequence: 1
---

## Human

The Bambu multi-part 3MF export always assumed one part per plate. For
collections of 30+ parts that's annoying. Wanted a checkbox/option in the
Bambu-specific export to choose the plate layout: export all parts together in a
grid on one plate, keep the current one-part-per-plate, or — now that part
grouping exists — one plate per group (grid where every group gets its own
plate). Implement and open a PR.

## Assistant

## Key decisions

**Modelled the choice as a `BambuPlateLayout` = `'separate' | 'grid' | 'group'`
rather than a boolean checkbox.** The user described three distinct behaviours,
not a two-state toggle, so a small enum keeps it honest and future-proof.
`'separate'` is the default, so every existing caller (menu flow, console/AI API,
all four printer tests) is byte-identical unless it opts in.

**Extracted the plate distribution into a pure, exported `assignBambuPlates(groups,
layout)`.** It turns a per-part group list + mode into `number[][]` (a list of
plates, each a list of part indices). Keeping it pure means the whole
distribution decision is unit-testable in the fast vitest tier with no browser —
`tests/unit/bambuPlateLayout.test.ts` pins all three modes plus the edge cases
(non-contiguous group members collapse to one plate; no-groups degrades to
separate; whitespace group names are ungrouped).

**`'group'`: parts sharing a group share a plate; each ungrouped part gets its
own plate.** Mirrors `buildPartTree`'s first-appearance ordering (the reference
pushed into `plates` on first sight collects later members too), so the two
list views stay consistent. Ungrouped-as-singleton reads as "if you didn't group
it, it prints separately."

**Generalised `buildBambuPackage` from one-plate-per-part to N-parts-per-plate.**
Two structural changes: (1) a part's world transform now comes from its plate
cell PLUS a sub-grid slot within that plate's bed footprint (⌈√count⌉ columns
about the plate centre) — for count=1 this reduces to the original centre, so the
existing per-axis-stride test is unaffected; (2) `<plate>` blocks moved out of the
per-part loop into a per-plate loop, each carrying one `<model_instance>` per
object assigned to it. `plateGridCols` now keys off the plate count, not the part
count.

**Bed-overflow is left as an honest "doesn't fit" case, not silently reflowed.**
If a group's parts exceed one bed they spill toward the neighbouring plate cell
(the 20% plate gap absorbs modest overhang) — but such parts are unprintable
regardless, so reflowing them would hide a real problem. Documented in a code
comment.

**Parity closed in the same PR.** UI: a radio group in `exportPartsModal.ts`
(the `'group'` option only appears when the session actually has groups). API:
`plateLayout` added to `export3MFParts`/`export3MFPartsData` opts with
`isBambuPlateLayout` boundary validation, the `help()` signature, and
`public/ai/file-io.md`. The shared picker + shared builder meant one code path
served both the menu flow and the console/AI twin.
