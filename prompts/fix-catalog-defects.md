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
  down. That face's numeral stands 0.3 mm proud (one print layer), so the die
  rests on its strokes and every face stays visibly raised.
- **voxel-castle round 4.** The gates got lintels, so they read as a wall with
  a door in it. The garden hedge is cleared around the fountain basin again; it
  had been narrowed by mistake in round 3. The mirrored battlements now have a
  double crenel at the centre line instead of a double merlon.
- **pipe-tee-fitting round 2.** The tee is lifted by the collar radius so it
  rests on z=0, and the stale vert_len comment now matches the code.
- **voxel-castle passed** on its fifth review. Stale dimension comments were
  corrected, with the geometry unchanged.
- **pacman-ghost round 4.** The pupils are placed in world coordinates with one
  shared offset, so both look left; in the rotated eye frames they diverged.
  The pellets were enlarged so they read, and the stale comments fixed.
- **coffee-mug, machine-knob (BREP).** The mug's `shell` grew outward, and its
  baked label colours landed on the wrong triangles. So the cavity is now a
  plain cut, the handle stands off the wall with a real finger gap, and the
  coffee fills the cavity. Colours are analytic cylinder paint regions, because
  multi-label `BREP.label` sets come back scrambled in replicad sessions (filed
  as a separate bug). The knob got the fluted skirt and chamfered top its
  description promised. Both manifest descriptions were updated to match.
- **treasure-chest, castle-tower.** The texture defects had one root cause.
  Scoped `api.surface` ops pick triangles near the label's base-mesh centroids,
  and big flat triangles or slivers made that scope patchy, so gold bled into
  the wood and brown into the stone. Rebuilding the base meshes with uniformly
  fine triangles fixed both. The chest now has real ball feet it rests on, two
  straps clear of the lock plate, and a dark keyhole. The tower got a pointed
  gothic door recessed into the wall, inside an untextured stone surround, and
  an untextured plinth so it sits flat on z=0. Trade-off: the bake now persists
  the textured mesh (`surfaceTexture`), so each file is about 2.7-2.9 MB.
- **dummy13-complete-kit.** Levelset "straddle pair" ledges were lerped across
  a 0.15 mm marching-cubes grid that sat right on the ledge plane, which
  shattered the flat step into hundreds of slivers. The ledge pairs are now
  exact half-space unions blended into the lerp. Only the affected parts
  (22, 25, 33, 34, 36) were re-run and spliced in. All 37 parts and the
  58-piece total are unchanged, and the outer chest's chamfer error against
  the source STL improved.
- **surfer, ballerina, lotus-yogi.**
  - Surfer: the board's 0.18 taper had collapsed one end and ballooned the
    other, so the board is rebuilt as a proper long, narrow board with both
    feet planted on its deck.
  - Ballerina: the tutu is now three distinct stepped tiers instead of one
    melted disc.
  - Lotus-yogi: re-posed from a squat to a cross-legged seat on a cushion. The
    figure rig can't put the feet on the opposite thighs, so it is a simplified
    lotus, and the manifest description now says so (rig gap filed separately).
  - All three now rest on z=0 by translating by the built mesh's real min z.
    Missing `lips` palette colours were added for the lotus-yogi and the surfer.
- **coffee-mug round 2.** The handle moved out to leave an 18.5 mm finger gap.
  The rim band became a 0.4 mm-proud geometric ring, so its paint edge is
  crisp; paint alone always notched at the cylinder seam. The white body paint
  is applied, but the viewport's ACES tone mapping caps it at mid-grey, so it
  can't read as bright white without a renderer change.
- **Catalog size gate.** `build-catalog-entry.cjs` had started writing
  `Version.surfaceTexture` (the full textured mesh, multiple MB), which pushed
  the two api.surface entries past the 1500 KB `lint:catalog` limit. The bake
  now drops it, because the app recomputes the texture from the stored code on
  open. castle-tower was re-baked with it (2871 KB -> 66 KB).
- **treasure-chest round 2.** The corner caps and ball feet got their own gold
  label, distinct from the brass straps, as the request names them. The
  lock-plate rivets now stand proud of the plate. The entry was re-baked
  without the persisted texture (2642 KB -> 132 KB).
- **surfer round 2.** The reviewer counted the near-upright stance against the
  request's "low riding crouch". The crouch is deepened: hips about 16 above
  the soles, a wide stance, and spine lean 27. The crown now sits about 43
  above the deck, against about 55 standing.
- **pocket-watch.** All six defects are fixed:
  - the bow is now a standing ring;
  - the crown and pendant overlap instead of leaving a gap;
  - nothing sits below z=0;
  - the rubies sit seated and proud;
  - the beaded lip rests on the bezel;
  - the gear trains are phased by solving each follower's spin, verified with
    empty tooth intersections.
  Heavy SCAD meshing under load ran past the review harness's 360 s per-entry
  timeout, so it is raised to 900 s.
- **treasure-chest round 3.** The hasp is clipped to the lid's cylinder, so it
  follows the dome at constant proudness instead of standing out as a flat
  block. The strap comment was corrected, and the strap brass brightened while
  staying distinct from the gold.
- **surfer round 3.** The wider stance had also widened the board, because
  its width came from the foot span. The board is now sized from the figure
  height, 24 × 66 (ratio 2.75), with a pointed nose and pin tail. The cream
  board colour read as grey, so it is now coral.
