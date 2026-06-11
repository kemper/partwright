---
session: "qvftq1"
timestamp: "2026-06-08T03:55:00Z"
model: claude-opus-4-8
tools: [subagent, playwright]
---

## Human

I've merged many new features recently. I've had multiple rounds of AI
investigating defects and bugs — crashes, things not behaving as wanted —
but also UI inconsistencies (menus that don't match other menus), tools that
work with one modeling engine but were never considered for the others,
missing documentation/skills, and features that are reachable from the UI but
NOT from the `window.partwright` JavaScript API. The end goal is for an AI to
be able to drive almost everything a user can do, through that JS API. Create
~20 subagents to investigate the codebase and report back. For things that
very obviously need fixing, open a PR; otherwise just report findings.

## Assistant

## Key decisions

**Approach**: Ran a 20-agent read-only audit fleet, each scoped to one
non-overlapping concern across five themes — UI↔JS-API parity, cross-engine
tool coverage, UI consistency, bugs/crashes, and docs/skills gaps. Agents
returned structured findings (severity + file:line + obvious-fix flag), not
file dumps, so the synthesis stayed in budget. Then implemented only the
clearly-correct, self-contained subset and reported the rest for triage.

**What shipped in this PR** (the "obviously needs fixing" cluster):

- **AI-tool parity (the user's central goal).** `smoothModel`, `voxelizeModel`,
  `scaleModel`, `placeModel`, `rotateModel`, `layFlatModel` already existed on
  `window.partwright` and in the UI/command palette but had no `src/ai/tools.ts`
  schema or dispatch — the in-app AI literally couldn't smooth, voxelize,
  resize, or orient a model. Added schemas + dispatch + SAVE_GATED membership,
  mirroring the existing texture tools. Params are plain/serializable.

- **Destructive-bake warning (cross-engine correctness).** Applying any surface
  modifier or scale to a SCAD/replicad session silently baked it to a
  manifold-js mesh — discarding the parametric source, and for BREP the STEP
  export — with no warning. The transform/place path already warned
  (`commitTransform`); the surface-modifier commit path (`commitSurfaceModifier`)
  did not. Added `engineBakeWarning(priorLang, target)`, emitted as a `warn`
  toast (source `engine`, auto-mirrored to the Diagnostic Log) AND returned in
  the result `warnings` for AI/console callers. `commitTransform` passes
  `warnOnBake:false` so the transform path isn't double-warned (it keeps its
  more specific message).

- **Silent clipboard failure** in the Diagnostics panel copy button: added the
  missing `.catch` → `showToast` warn, matching the pattern used elsewhere.

- **Docs.** CLAUDE.md still said "three engines"; `voxel` is a real fourth
  engine (registered, typed, in the help page) — bumped to four, added the
  `voxel.ts` architecture bullet and an engine-awareness note about bake paths.
  `public/ai/printing.md` actively told the AI to hand bed-fit/orientation off
  to UI tools; rewrote it to use `scaleModel`/`placeModel`/`rotateModel`/
  `layFlatModel` directly. Added `smoothModel`/`voxelizeModel` to
  `public/ai/textures.md` with the cross-engine bake caveat.

**Deliberately NOT in this PR** (reported for triage — broader or need design):
image-stamp/filament-palette/replace-color paint API, STL/STEP import API,
version rename/delete/diff API, patch/triangle-selection AI primitive, the
hand-rolled-modal → `createModalShell`/`confirmDialog` consolidations, AI-modal
button-constant migration, and the `kind:'triangles'` paint-region
re-tessellation fragility. The IndexedDB layer, cross-tab isolation, resource
disposal, and cross-engine import/export wiring all audited clean.

**Verification**: `npm run build` (tsc) + 800 unit tests pass; a throwaway
Playwright spec drove `window.partwright` to confirm `scaleModel` on a manifold
model is warning-free while `smoothModel` on a SCAD model bakes to manifold-js
and surfaces the "OpenSCAD model was baked to a mesh" toast.
