---
date: 2026-06-19
branch: claude/hands-opt2-dense
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
---

## Human

Ship 3 hand options on separate PRs (tracking #767). This is Option 2 —
separate fingers + denser hand mesh, allowing real curls.

## Assistant

Built on Option 1's base (canonical-frame hand, flat slab palm, single-capsule
separated fingers via plain union, oriented via eulerFromBasis). Option 2 adds
CURL: each finger is a single capsule angled toward the palm by a per-finger
curl, so the configurations include genuinely curled poses (relaxed, fist, ok,
claw, clutch) on top of the straight ones (open, spread, wave, point, peace).

Curled separate fingers create tight concave palm-junction crevices, so this
option pays for clean curls with a FINER handDetail default (r.hand*0.05 vs
0.085, radius 2.8). Cost: ~+50k triangles per figure (athlete 322k, afro 339k —
within the ~500k budget). At this density curled poses are mostly clean
(componentCount 2, no detached spike fragments) but still show minor residual
specks; fully clean needs ~0.035 (≈150k tris for the hands alone — too heavy),
which is exactly the tradeoff this option exists to expose. Straight-finger poses
are clean.

Updated the "rejects unknown grips" unit test (claw is now a valid grip).
254 tests pass; build green. Companion PRs: Option 1 (#768, straight only),
Option 3 (two-pass mesh).
