---
date: 2026-06-21
task: scale the ground grid to the studio room (PR #817)
---

## Liked
- The headless verification loop was fast and decisive: a throwaway Playwright
  spec driving `partwright.setGridVisible(true)` + `resetView()` over a large
  cube and a small sphere proved the scaling behavior in one run, with PNGs to
  show the user.

## Lacked
- No `gh` CLI and no `send_later` in this remote session, so watching CI to
  green required a `Monitor` bash poll that just *wakes me to re-query the GitHub
  MCP* — works, but it's an awkward indirection vs. a direct status poll.

## Learned
- The grid config (`renderer.gridSize`/`gridDivisions`) had a full Advanced
  Settings UI but `makeGrid` hardcoded `40, 40` and never read it — a dead knob
  hiding in plain sight. Worth grepping that a config field is actually *read*,
  not just declared + surfaced in settings.

## Longed for
- A single "ground-plane sizing" source of truth: the studio floor's `maxDim*14`
  factor is still an inline magic number in `frameModelShadow`, separate from the
  new `gridRoomFactor`. A shared `studioRoomFactor` would keep floor + grid in
  lockstep instead of two independent multipliers.
