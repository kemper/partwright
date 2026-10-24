---
date: "2026-10-20T23:45:00Z"
task: "feat: typed slider entry everywhere + shared sliderEntry helper (#1043, #1046)"
pr: 1046
areas: [ui, testing, agents]
cost: medium
---

## Liked / Worked
- Delegating the "audit every range slider" fan-out to an `explore` subagent
  returned a per-slider table (slider max vs real engine clamp, paired or not)
  that drove both PRs; I never had to read the 15 files myself.
- The `work-reviewer` pass caught real defects both times (span-scaled integer
  rounding in #1043; hidden-digit apply in Simplify + the voxel focus clobber in
  #1046) before a human saw them.

## Lacked
- A slider's UI max and the engine's hard clamp live in different files with
  no link — the smooth cap (20) was invisible from the panel (12). Several
  engine caps were module-private consts I had to export to stop the UI drifting.
- Running the background test-triage agent and my own Playwright run at the
  same time killed/recycled the shared dev server and produced
  ERR_CONNECTION_REFUSED noise (cost: one confused re-run).

## Learned
- In main.ts, a `let` declared inside the giant init function near the code
  that uses it can be in the TDZ when an earlier line calls a hoisted function
  that assigns it (initClipControls is called ~10k lines above its body) —
  put such state at module scope.
- Playwright `fill()` leaves the box focused, so any "don't clobber a focused
  input" guard in a programmatic setter breaks Reset-style flows in e2e.

## Longed for
- A per-run port for Playwright's webServer (e.g. `E2E_PORT` honoured by
  playwright.config.ts) so a background agent's test run can't collide with
  the foreground one.
- A tiny "engine limits" registry the UI and API validation both read (like
  SURFACE_OP_FIELDS but for numeric bounds), so slider hard limits can't drift
  from the engine clamps.
