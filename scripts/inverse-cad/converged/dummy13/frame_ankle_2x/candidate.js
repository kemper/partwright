// frame_ankle_2x — CAD reconstruction
// ring disk r4.5 + neck + lobe, keyhole prism, sphere socket + conical entry
// chamfers, 45deg 0.5x0.5 ring edge chamfers (stepped offsets).
// All numbers measured via probe.mjs (sections + sphere fit).
const { Manifold, CrossSection, geom } = api;

const SEG = 128;
const cx = 0.0008, cy = -0.0015;      // socket center (probe fit)
const sphR = 2.9046;                  // probe fit, 99.1% inliers
const ringR = 4.5;                    // traced outer arc radius
const zTop = 5;
const CH = 0.5;                       // ring edge chamfer (measured 45deg, w=h=0.5)

// ---- ring 2D profile ----
let ring = CrossSection.circle(ringR, SEG);
// bottom cut y >= -4
ring = ring.subtract(geom.fromPoints([[-8, -4], [8, -4], [8, -10], [-8, -10]]));
// left tip cut y <= 2.96
ring = ring.subtract(geom.fromPoints([[-8, 2.96], [8, 2.96], [8, 10], [-8, 10]]));
// right tip chord through [4.3733,1.0605]-[3.7588,1.3681]
ring = ring.subtract(geom.fromPoints([[6.22, 0.14], [1.92, 2.29], [6.40, 11.23], [10.69, 9.08]]));
// mouth wedge: apex at socket center, 20.03deg .. 132.5deg, R=12
const wedgePts = [[cx, cy]];
for (const a of [20.03, 48, 76, 104, 132.5]) {
  const t = a * Math.PI / 180;
  wedgePts.push([cx + 12 * Math.cos(t), cy + 12 * Math.sin(t)]);
}
ring = ring.subtract(geom.fromPoints(wedgePts));

// ---- chamfered ring solid: exact 45deg chamfers ----
// circle edge: intersect with cone-cyl-cone envelope
let ringSolid = ring.extrude(zTop, 0, 0, [1, 1]);
const circEnv = Manifold.cylinder(CH, ringR - CH, ringR, SEG)
  .add(Manifold.cylinder(zTop - 2 * CH, ringR, ringR, SEG).translate([0, 0, CH]))
  .add(Manifold.cylinder(CH, ringR, ringR - CH, SEG).translate([0, 0, zTop - CH]));
ringSolid = ringSolid.intersect(circEnv);

// straight edges: subtract 45deg wedge prisms (bottom + top per edge).
// Prism runs from E1 along d=(ny,-nx) for length L; halfspace n.p > c-CH+z
// (bottom) / n.p > c-CH+(zTop-z) (top), n = outward normal, material n.p <= c.
function edgeWedges(nx, ny, c, e1x, e1y, L) {
  const bot2d = geom.fromPoints([[c - 2.5, -2], [c, CH], [c + 12, CH], [c + 12, -2]]);
  const top2d = geom.fromPoints([[c + 12, zTop + 2], [c - 2.5, zTop + 2], [c, zTop - CH], [c + 12, zTop - CH]]);
  const theta = Math.atan2(ny, nx) * 180 / Math.PI;
  const mk = (cs) => cs.extrude(L, 0, 0, [1, 1])
    .rotate([90, 0, 0])       // (x,y,ze) -> (x,-ze,y): prism along -y, x=s, z=height
    .rotate([0, 0, theta])    // +x -> n, -y -> d=(ny,-nx)
    .translate([e1x, e1y, 0]);
  return mk(bot2d).add(mk(top2d));
}
// y=-4 edge (exposed only for 1.2<=|x|<=2.06; runout at |x|=1.2)
ringSolid = ringSolid.subtract(edgeWedges(0, -1, 4, 2.6, -4, 1.4));
ringSolid = ringSolid.subtract(edgeWedges(0, -1, 4, -1.2, -4, 1.4));
// y=2.96 left tip cut
ringSolid = ringSolid.subtract(edgeWedges(0, 1, 2.96, -3.9, 2.96, 1.6));
// right tip chord (n from line [4.3733,1.0605]-[3.7588,1.3681])
ringSolid = ringSolid.subtract(edgeWedges(0.4476, 0.8942, 2.9056, 3.133, 1.681, 2.1));
// mouth wedge faces L1 (132.5deg) and L2 (20.03deg), apex at socket center
const u1x = Math.cos(132.5 * Math.PI / 180), u1y = Math.sin(132.5 * Math.PI / 180);
ringSolid = ringSolid.subtract(edgeWedges(0.7373, 0.6756, 0, cx + 4.6 * u1x, cy + 4.6 * u1y, 4.2));
const u2x = Math.cos(20.03 * Math.PI / 180), u2y = Math.sin(20.03 * Math.PI / 180);
ringSolid = ringSolid.subtract(edgeWedges(-0.3425, 0.9396, 0, cx + 0.4 * u2x, cy + 0.4 * u2y, 4.4));

// ---- neck + lobe (unchamfered, full height) ----
const lobe = CrossSection.circle(1.5, 96).translate([0, -5.5]);
const neck = geom.fromPoints([[-1.2, -4.65], [1.2, -4.65], [1.2, -3.9], [-1.2, -3.9]]);
const restSolid = lobe.add(neck).extrude(zTop, 0, 0, [1, 1]);

// ---- keyhole through-hole (traced at z=2.0; prismatic, verified at z=0.05) ----
const hole = geom.fromPoints([[0.3708, -4.7346], [0.36, -4.0], [-0.36, -4.0], [-0.3843, -4.8007], [-0.6573, -5.4407], [-0.5261, -5.8985], [-0.1211, -6.1488], [0.1211, -6.1488], [0.3972, -6.0271], [0.5606, -5.8483], [0.657, -5.5623], [0.6353, -5.3211], [0.4973, -5.0595]]);
const holePrism = hole.extrude(6, 0, 0, [1, 1]).translate([0, 0, -0.5]);

// ---- socket: sphere + conical entry chamfers (measured r(z)=2.4649-0.3708z) ----
const socket = Manifold.sphere(sphR, 128).translate([cx, cy, 2.5]);
const coneSlope = 0.3708, coneR0 = 2.4649;
const coneBot = Manifold.cylinder(1.2, coneR0 + 0.2 * coneSlope, coneR0 - 1.0 * coneSlope, 96)
  .translate([cx, cy, -0.2]);
const coneTop = Manifold.cylinder(1.2, coneR0 - 1.0 * coneSlope, coneR0 + 0.2 * coneSlope, 96)
  .translate([cx, cy, zTop - 1.0]);

return ringSolid.add(restSolid)
  .subtract(holePrism)
  .subtract(socket)
  .subtract(coneBot)
  .subtract(coneTop);
