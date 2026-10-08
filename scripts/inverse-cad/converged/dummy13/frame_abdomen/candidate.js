// frame_abdomen — probe-driven primitive composition
// All numbers measured (probe fit / ray / section):
//  - disc: z-cylinder r=4.500 about origin, z ±2.5, 45° leg-0.5 chamfers |z|>2
//  - mouth wedge: planes y = -0.6682|x| through socket center, chamfered leg 0.5 near z faces
//  - corner chamfer lines: y = 0.2279x - 2.9803 (mirror), unchamfered (hip_shoulder spec mirrored)
//  - socket sphere r=2.8488 @ origin; entry cones r(z)=2.3677-0.3525*(2.5-|z|) both faces
//  - bulge: ellipse prism (3.2, 2.5) y 2.5..4.8, 45° chamfer to (3.0,2.3) at y=5.0
//  - body: Y-cylinder r=3.000 to y=8.5, 45° leg-0.5 chamfer to r=2.5 at end face y=9.0
//  - neck: D-section r=1.500 flat at z=-1.3, y 8.5..11.2
//  - ball: sphere r=3.000 @ (0,13,0), clipped z ±2.5
const { Manifold, CrossSection, geom } = api;

const SEG = 128;

// ---- disc (r4.5 about origin, chamfered arc edges)
const discCore = Manifold.cylinder(4.02, 4.5, 4.5, SEG, true); // z -2.01..2.01
const discTop = Manifold.cylinder(0.5, 4.5, 4.0, SEG).translate([0, 0, 2.0]);
const disc = discCore.add(discTop).add(discTop.mirror([0, 0, 1]));

// helper: extrude a cross-section along +Y from y0 to y1 (optional scaleTop)
function alongY(cs, y0, y1, scaleTop) {
  return cs.extrude(y1 - y0, 0, 0, scaleTop || [1, 1])
    .rotate([-90, 0, 0])
    .translate([0, y0, 0]);
}

// ---- bulge: ellipse (3.2, 2.5)
const ell = CrossSection.circle(1, SEG).scale([3.2, 2.5]);
const bulge = alongY(ell, 2.5, 4.81)
  .add(alongY(ell, 4.8, 5.0, [3.0 / 3.2, 2.3 / 2.5]));

// ---- body: Y-cylinder r=3 with end chamfer
const c3 = CrossSection.circle(3.0, SEG);
const body = alongY(c3, 3.0, 8.51)
  .add(alongY(c3, 8.5, 9.0, [2.5 / 3.0, 2.5 / 3.0]));

// ---- neck: D-section r=1.5, flat at world z=-1.3 (cs Y <= 1.3 since world z = -csY)
const neckCS = CrossSection.circle(1.5, 96)
  .intersect(CrossSection.square([4, 2.8]).translate([-2, -1.5]));
const neck = alongY(neckCS, 8.5, 11.2);

// ---- ball r=3 @ (0,13,0), clipped z ±2.5
const ball = Manifold.sphere(3.0, SEG)
  .intersect(Manifold.cube([8, 8, 5], true))
  .translate([0, 13, 0]);

// global z-clip: everything lives in |z| <= 2.5 (body r3 and ball r3 poke past)
let solid = disc.add(bulge).add(body).add(neck).add(ball)
  .intersect(Manifold.cube([22, 26, 5], true).translate([0, 6.9, 0]));

// ---- mouth wedge cut with leg-0.5 45° chamfers near z faces (§5.11 wedge prism)
// profile in (s, z): cut where s <= f(z); f=0 for |z|<=2, |z|-2 for 2..2.5, 0.5 beyond
const mouthProf = geom.fromPoints([
  [-8, -3], [0.5, -3], [0.5, -2.5], [0, -2], [0, 2], [0.5, 2.5], [0.5, 3], [-8, 3],
]);
function mouthCut(nx, ny) {
  const th = Math.atan2(ny, nx) * 180 / Math.PI;
  return mouthProf.extrude(14, 0, 0, [1, 1])
    .translate([0, 0, -7])
    .rotate([90, 0, 0])
    .rotate([0, 0, th]);
}
// planes through origin: y + 0.6682x = 0 (x>0 side), y - 0.6682x = 0 (x<0 side)
// wedge region = INTERSECTION of the two half-spaces (y <= -0.6682|x|)
const nlen = Math.hypot(0.6682, 1);
const wedge = mouthCut(0.6682 / nlen, 1 / nlen)
  .intersect(mouthCut(-0.6682 / nlen, 1 / nlen));
solid = solid.subtract(wedge);

// ---- corner chamfer line cuts: remove y <= 0.2279x - 2.9803 (and mirror)
const cornerPoly = geom.fromPoints([
  [2, -5], [6, -5], [6, 0.2279 * 6 - 2.9803], [2, 0.2279 * 2 - 2.9803],
]);
const cornerCut = cornerPoly.extrude(6, 0, 0, [1, 1]).translate([0, 0, -3]);
solid = solid.subtract(cornerCut).subtract(cornerCut.mirror([1, 0, 0]));

// ---- socket sphere + entry cones (subtract from assembled body)
solid = solid.subtract(Manifold.sphere(2.8488, SEG));
// cone: r = 2.3677 - 0.3525*(2.5-z); extended z 1.7..3.0
const coneCut = Manifold.cylinder(1.3, 2.3677 - 0.3525 * 0.8, 2.3677 + 0.3525 * 0.5, SEG)
  .translate([0, 0, 1.7]);
solid = solid.subtract(coneCut).subtract(coneCut.mirror([0, 0, 1]));

return solid;
