// frame_head — structured rebuild from probe measurements (sibling of
// frame_hip_and_shoulder: same joint spec, mirrored mouth, keyhole stem).
// Structure:
//  - ring disc r=4.5 about socket center (0,0), z 0..5
//  - front corner-cut flats: line offset 2.9062 along n=(±0.2224,-0.9749), NOT chamfered
//  - mouth wedge: y <= -0.6682|x| (walls through socket center), full depth
//  - stem plate z 0..3: walls x=±1.2 (y 4.34..6.1) + traced bulb to y≈8.99
//  - keyhole slot through stem (z 0..3): straight part x ±0.36 from y 4.4856, traced bulb
//  - cavity: sphere r=2.8979 @ (0,-0.013,2.5) + rim entry cones r(d)=2.469-0.368d both faces
//  - 45° leg-0.5 chamfers top+bottom on: outer arc (revolve envelope), mouth lines;
//    slot front edge chamfered at bottom only (measured 4.486->4.034 @z=0.05)
const { Manifold, CrossSection, geom } = api;

const p = api.params({
  socketR:  { type: 'number', default: 2.8979, min: 2.85, max: 2.97 },
  socketY:  { type: 'number', default: -0.013, min: -0.06, max: 0.04 },
  rimR0:    { type: 'number', default: 2.469,  min: 2.40, max: 2.55 },
  rimSlope: { type: 'number', default: 0.368,  min: 0.30, max: 0.45 },
  mouthS:   { type: 'number', default: 0.6682, min: 0.65, max: 0.69 },
  outerR:   { type: 'number', default: 4.5,    min: 4.46, max: 4.54 },
  flatOff:  { type: 'number', default: 2.9062, min: 2.86, max: 2.95 },
  cham:     { type: 'number', default: 0.5,    min: 0.40, max: 0.60 },
});

const S = p.mouthS;      // mouth wall slope (walls: y = -S|x|, through socket center)
const R = p.outerR;
const CH = p.cham;
const H = 5.0;

// ---------- helpers (from frame_hip_and_shoulder) ----------
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
function rect2D(n, s0, s1, t0, t1) { // rectangle in (n, d) frame: s along n, t along d=(n.y,-n.x)
  const d = [n[1], -n[0]];
  const P = (s, t) => [n[0] * s + d[0] * t, n[1] * s + d[1] * t];
  return geom.fromPoints([P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)]);
}

// ---------- ring disc + corner-cut flats ----------
const nCirc = 160;
const circPts = [];
for (let i = 0; i < nCirc; i++) {
  const t = (2 * Math.PI * i) / nCirc;
  circPts.push([R * Math.cos(t), R * Math.sin(t)]);
}
let base2D = geom.fromPoints(circPts);
const nFlatR = [0.2224, -0.9749];
const nFlatL = [-0.2224, -0.9749];
base2D = base2D.subtract(rect2D(nFlatR, p.flatOff, p.flatOff + 3, -4, 4));
base2D = base2D.subtract(rect2D(nFlatL, p.flatOff, p.flatOff + 3, -4, 4));

// outer arc 45° chamfer via exact revolve envelope about the socket axis
const envProf = geom.fromPoints([
  [0.001, -0.01], [R - CH, -0.01], [R + 0.001, CH], [R + 0.001, H - CH], [R - CH, H + 0.01], [0.001, H + 0.01],
]);
const envelope = envProf.revolve(160);
let body = base2D.extrude(H, 0, 0, [1, 1]).intersect(envelope);

// ---------- stem plate (z 0..3) with keyhole bulb (traced, symmetrized) ----------
const stemLeft = [
  [-1.2, 6.1], [-1.3831, 6.4195], [-1.494, 6.8656], [-1.4932, 7.1422], [-1.4136, 7.5017],
  [-1.1953, 7.9063], [-1.1463, 8.1551], [-1.046, 8.388], [-0.8991, 8.5947], [-0.712, 8.7659],
  [-0.4931, 8.894], [-0.1688, 8.9881],
];
// CCW: up the right side (mirror of left, same order), across the top, down the left side
const stemPts = [[1.2, 3.8]];
for (const q of stemLeft) stemPts.push([-q[0], q[1]]);
for (let i = stemLeft.length - 1; i >= 0; i--) stemPts.push(stemLeft[i]);
stemPts.push([-1.2, 3.8]);
const stem = geom.fromPoints(stemPts).extrude(3, 0, 0, [1, 1]);
body = body.add(stem);

