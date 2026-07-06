// frame_chest — structured rebuild from probe measurements (hip_shoulder module x2 + hips archetype).
// Plate z in [-2.5, 2.5]: lower body (spine socket block w/ arc r4.5 about (0,0), walls x=±4.5,
// column + notches + bar x=±8 y 7..10 w/ plan corner chamfers 0.5, slot 3x3.2 @ (0,6.5)) and
// neck ring (disc r4.5 about (0,20)). Balls r=3.000 exact @ (±6,14,0) (probe rms 0), top z=3.
// Struts: cyl r1.5 along Y @ (x=±6, z=0), chordal flat z=-1.3 (hips archetype, ray-verified).
// Arms: slabs z in [-1.5,1.5] between lines x+y=20 and x+y=22.5 (ray-verified z, trace-verified lines).
// Cavities: spine sphere r2.8501 @ (0,0,0) + neck sphere r2.900 @ (0,20,0), rim entry cones both
// faces each, mouth wedges slope 0.6682 through centers (spine opens -y, neck +y).
// Outer 45° leg-0.5 chamfers on both faces: walls, arcs (annulus cutters), mouth lines, corner
// lines, bar edges + plan corners, y=10, slot rim (hull frustums). NOT: notch, arms, struts.
const { Manifold, CrossSection, geom } = api;

const p = api.params({
  spineR: { type: 'number', default: 2.8501, min: 2.80, max: 2.90 },
  r0s:    { type: 'number', default: 2.372,  min: 2.30, max: 2.46 },
  r0n:    { type: 'number', default: 2.4709, min: 2.40, max: 2.55 },
  slope:  { type: 'number', default: 0.3678, min: 0.30, max: 0.45 },
  cham:   { type: 'number', default: 0.5,    min: 0.42, max: 0.58 },
});

const S = 0.6682;                 // mouth line slope about socket center
const A = 0.2279, B = 2.9803;     // corner chamfer line (hip_shoulder spec, y-mirrored)
const R = 4.5;                    // block/ring outer arc radius
const CH = p.cham;
const NY = 20;                    // neck socket center y

// corner-line endpoints (spine frame, x>0, mouth toward -y): on mouth line & on arc r=R
const xm = B / (S + A);                                         // = 3.3259
const ym = -S * xm;                                             // = -2.2223
const xa = (A * B + Math.sqrt(A * A * B * B - (1 + A * A) * (B * B - R * R))) / (1 + A * A);
const ya = A * xa - B;                                          // (3.9959, -2.0695)

// ---------- helpers ----------
function cylY(r, y0, y1, x, z, segs) {
  return Manifold.cylinder(y1 - y0, r, r, segs).rotate([-90, 0, 0]).translate([x, y0, z]);
}
// 45° chamfer wedge cutter for a straight edge on the bottom face z=-2.5; n = outward unit normal.
function chamferWedge(e1, e2, n, leg) {
  const prof = geom.fromPoints([[-leg, 0], [-leg, -0.4], [0.6, -0.4], [0.6, leg], [0, leg]]);
  const d = [n[1], -n[0]];
  const v = [e2[0] - e1[0], e2[1] - e1[1]];
  const L = Math.hypot(v[0], v[1]);
  const anchor = (v[0] * d[0] + v[1] * d[1] > 0) ? e1 : e2;
  const phi = Math.atan2(n[1], n[0]) * 180 / Math.PI;
  return prof.extrude(L).rotate([90, 0, 0]).rotate([0, 0, phi]).translate([anchor[0], anchor[1], -2.5]);
}
function fan(cx, cy, a0deg, a1deg, rad, steps) {
  const pts = [[cx, cy]];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0deg + ((a1deg - a0deg) * i) / steps) * Math.PI) / 180;
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  return geom.fromPoints(pts);
}
// annulus chamfer cutter about (cx,cy) for the bottom face: cuts outside the 45° cone r=R-CH+(z+2.5)
function arcAnnulus(cx, cy) {
  const ring = Manifold.cylinder(0.75, R + 1, R + 1, 96).translate([cx, cy, -2.75]);
  const cone45 = Manifold.cylinder(0.75, R - CH - 0.25, R + 0.25, 128).translate([cx, cy, -2.75]);
  return ring.subtract(cone45);
}

