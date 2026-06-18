---
date: 2026-06-17
branch: claude/kind-cerf-dikkfm
files_changed:
  - examples/figure_strongman.js
  - public/catalog/flexing_strongman.partwright.json (re-baked)
---

## Human

[On PR #713, with a front close-up of the strongman chest attached.] On the
strongman the nipples could/should be higher and also are still clipped with
the body.

## Assistant

Two adjustments to the hand-rolled areola coins in `figure_strongman.js`:

**Height.** `nipZ` sat `0.16·puffR_z` below the pec-puff centre — low on the
mass. Raised it to `0.04·puffR_z` so the areolae sit up near the pec apex.

**Clipping (sunk rim).** Root cause: the coin was a sphere of radius
`surfR = puffR[1]` — the pec's *depth* (Y) radius (`chestY·1.2`) — but the pec
ellipsoid is taller in Z (`chestY·1.6`). A sphere sized to the smaller depth
radius curves away faster than the actual elongated surface, so the disc's
top/bottom rim fell *behind* the real pec surface and sank into the body (the
clipping the user saw). Fix: size the coin off the larger Z radius
(`surfR = puffR[2]·0.9`) so it's flatter and matches the surface across its
whole rim, and seat it a touch more proud on this heavily-muscled chest
(`eps` `chestX·0.03 → 0.06`). The flush-coin construction, the bounded
`discDepth`, and the tiny nipple nub are otherwise unchanged.

Verified by colored front/side/back bakes (the only colored render path;
`model:preview` shades by normal and can't show the areola paint): both
areolae now sit higher and flush with clean circular rims, no sinking, and the
back stays clean (no rod). Re-baked `flexing_strongman.partwright.json`:
`isManifold: true`, `componentCount: 1`, 11 labels incl. `areola`, genus 1
(pre-existing). Continuation of the PR #713 areola work.
