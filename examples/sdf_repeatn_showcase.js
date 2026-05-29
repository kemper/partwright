// SDF `repeatN` showcase — a perforated speaker-style faceplate, the
// textbook "I want N×M features, NOT an infinite tiling clipped to a
// box" case. The whole point: `.repeatN(counts, periods)` gives finite
// bounds out of the box, so the holes don't need an `.intersect()` to
// clip them to the faceplate — you just `.subtract()` the array and
// you're done.
//
// Two independent uses of `repeatN` exercise it in different shapes:
//   1. A 7×5 grid of through-holes (35 cells — comfortably > 12),
//      subtracted from the faceplate slab.
//   2. A 4×1 row of LED-indicator bumps (4 cells, 1-axis pass-through
//      via `0` on the Y count), unioned into the bezel.
//
// Three paint regions:
//   - 'faceplate' — the perforated slab (its label survives the subtract)
//   - 'bezel'     — the rounded frame around the faceplate
//   - 'leds'      — the row of indicator bumps along the top edge
//
// Why sharp `union` between the three labels (rather than smoothUnion):
// per sdf.md, smooth blends across labels degrade to hard unions anyway
// because the partition-and-mesh-per-label pipeline can't blend across a
// label boundary. So we lean into it — sharp unions keep all three
// regions paintable, and a `.round()` pass on the bezel + a smoothUnion
// of the LEDs INTO the bezel (BEFORE labelling) keep the look soft.
const { sdf } = api;

// ---- Sizing -------------------------------------------------------------
// Bbox target: ≤ 80 units on every axis. Final extents are ~56 × 42 × ~8.
const fpW          = 50;      // faceplate X
const fpD          = 36;      // faceplate Y
const fpH          = 4;       // faceplate thickness (Z)
const fpRound      = 1.5;     // faceplate edge round

// Hole grid — 7 (X) × 5 (Y) = 35 finite cells, comfortably > 12.
// Periods chosen so the (n-1)*p spans (36, 24) fit inside the faceplate
// with margin on every side.
const holeNx       = 7;
const holeNy       = 5;
const holePx       = 6;       // X period — span = 6*6 = 36 < fpW (50)
const holePy       = 6;       // Y period — span = 4*6 = 24 < fpD (36)
const holeR        = 1.6;     // hole radius
const holeH        = fpH * 2; // overshoot so the drill cuts cleanly through

// Bezel — a frame slightly larger than the faceplate.
const bezW         = fpW + 6; // 56
const bezD         = fpD + 6; // 42
const bezH         = fpH + 2; // 6  — sits a touch proud of the faceplate
const bezRound     = 1.2;

// LED row — 4 (X) × 1 (Y) bumps centred on the +Y edge of the bezel top.
const ledN         = 4;       // count along X
const ledPx        = 8;       // period — span = 3*8 = 24
const ledR         = 1.1;     // bump radius
const ledY         = bezD / 2 - 2.4;            // offset toward the +Y bezel edge
const ledZ         = bezH / 2;                  // sit on top surface of bezel

// ---- Faceplate: rounded slab with the finite hole grid drilled out -----
// A single Z-aligned cylinder is the "unit hole". `.repeatN` snaps points
// outside the array to the nearest cell rather than tiling forever — so
// the array's bounds are already (holeNx-1)*holePx wide × etc., finite
// enough that NO intersect() is needed to keep the drills inside the
// faceplate. That's the whole pitch over `.repeat()`, which would force
// an `.intersect(slabSizedBox)` here.
const holeUnit = sdf.cylinder(holeR, holeH);

const holeGrid = holeUnit.repeatN(
  [holeNx, holeNy, 0],          // 0 on Z = no repeat there (single layer)
  [holePx, holePy, 0],          // period 0 on Z matches the 0 count
);

// `subtract` preserves the A-side label (per sdf.md). So we label the
// faceplate ONCE on the slab and the perforated result inherits it.
const faceplate = sdf
  .roundedBox([fpW, fpD, fpH], fpRound)
  .subtract(holeGrid)
  .label('faceplate');

// ---- Bezel: frame around the faceplate, with LED bumps welded in -------
// Build the bezel as the OUTER block; smoothUnion the LED row into it
// BEFORE labelling so the bumps weld in with a small fillet. We then
// label the bezel-plus-bumps subtree as one region, OR — to keep the
// LEDs paintable separately — sharp-union the LEDs as their own label.
//
// Going with the second route: the LEDs are visually distinct (an
// accent color in the paint manifest) so they should be their own
// region. The sharp seam where each bump meets the bezel is hidden by
// a `.round()` on the bezel itself — soft enough to read as one piece
// at normal viewing distance.
const bezelSolid = sdf
  .roundedBox([bezW, bezD, bezH], bezRound)
  // Drop a faceplate-sized pocket out of the bezel top so the faceplate
  // sits FLUSH inside the frame (not stacked on top). The pocket is a
  // hair larger than the faceplate so the booleans see real overlap.
  .subtract(
    sdf.box([fpW + 0.4, fpD + 0.4, fpH + 1])
      .translate(0, 0, (bezH - fpH) / 2 + 0.5),
  )
  .round(0.25)                  // soften ALL bezel edges in one pass
  .label('bezel');

// Second `repeatN`: a 4 × 1 × 0 finite row of hemisphere-like bumps.
// `0` on the Y and Z counts means "no repeat there" — the array is a
// single row of 4 along X, centred on the origin (cells at X ∈
// {-12, -4, 4, 12} with period 8). This exercises `repeatN`'s
// pass-through behaviour on the off-axes.
const ledBump = sdf.sphere(ledR);

const ledRow = ledBump
  .repeatN(
    [ledN, 0, 0],
    [ledPx, 0, 0],
  )
  .translate(0, ledY, ledZ)
  .label('leds');

// ---- Assemble: sharp union of the three labelled regions ---------------
// Sharp `union` between labels preserves each one's identity (per
// sdf.md's partition-per-label model). Build at edgeLength 0.35 — fine
// enough to resolve the bezel's `.round(0.25)`, the LED hemispheres,
// and the cylindrical hole walls without exploding triangle count.
return sdf.union(bezelSolid, faceplate, ledRow).build({ edgeLength: 0.35 });
