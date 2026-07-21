// Saguaro cactus dock — built with the directional-surface primitive api.sdf.tube.
// Each arm is ONE bent tube, so its vertical flutes flow continuously around the
// elbow (no per-segment seam). Trunk + arms smooth-welded into one connected,
// paintable body; tan pot hard-unioned so it keeps its own color.
const { sdf, Manifold } = api;

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

// Spines — scatter tiny cones over the trunk + arms only. `where` keeps
// samples above the pot rim (top at z=34, translate(0,0,17) + half-height 17;
// a few mm of margin clears its rounded edgeRadius=4 corner too) so nothing
// lands on the pot or dips down toward the soil line.
const spine = Manifold.cylinder(2.6, 0.9, 0.08, 6); // tiny sharp cone, base at origin, tip along +Z
const spines = api.scatter(model, spine, {
  count: 850,
  seed: 11,
  alignToNormal: true,
  spin: true,
  scale: [0.85, 1.2],
  offset: -0.45, // sink the base in so it fuses with no seam
  minSpacing: 4.5,
  where: (p) => p[2] > 38, // trunk/arms surface only — clears the pot entirely
});
const withSpines = api.expectUnion([model, api.label(spines, 'spines', { color: '#e8dcb0' })], { expectComponents: 1 });
return withSpines;
