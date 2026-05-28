// Twisted lantern finial — a square-cross-section column spiralled one full
// turn around Z (the .twist() modifier doing all the work), smooth-welded to
// a domed cap, then hard-stacked on a plinth base and topped with a slender
// spire. Twisting a roundedBox is the canonical case: the four corners trace
// helices while the smooth fillets of the rounded edges keep the meshing
// clean. A pure sphere or cylinder would be invariant under z-twist; the
// non-radial cross-section is what makes the warp visible.
const { sdf } = api;

// --- The twisted column ----------------------------------------------------
// 10x10 cross-section, 40 tall, with 2-unit corner rounding (keeps the
// marched edges from chattering at the highest twist gradient).
// 9 deg/unit * 40 units = 360 degrees -> exactly one full revolution from
// the bottom of the column to the top. Intuitive: pick the rate so that
// (rate * height) lands on whatever pleasing fraction of a turn you want.
const column = sdf.roundedBox([10, 10, 40], 2).twist(9, 'z');

// --- The cap on top --------------------------------------------------------
// Slightly oversized so the smoothUnion gets a proper bulge to blend across;
// k = ~12% of the join's smallest dimension (~6) gives a generous fillet.
const cap = sdf.sphere(6).translate(0, 0, 21);

// --- Smooth-welded body ----------------------------------------------------
// Smooth booleans don't propagate labels, so we label the OUTER expression.
// This means the whole twisted column + cap is one paintable 'body' region,
// but the blend zone where the round cap melts into the twisted column top
// stays smooth (which is the visual money shot).
const body = column.smoothUnion(cap, 1.2).label('body');

// --- The plinth base -------------------------------------------------------
// A wide rounded disc, hard-unioned so its label survives partitioning.
// Sitting just below the column with a small overlap so the union is solid.
const base = sdf.cylinder(13, 4)
  .round(0.6)
  .translate(0, 0, -22)
  .label('base');

// --- The spire on top ------------------------------------------------------
// A tapered capsule (a fat-to-narrow rod) tipping the finial. Labels
// propagate through translate, so labelling the capsule directly is fine.
const spire = sdf.capsule([0, 0, 0], [0, 0, 7], 1.5)
  .translate(0, 0, 25)
  .label('spire');

// Hard-union the three labelled pieces so each stays its own paint region.
// (A smoothUnion here would collapse them into a single anonymous region.)
// Finer edgeLength than the default — the twist's surface curvature
// benefits from extra mesh resolution along the helical corners.
return body
  .union(base)
  .union(spire)
  .build({ edgeLength: 0.4 });
