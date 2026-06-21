// Vacuum-hose elbow — RINGS (corrugations across the direction of travel) that
// follow a 90° bend. The ring spacing is measured by arc length along the path,
// so the corrugations stay evenly spaced as the hose turns the corner.
const { sdf } = api;

// Straight inlet, a quarter-circle bend, straight outlet.
const path = [[0, 0, 0], [0, 0, 30]];
const R = 44, cx = R, cz = 30;                 // bend centre (gentle radius)
for (let i = 1; i <= 12; i++) {
  const a = (Math.PI / 2) * (i / 12);          // 0 → 90°, finely sampled
  path.push([cx - R * Math.cos(a), 0, cz + R * Math.sin(a)]);
}
path.push([cx + 32, 0, cz + R]);               // straight outlet

const hose = sdf.tube(path, 12, { profile: 'rings', count: 32, depth: 1.3 }).label('hose');
const model = hose.build({ edgeLength: 0.5 });
api.paint.label({ label: 'hose', color: '#46506b' });
return model;
