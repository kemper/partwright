// Saguaro cactus dock — built with the directional-surface primitive api.sdf.tube.
// Each arm is ONE bent tube, so its vertical flutes flow continuously around the
// elbow (no per-segment seam). Trunk + arms smooth-welded into one connected,
// paintable body; tan pot hard-unioned so it keeps its own color.
const { sdf } = api;

// Central trunk — vertical flutes.
const trunk = sdf.tube([[0, 0, 22], [0, 0, 168]], 16, { profile: 'flutes', count: 22, depth: 1.4 });

// Arms: a curved 4-point path (out, round the elbow, up). Flutes follow it.
const armR = sdf.tube([[0, 0, 74], [40, 0, 74], [56, 0, 90], [56, 0, 126]], 11,
  { profile: 'flutes', count: 15, depth: 1.1, taper: 0.92 });
const armL = sdf.tube([[0, 0, 102], [-34, 0, 102], [-48, 0, 117], [-48, 0, 150]], 10,
  { profile: 'flutes', count: 14, depth: 1.0, taper: 0.92 });

const body = trunk
  .smoothUnion(armR, 6)
  .smoothUnion(armL, 6)
  .label('cactus');

// Tan pot at the base; trunk lifts off the floor so nothing pokes through.
const pot = sdf.roundedCylinder(30, 34, 4).translate(0, 0, 17).label('pot');

const model = sdf.union(body, pot).build({ edgeLength: 0.7 });

api.paint.label({ label: 'cactus', color: '#4a6b3a' });
api.paint.label({ label: 'pot', color: '#c9a784' });
return model;
