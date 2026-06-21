---
session: "bb0d5a1"
timestamp: "2026-06-20T16:46:00Z"
model: claude-opus-4-8
---

## Human

(work-reviewer pass on PR #799) Two should-fix findings on api.sdf.tube.

## Assistant

## Key decisions

**Fix 1 — helix seam with fractional count:** `count` is now validated
`{ min: 1, integer: true }`. The helix phase `count*theta + …` is not even in
theta, so a fractional start-count left a longitudinal groove discontinuity
where atan2 wraps at ±π. flutes/rings use an even cos(count*theta) so they were
unaffected, but an integer rib/ring/thread count is what callers mean anyway.

**Fix 2 — per-sample allocation:** inlined the tangent interpolation +
normalize into scalars (axx/axy/axz), removing the `unit([...])` array
allocation from the textured eval hot path so it matches the allocation-free
sibling primitives (primCapsule/primTorus). Geometry is byte-identical
(cactus still 390504 tris / 1 component).

Nit (turns has no min bound) intentionally left — turns:0 and negative
(reversed spiral) are valid.
