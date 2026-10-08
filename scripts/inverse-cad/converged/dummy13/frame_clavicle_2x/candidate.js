// frame_clavicle_2x — probe-driven primitive composition (Dummy 13 socket grammar, §5.19i)
// Structure (all numbers probed, none guessed):
//  - socket body: OUTER SPHERE r=4.5 @ origin (rays r=4.4998), clipped z∈[-2.5,2.5]
//  - ball r=3.000 exact @ (0,7,0) (fit rms 0), plate-clipped z>=-2.5
//  - neck strut: cylinder r=1.5 along Y (top/side rays both 1.5000 at y=4.4)
//  - cavity: sphere r=2.900 @ origin (fit rms 0, inliers 1.0) + kit lead-in
//    cones both faces: r(z) = 2.4689 - 0.3678*(2.5-|z|) (ray-cast r(z) profile)
//  - mouth wedge: vertical planes y = ±0.6682x through the socket center (§5.12)
//  - mouth planes carry 45° leg-0.5 face chamfers starting |z|=2.0 (verified
//    (y-0.6682x)/1.2028 == |z|-2.0 at z=2.4)
//  - corner cut: kit corner-chamfer line y=±(0.2168x-2.935) at z=0, modulated
//    in z as a conoid: y < CC - s(z)*(CA - CB*|x|), s=sqrt(1-(z/CZ)^2)
//    (554-pt ray sample fit rms 0.0042, max 0.014) — built as hulled z-bands
const { Manifold, CrossSection, geom } = api;

const outerR = 4.5;
const sockR = 2.900;
const ballR = 3.000;
const strutR = 1.5;
const mouthS = 0.6682; // |slope| of mouth wedge walls
const coneRf = 2.4689; // lead-in cone radius at face plane
const coneM = 0.3678;  // lead-in cone slope (dr/dz)
const chamZ0 = 2.0;    // mouth face chamfer start |z| (45°, leg 0.5)
// conoid corner cut params
const CC = -0.3215, CA = 2.6138, CB = 0.2168, CZ = 3.3882;

// ---- body ----
const sockBody = Manifold.sphere(outerR, 128).intersect(Manifold.cube([11, 11, 5], true));
const ball = Manifold.sphere(ballR, 128).translate([0, 7, 0]);
const strut = Manifold.cylinder(7, strutR, strutR, 96).rotate([-90, 0, 0]); // along +Y, y∈[0,7]
let body = sockBody.add(ball).add(strut);

// plate clip z >= -2.5 (only the ball extends below)
body = body.intersect(Manifold.cube([11, 15, 5.7], true).translate([0, 3.9, 0.35]));

// ---- mouth wedge (vertical prism through the socket center) ----
const yw = 6 * mouthS;
const wedge2d = geom.fromPoints([[0, 0], [-6, -yw], [-6, -12], [6, -12], [6, -yw]]);
const wedge = wedge2d.extrude(6.5, 0, 0, [1, 1]).translate([0, 0, -3]);
body = body.subtract(wedge);

// ---- mouth-plane 45° leg-0.5 face chamfers (§5.11 wedge prisms) ----
// profile in (s,z): s = distance along into-material normal from the mouth plane
const chamProf = geom.fromPoints([[-0.4, chamZ0 - 0.4], [0.8, chamZ0 + 0.8], [0.8, 3.4], [-0.4, 3.4]]);
// left mouth line: n̂=(-0.5556,0.8314,0), û=(-0.8321,-0.5547,0)=ẑ×n̂
const thetaL = Math.atan2(0.8314, -0.5556) * 180 / Math.PI;
const E1 = [5.2 * -0.8321, 5.2 * -0.5547, 0];
const chamTopLeft = chamProf
  .extrude(5.8, 0, 0, [1, 1])
  .rotate([90, 0, 0])
  .rotate([0, 0, thetaL])
  .translate(E1);
const chamTopRight = chamTopLeft.mirror([1, 0, 0]);
const chamTop = chamTopLeft.add(chamTopRight);
const chamAll = chamTop.add(chamTop.mirror([0, 0, 1]));
body = body.subtract(chamAll);

// ---- conoid corner cut (hulled z-bands; hull convexifies, so per side) ----
function conoidHalfSlab(z, side) {
  // side=-1: left (x<0); returns thin slab whose polygon is the cut region
  const s = Math.sqrt(Math.max(1 - (z / CZ) * (z / CZ), 0));
  const yc = CC - s * CA;            // bound at x=0
  const yo = CC - s * (CA - CB * 4.9); // bound at |x|=4.9
  const pts = side < 0
    ? [[-4.9, -4.5], [0, -4.5], [0, yc], [-4.9, yo]]
    : [[0, -4.5], [4.9, -4.5], [4.9, yo], [0, yc]];
  return geom.fromPoints(pts);
}
const bandEdges = [];
for (let z = -2.5; z <= 2.501; z += 0.25) bandEdges.push(+z.toFixed(4));
let conoidCut = null;
for (let i = 0; i + 1 < bandEdges.length; i++) {
  const z1 = bandEdges[i], z2 = bandEdges[i + 1];
  for (const side of [-1, 1]) {
    const a = conoidHalfSlab(z1, side).extrude(0.012, 0, 0, [1, 1]).translate([0, 0, z1]);
    const b = conoidHalfSlab(z2, side).extrude(0.012, 0, 0, [1, 1]).translate([0, 0, z2 - 0.012]);
    const h = a.add(b).hull();
    conoidCut = conoidCut ? conoidCut.add(h) : h;
  }
}
body = body.subtract(conoidCut);

// ---- socket cavity: sphere + two lead-in cone frustums (overshoot faces) ----
const coneTop = Manifold.cylinder(1.0, coneRf - coneM * 0.8, coneRf + coneM * 0.2, 96).translate([0, 0, 1.7]);
const coneBot = coneTop.mirror([0, 0, 1]);
const cavity = Manifold.sphere(sockR, 128).add(coneTop).add(coneBot);
body = body.subtract(cavity);

return body;
