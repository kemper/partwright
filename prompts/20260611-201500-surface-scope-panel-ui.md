---
session: "6sobw6"
timestamp: "2026-06-11T20:15:00Z"
tools: [playwright, vitest]
sequence: 9
---

## Human

(Same three-part request — the user-facing surfaces of items 2 and 3: the
Surface panel's click-to-region capture, plus driving scoping from the console
and the in-app AI.)

## Assistant

### Surfaces for scoping — panel UI, console/AI codegen, docs

**One shared validator.** Extracted `parseSurfaceOpts(id, opts) → { params, scope? }`
into the dependency-free `surfaceOpSpec.ts` so the Worker sandbox recorder
(`recordSurfaceOp`) and the console twin (`applySurfaceTextureAsCode`) validate
scalar params + the reserved `label`/`region` keys through ONE path (no drift).
The Worker throws plain `Error`; the console method re-wraps as `ValidationError`
so `guard()` returns `{ error }`.

**Codegen handles scopes.** `surfaceCodegen.formatValue` now renders arrays and
nested objects, so `applySurfaceTextureAsCode` (and the panel) can write
`api.surface.fuzzy({ region: { point: [x,y,z], radius } })` /
`{ label: 'grip' }` faithfully.

**Panel Scope picker.** In whole-model "apply as code" mode the Surface panel
shows a **Scope** row — Whole / By label / Near point. "By label" lists the
model's `api.label` regions (new `getLabelNames()`); "Near point" reuses the
existing `pickFace` + `addPointerSuppressor` machinery to capture a clicked
surface point + a radius slider. The chosen scope merges into the apply-as-code
options. Hidden whenever Apply would bake; reset on tab change.

**AI tool + docs.** `applySurfaceTexture`'s description gains a Scoping section
(label/region, code-path only) and drops the stale "region texturing is not
available from chat" line. `public/ai/textures.md`, `public/ai.md`, the `help()`
entries, and the CLAUDE.md surfaceOps bullet document the scope keys.

**Verified.** Unit: `parseSurfaceOpts` (scope split, both-keys/unknown/malformed
errors). E2e (`surface-panel-as-code.spec.ts`): the Scope picker writes a
label-scoped knurl on a union, and "Near point" captures a clicked point and
writes a region-scoped fuzzy (pointerdown dispatched at the canvas center).
Browser screenshots of the Scope UI, the label-scoped knurl (cube knurled,
sphere smooth), and the region patch posted in chat. Build + lint:deps clean.