// ---------- 2D plan ----------
const spineDisc = CrossSection.circle(R, 128);
const wallsRect = geom.fromPoints([[-4.5, 0], [4.5, 0], [4.5, 7], [-4.5, 7]]);
const barOct = geom.fromPoints([[-7.5, 7], [7.5, 7], [8, 7.5], [8, 9.5], [7.5, 10], [-7.5, 10], [-8, 9.5], [-8, 7.5]]);
// spine mouth wedge (cut region y <= -S|x|), apex at center
const spineWedge2D = geom.fromPoints([[0, 0], [-8, -8 * S], [-8, -12], [8, -12], [8, -8 * S]]);
// spine corner-line halfplane cuts (below y = A x - B for x>0; mirrored) — CCW
const spineCornerCutR = geom.fromPoints([[2.8, -7], [6, -7], [6, A * 6 - B], [2.8, A * 2.8 - B]]);
// notch cut at y in [3,3.5], from wall to x=3.25 with r0.25 rounded end
const notchR = geom.fromPoints([[3.25, 3], [5, 3], [5, 3.5], [3.25, 3.5]]).add(CrossSection.circle(0.25, 32).translate([3.25, 3.25]));

let lower2D = spineDisc.add(wallsRect).add(barOct)
  .subtract(spineWedge2D)
  .subtract(spineCornerCutR).subtract(spineCornerCutR.mirror([1, 0]))
  .subtract(notchR).subtract(notchR.mirror([1, 0]));

const neckWedge2D = geom.fromPoints([[0, NY], [8, NY + 8 * S], [8, NY + 13], [-8, NY + 13], [-8, NY + 8 * S]]);
const neckCornerCutR = geom.fromPoints([[2.8, NY + B - A * 2.8], [6, NY + B - A * 6], [6, NY + 7], [2.8, NY + 7]]);
const ring2D = CrossSection.circle(R, 128).translate([0, NY])
  .subtract(neckWedge2D)
  .subtract(neckCornerCutR).subtract(neckCornerCutR.mirror([1, 0]));

const plate = lower2D.add(ring2D).extrude(5, 0, 0, [1, 1]).translate([0, 0, -2.5]);

// ---------- mid-height members ----------
const armR = geom.fromPoints([[1.8, 18.2], [6.2, 13.8], [8.7, 13.8], [3.9, 18.6]])
  .extrude(3, 0, 0, [1, 1]).translate([0, 0, -1.5]);
const arms = armR.add(armR.mirror([1, 0, 0]));

const flatBox = Manifold.cube([8, 8, 8]).translate([-4, -4, -1.3]); // keep z >= -1.3
const strutR = cylY(1.5, 9, 12.7, 6, 0, 96).intersect(flatBox.translate([6, 10.8, 0 + 0]));
const strutL = strutR.mirror([1, 0, 0]);

const ballR = Manifold.sphere(3, 128).translate([6, 14, 0]);
const ballL = ballR.mirror([1, 0, 0]);

// ---------- cavities ----------
const spineSphere = Manifold.sphere(p.spineR, 128);
const neckSphere = Manifold.sphere(2.900, 128).translate([0, NY, 0]);
function coneBot(cx, cy, r0) {
  return Manifold.cylinder(0.78, r0 + 0.1 * p.slope, r0 - 0.68 * p.slope, 96).translate([cx, cy, -2.6]);
}
function coneTop(cx, cy, r0) {
  return Manifold.cylinder(0.78, r0 - 0.68 * p.slope, r0 + 0.1 * p.slope, 96).translate([cx, cy, 1.82]);
}

// slot 3 x 3.2 @ (0, 6.5) with chamfered rims (hull frustums, faces pinned on planes)
const slotRect = geom.fromPoints([[-1.5, 4.9], [1.5, 4.9], [1.5, 8.1], [-1.5, 8.1]]);
const slotRect2 = geom.fromPoints([[-2.0, 4.4], [2.0, 4.4], [2.0, 8.6], [-2.0, 8.6]]);
const slotPrism = slotRect.extrude(5.2, 0, 0, [1, 1]).translate([0, 0, -2.6]);
const slotTopCh = slotRect.extrude(0.1, 0, 0, [1, 1]).translate([0, 0, 1.9])
  .add(slotRect2.extrude(0.1, 0, 0, [1, 1]).translate([0, 0, 2.5])).hull();
