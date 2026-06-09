// Brain coral — a rounded boulder scored with winding labyrinthine grooves.
// Ridged noise gives the maze-like "brain" pattern; shaping the field to
// [-1, 0] makes the grooves carve INWARD only (never bumping outward), so
// the ridges can't pinch off floating islands. Keep the groove depth just
// under the point where a closed loop would sever a cap (here ~1.8 on a
// 24-radius dome) to stay a single watertight piece.
const { sdf } = api;

const g = sdf.noise({ seed: 11, frequency: 0.3, octaves: 2, gain: 0.5, ridged: true });
const groove = (x, y, z) => -(g(x, y, z) * 0.5 + 0.5);   // inward-only grooves

const coral = sdf.roundedCylinder(24, 24, 10)
  .translate(0, 0, 14)
  .displace(1.8, groove)
  .label('coral');

return coral.build({ edgeLength: 0.62 });
