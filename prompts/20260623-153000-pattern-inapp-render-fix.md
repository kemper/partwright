---
session: "sharpbell"
timestamp: "2026-06-23T15:30:00Z"
sequence: 11
---

## Human

[PR #852 in-app verification + watch CI] proceed to the next step

## Assistant

## Key decisions

**Browser check caught a real in-app render bug the headless path couldn't.** A
striped sphere rendered SOLID amber in the editor while `model:preview` showed
stripes. Root cause: the live-run path that turns `api.paint.*` ops into the
model-colour underlay (`main.ts`, ~16693) destructured only `triangles` from
`resolveDescriptorTriangles` and dropped `perTriColors`; `setModelColorRegions`
didn't thread it either. So a `pattern` op fell back to its single swatch colour
(base) on every triangle. The headless `paintOpsResolve` resolves `perTriColors`
directly, which is why it was unaffected and the bug slipped through. Fix: thread
`perTriColors` through both (the compositor already stamps it per triangle).

**Added a permanent golden-path e2e** (`tests/pattern-colorway.spec.ts`): runs a
striped colourway in the editor, screenshots the canvas, and asserts ≥2 distinct
warm coat colours render. Deterministic (fixed seed), and it specifically guards
the live-run `perTriColors` path — with the regression the coat collapses to one
colour and the assertion fails. Uses a Playwright canvas screenshot + `sharp`
(WebGL `readPixels` returns blank without `preserveDrawingBuffer`).