const slotBotCh = slotTopCh.mirror([0, 0, 1]);

// ---------- outer chamfer cutters (bottom set, then z-mirrored) ----------
const nm = 1 / Math.hypot(S, 1);
const dM = [1 * (1 / Math.hypot(1, S)), -S * (1 / Math.hypot(1, S))]; // spine mouth dir (x>0, y<0)
const cutters = [];
// walls x=±4.5 (span through notch region — notch is air there)
cutters.push(chamferWedge([4.5, -0.05], [4.5, 7.5], [1, 0], CH));
// bar underside y=7 (x 4.0..8.1, past concave corner + convex corner)
cutters.push(chamferWedge([4.0, 7], [8.1, 7], [0, -1], CH));
// bar side x=8
cutters.push(chamferWedge([8, 7.4], [8, 9.6], [1, 0], CH));
// bar plan-corner lines
const iv = Math.SQRT1_2;
cutters.push(chamferWedge([7.4, 6.9], [8.1, 7.6], [iv, -iv], CH));
cutters.push(chamferWedge([7.4, 10.1], [8.1, 9.4], [iv, iv], CH));
// spine mouth line (x>0): from s=2.0 to s=4.2 along dM; outward normal (-S,-1)/|.|
cutters.push(chamferWedge([2.0 * dM[0], 2.0 * dM[1]], [4.2 * dM[0], 4.2 * dM[1]], [-S * nm, -1 * nm], CH));
// spine corner line (x>0), extended ±0.1
cutters.push(chamferWedge([xm - 0.098, A * (xm - 0.098) - B], [xa + 0.098, A * (xa + 0.098) - B], [A / Math.hypot(1, A), -1 / Math.hypot(1, A)], CH));
// neck mouth line (x>0): dir (dM[0], +S*..) about (0,20)
cutters.push(chamferWedge([2.0 * dM[0], NY - 2.0 * dM[1]], [4.2 * dM[0], NY - 4.2 * dM[1]], [-S * nm, 1 * nm], CH));
// neck corner line (x>0)
cutters.push(chamferWedge([xm - 0.098, NY + B - A * (xm - 0.098)], [xa + 0.098, NY + B - A * (xa + 0.098)], [A / Math.hypot(1, A), 1 / Math.hypot(1, A)], CH));
// y=10 edge (single, symmetric)
const cutY10 = chamferWedge([-7.6, 10], [7.6, 10], [0, 1], CH);
// spine arc annulus: sectors from -26° to -154° (through -90°)
const spineArcCut = arcAnnulus(0, 0).intersect(fan(0, 0, -154, -26, 6.5, 12).extrude(1.2, 0, 0, [1, 1]).translate([0, 0, -2.9]));
// neck arc annulus: full annulus minus top wedge sector (26°..154°)
const neckArcCut = arcAnnulus(0, NY).subtract(fan(0, NY, 25, 155, 6.5, 12).extrude(1.4, 0, 0, [1, 1]).translate([0, 0, -3.0]));

let cutBottom = cutY10.add(spineArcCut).add(neckArcCut);
for (const c of cutters) cutBottom = cutBottom.add(c).add(c.mirror([1, 0, 0]));
const allCut = cutBottom.add(cutBottom.mirror([0, 0, 1]));

// ---------- assemble ----------
const body = plate.add(arms).add(strutR).add(strutL).add(ballR).add(ballL)
  .subtract(spineSphere)
  .subtract(neckSphere)
  .subtract(coneBot(0, 0, p.r0s)).subtract(coneTop(0, 0, p.r0s))
  .subtract(coneBot(0, NY, p.r0n)).subtract(coneTop(0, NY, p.r0n))
  .subtract(slotPrism).subtract(slotTopCh).subtract(slotBotCh)
  .subtract(allCut);

const clip = Manifold.cube([22, 30, 6.5]).translate([-11, -4, -2.5]);
return body.intersect(clip);
