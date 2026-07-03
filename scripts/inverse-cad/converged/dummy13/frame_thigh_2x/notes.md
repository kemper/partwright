# frame_thigh_2x — session notes (2026-07-03)

## Verdict: CONVERGED

Best = attempt 7: **score 0.0281**, 6/6 MUST + 2/2 SHOULD, chamfer 0.0013mm,
hausdorff max 0.086mm, P99 0.031mm, IoU 0.9978, volume ratio 1.0012,
genus 3/3, components 1/1, zero findings. 7 attempts used (budget 15).

## What the part actually is (all numbers probed, not guessed)

NOT the "ball on both ends" limb archetype. Measured structure:

- **Body**: Y-prism of a chamfered octagon (0.5 × 45° chamfers on all top/bottom
  long edges): shaft half-width 2.5 (y 0..14.5), 45° flare to hw 4 (y 14.5..16),
  fork block hw 4 (y 16..22). Z 0..5 flat on plate.
- **−Y end = spool** (hip pivot), axis vertical at (0,0): cylinder r2.5 with a
  45° V-groove pinching to r1.5 at z=2.5 (groove z 1.5..3.5), 0.5 chamfers at
  z0/z5 (r2.0 at the faces), and **truncated-cone dimples** on both faces:
  r1.0 at the face → r0.5 at depth 0.5, flat floor (NOT full cones — the flat
  floor at z=0.5/4.5 was the last 0.5mm hausdorff defect).
- **Window** (genus handle 1): slab void z 1.0..4.1 between the spool and the
  shaft face y=5; bridges top (z 4.1..5) and bottom (z 0..1) connect the spool
  to the shaft at full shaft width.
- **Slot** (genus handle 2): curved through-Z slot at y 15.63..16.95, x ±2.51.
  Composite 2D shape: inner edge arc r≈2.99 c(0,18.62) (tangent-line ends from
  x≈±0.99), outer edge arc r1.5 c(0,15.45) blending via r≈0.83 fillets into
  flat y=16.5, end caps r0.1 c(±2.412,16.400). Candidate uses the traced 11-pt
  polygon (adequate: residual ~0.04mm rms).
- **Fork cavity** (genus handle 3, the knee C-clip socket): Y-prism y 17..19.6
  of XZ profile [circle r3.1 c(0,z2.5) ∪ rect x±2.5 z<0.667 ∪ rect x±2.8
  z>3.833], minus the **wall bump** — a vertical cylinder r2.0 at (0,15.45)
  whose crescent forms the flex wall's back face (wall is the 0.5-thick C-clip
  spring between slot and cavity).
- **Channel**: Y-prism y 19.6..22 of [circle r1.6 c(0,z2.5) ∪ rect x±1.5 upper
  half] — the snap entry; leaves the z<0.9 shelf at the tip.
- **Flare diagonal chamfer**: the tilted flare face's 45° chamfer is measured
  PERPENDICULAR to the face → plan recession = full (z−4.5), not (z−4.5)/√2 as
  a hull of two chamfered octagons gives; it also clips the fork corner past
  y=16 (to y≈16.10 at z=4.75). Modeled by intersecting flare+fork with a
  chamfer-profile prism running along each diagonal.

## Attempt log (what moved the needle)

1. att 2: full measured restructure → 1.87 → 0.157, all gates green already.
2. att 3: window slab was cut 0.1 too deep (cube length 9.2 from y=−4.1
   reached y=5.1; shaft face is at 5.0) → 0.102.
3. att 4: flare hull end-slabs were 0.1 thick → diagonal steeper than 45°;
   pinned hull ends outside [14.5,16] → 0.089.
4. att 5: hausdorff 0.5 localized at the dimples: subtracting dimples from the
   spool BEFORE unioning body let the shaft prism (y>0) refill half of each
   dimple. Subtract dimples from the final body → 0.063.
5. att 6: dimples are truncated cones (flat floor at depth 0.5; residuals
   matched (0.5−r)/√2 exactly) → 0.058.
6. att 7: diagonal chamfer prisms on flare/fork → 0.028, zero findings.

## Old candidate (.plans/inverse-cad/candidates/thigh-v4.js) — its >2mm defect

thigh-v4 had the wrong architecture at BOTH ends: (a) −Y end modeled as a
stadium cap with a biconic bore along Y — the real part is a vertical spool
with an external V-groove and a through-X window (v4 had genus 0 there);
(b) fork modeled as side gaps + embedded ball + ear notch — the real part is a
C-clip: prismatic cavity + curved slot + flex wall + channel. Nothing from v4
was inherited.

## Not done / next if reopened

- Slot is a traced 11-pt polygon, not the parametric composite (measured specs
  above if anyone wants CAD-pure code). Residual excess ~1mm³ total.
- Optimizer pass skipped deliberately: all dimensions came from exact probe
  fits; chamfer 0.0013 leaves no numeric headroom (worked-example precedent:
  probe-fit dims come back "already-optimal").
- strategiesTried updated in state.json.
