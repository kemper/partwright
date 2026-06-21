---
session: "6sobw6"
timestamp: "2026-06-11T02:20:00Z"
tools: [playwright, vitest]
sequence: 3
---

## Human

Phase 4 of the "surface textures as code" direction (the second of the two
deferred phases, after the texture-persistence PR merged): the Surface panel
should emit `api.surface.*` calls instead of baking, for manifold-js sessions
and the 8 in-code-able modifiers — keeping the bake path for voxelize /
voronoiLamp (engine-changing), region/patch-selected textures (api.surface is
whole-model only), and SCAD/BREP sessions. Make the path a given Apply takes
obvious in the UI, and close the UI↔API parity loop in the same PR.

## Assistant

## Key decisions

**The panel calls a new console method, preserving its decoupling AND closing
parity in one stroke.** The Surface panel already drives `partwright.apply*`
rather than editor internals, so the as-code path is a sibling console method
— `applySurfaceTextureAsCode(id, opts?)` — that the panel (and any agent)
calls. It upserts the call in the code, re-runs (force-computing the texture),
and saves a version labeled `api.surface.<id>`, mirroring the bake methods'
"Apply saves a version" contract. Phase 3 then persists the computed texture
on that version for free.

**Pure codegen leaf, modeled on Voxel Studio's.** `src/surface/surfaceCodegen.ts`
inserts the call before the code's LAST `return …;` (the proven greedy-prefix
regex from `editCodegen.ts`), or — when the code already calls the same op
(direct or `apply('<id>', …)` form) — rewrites the LAST such call in place, so
re-applying with tweaked sliders edits rather than stacking duplicates while
chains of *different* textures build up naturally. Exact matching is possible
because surface-op options are flat primitives (the allow-list admits no
nesting), so the object literal can never contain an inner brace. No `return`
to hook onto → null → an actionable error, not a guess.

**Path visibility = button label + live hint.** `applyWritesCode()` (in-code-able
tab ∧ whole-model mode ∧ manifold-js) flips the Apply button between "Apply as
code" and "Apply (bake)" and drives a one-line hint stating what will happen
("Adds api.surface.fuzzy(…) to your code — stays parametric…" vs "Bakes the
textured mesh… code is replaced"). Region mode stays bake-by-default, so the
mode toggle is also the path toggle — a visible, deliberate switch.

**On a failed run the code edit is reverted** (buffer restored + previous code
re-run) rather than leaving a broken insertion in the editor.

**Bug fix surfaced by the work:** `regionBlocked()` didn't exempt the
voxelize/voronoiLamp tabs, whose region UI is hidden — a lingering empty
region selection dead-locked their Apply/preview. Now regionless tabs never
block (regression-tested).

**Parity loop:** console method with full `guard()` validation (id enum vs
`SURFACE_OP_IDS`, unknown-key rejection vs `SURFACE_OP_FIELDS`, primitive
values), `help()` entry, `public/ai.md` + `ai/textures.md` docs. **No in-app
AI tool added, deliberately:** the chat AI already writes `api.surface.*`
calls directly in code via `runAndSave` — a tool wrapping a code edit it can
make itself would be redundant surface area.

**Verification.** Unit (`surfaceCodegen.test.ts`): insert-before-last-return,
in-place update, generic-form normalization, chain build-up, no-return null,
float formatting. E2e (`surface-panel-as-code.spec.ts`): console golden path +
re-apply-updates-in-place, manifold-js-only and unknown-key errors, the
panel's whole-model "Apply as code" flow end-to-end, and the voxelize
dead-lock regression. Browser screenshots of the labeled panel and the
inserted call posted in chat. Full unit tier (1060), lint:deps acyclic.
