// frame_hip_and_shoulder_4x — structured rebuild from probe measurements.
// Structure: main block (outline = walls x=±4.5 + arc r=4.5 about socket center
// + straight corner chamfer lines + mouth lines through center), tab with leg-1.0
// 45° x-edge chamfers, Ø3 rod along Y, rear r=3 cylinder along Y clipped at z=0.
// Cavity: sphere r=2.9075 @ (0,0,2.5) + 20° rim entry cones at both faces +
// full-height mouth wedge (y >= 0.6682|x|). Outer 45° leg-0.5 chamfers (top+bottom)
// on: x walls, r=4.5 arc, mouth lines ONLY (measured: y=-2.8 / corner-cut / y=-4 /
// tab end / chamfer-line edges are NOT chamfered).
const { Manifold, CrossSection, geom } = api;

const p = api.params({
  socketR:  { type: 'number', default: 2.9075, min: 2.85, max: 2.97 },
  rimR0:    { type: 'number', default: 2.4709, min: 2.40, max: 2.55 },
  rimSlope: { type: 'number', default: 0.3678, min: 0.30, max: 0.45 },
  mouthS:   { type: 'number', default: 0.6682, min: 0.65, max: 0.69 },
  outerR:   { type: 'number', default: 4.5,    min: 4.46, max: 4.54 },
  rearR:    { type: 'number', default: 2.9995, min: 2.95, max: 3.05 },
  cham:     { type: 'number', default: 0.5,    min: 0.40, max: 0.60 },
});

const S = p.mouthS;              // mouth line slope: y = S*x (through socket center)
const R = p.outerR;              // big outline arc radius about socket center
const CH = p.cham;               // outer chamfer leg
const H = 5.0;                   // main block height (ray-measured top z=5.0)
// corner chamfer line (probed): y = A*x + B
const A = -0.2279, B = 2.9803;
// chamfer-line endpoints: on mouth line and on arc r=R
const xm = B / (S - A);                                   // mouth end
const ym = S * xm;
const xa = (-A * B + Math.sqrt(A * A * B * B - (1 + A * A) * (B * B - R * R))) / (1 + A * A);
const ya = A * xa + B;

// ---------- helpers ----------
function cylY(r, y0, y1, zc, segs) {
  return Manifold.cylinder(y1 - y0, r, r, segs).rotate([-90, 0, 0]).translate([0, y0, zc]);
}
// 45° chamfer wedge cutter for a straight bottom edge (z=0): outward normal n (unit).
function chamferWedge(e1, e2, n, leg) {
  const prof = geom.fromPoints([[-leg, 0], [-leg, -0.4], [0.6, -0.4], [0.6, leg], [0, leg]]);
  const d = [n[1], -n[0]];
  const v = [e2[0] - e1[0], e2[1] - e1[1]];
  const L = Math.hypot(v[0], v[1]);
  const anchor = (v[0] * d[0] + v[1] * d[1] > 0) ? e1 : e2;
  const phi = Math.atan2(n[1], n[0]) * 180 / Math.PI;
  return prof.extrude(L).rotate([90, 0, 0]).rotate([0, 0, phi]).translate([anchor[0], anchor[1], 0]);
}
function mirrorZmid(m) { return m.translate([0, 0, -H / 2]).mirror([0, 0, 1]).translate([0, 0, H / 2]); }

// ---------- main block outline ----------
const thArcEnd = Math.atan2(ya, xa); // arc runs from angle 0 to thArcEnd
const pts = [];
pts.push([-2.5, -4], [2.5, -4], [3.7, -2.8], [4.5, -2.8], [R, 0]);
const nArc = 14;
for (let i = 1; i <= nArc; i++) {
  const t = (thArcEnd * i) / nArc;
  pts.push([R * Math.cos(t), R * Math.sin(t)]);
}
pts.push([xm, ym], [-xm, ym], [-xa, ya]);
for (let i = nArc - 1; i >= 1; i--) {
  const t = (thArcEnd * i) / nArc;
  pts.push([-R * Math.cos(t), R * Math.sin(t)]);
}
pts.push([-R, 0], [-4.5, -2.8], [-3.7, -2.8]);
const base = geom.fromPoints(pts).extrude(H, 0, 0, [1, 1]);

