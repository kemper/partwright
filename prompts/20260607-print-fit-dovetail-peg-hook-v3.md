---
date: 2026-06-07
branch: claude/inspiring-brown-MHzmu
pr: "#403"
files_changed:
  - examples/print_fit_dovetail_system.js (peg-style hook redesign)
  - public/catalog/print_fit_dovetail_system.partwright.json (rebaked)
---

## Human

The V2 hook is still terrible. The root failure mode is that I kept designing arms that go in +Y (forward) which are invisible from the model:preview front view (XZ plane, looking along Y). Step back and redesign with visual readability from the front view as the primary constraint.

## Assistant

**Root failure diagnosis:** Both prior hook designs had arms extending in the +Y direction. The model:preview front view is the XZ plane looking along Y — any +Y arm is invisible from that angle. V1 looked like a block with a downward spike; V2 looked like a block with a blob hanging below it. Neither read as a coat hook from the most prominent catalog view angle.

**Design target defined first (lesson from retro):** A Shaker-style peg hook reads correctly from all 4 views:
- Front (XZ): vertical stem column + arc cap silhouette + ball — unambiguous peg hook
- Side (YZ): full J/peg profile — stem goes up, bends forward, ball cap
- Top: block footprint + circular stem cross-section visible
- Iso: complete 3D form

**Geometric pre-checks before coding:**
- `armR = 8` on `hookBlockW = 34`: ratio 16/34 = 47% — within the 30–60% range that reads as substantial
- `stemH = 14 > bendR = 14 = bendR`: stem height equals bend radius — `tipBaseY = hookBlockT/2 + bendR = 10 + 14 = 24 > hookBlockT = 20` — arm exits block cleanly with 4mm clearance

**Arm construction:**
1. **Stem** — `Manifold.cylinder(stemH, armR, armR, 24).translate([cx, cy, hookBlockH])` — rises in +Z, visible from front as a column
2. **Quarter-torus bend** — `Manifold.revolve(CircleProfile, 24, 90).rotate([90,0,0]).rotate([0,0,-90])` — maps (bendR,0,0)→(0,bendR,0) arc to +Z→+Y arc. Arc start at `(cx, cy+bendR, hookBlockH+stemH)`, tangent +Z to match stem; arc end tangent +Y to match arm
3. **Tapered arm** — `Manifold.cylinder(armLen, armR, armR*0.6, 24).rotate([-90,0,0])` — extends in +Y, tapers to 60% at tip for visual interest
4. **Ball cap** — `Manifold.sphere(armR*1.3, 24)` — classic Shaker peg termination, prevents things from sliding off

The `rotate([90,0,0]).rotate([0,0,-90])` chain on the revolve is the verified formula for this arc orientation — the retro captures it for reuse.
