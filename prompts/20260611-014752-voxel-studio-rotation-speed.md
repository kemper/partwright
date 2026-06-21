---
session: "u0cvuk"
timestamp: "2026-06-11T01:47:52Z"
model: claude-opus-4-8
---

## Human

After using Voxel Studio on a voxel model (e.g. applying smoothing or other
operations), the interactive rotation in the viewport became dramatically
slower than before — the model rotates "incredibly slowly." Asked to
investigate and, if confident, fix it. Follow-up answers: the rotation is
"smooth but turns far less" (not choppy), it happens on *any* voxel model
including a fresh sphere, and there was a vague memory of a past PR about a
"different selected rotation speed."

## Assistant

## Key decisions

**Ruled out an angular-speed regression.** OrbitControls rotation is
`2π · pixels / canvasHeight` — invariant to model scale, distance, and triangle
count. Confirmed empirically with instrumented browser runs: degrees-per-drag,
camera distance, canvas clientHeight, and apparent on-screen size were all
*identical* before opening the studio, in the studio (blocky), after smoothing,
and after the full bake-and-commit path (at devicePixelRatio 2). A pickaxe over
the entire git history of all branches showed `rotateSpeed` has **never** been
set anywhere; the "rotation" PRs the user half-remembered rotate the starter
*geometry's orientation*, not the camera. So there is no per-engine or
voxel-specific rotation speed to "restore."

**Found the real mechanism: frame-rate-dependent damping.** three.js
OrbitControls applies damping once per `update()` (once per animation frame)
with no time term: each frame it moves the camera by `sphericalDelta · factor`
and decays the backlog by `(1 − factor)`. With a fixed factor the coast takes a
fixed number of *frames*, so the wall-clock feel scales with frame rate. Measured
the coast directly: at pointer-release only ~33° of an eventual ~47° had been
applied — ~30% was still "coasting" out over the following frames. When the
frame rate dips — exactly what heavy/smoothed voxel meshes cause — that backlog
drips out over many more seconds and the model lags far behind the cursor, which
reads as "smooth but turns far less / sluggish." This is consistent with the
symptom being worse on voxel models (the app's heaviest meshes) and after
smoothing (heavier still).

**Fix:** re-derive the per-frame damping factor from the real frame delta so the
decay stays constant *per second* instead of per frame:
`f_eff = 1 − (1 − base)^(deltaSeconds · refFps)`, capped just under 1 for very
long frames (backgrounded tab). At the reference rate (60 fps) it returns the
configured factor unchanged — a no-op for anyone already at 60 fps — and only
compensates when the frame rate drops. The total rotation eventually applied is
unchanged; only its *timing* is made frame-rate independent.

**Structure:** extracted the pure helper into a dependency-free leaf module
`src/renderer/orbitDamping.ts` (so it unit-tests in the node tier without
dragging in three.js), wired it into viewport.ts's animate loop using the
`delta` already computed there. Added `orbitDampingReferenceFps` (default 60) to
`appConfig.ts` per the no-hardcoded-tuning-constants rule, surfaced it in the
advanced settings modal, and added `tests/unit/orbitDamping.test.ts` proving the
constant-per-second property, the no-op at the reference rate, and the
stability cap.

**Verification:** unit tier (1052 passing), typecheck, production build, and
`lint:deps` (acyclic) all green; the existing `voxel-studio-camera` e2e still
passes. A browser check under 8× CPU throttle confirmed full rotation is
preserved and the coast settles in ~0.8 s instead of dragging out.
