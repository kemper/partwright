# frame_head — notes

## Verdict: CONVERGED (attempt 2, score 0.0422)

6/6 MUST, 2/2 SHOULD. chamfer 0.0031, hausdorff max 0.122 (P99 0.016),
IoU 0.9938, volume ratio 1.0025, genus 1/1, components 1/1.
Two authored attempts (attempt 1 had a polygon-winding bug; attempt 2 fixed it).
No optimizer pass needed — probe-measured numbers were already exact.

## What the part is

The head is a SIBLING of frame_hip_and_shoulder: the identical joint grammar,
mirrored (mouth opens toward −Y), plus a keyhole stem instead of tab/rod:

- Ring disc r=4.5 about the socket center (0,0), z 0..5 (tactic 5.20: the
  whole outer wall is one arc about the socket center — verified by ray).
- Front corner-cut flats: line offset 2.9062 along n=(±0.2224,−0.9749) —
  IDENTICAL line spec to hip_shoulder's corner chamfer (A=−0.2279, B=2.9803
  → same normal/offset). NOT z-chamfered (same as hip_shoulder).
- Mouth wedge y ≤ −0.6682|x|, walls through the socket center (tactic 5.12);
  same |slope| 0.6682 as hip_shoulder's mouth.
- Socket sphere r=2.8979 @ (0,−0.013,2.5), rim lead-in cones on BOTH z faces:
  r(d)=2.469−0.368d (kit cone spec; opens top and bottom).
- 45° leg-0.5 chamfers top+bottom on: outer arc (exact via revolve-envelope
  intersection) and mouth wall lines (chamferWedge cutters). Flats and stem
  are NOT chamfered.
- Stem plate z 0..3 (walls x=±1.2, traced bulb to y≈8.99) unioned onto the
  ring; keyhole slot (straight part x±0.36 from y=4.4856 + traced bulb to
  y≈8.155) cut through the stem z 0..3 — this slot tunnel is the genus-1
  handle (socket cavity + mouth + both face openings all merge into ONE
  opening, contributing no genus).
- Slot front edge has a leg-0.5 bottom-only chamfer (measured y 4.486→4.034
  at z=0.05); slot sides/bulb are unchamfered.

## What v1 got wrong (the 2mm hausdorff)

head-v3 extruded the mid-Z slice straight through: (a) the socket became a
r2.9 cylinder instead of a sphere (tactic 5.4 — traced outline carries the
equator through the depth), (b) no rim cones, (c) no z-chamfers, (d) the
stem carried to z=5 instead of stopping at z=3 (the ~2mm defect: solid at
y>4.5, z 3..5 that the target doesn't have).

## Traps hit

- Assembling a mirrored-half polygon in the wrong order produced a bowtie;
  extrude silently returned degenerate/empty geometry and the union was a
  no-op (attempt 1: whole stem missing, genus 0). Shoelace-check before
  fromPoints, and treat a "union did nothing" finding as a winding bug.
- Ray-probe sign discipline: I mis-derived a surface offset from
  (1.5 − hit.dist) and briefly concluded the mouth walls gained material
  near the faces (anti-chamfer). Recompute the hit point's signed plane
  distance directly from hit coordinates before believing any offset sign.

## What I'd try next (if reopened)

Nothing structural. If SHOULD-level polish were ever needed: optimize over
(socketR, socketY, rimR0, rimSlope, flatOff, cham) — all declared in
api.params in best/candidate.js.
