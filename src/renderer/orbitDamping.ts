// Pure, dependency-free helper for frame-rate-independent OrbitControls damping.
// Kept out of viewport.ts (which pulls in three.js) so it can be unit-tested in
// the node tier. See the call site in viewport.ts's animate loop.

/** Re-derive OrbitControls' per-frame damping factor from the real frame delta
 *  so the orbit coast decays at a constant rate per *second* rather than per
 *  *frame*.
 *
 *  OrbitControls applies damping once per `update()` (once per animation frame)
 *  with no time term: each frame it moves the camera by `sphericalDelta * factor`
 *  and decays the remaining backlog by `(1 - factor)`. With a fixed factor the
 *  coast therefore takes a fixed number of *frames*, so when the frame rate dips
 *  — exactly what a heavy/smoothed voxel mesh does — the same drag coasts for far
 *  more wall-clock time and the model lags behind the cursor (reads as sluggish,
 *  slow rotation).
 *
 *  `base` is the factor authored for `refFps`. At that frame rate this returns
 *  `base` unchanged; below it the factor rises so each longer frame consumes
 *  proportionally more of the backlog (constant decay-per-second); above it the
 *  factor falls for the same reason. The total rotation eventually applied is
 *  unchanged — only its timing is made frame-rate independent.
 *
 *  Capped just below 1 so the controls stay stable when a single frame is very
 *  long (e.g. the first frame after the tab was backgrounded). Falls back to
 *  `base` for non-positive / non-finite inputs. */
export function frameRateAdjustedDamping(base: number, deltaSeconds: number, refFps: number): number {
  if (!(deltaSeconds > 0) || !(refFps > 0) || !(base > 0)) return base;
  const frames = deltaSeconds * refFps; // 1.0 at the reference frame rate
  return Math.min(0.9, 1 - Math.pow(1 - base, frames));
}
