// TPMS comparison study — four 14×14×14 lattice tiles laid out side by
// side on a thin solid plinth so the four surface families can be
// compared at a glance. From left (-X) to right (+X):
//
//   1. Schwarz P  — blockier, rounded-cubic cells
//   2. Diamond    — interpenetrating diamond channels (scaffold look)
//   3. Lidinoid   — higher-genus, woven
//   4. Graded gyroid — thickness ramps from thick at the bottom-left
//      corner of the tile to thin at the top-right, with a faint Z
//      sinusoid layered on so the grading is obvious from any view.
//
// Each tile is its own labelled region so the paint manifest can colour
// the four lattices distinctly. The plinth gets its own label too. All
// four TPMS primitives are mathematically infinite, so every lattice is
// intersected with a finite cube tile to give the mesher bounded
// support. cellSize and thickness are kept identical across tiles so
// the only visible difference is the surface family itself (except for
// the gradedGyroid, which is the whole point of varying the thickness).
const { sdf, Manifold } = api;

// ---- Parameters ----------------------------------------------------------
const tile     = 14;     // edge length of each cube tile
const gap      = 1.6;    // air gap between tiles so the boundaries read
const cellSize = 3.5;    // TPMS period — small enough that each tile shows ~4 cells
const wallTh   = 0.55;   // constant wall thickness for the non-graded lattices

const plateH   = 2.0;    // solid plinth thickness
const plateW   = 4 * tile + 3 * gap + 4;       // overall plinth length (X)
const plateD   = tile + 4;                     // plinth depth (Y)

// X centre of each tile (4 tiles, evenly spaced, centred on origin)
const stride = tile + gap;
const xCentres = [-1.5, -0.5, 0.5, 1.5].map((i) => i * stride);

// Helper: an axis-aligned cube of side `tile` centred at (cx, 0, 0). The
// tile sits with its base at z = plateH/2 so it rests on the plinth.
function tileBox(cx) {
  return sdf.box(tile).translate(cx, 0, tile / 2 + plateH / 2);
}

// ---- Tile 1: Schwarz P ---------------------------------------------------
const tileP = sdf
  .schwarzP(cellSize, wallTh)
  .intersect(tileBox(xCentres[0]))
  .label('schwarzP');

// ---- Tile 2: Diamond -----------------------------------------------------
const tileD = sdf
  .diamond(cellSize, wallTh)
  .intersect(tileBox(xCentres[1]))
  .label('diamond');

// ---- Tile 3: Lidinoid ----------------------------------------------------
const tileL = sdf
  .lidinoid(cellSize, wallTh)
  .intersect(tileBox(xCentres[2]))
  .label('lidinoid');

// ---- Tile 4: Graded gyroid ----------------------------------------------
// Thickness function: ramp from ~0.95 at the -X / -Z corner of the tile
// down to ~0.20 at the +X / +Z corner, plus a small Z-sinusoid so the
// banding is visible from the side. The fn is called once per mesh
// sample (millions of times), so it's pure arithmetic with no allocs.
//
// Tile spans:   x ∈ [cx - tile/2,  cx + tile/2]
//               z ∈ [plateH/2,     plateH/2 + tile]
// Normalise both to [0, 1] inside the tile so the magnitudes are easy
// to reason about regardless of the tile's world position.
const cx4   = xCentres[3];
const xMin4 = cx4 - tile / 2;
const zMin4 = plateH / 2;
const invTile = 1 / tile;
const tMax = 0.95;
const tMin = 0.20;
const tAmp = 0.08;             // sinusoidal amplitude on top of the ramp
const kBand = (2 * Math.PI) / (cellSize * 2); // one band per ~2 cells of Z

const gradedThickness = (x, y, z) => {
  // Normalised position inside the tile, clamped just in case the
  // mesher samples slightly outside the intersect bounds.
  let u = (x - xMin4) * invTile;        // 0 at -X edge, 1 at +X edge
  let w = (z - zMin4) * invTile;        // 0 at bottom, 1 at top
  if (u < 0) u = 0; else if (u > 1) u = 1;
  if (w < 0) w = 0; else if (w > 1) w = 1;
  // Diagonal ramp + sinusoidal Z-banding.
  const ramp = 1 - 0.5 * (u + w);       // 1 at (-X, bottom), 0 at (+X, top)
  return tMin + (tMax - tMin) * ramp + tAmp * Math.sin(kBand * z);
};

const tileG = sdf
  .gradedGyroid(cellSize, gradedThickness)
  .intersect(tileBox(cx4))
  .label('gradedGyroid');

// ---- Combine the four tiles (SDF) ---------------------------------------
// Plain sharp union — these are non-overlapping tiles, so smoothUnion
// would be wasted (and would also collapse their separate labels).
const lattices = tileP.union(tileD).union(tileL).union(tileG);

// edgeLength 0.4 resolves all four surfaces cleanly. The four tiles
// together are 4×14 + 3×1.6 = 60.8 wide, 14 deep, 16 tall — well under
// the 70-unit bounding-box budget.
const sdfPart = lattices.build({ edgeLength: 0.4 });

// ---- Plinth (Manifold) ---------------------------------------------------
// A thin solid plate the tiles sit on, so the piece reads as one object
// rather than four floating chunks. Plain Manifold here — crisp,
// axis-aligned, no reason to pay for an SDF cube.
const plinth = api.label(
  Manifold.cube([plateW, plateD, plateH], true),
  'plinth',
);

// ---- Final assembly ------------------------------------------------------
// Clipping any TPMS at a hard boundary leaves dozens of tiny edge chips
// where partial cells get sliced — that's inherent to lattice cropping,
// not a defect, so we don't assert single-component here.
return Manifold.union([sdfPart, plinth]);
