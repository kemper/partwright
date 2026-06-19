---
date: 2026-06-19
branch: claude/nice-dijkstra-xxdsz6
files_changed:
  - src/geometry/sdfFigure.ts
  - public/ai/figure.md
---

## Human

(Reviewing the catalog hands against an uploaded reference photo of a real
hand, front + back.) Fingers still aren't fully separated, and there's a lumpy
part coming out of the palm. The old hands weren't bad — just needed a 4th
finger and to be flatter (less palm-to-back thickness). I'll likely want finger
joints long-term — figure that out now if it makes sense so it all aligns.
→ Approved direction: wire it in as-is, subtle joints now.

## Assistant

Two real defects: (1) fingers fanned from a packed base joined by a knuckle bar,
so they blended instead of separating; (2) the palm was welded round capsules, so
the weld + thumb base bulged.

New construction (matches the reference, sets up joints):
- **Build the hand in a CANONICAL frame** (fingers +Z, width +X, palm +Y) and
  ORIENT it onto each wrist via a new `eulerFromBasis` helper (derives the
  Rz·Ry·Rx Euler angles that map the canonical axes to the re-orthonormalized
  (splay, palmN, dir) wrist basis; palmN = dir × splay for a right-handed map).
  This is what lets the palm be a real flat slab (orientation/roll matters for a
  rectangle — `eulerAlignZ` alone couldn't do it) and the fingers stay crisp.
- **Flat slab palm**: a wide knuckle roundedBox + a narrower wrist roundedBox,
  smooth-unioned → clean tapered flat palm, no weld lump. (`roundedBox` corner
  radius is capped by half the slab thickness — the taper comes from the two-box
  blend, not a big corner radius.)
- **Fully-separated jointed fingers**: each finger is a 3-segment digit
  (phalanges 0.42/0.33/0.25 of length, tapering) that bends toward the palm by
  `curlDeg` per joint. Digits are `union`ed (crisp gaps — they don't touch) then
  smooth-unioned to the palm for clean knuckle bases. `open` = 5°/joint (subtle
  knuckles), `relaxed` = 22°/joint (curls into a cup). The segmentation IS the
  joint architecture — per-finger/joint pose control can be added later without
  another rewrite.
- **Thumb**: a 2-segment digit off the radial side edge (the localized weld is
  the thenar pad, not a palm-face lump).
- **L/R mirror**: the canonical geometry's X is multiplied by `side`, so the two
  hands are true mirror images under the same orientation.
- Kept the **fist** (ball + ridges) and **legacy puffy** (`fingers:false`) paths.
- Params unchanged + `palmThickness` default 0.46 → 0.5.

Critical verification (the lesson from the prior round): rendered open/relaxed/
fist AND a full figure AT CATALOG RESOLUTION (within the detail sphere) — fingers
fully separated, palm clean and flat, thumb off the side, mirror-correct, no
craters/aliasing. athlete builds manifold/1-component. 250 figure tests green
(reach-peak finger counter, count/length/palmThickness, L/R symmetry); full
preflight green.
