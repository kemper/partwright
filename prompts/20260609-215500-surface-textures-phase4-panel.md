---
session: "1kdce9"
timestamp: "2026-06-09T21:55:00Z"
model: claude-opus-4-8
tools: [playwright, vitest]
sequence: 6
---

## Human

Phase 4 of surface-textures-as-code (stacked on phase 3): make the Surface panel
emit `api.surface.*` code instead of baking, with a console method + AI tool.

## Assistant

## Key decisions

**Code is now the default panel output, bake is the escape hatch.** The Surface
panel grew an "Apply as editable code (api.surface.*)" checkbox (on by default)
for the eight code-expressible textures (fuzzy/knit/cable/waffle/fur/woven/
voronoi/smooth). Checked → the texture is appended to the model source as a
parametric call and re-run (force-applies the phase-1/2 memoized texture);
unchecked → the existing destructive bake. The toggle is hidden for
voronoiLamp/voxelize (engine-changing → bake only) and bypassed when a region is
selected (per-region code is phase 5 — the patch still bakes).

**Single emit path for panel + console + AI.** All three route through one new
`commitSurfaceCode(id, opts)` in main.ts → `partwright.surfaceTexture(id, opts)`
console method + `surfaceTexture` AI tool (SAVE_GATED) + help() entry. Parity in
one place. It guards manifold-js-only and returns `{ error }` otherwise.

**Codegen mirrors the api.paint.* migration wrapper.** `surfaceCodegen.ts`
(pure, unit-tested) appends `api.surface.<id>({...})` before the IIFE wrapper's
`return __pwModel;`, wrapping the body on first use and inserting before the
existing return on subsequent applies — so repeated textures compose without
nesting, and it interoperates with the paint-in-code wrapper. `surfaceOptsLiteral`
filters to the op's valid fields (drops `selectedTriangles`, unknown keys) and
rounds numbers to 4dp for a tidy literal.

**Why this is the right default:** it directly fixes the user's earlier finding
(an AI baked because it couldn't get a parametric texture). Now the AI's natural
tool (`surfaceTexture`) and the human's panel both produce editable models;
baking is opt-in.

## Verification

`tests/surface-code-emit.spec.ts` (emit → code contains the call + textured
render; unknown-id error) + `tests/unit/surfaceCodegen.test.ts` (literal
filtering, IIFE wrap, compose-without-nesting). Panel toggle confirmed in the
browser (screenshot). All three surface e2e specs + 941 unit tests + build +
lint:deps/consistency/deadcode green.
