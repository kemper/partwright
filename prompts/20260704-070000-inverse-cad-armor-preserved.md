---
session: "inverse-cad"
timestamp: "2026-07-04T07:00:00Z"
model: claude-fable-5
sequence: 47
---

## Human

(continuation — armor endgame)

## Assistant

## Key decisions

**armor_forearm converged essentially bit-exact** (chamfer 0.000,
hausdorff max 0.0029, genus 4/4) — the third exact-class part. Its path
validated the safety-best pattern: stock levelSet turn banked first
(0.156, all MUST), then the facet-census CSG decode took over.

**Preserved 15 armor reconstructions** in
`scripts/inverse-cad/converged/dummy13-armor/` (candidate + metrics +
notes + state per part). Final armor verification sweep + 6-view gallery
generation running in background.

**Caught my own orchestration miss via the final sweep table**:
armor_shoulder_2x was never assigned an agent (crotch's bootstrap-pass
made the launch count look complete). Launched now — the last
unconverged part of the 37-part corpus.

Ratchets from forearm: §5.34 census-diff ± facet pairs (a "2x" part can
be non-mirror in one feature), §5.35 hull corners the mesh never welds,
§5.36 faceted-sphere decode from ring radii; §7 traps: hull silently
convexifies concave profiles (split into convex sub-prisms);
closestPointOnMesh takes scalars, [x,y,z] returns Infinity silently.
