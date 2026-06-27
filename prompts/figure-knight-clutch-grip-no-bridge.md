---
date: 2026-06-27
branch: claude/admiring-goodall-1tlwna
files_changed:
  - examples/figure_knight.js
  - public/catalog/knight.partwright.json
---

## Human

After diagnosing that the hand is a "fist" sphere with a sword glued to the
knuckles via a bridge capsule — so the fingers don't actually wrap anything:

"yes let's prototype it" (the finger-wrap mechanism, after I proposed a new
`'wrap'` grip preset + per-finger prop carve)

## Assistant

Prototype FIRST step (before designing the new primitive): see how far the
existing API can already go. Two minimal changes to the knight:

1. `F.hands(rig, { grip: 'fist' })` → `F.hands(rig, { grip: 'clutch' })` — the
   `'clutch'` preset has fingers that curl at ~0.7 (instead of 1.0 for 'fist'),
   so they extend forward from the knuckles, then curl. With the sword seated at
   the grip frame, the fingers physically reach across the sword's handle.
2. Dropped the sword bridge capsule (`swordBridge = sdf.capsule(j.handR,
   rig.grip.R.point, gripR * 1.1)`). With clutch fingers already overlapping the
   sword's grip volumetrically, no bridge is needed for the sword + skin to fuse
   as one piece.

Result: four distinct fingers visibly wrapping the front of the sword grip with
the thumb behind — reads as a real grip from front, 3/4, side, and underside.
No more "sword glued to knuckles" lump on the back of the hand. Manifold, 1
component (the volumetric finger-grip overlap holds the weld), 363978 tris.
Catalog re-baked.

What's deferred: a proper finger-carve primitive (subtract the prop's grip from
the fingers so they STRUCTURALLY wrap rather than visually-overlap). For an
elongated grip (sword, staff, hammer) the minimal change above already reads
correctly. The carve primitive becomes important when (a) the prop has a complex
non-cylindrical grip, or (b) extreme close-up reveals visible finger-through-
sword clipping. Filed as a follow-up note for when a figure actually needs it.
