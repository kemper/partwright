---
date: 2026-06-21
title: Grid scales to the studio room instead of a fixed 40-unit patch
---

## Human

"the grid for models is often way too small. I think when the grid is enabled
it should likely be the size of the room in the interactive view. It should be
larger either way. make a PR way."

## Assistant

The ground grid was a fixed `THREE.GridHelper(40, 40)` parked at the model's
base. Two problems compounded:

- `makeGrid` **hardcoded** `40, 40`, silently ignoring the existing
  `renderer.gridSize` / `renderer.gridDivisions` config — which even had an
  Advanced Settings UI. The "Grid size" knob did nothing.
- A fixed 40-unit footprint is tiny under a large model (e.g. a 120-unit cube
  overhangs it) and oversized under a small one, while the studio floor (the
  "room") already scales to `maxDim * 14`.

Decision: make the grid **track the model/room size** like the floor does,
rather than bumping a fixed size that would still be wrong at the other end of
the scale range.

- `makeGrid` now builds a unit-base grid at `gridDivisions` cells and applies
  `lastGridScale`; `frameModel` re-derives that scale from the framed model as
  `maxDim * gridRoomFactor / divisions`, so the world footprint is
  `maxDim * gridRoomFactor` (divisions only set cell density, not extent). The
  scale is re-applied on theme rebuilds via the stored `lastGridScale`.
- Replaced the dead `renderer.gridSize` (absolute world units, never read) with
  `renderer.gridRoomFactor` (default 8 — the grid spans 8× the model's largest
  dimension, comfortably larger than before and clearly room-like). Updated the
  Advanced Settings field/tooltips to match.

Verified in-browser with a throwaway spec: a 120×120×40 cube now sits on a grid
that extends well past it, and a radius-5 sphere gets a proportionally small
grid — both "room-sized" rather than the old fixed patch.
