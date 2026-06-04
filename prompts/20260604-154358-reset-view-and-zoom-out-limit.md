---
session: "zen-cori"
timestamp: "2026-06-04T15:43:58Z"
model: claude-opus-4-8
tools: [claude-code]
---

## Human

I'd like a reset view button in the interactive view and a limit on how far
away I can zoom out.

## Assistant

## Key decisions

**Single framing path, reused.** The camera auto-frame logic was inline inside
`updateMesh`. Rather than copy it into a new reset handler (which would drift
out of sync the way the project's "duplicated logic" guidance warns against), I
extracted it into a private `frameModel()` in `viewport.ts` and exported a thin
`resetView()` that calls it. `updateMesh`'s auto-frame and the new button now go
through the exact same code, so "reset" provably matches the framing applied
after a fresh run.

**Zoom-out limit via OrbitControls `maxDistance`, scaled to the model.** A fixed
world-unit cap would be wrong across the app's arbitrary-scale models (a 5mm
keychain vs an 890mm panel). I set `controls.maxDistance = maxDim *
maxZoomOutFactor` inside `frameModel()`, re-derived every time the model is
framed. The default framing sits at ~2.1×maxDim, so the factor (default 12)
leaves ~6× of pull-back room before clamping — generous but bounded. It stays
comfortably inside the existing `camera.far = maxDim * 50`, so the model never
clips out at the limit.

**Tunable, not hardcoded.** Per the repo's "no hardcoded numeric constants"
rule, `maxZoomOutFactor` is a new `renderer` field in `appConfig.ts` with a
default and a JSDoc, read via `getConfig()` at frame time (so a user override
applies on the next frame), and surfaced as a `<Field>` in the advanced
settings modal.

**Discoverability.** Added a "↻ Reset View" button to the clip-controls overlay
next to the existing view toggles, and exposed `partwright.resetView()` on the
console API (plus its signature entry and ai.md docs) so AI agents can re-frame
too.

**Verification.** Confirmed in a real browser via a Playwright spec: a 10-unit
cube frames at distance 20.78; wheeling out hard clamps exactly at 120
(= 10 × 12) instead of running away; clicking Reset View returns to 20.78. Kept
the spec as a permanent golden-path test (`tests/viewport-reset-view.spec.ts`).
