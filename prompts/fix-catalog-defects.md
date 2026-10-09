---
date: 2026-10-09
branch: claude/modest-ptolemy-mls6fe
files_changed:
  - public/catalog/*.partwright.json (19 entries tracked in #985)
  - examples/* sources for those entries where one exists
---

## Human

Use subagents to fix all 19 catalog entries in #985, with Sonnet 5.5 as the
subagent model, and use the review bot on each re-baked entry to make sure the
fix is done well.

## Assistant

- **Fan-out.** Sonnet fixer subagents, grouped 1–3 entries each by engine
  (SCAD, manifold mechanical, voxel, BREP, figures, textured), run in waves of
  about 4 because every bake drives its own headless Chromium against one dev
  server. Each fixer edits only its own entries' files (entry JSON +
  `examples/` source) and runs no git. Since `build-catalog-entry.cjs` never
  touches `manifest.json`, parallel bakes can't collide. Description changes
  come back in the fixer's report and the coordinator applies them to the
  manifest.
- **Fixes are proven, not eyeballed.** Every defect needs a measurement from
  `model:preview` stats, probes or close-up renders, and the fixer must look at
  the real app render from `catalog-review.mjs prepare`.
- **Independent review gate.** Each re-baked entry is graded by a separate
  Sonnet reviewer using the merged recalibrated prompt (#987), on the exact
  in-app review input. Real in-scope findings go back to the fixer.
- **Committed per entry.** Entries are committed by explicit path as each one
  completes, so in-flight fixers' half-written files are never swept in.
- **pacman-ghost.** The catalog description promised a "standalone figurine"
  but the entry is deliberately a diorama (Pac-Man + ghost + pellets + base).
  I kept the model and corrected the description, which is the less
  destructive fix; the ghost's hem "teeth" were a real defect and were rebuilt
  as a scalloped ring.
- **Review round 2 (jar, knob).** The reviewer's minor findings were param-range
  edge cases: at thin walls the lid flutes cut into the thread, and at small
  diameters the knob bore reached the knurl valleys. Both now clamp so at least
  1.2 mm of wall survives across the whole parameter range. The defaults look
  the same.
- **honeycomb-planter, d20-die.** The planter's cells now cut through the wall,
  and the hex is rotated 30° so the lattice really is a honeycomb. The d20's
  numerals were engraved pockets with gold fills, which produced 16 sliver
  components. The request asks for raised gold numerals, so they are now
  proud extrusions unioned into the body, leaving one component.
- **voxel-castle round 2.** The garden path was buried under the fountain, the
  inner-wall windows were half inside a tower, and one ivy voxel was buried in
  the keep. All three were moved to visible spots. The front-tower banners
  turned gold to match "golden banners". The "6 extra" voxels removed by the
  first fix were checked with a grid diff: they were the mirrored copy of the
  black path cut, minus voxels the fountain repaints, so nothing intended was
  lost.
- **pipe-tee-fitting, spur-gear-pair.** The tee's vertical bore started below
  the run and punched a fourth hole through its floor. It now starts at z=0
  (genus 3 -> 2), and the right/top collar chamfers moved to the outer lips.
  The gear plate is re-centred on the two tip circles, with about 6 mm of
  margin on each side. The manifest description now says cyl(chamfer=),
  because the collars use both chamfer ends.
- **retro-tv, pacman-ghost round 2.** Both now rest on z=0. The TV's
  antennas are thick enough to print, its handle leaves finger room, and the
  unused `angleX` parameter is gone. The ghost's eyes are rotated tangent to
  the dome so they no longer stick out as flaps at the rim.
- **voxel-castle round 3.** The reviewer kept turning up older hidden details:
  a door slit, buried water highlights, and tree canopies fused into the wall.
  Instead of another round of spot fixes, the fixer swept the whole grid with a
  script for hidden accent voxels and see-through gaps, so the entry converges.
- **honeycomb-planter, d20-die round 2.** The planter's web now honours its
  declared honeyWall: effR is inflated by wall/√3, giving a flat-to-flat gap
  equal to the wall. The d20 was scaled to about 25 mm so its numeral strokes
  reach the 0.8 mm minimum. The glyphs are seated on the measured face plane so
  their relief is real, and each numeral's ink is centred on its face.
- **pacman-ghost round 3.** Pac-Man's eye sat inside his head, and his mouth
  pointed toward the camera instead of the pellets. The eye now sits on the
  head surface and the mouth faces the pellet line.
- **d20-die round 3.** The die now rests on a face at z=0, with the "20" face
  down. That face's numeral is relieved to 0.05 mm so the die sits flat, and
  it stays a separate gold region.
