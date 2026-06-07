# Retro — Dovetail coat hook arm geometry

**Date:** 2026-06-06  
**Task:** Rewrite print_fit_dovetail_system.js with horizontal rail + curved coat hook

## Liked

- `model:preview` PNG is genuinely useful for catching orientation bugs — the front/side/top/iso views made it obvious once I looked that the arm was pointing in the right direction.
- The revolve + two-rotation approach for the quarter-torus (`.rotate([-90,0,0]).rotate([0,0,90])`) is clean once proven; it's a reusable pattern for any YZ-plane arc from a Manifold.revolve that naturally produces an XY-plane arc.

## Lacked

- **Geometric pre-check for arm clearance.** The first version had `stemLen < bendR`, which placed `tipBaseY = hookBlockT + stemLen - bendR < hookBlockT` — the downward tip was geometrically inside the hook block body. I didn't catch this until user feedback. The invariant `stemLen >= bendR` (equivalently `tipBaseY >= hookBlockT`) was computable before writing any code; I should have verified it explicitly.
- **Too much analysis, not enough visualisation.** I spent many reasoning turns working out rotation matrices algebraically rather than just writing a candidate, running `model:preview`, and reading the PNG to see if it looked right. A 2-second preview catches what 20 reasoning steps miss.
- **armR too small for the block size.** armR=7 on a 38×14×40mm block looked spindly. Correct proportion check: arm diameter / block width ≈ 14/38 = 37% is too thin; 20/34 = 59% looks right. Should ballpark this ratio before coding.

## Learned

- `Manifold.revolve` sweeps in the XY plane (X=radial, Y→Z after revolve). The resulting arc is in the XY plane at Z=0. To get a YZ-plane arc (arm goes +Y then curves -Z), the two required rotations are Rx(-90°) then Rz(90°) — NOT just Rz(90°) alone as the session summary incorrectly stated.
- Setting `stemLen = hookReach` directly (rather than `hookReach - bendR`) makes the parameter semantics clearer (hookReach = arm projection from block face) and avoids the clearance failure that occurs when hookReach < 2*bendR.
- The "tip inside block" failure was invisible in the stats (`isManifold: true`, `componentCount: 2`) — the boolean union silently absorbed the interpenetration. Only the PNG and user eyeballs caught it.

## V3 Resolution (2026-06-07)

Redesigned as a **Shaker peg hook**: stem rises above block top (+Z, visible from front), quarter-torus bends forward (+Y), tapered arm, ball cap. Key fix: design target defined in terms of all 4 model:preview views *before* writing any code. Verified `armR/hookBlockW` ratio (47%) and arm clearance `tipBaseY=24 > hookBlockT=20` with concrete numbers before coding. PNG confirmed correct from all 4 views on first attempt.

Rotations used in V3: `.rotate([90,0,0]).rotate([0,0,-90])` (arc goes +Z→+Y). Different from what the retro's "Learned" section said for a downward arc — the correct formula depends on which direction the end tangent points. Catalog baked successfully, build/unit tests green.

## Longed For

- A `model:preview` stat or warning for **self-intersection / interpenetrating sub-components before union**. If the tool reported "arm tip extends to Y=12, behind block face at Y=14" I'd have caught this immediately.
- A **proportions linter** in the model preview: flag when a tube/arm feature's diameter is < 30% of the mounting body width. Would have caught the armR=7 on hookBlockW=38 issue.
- The CLAUDE.md summary of the session's revolve geometry was wrong (said only one rotation needed). A way to mark session-level geometry conclusions as "unverified" until `model:preview` confirms them would prevent future sessions from inheriting incorrect geometry notes.
