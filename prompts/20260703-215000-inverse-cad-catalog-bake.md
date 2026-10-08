---
session: "inverse-cad"
timestamp: "2026-07-03T21:50:00Z"
model: claude-fable-5
sequence: 32
---

## Human

"That is incredibly good... Let's bake a catalog entry. chat with me about
the smoothing and whether we think we could reproduce the dummy 13
armor/shell parts as well." (Also: hands look pixelated/rough.)

## Assistant

## Key decisions

**Baked `dummy13-faithful-kit`**: all 21 converged parts assembled into one
print-plate snippet (each candidate wrapped in a closure, api.params
inlined to defaults to avoid cross-part key collisions, parts translated
to a 5-column grid and dropped to z=0). Verified headlessly (manifold,
29 components = 21 parts + 8 faithful debris shells, 234k tris), baked
with the real dev-server pipeline, manifest entry added (154 total,
lint:catalog green).

**Smoothing experiment (empirical, before opining)**: `smoothOut(50–80)
+ refineToLength` does NOT fix the hands' band-staircase — it rounds stair
EDGES but the 0.4mm lateral steps are real geometry, so the result is a
wavy staircase and metrics get slightly worse (0.028 → 0.033 chamfer).
Recommendation to user: (a) print-reality note — at 0.2mm layers the
stairs are at/below layer quantization anyway; (b) the real fixes are
finer bands (0.1–0.2mm), SDF/levelSet interpolation between measured
sections (smooth AND faithful), or app-side Taubin after refinement —
proposed as follow-up, not blocking the bake.
