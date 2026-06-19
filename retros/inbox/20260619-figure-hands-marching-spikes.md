# Retro — figure hand marching spikes (PR #748)

## Liked
- `model:preview` reproducing the exact catalog corruption once I matched the
  real figure's `r.hand` AND the failing arm pose — turned a "can't repro" into
  a tight Node loop.
- renderViews-in-a-Playwright-spec gave true browser ground truth (the editor
  re-runs code, so the branch preview showed my real geometry, not stale bakes).

## Lacked
- I verified hands at ONE convenient pose (raiseSide 90) and shipped; the bug
  only appears at extreme poses (overhead, twisted). Pose is a hidden variable
  for SDF marching of smoothUnion-dense features.
- A standing "worst-pose" hand verification fixture: build the hand at several
  adversarial arm orientations (overhead, behind back, twisted) and assert no
  spikes / triangle-count sanity — would have caught this pre-merge.

## Learned
- **Small smoothUnion `k` between angled capsules = non-Lipschitz field =
  orientation-dependent marching spikes at coarse grids.** Finer edgeLength does
  NOT fix it; fatter welds do. This is distinct from the thin-feature alias trap
  (which finer DOES fix).
- The catalog/editor re-runs figure code, so a branch preview reflects current
  code — corruption there is real, not necessarily a stale bake.

## Longed for
- A headless multi-pose figure smoke (`figure:smoke --poses overhead,twist,...`)
  that flags spike/degenerate-triangle blowups, so hand/limb SDF changes are
  verified across the pose space, not one frame.
