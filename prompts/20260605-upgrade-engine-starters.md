---
date: 2026-06-05
branch: claude/affectionate-heisenberg-Dk7Er
files_changed:
  - examples/basic_shapes.js
  - src/main.ts
---

## Human

I'm thinking of upgrading all the starter files for all the engines. I want
something cool for each but also something that will render quickly and makes
sense for each engine type. (Clarified: by "starter file" they mean the initial
model that loads into the editor for a new session / on a language switch.)

## Assistant

Replaced the four boring "cube" starters with small, fast-rendering models
chosen to show off what each engine is good at:

- **manifold-js** — a twisted rounded-square column (`CrossSection.hull` of four
  corner circles, `extrude` with built-in twist + taper). Showcases the mesh
  kernel's cheap continuous deformation. Lives in `examples/basic_shapes.js`
  because that file doubles as the landing-page `defaultCode` seed.
- **scad** — a twisted 6-point star column (parametric `module` + `linear_extrude`
  with `twist`/`scale`). Deliberately **pure OpenSCAD, no BOSL2**: BOSL2's first
  load fetches ~4 MB and recompiles every run, which would violate the
  "renders quickly" requirement for a first-switch starter.
- **replicad** — a rounded mounting plate with true selective fillets, a
  chamfered top rim, and two boolean-cut bores. The OCCT solver runs sub-second
  even cold, and it shows the BREP headline (exact fillets/chamfers + STEP).
- **voxel** — a little tree (trunk + three tapered canopy layers + a gold star),
  showing `fillBox`/`set` with hex colors.

Decisions / why:
- **De-duplicated the starter strings.** Previously each starter was spelled out
  three times (the `DRAFT_STUB_*` constants, the terse bodies in
  `resetEditorToStarter`, and — for JS — `basic_shapes.js`), which drifts. Now
  SCAD/replicad/voxel live in single module-level constants
  (`STARTER_SCAD`/`STARTER_REPLICAD`/`STARTER_VOXEL`); JS lives in
  `basic_shapes.js` → `defaultCode`. The language-toggle path and
  `resetEditorToStarter` both reference those. Deleted the `DRAFT_STUB_*` block.
- **Kept the `examples/*` glob** even though it now only feeds `defaultCode` from
  `basic_shapes.js`: removing it would orphan every example file and trip knip's
  `files` gate.
- `resetEditorToStarter` lost its now-redundant `comment` param (it used to
  prepend `// New session` / `// New part`; the starters carry their own
  descriptive header, so the extra label was just a doubled comment).
- `isStarterCode` still recognizes the new JS starter (it compares to
  `defaultCode`) and keeps the legacy cube regex for back-compat with old drafts.

Verified all four render via a throwaway Playwright probe (screenshots posted in
the session); build + unit tier green.

Follow-up (CI): `session-modal.spec.ts` asserted the new-session editor contained
`// New session` — the comment header `resetEditorToStarter` no longer prepends.
Updated it to assert the fresh manifold-js default loaded (`toContain('CrossSection')`),
which is the real intent (old code cleared, default seeded). The scad-companion
shard-3 failure in the same run was flaky (passed on retry).

Follow-up (feedback): the single-shape starters were "too lame." Reworked the
manifold-js / scad / replicad starters into **capability samplers** — several
shapes/operations laid out in a row in one tweakable model so people can
experiment:
- manifold-js: boolean cutout, hull-rounded box, twist-extrude column, revolve vase.
- scad: difference, minkowski-rounded box, module+linear_extrude twist, rotate_extrude vase.
- replicad: fully-rounded box, knob (filleted rim + chamfered base), cone fused
  onto a cylinder, bracket with rounded corners + bored holes.
- voxel: a fuller layered pine tree (loop-built tapering tiers in alternating
  greens, snowy caps, ornaments, gold star).
All four verified rendering via a throwaway probe (screenshots in session). The
session-modal assertion still holds — the manifold sampler still uses CrossSection.
Note: chamfering a box whose edges were all just filleted fails in OCCT, so the
replicad block-1 box is fillet-only (chamfer is shown on the knob's base instead).

Follow-up (CI): the first sampler cut was a union of four *disjoint* shapes, so
the manifold-js default (which auto-runs on /editor) became multi-component and
emitted a "⚠ N disconnected components" warning. That broke two tests that
exercise the default model — `feedback-a11y` (clean export toast) and
`printability-toast` (its own 2-component toast collided with the default's
4-component one) — and, more importantly, was a real UX regression: a brand-new
user's first model shouldn't throw a disconnected-components warning. Fixed by
mounting each code sampler (js / scad / replicad) on a thin **tray base** that
ties the demos into one connected, printable solid (verified componentCount === 1,
isManifold === true for all three via a probe). The tray reads as an intentional
sampler board. No test edits needed — the tests correctly assert app behavior on
the default model.

Follow-up (review nit): refreshed the `isStarterCode` doc comment, which still
described the dropped `// New session`/`// New part` prefix as a currently-emitted
form. Behavior unchanged — the regex is retained only for back-compat with legacy
saved cube drafts.
