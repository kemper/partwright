---
session: "cool-galileo"
timestamp: "2026-06-20T15:15:37Z"
model: claude-opus-4-8
---

## Human

After the import fix merged: the default view is too zoomed in on the new
model — it should be more zoomed out by default. Make a new PR.

## Assistant

## Key decisions

**Root**: `frameModel()` in `src/renderer/viewport.ts` hardcoded the auto-frame
camera at `center ± maxDim * 1.2` on each axis (view distance ≈ 2.08·maxDim).
That `1.2` is the framing tightness — too small, so the model nearly fills the
viewport on every fresh render / Reset view.

**Fix**: per the repo's "no hardcoded tuning constants" rule, promoted the factor
to `renderer.defaultFrameFactor` in `appConfig.ts` and raised the default to
**1.5** (view distance ≈ 2.6·maxDim — ~25% more margin). `frameModel` reads it
via `getConfig()`. Exposed it in the Advanced Settings modal (Rendering section)
as "Default zoom (framing)" so users can tune it live. Updated the adjacent
maxDistance comment that referenced the old ~2.1·maxDim distance.

Verified visually (scratch spec, throwaway): the same body+head figure that
previously filled the frame now sits centered with comfortable margin. Full
preflight green (the new config key didn't trip the config-shape unit tests).
No new permanent test — the value is subjective and a hardcoded camera-distance
assertion would be brittle; framing is already exercised indirectly by the e2e
suite.