// ---------- mouth wedge (walls through socket center, chamfered at faces) ----------
const wedge2D = geom.fromPoints([[0, 0], [-9, -9 * S], [-9, -14], [9, -14], [9, -9 * S]]);
body = body.subtract(wedge2D.extrude(7, 0, 0, [1, 1]).translate([0, 0, -1]));
// mouth wall chamfer cutters (bottom pair, then z-mirrored)
const nm = 1 / Math.hypot(S, 1);
const nMouthR = [S * nm, -1 * nm];   // outward normal of right wall (solid above y=-Sx)... see note
// wall on +x side: line y = -S x, solid at y > -S x  => outward normal points down-right:
// n = (-S, -1)/|.| has dot<0 with solid side; outward from solid into void: (S? ) compute:
// solid side test point (3,0): y + Sx = 2 > 0 -> solid where y + S|x| > 0 near wall.
// gradient of (y + Sx) is (S,1); void side is negative -> outward normal = -(S,1)/|.|
const nWR = [-S * nm, -1 * nm];      // outward normal, right wall
const nWL = [S * nm, -1 * nm];       // outward normal, left wall (y + S*(-x): grad (-S,1))
const dWR = [nWR[1], -nWR[0]];
{
  // right wall edge runs along direction dR = (cos(-33.75deg), sin(-33.75deg))
  const dR = [1 / Math.hypot(1, S), -S / Math.hypot(1, S)];
  const e1 = [2.0 * dR[0], 2.0 * dR[1]];
  const e2 = [4.7 * dR[0], 4.7 * dR[1]];
  body = body.subtract(chamferWedge(e1, e2, nWR, CH));
  body = body.subtract(mirrorZmid(chamferWedge(e1, e2, nWR, CH)));
  const e1L = [-e1[0], e1[1]];
  const e2L = [-e2[0], e2[1]];
  body = body.subtract(chamferWedge(e2L, e1L, nWL, CH));
  body = body.subtract(mirrorZmid(chamferWedge(e2L, e1L, nWL, CH)));
}

// ---------- keyhole slot (through stem, z 0..3) ----------
const slotLeft = [
  [-0.1973, 8.1011], [-0.3201, 7.9647], [-0.4003, 7.6351], [-0.5902, 7.2954], [-0.657, 7.0625],
  [-0.6353, 6.8212], [-0.427, 6.4288], [-0.3627, 6.1675], [-0.36, 6.1],
];
// CCW: up the right side (mirror of left, reversed), top point, down the left side
const slotPts = [[0.36, 4.4856]];
for (let i = slotLeft.length - 1; i >= 0; i--) slotPts.push([-slotLeft[i][0], slotLeft[i][1]]);
slotPts.push([0, 8.153]);
for (const q of slotLeft) slotPts.push(q);
slotPts.push([-0.36, 4.4856]);
const slot = geom.fromPoints(slotPts).extrude(3.5, 0, 0, [1, 1]).translate([0, 0, -0.25]);
// slot extends z -0.25..3.25: above z=3 the stem is gone; the only overshoot risk is the
// ring-arc sliver at y 4.486..4.5, |x|<0.36, z 3..5 -> must NOT be cut. Clip slot to z<=3.
const slotClipped = slot.intersect(Manifold.cube([4, 6, 3.5], true).translate([0, 6.3, 1.5]));
body = body.subtract(slotClipped);
// slot front edge bottom chamfer (measured: y 4.486 -> 4.034 at z=0.05)
body = body.subtract(chamferWedge([-0.36, 4.4856], [0.36, 4.4856], [0, 1], CH));

// ---------- cavity: socket sphere + rim entry cones (subtract LAST) ----------
const socket = Manifold.sphere(p.socketR, 128).translate([0, p.socketY, 2.5]);
const coneBot = Manifold.cylinder(1.1, p.rimR0 + 0.1 * p.rimSlope, p.rimR0 - 1.0 * p.rimSlope, 96)
  .translate([0, p.socketY, -0.1]);
const coneTop = mirrorZmid(coneBot);
body = body.subtract(socket).subtract(coneBot).subtract(coneTop);

return body;
