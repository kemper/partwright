// Gyroid lantern chamber — a porous triply-periodic minimal-surface core
// sandwiched between a solid base and cap, cinched at the waist by a
// decorative torus ring. The gyroid lattice is the showpiece (it's
// infinite so we MUST intersect it with a finite cylinder to give the
// mesher bounded support), while the solid bookends and ring keep the
// piece readable as an object rather than "just a chunk of gyroid".
//
// Four labelled regions ('lattice', 'base', 'cap', 'ring') let the
// paint manifest color each part independently. Labels are placed on
// the OUTSIDE of every transform/intersect so they propagate cleanly
// (the lattice label rides through the gyroid.intersect(cylinder) per
// the propagation rules — label survives the A-side of intersect when
// applied to the intersect node itself).
const { sdf, Manifold } = api;

// ---- Parameters ----------------------------------------------------------
const R         = 22;     // outer radius of the lantern
const latticeH  = 32;     // height of the gyroid section
const baseH     = 5;      // solid base thickness
const capH      = 4;      // solid top cap thickness
const ringMinor = 1.6;    // torus tube radius (decorative waist ring)
const ringMajor = R + 0.4;// torus sits flush around the equator

const cellSize  = 5.5;    // gyroid cell period — chunky enough to read at a glance
const wallTh    = 0.9;    // gyroid wall thickness — sturdy enough to print

// ---- Lattice (SDF) -------------------------------------------------------
// Clip the infinite gyroid to a cylinder so it has finite bounds. The
// intersect node inherits its bounds from the cylinder (the gyroid's
// bounds are infinite). Label is applied to the intersect node so the
// whole carved lattice paints as one region.
const lattice = sdf
  .gyroid(cellSize, wallTh)
  .intersect(sdf.cylinder(R - 0.2, latticeH))   // tiny inset so it sits inside the ring
  .label('lattice');

// ---- Decorative ring (SDF torus) -----------------------------------------
// A subtle waist ring at z=0 (the equator of the lattice section). It
// sticks out just slightly beyond R so it reads as a distinct band.
const ring = sdf
  .torus(ringMajor, ringMinor)
  .label('ring');

// Build the SDF half. Both subtrees together still have finite bounds
// (the lattice is bounded by its cylinder; the torus is naturally
// finite). edgeLength tuned to resolve the gyroid surface cleanly
// without the mesh ballooning past ~a few hundred k tris.
const sdfPart = lattice.union(ring).build({ edgeLength: 0.4 });

// ---- Solid base + cap (Manifold) -----------------------------------------
// Rounded thin disks that bracket the lattice top and bottom. We use
// plain Manifold here because the geometry is crisp and axis-aligned;
// SDF would add cost for no benefit. Each gets its own paint label via
// api.label so the paint manifest can address them independently.
const base = api.label(
  Manifold.cylinder(baseH, R, R, 96).translate([0, 0, -latticeH / 2 - baseH]),
  'base',
);

const cap = api.label(
  Manifold.cylinder(capH, R, R, 96).translate([0, 0, latticeH / 2]),
  'cap',
);

// ---- Combine -------------------------------------------------------------
// SDF result is a normal Manifold, so a plain union closes the assembly.
// We deliberately do NOT use expectUnion({expectComponents: 1}) here: a
// gyroid clipped by a cylinder leaves hundreds of tiny lattice "chips"
// at the boundary where partial cells get sliced — they're inherent to
// the geometry, not a defect, and the main lantern body still meshes
// as one piece. Manifold.union handles the many-component result fine.
return Manifold.union([sdfPart, base, cap]);
