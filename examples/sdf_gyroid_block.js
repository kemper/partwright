// Gyroid infill block — a triply-periodic minimal surface clipped to
// a finite box. The gyroid is mathematically infinite, so we intersect
// it with a box to give the level-set mesher a bounded region. This
// pattern is widely used for 3D-printed lightweight structures and
// scaffolds because the surface has zero mean curvature and is
// self-supporting at every overhang.
const { sdf } = api;

const cellSize  = 4;      // period of the gyroid lattice
const thickness = 0.6;    // shell wall thickness
const size      = 24;     // outer block dimensions

return sdf
  .gyroid(cellSize, thickness)
  .intersect(sdf.box([size, size, size]))
  .build({ edgeLength: 0.35 });
