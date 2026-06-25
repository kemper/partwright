---
date: 2026-06-25
branch: claude/admiring-goodall-1tlwna
files_changed:
  - src/geometry/sdfFigure.ts
  - examples/figure_scholar.js
  - examples/figure_knight.js
  - public/ai/figure.md
  - tests/unit/figureAttachment.test.ts
  - public/catalog/scholar.partwright.json
  - public/catalog/knight.partwright.json
---

## Human

"Is there anything we need/should cleanup from the work on this PR? A past attempt
tried a layers API but didn't yield the results you got. Is the layers API still in
effect? Are you using it? Could it help the API or should we discard it?"

(Decision via AskUserQuestion: "Discard it entirely.")

## Assistant

Audited `F.layers`: both scholar and knight still called it, but every entry was
`carve:false` with no `occludeArms`/`occlude`, so `buildLayers` reduced to a plain
`sdf.union`. Its headline feature — `occludeArms`, the dilated-capsule limb
subtraction — was the exact mechanism the past attempt leaned on and that failed
for three sessions; the garment-parts approach removed the limb problem at the
source, so I'd already dropped every `occludeArms`. What remained (`priority`/
`carve` contested-space carving) had zero users. Leaving `occludeArms` in the
documented agent-facing API was an attractive nuisance — a future agent could
reach for it and re-enter the trap.

Discarded it entirely:
- Removed `buildLayers` + `dilatedArms`, the `layers` namespace method + interface
  decl, and the `buildLayers` testables export.
- Switched scholar + knight to `sdf.union(...)` (geometrically identical — the
  no-op `F.layers` *was* a union; both still 345812 / 339894 tris, manifold, 1
  component).
- Removed the three `buildLayers` unit tests; fixed the stale knight comment that
  claimed the cuirass was "arm-occluded by F.layers".
- Rewrote the figure.md "composite the stack" section to teach a plain union (with
  the one caveat the layer compositor used to handle: never bury the fine-hands
  marker in a `.subtract`).
- **Re-baked scholar + knight catalog entries** — critical: their embedded session
  code called `F.layers`, which no longer exists, so they'd have thrown on load.

Verified: typecheck clean, full unit 1630 pass, madge acyclic, both figures
re-render identical and manifold. No `F.layers`/`occludeArms` API calls remain
anywhere (only historical contrast comments).
