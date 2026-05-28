// Helix Lamp Standard — an architectural light post where the *repetition*
// and the *offset-axis spiral* are the design. Three SDF features carry the
// piece:
//   • a tall shaft that twists around an off-centre vertical line (the
//     `.twist(rate, 'z', [u, v])` offset-axis form) — so the corners trace a
//     wide candy-cane helix instead of a tight pirouette;
//   • a back screen wall perforated by an infinite XZ grid of round
//     portholes (`sdf.repeat([px, 0, pz])` clipped to the finite screen via
//     `.intersect(...)`); and
//   • a flared lamp cap on top via `sdf.roundedCylinder(r, h, edgeR)` whose
//     OUTER size is preserved (no inflation surprises).
// A crisp Manifold base plinth grounds the whole thing — that's the right
// tool for axis-aligned blocky geometry.
const { sdf, Manifold } = api;

// --- Dimensions ------------------------------------------------------------
// Keep total bbox under 80 units on every axis. The shaft sits centred on
// the origin in XY; the plinth is the only thing wider than the shaft.
const PLINTH = { x: 50, y: 20, z: 4 };
const SHAFT  = { x: 7, y: 7, h: 50, edgeR: 1.2 };
const SCREEN = { x: 38, y: 1.6, h: 36 };
const LAMP   = { r: 8, h: 6, edgeR: 1.6 };

// --- Manifold plinth (crisp axis-aligned base) -----------------------------
// Native Manifold is the right tool for a flat block — no need to bring SDF
// meshing costs to a box. `api.label(...)` registers it for paintByLabel.
const plinthZ = -SHAFT.h / 2 - PLINTH.z / 2; // sits just below the shaft
const plinth = api.label(
  Manifold.cube([PLINTH.x, PLINTH.y, PLINTH.z], true).translate([0, 0, plinthZ]),
  'plinth',
);

// --- The corkscrew shaft (offset-axis twist) -------------------------------
// A square cross-section column with rounded corners (twisting a sharp box
// chatters along the helix; pre-rounding keeps the marched edges smooth at
// the default edgeLength). The non-zero `center=[u,v]` is the whole point of
// this feature: the column spirals around a vertical line offset by +2.5 in
// X, so its outline traces an asymmetric candy-cane around the lamp axis
// instead of pirouetting in place.
//   rate * height = 4.5 * 50 = 225 deg = 5/8 of a turn from base to cap.
const shaftCore = sdf.roundedBox([SHAFT.x, SHAFT.y, SHAFT.h], SHAFT.edgeR);
const shaft = shaftCore
  .twist(4.5, 'z', [2.5, 0])
  .label('shaft');

// --- The perforated screen wall (repeat clipped by intersect) --------------
// A thin slab parked behind the shaft. The `repeat` tile is a Y-aligned
// cylinder (cylinder is Z-aligned by default → rotate 90° about X to lay it
// horizontally through the panel), then `.repeat([6, 0, 6])` tiles it
// infinitely on the XZ grid (the 0 on Y means "don't repeat along Y" — Y is
// the panel's thickness direction, the holes go straight through). The
// infinite grid MUST be intersected with a finite shape (or fed explicit
// `bounds` to `.build()`) — here we intersect with a slightly oversized
// region matching the panel slab so only the holes that land in the panel
// survive. Then we subtract the bounded hole-cloud from the panel slab.
const screenY = -SHAFT.y / 2 - SCREEN.y / 2 - 1; // tucked behind the shaft
const screenSlab = sdf.box([SCREEN.x, SCREEN.y, SCREEN.h]).translate(0, screenY, 0);

// One porthole: a 2-unit-radius cylinder that, after rotation about X, runs
// along Y for at least the panel thickness. Make it long enough to punch
// fully through even at the panel's offset.
const porthole = sdf.cylinder(2, SCREEN.y + 4).rotate(90, 0, 0);

// Infinite XZ grid of portholes, clipped to a finite region sized to the
// panel (slightly inset so the perimeter row of holes doesn't break out
// through the panel edge — that would leave half-moon gouges).
const holeRegion = sdf.box([SCREEN.x - 5, SCREEN.y + 6, SCREEN.h - 5]).translate(0, screenY, 0);
const holeGrid = porthole.repeat([6, 0, 6]).intersect(holeRegion);

// The slab minus the grid. Labelling the slab side (the A side of subtract)
// is the right call — that's the surface that survives, and labels
// propagate through subtract from A.
const screen = screenSlab.label('screen').subtract(holeGrid);

// --- The lamp cap (roundedCylinder — outer dims preserved) -----------------
// `roundedCylinder(r, h, edgeR)` gives a flat-top-and-bottom disc whose
// OUTER radius is exactly `r` and height exactly `h` — unlike
// `cylinder(r, h).round(edgeR)`, which would inflate to radius `r + edgeR`
// AND height `h + 2*edgeR`. For something that has to sit cleanly on the
// shaft top with a known footprint, the preserved-outer-dims form is the
// right pick.
const lampZ = SHAFT.h / 2 + LAMP.h / 2 - 0.5; // small overlap with shaft top
const lamp = sdf.roundedCylinder(LAMP.r, LAMP.h, LAMP.edgeR)
  .translate(0, 0, lampZ)
  .label('lamp');

// --- Compose ---------------------------------------------------------------
// Hard-union the SDF labelled pieces so each region survives partitioning,
// then add the Manifold plinth on top. edgeLength tuned to 0.45 — the twist
// helix benefits from a touch more resolution than the default, but anything
// finer doubles the runtime for no visible gain on a piece this size.
const sdfPart = shaft.union(screen).union(lamp).build({ edgeLength: 0.45 });
return sdfPart.add(plinth);
