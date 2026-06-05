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
