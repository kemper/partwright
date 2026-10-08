# frame_upper_arm_2x — session notes (2026-07-03)

## Verdict: CONVERGED

Best = attempt 1: **score 0.0272**, 6/6 MUST + 2/2 SHOULD, chamfer 0.0017mm,
hausdorff max 0.0869mm, P99 0.0324mm, IoU 0.9982, volume ratio 1.0019,
genus 3/3, components 1/1, zero findings. 1 authored attempt (budget 15) —
single sibling-transfer restructure over the bootstrap (tactic 5.18).

## What the part actually is

**The thigh with an 8mm-shorter shaft.** Same architecture end-to-end:
frame_thigh_2x with every feature beyond the shaft face (y=5) shifted −8 in
y; spool / window / shaft-face geometry byte-identical. Genus 3 = window +
slot + fork cavity, exactly like the thigh.

- **−Y end = spool** (shoulder pivot) at (0,0): r2.5, 45° V-groove to r1.5
  @z2.5 (groove z 1.5..3.5), 0.5 chamfers at z0/z5 (r2.0 at faces),
  truncated-cone dimples r1.0→r0.5 depth 0.5 both faces, subtracted LAST.
- **Window**: slab void z 1.0..4.1, y −4.1..5 (shaft face y=5, same as thigh).
- **Shaft**: oct(2.5) y 0..6.5 (thigh: 0..14.5 — the only real difference).
- **Flare**: 45°, y 6.5..8 (hw 2.5→4), with the tactic-5.16 diagonal chamfer
  prism (diagP translate y = 26.142−8 = 18.142).
- **Fork**: oct(4) y 8..14; slot y 7.63..8.95 (thigh slot polygon −8,
  point-for-point); cavity y 9..11.6 (circle r3.1 c(0,2.5) ∪ rects
  z<0.667 / z>3.833); wall bump r2.0 c(0,7.45); channel y 11.6..14
  (r1.6 c(0,2.5) ∪ upper rect x±1.5, z<0.9 tip shelf).

## Verification trail (chord math per tactic 5.18, before any authoring)

- Spool r2.5/r2.0/groove: bootstrap band0/1/2 chords, e.g. sqrt(2.5²−1.75²)
  =1.7854 vs traced 1.7860; groove split z 2.246/2.749 vs predicted 2.25/2.75.
- Dimples: band1 cone-rim chords (0.6613 @z5); floor truncation confirmed by
  NO hole in the z=4.3 plan section (full cone would show r0.3).
- Window/shaft face/flare/fork/cavity/channel/bump: one z=2.5 plan section
  gave every y-extent explicitly ([±2.5,5.0] face, flare 6.5→8, cavity
  9..11.6, channel ±1.60 to 14, bump points all at r=2.00 from (0,7.45)).
- Slot: z=2.5 hole trace == thigh slot polygon −8 (max pt delta ~0.07 = DP
  noise); reused thigh polygon shifted.
- Diagonal chamfer: z=4.75 plan flare face [−2.25,6.60]→[−3.75,8.10] ==
  thigh's [−2.25,14.60]→[−3.75,16.10] at y+8; borrowed diagP verbatim.
- Flare 45° slope: band4 traced hw 3.2509 @ y=7.251 → hw = y−4 ✓.

Total probes: 4 sections (3 on this target, 1 comparison on the thigh's).
No fit probes needed — nothing on this part is new.

## Not done / next if reopened

- Nothing structural. Optimizer pass skipped deliberately: every dimension
  is a thigh probe-fit transfer re-verified here; chamfer 0.0017 leaves no
  numeric headroom (same precedent as thigh/shin).
- Slot remains the traced 11-pt polygon (parametric composite spec is in
  frame_thigh_2x/notes.md if anyone wants CAD-pure code).
- Candidate = best/candidate.js (also attempts/001).