// ---------- tab (y in [-5,-3.7], leg-1.0 45° chamfers on x edges) ----------
const tabProf = geom.fromPoints([[-1.5, 0], [1.5, 0], [2.5, 1], [2.5, 4], [1.5, 5], [-1.5, 5], [-2.5, 4], [-2.5, 1]]);
const tab = tabProf.extrude(1.3, 0, 0, [1, 1]).rotate([90, 0, 0]).translate([0, -3.7, 0]);

// ---------- rod + rear cylinder ----------
const rod = cylY(1.5, -7.65, -4.5, 2.5, 64);
const rearClip = Manifold.cube([12, 3.5, 8]).translate([-6, -10.1, 0]);
const rear = cylY(p.rearR, -9.9, -7.6, 2.5, 128).intersect(rearClip);

// ---------- cavity ----------
const socket = Manifold.sphere(p.socketR, 128).translate([0, 0.002, 2.5]);
const coneBot = Manifold.cylinder(0.78, p.rimR0 + 0.1 * p.rimSlope, p.rimR0 - 0.68 * p.rimSlope, 96).translate([0, 0.002, -0.1]);
const coneTop = mirrorZmid(coneBot);
const wedge2D = geom.fromPoints([[0, 0], [8, 8 * S], [8, 12], [-8, 12], [-8, 8 * S]]);
const mouthWedge = wedge2D.extrude(7, 0, 0, [1, 1]).translate([0, 0, -1]);

// ---------- outer 45° chamfer cutters (bottom set, then z-mirrored) ----------
const cutters = [];
// x walls (extent exactly y in [-2.8, 0.1])
cutters.push(chamferWedge([4.5, 0.1], [4.5, -2.8], [1, 0], CH));
cutters.push(chamferWedge([-4.5, 0.1], [-4.5, -2.8], [-1, 0], CH));
// mouth lines (from inside cavity rim out past the arc)
const nm = 1 / Math.hypot(S, 1);
const nMouth = [-S * nm, 1 * nm];
const dMouth = [nMouth[1], -nMouth[0]];
cutters.push(chamferWedge([2.1 * dMouth[0], 2.1 * dMouth[1]], [4.6 * dMouth[0], 4.6 * dMouth[1]], nMouth, CH));
cutters.push(chamferWedge([-2.1 * dMouth[0], 2.1 * dMouth[1]], [-4.6 * dMouth[0], 4.6 * dMouth[1]], [S * nm, 1 * nm], CH));
// arc annulus cutter: outside 45° cone about origin, limited to arc sectors
const ring = Manifold.cylinder(0.75, R + 1, R + 1, 64).translate([0, 0, -0.25]);
const cone45 = Manifold.cylinder(0.75, R - CH - 0.25, R + 0.25, 128).translate([0, 0, -0.25]);
const annulus = ring.subtract(cone45);
const secAngles = [-1.5, 6, 13, 20, 27.6].map((a) => (a * Math.PI) / 180);
const secPts = [[0, 0]].concat(secAngles.map((t) => [6 * Math.cos(t), 6 * Math.sin(t)]));
const sector = geom.fromPoints(secPts).extrude(1.2, 0, 0, [1, 1]).translate([0, 0, -0.3]);
const sectors = sector.add(sector.mirror([1, 0, 0]));
cutters.push(annulus.intersect(sectors));

let cutBottom = cutters[0];
for (let i = 1; i < cutters.length; i++) cutBottom = cutBottom.add(cutters[i]);
const allCut = cutBottom.add(mirrorZmid(cutBottom));

// ---------- assemble ----------
return base.add(tab).add(rod).add(rear)
  .subtract(mouthWedge)
  .subtract(socket)
  .subtract(coneBot)
  .subtract(coneTop)
  .subtract(allCut);
