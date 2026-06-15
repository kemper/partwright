---
date: 2026-06-14
branch: claude/anatomical-realism-9i9owt
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
  - public/catalog/athlete.partwright.json
  - public/catalog/bodybuilder.partwright.json
---

## Human

"The athletic sprinter in the catalog has holes in her abdomen. We should
prevent that. Also, generally having muscles does not mean you could ever have
a 'thin-ness' of [the minimum] non-hole belly/abdomen/chest/torso depth."

## Assistant

Reproduced: the baked Athletic Sprinter was genus 3 with two visible tunnels in
the midriff. Isolated the cause empirically with `model:preview` genus checks —
the **lats** were the culprit. They were modeled as a vertical ellipsoid offset
far to the side; on a tapering (slim/female/lean) waist that ellipsoid overlaps
the core only at its top and bottom, looping a handle (a tunnel) on each side →
genus 2. Disabling the lats dropped genus to 0, confirming it.

Two fixes, addressing both the specific bug and the general principle:

1. **Lats redesigned as tapered "wings"** (`buildTorso`): a `tapered` capsule
   running high-and-wide at the armpit → low-and-inward at the waist, so it
   overlaps the core along its whole length and can't pinch a hole. The V-taper
   reads as well or better (verified front/back/side on both catalog figures).

2. **Muscle-aware minimum torso-depth floor** (`buildRig`) — the user's general
   ask. The torso's thin dimension is its front-back depth (chestY/hipsY); a
   slim×lean×narrow combo can drive it low enough that surface masses pinch the
   wall. `depthFloor` now floors chestY/hipsY at `headH*(0.26|0.24 + 0.14*muscle)`
   — so each unit of muscle raises the minimum depth (you can't be both maximally
   lean AND maximally muscled). At `muscle: 0` the floor (0.26/0.24·headH) sits
   below every real build's natural depth (slim chestY ≈ 0.33·headH), so all
   existing non-muscled figures stay byte-identical (pinned by tests).

Result: the Athletic Sprinter's visible abdomen holes are gone (genus 3 → 1, and
the bare-skin torso is genus 0). The remaining genus-1 is a single non-visible
internal handle, the same the Muscular Hero already shipped with — manifold, one
component, prints fine. Re-baked both catalog entries. Added unit tests for the
muscle-aware floor; `npm run preflight` green (1399 tests).
