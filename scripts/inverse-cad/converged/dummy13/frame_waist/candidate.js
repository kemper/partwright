// frame_waist — structured rebuild (all numbers probed)
// body: disc r=4.5 about socket center (origin) + shoulder block |x|<=2.5 to y=7
//   (plan corner chamfers 0.5), uniform 0.5 x 45deg chamfer top+bottom on the
//   whole outline (near-face outline matches r=4.05 / x=2.05 / y=6.55 exactly).
// side tabs: Y-prisms, profile = circle r=0.5986 @ (x=+-3.0529, z=0) plus its
//   45deg tangent lines x+|z|=3.899, ending flat at y=3.40 (ray-scanned).
// mouth wedge: {y <= -0.66818|x|} through the socket center (verified at 3 z's,
//   par. 5.12), with corner-chamfer lines y = +-0.228x - 2.9806 to the arc;
//   both cuts dilated 0.5 @ 45deg at the faces (hull, faces pinned).
// socket: sphere r=2.852 @ origin + lead-in cones r(z)=1.4888+0.3515|z|
//   opening on BOTH faces (hourglass, par. 5.19d), subtracted last.
// neck: D-cyl r=1.5 along Y at z=0, chordal flat at z=-1.30, y 7->ball.
// ball: r=3.000 @ (0,11,0), clipped z>=-2.5 (print-flat).
const { Manifold, CrossSection, geom } = api;

const p = api.params({
  socketR:   { type: 'number', default: 2.852,  min: 2.78,  max: 2.95 },
  coneR0:    { type: 'number', default: 1.4888, min: 1.35,  max: 1.65 },
  coneSlope: { type: 'number', default: 0.3515, min: 0.30,  max: 0.42 },
  tabA:      { type: 'number', default: 3.0529, min: 2.95,  max: 3.15 },
  tabR:      { type: 'number', default: 0.5986, min: 0.50,  max: 0.70 },
  ballR:     { type: 'number', default: 3.0,    min: 2.94,  max: 3.06 },
  neckFlat:  { type: 'number', default: 1.30,   min: 1.15,  max: 1.45 },
});

const N = 128;
const leg = 0.5;          // face chamfer leg
const H = 2.5;            // body half-height
const R = 4.5;            // disc radius
const wS = 0.66818;       // wedge line slope (tan 33.75deg), through origin
const chM = 0.228;        // corner-chamfer line slope
const chC = 2.9806;       // corner-chamfer line intercept (y = chM*x - chC)

// ---- disc with top+bottom 45deg chamfer (cylinder + frustums) ----
const bodyArc = Manifold.cylinder(2 * (H - leg), R, R, N).translate([0, 0, -(H - leg)])
  .add(Manifold.cylinder(leg, R, R - leg, N).translate([0, 0, H - leg]))
  .add(Manifold.cylinder(leg, R - leg, R, N).translate([0, 0, -H]));

// ---- shoulder block, chamfered via hull (outer faces pinned at +-2 / +-2.5) ----
const Bpoly = geom.fromPoints([[2.5, 2.8], [2.5, 6.5], [2.0, 7.0], [-2.0, 7.0], [-2.5, 6.5], [-2.5, 2.8]]);
const Bero = Bpoly.offset(-leg, 'Miter');
const bodyB = Bpoly.extrude(2 * (H - leg), 0, 0, [1, 1]).translate([0, 0, -(H - leg)])
  .add(Bero.extrude(2 * H, 0, 0, [1, 1]).translate([0, 0, -H]))
  .hull();

// ---- side tabs: Y-prism, profile in (x,z) = circle + 45deg tangent quad ----
const tz = p.tabR / Math.SQRT2;            // tangent point z
const tx = p.tabA + tz;                    // tangent point x
const c2 = p.tabA + p.tabR * Math.SQRT2;   // tangent line x + |z| = c2
const zi = c2 - 2.55;                      // quad inner-edge half-height
const tabQuad = geom.fromPoints([[tx, -tz], [tx, tz], [2.55, zi], [2.55, -zi]]);
const tabProf = CrossSection.circle(p.tabR, 64).translate([p.tabA, 0]).add(tabQuad);
const tab = tabProf.extrude(1.1, 0, 0, [1, 1])
  .rotate([-90, 0, 0])                     // (X, Ycs, Zh) -> (X, Zh, -Ycs)
  .translate([0, 2.3, 0]);                 // y in [2.3, 3.40]
const tabL = tab.mirror([1, 0, 0]);

// ---- neck: D-cylinder r=1.5 along Y, flat at z = -neckFlat ----
// author flat at Ycs=+neckFlat; rotate(-90 about X) maps z = -Ycs
const neckProf = CrossSection.circle(1.5, 96)
  .intersect(CrossSection.square([4, 4], true).translate([0, p.neckFlat - 2]));
const neck = neckProf.extrude(3.0, 0, 0, [1, 1])
  .rotate([-90, 0, 0])
  .translate([0, 6.5, 0]);                 // y in [6.5, 9.5]

// ---- ball ----
const ball = Manifold.sphere(p.ballR, N).translate([0, 11, 0]);

let solid = bodyArc.add(bodyB).add(tab).add(tabL).add(neck).add(ball);

// ---- cuts: mouth wedge + corner-chamfer halfplanes, each with 45deg
//      face-edge dilation (prism z in [-2,2] + hulled flares, faces pinned) ----
function chamferedCut(poly2d) {
  const dil = poly2d.offset(leg, 'Round', 32);
  const mid = poly2d.extrude(2 * (H - leg), 0, 0, [1, 1]).translate([0, 0, -(H - leg)]);
  const top = poly2d.extrude(0.02, 0, 0, [1, 1]).translate([0, 0, H - leg - 0.02])
    .add(dil.extrude(0.5, 0, 0, [1, 1]).translate([0, 0, H]))
    .hull();
  const bot = poly2d.extrude(0.02, 0, 0, [1, 1]).translate([0, 0, -(H - leg)])
    .add(dil.extrude(0.5, 0, 0, [1, 1]).translate([0, 0, -H - 0.5]))
    .hull();
  return mid.add(top).add(bot);
}
const wedge2d = geom.fromPoints([[0, 0], [-8, -8 * wS], [-8, -9], [8, -9], [8, -8 * wS]]);
const hpR = geom.fromPoints([[8, chM * 8 - chC], [-8, -chM * 8 - chC], [-8, -9], [8, -9]]);
const hpL = geom.fromPoints([[8, -chM * 8 - chC], [-8, chM * 8 - chC], [-8, -9], [8, -9]]);
solid = solid.subtract(chamferedCut(wedge2d))
  .subtract(chamferedCut(hpR))
  .subtract(chamferedCut(hpL));

// ---- socket cavity: sphere + both-face lead-in cones (subtract LAST) ----
const rAt = (z) => p.coneR0 + p.coneSlope * z;
const coneTop = Manifold.cylinder(1.0, rAt(1.7), rAt(2.7), 96).translate([0, 0, 1.7]);
const coneBot = Manifold.cylinder(1.0, rAt(2.7), rAt(1.7), 96).translate([0, 0, -2.7]);
solid = solid.subtract(Manifold.sphere(p.socketR, N))
  .subtract(coneTop)
  .subtract(coneBot);

// ---- print-flat clip: z >= -2.5 (trims the ball underside) ----
solid = solid.subtract(Manifold.cube([22, 26, 3], true).translate([0, 5.9, -4.0]));

return solid;
