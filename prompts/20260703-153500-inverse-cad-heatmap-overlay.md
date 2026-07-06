---
session: "inverse-cad"
timestamp: "2026-07-03T15:35:00Z"
model: claude-fable-5
sequence: 13
---

## Human

(continuation — v2 framework build; implementer subagent delivered the
render layer)

## Assistant

## Key decisions

**heatmap.mjs** — per-triangle bidirectional signed-distance heatmap:
row 1 = candidate colored by distance to target (excess red / sunk blue),
row 2 = target colored by distance to candidate (the only render that
shows MISSING features), fixed ±scale with printed legend, optional
finding markers, shared-bbox framing. Reuses the BVH from
surfaceDistance.mjs and composePng from cli/preview.mjs.

**sliceOverlay.mjs** — 2D slice contour overlays (target black, candidate
red, translucent symmetric-difference fill, mm grid) + per-slice numerics
{targetArea, candArea, iou, maxDeviation_mm}; multi-slice contact sheet.
maxDeviation is null (not 0) when a slice misses geometry — tested.

Subagent-found bug worth recording: the overlay's SVG layer initially
painted an opaque white full-canvas rect that silently hid the
translucent disagreement fill underneath — caught by zoomed-crop visual
verification, exactly the CLAUDE.md high-res-inspection rule.

Verified: 1708 unit tests green, typecheck green; smoke on
frame_thigh vs +0.5mm-shifted self reports maxDeviation 0.500mm and the
expected red/blue leading/trailing split.
