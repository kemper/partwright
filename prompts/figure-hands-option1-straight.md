---
date: 2026-06-19
branch: claude/hands-opt1-straight
files_changed:
  - src/geometry/sdfFigure.ts
---

## Human

Ship clean separated fingers with presets for common hand configurations, as one
of three option PRs to compare (tracking #767). This is Option 1.

## Assistant

Option 1 = the robust, cheap, ships-now approach. After establishing that the
hand corruption comes from non-Lipschitz fields — `smoothUnion` (smin) blends
spike, and `union` of *angled* capsule segments leaves concave-junction slivers
when fingers curl — Option 1 sidesteps both by keeping every finger a SINGLE
STRAIGHT capsule (one exact Lipschitz SDF) and never curling it.

Design:
- Flat tapered slab palm (two big coplanar rounded boxes; smoothUnion is safe
  there — no thin/angled features).
- Each finger: a single straight capsule, fanned across the width by a per-finger
  `spread`, joined to the palm with plain `union`.
- `grip` presets pick which fingers are EXTENDED (full separate capsules) vs
  FOLDED (shown as a knuckle bump — a convex sphere embedded in the palm top, so
  no thin gap): open, relaxed, spread, wave, point, peace, thumbsup, fist.
- Built in a canonical frame (fingers +Z, width +X, palm +Y) and oriented onto
  each wrist via `eulerFromBasis` (Rz·Ry·Rx Euler from the re-orthonormalized
  dir/splay/palmN basis), so the flat slab palm stays unskewed at any arm pose.
- Kept `count` / `length` / `palmThickness` knobs and the `fingers:false` legacy
  puffy preset. No curled/gripping fingers — the deliberate trade for robustness.

Verified: overhead/twisted arm pose (the case that corrupted before) is clean —
componentCount 2 (no stray spike fragments), no smin/concave slivers; all 8
presets render clean and recognizable; full afro_funk raised hand clean in the
REAL browser. 254 figure unit tests pass; preflight green.

Companion PRs: Option 2 (curls via denser hand mesh), Option 3 (two-pass mesh).
