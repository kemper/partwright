// armor_thigh_2x — measured parametric reconstruction.
// Sleeve: rect 9x12 plan with 45° corner cuts (width 2), z 0..24.
// Front wall: plane y = 6.60606 - 0.151515*z (starts z=4; y=6 below).
// Back wall: arc in (y,z), center (z=3.9973, y=75.2877) r=81.2869 (tangent y=-6 at z=4).
// Corner cuts shear with the walls: x±y <= 2.5 + wall(z).
// Front scoop (X-prism): 45° entry y=13.423-z, blend arc c(z13.4979,y6.9876) r4.9924, exit y=1.33001+0.048749z.
// Tab x±1.5 on the front plane, z..17.25 top + chamfer facet; corner cuts |x|+y+0.151515z<=7.60606.
// Top: front chamfer y+z>=24, side chamfers x+z>=27.5, P2 corner planes sqrt2*x+y+z>=28.9497,
//      back facets z >= 24-0.593(|x-(-y)|... (x∓y-5.28), gap prism z>=19.5 flanks |x|<=1.6+(z-19.5)/4.5,
//      notch = swing cylinder r4.7511 about X-axis at (y0,z22) clipped |x|<=1.6, y<=0.
// Bore 2.6² through; mouth y±4.2 z<6.2 + 45° chamfer to 7.8; pocket cyl r3.2 z<5.2.
// Pivot boss spheres r0.9959 at (±3.197, 0, 22).
const { Manifold, CrossSection, geom } = api;

const FP_M = 0.151515, FP_B = 6.606061;          // front plane y = FP_B - FP_M*z
const ARC_CY = 75.2877, ARC_CZ = 3.9973, ARC_R = 81.2869;
const yb = (z) => z <= ARC_CZ ? -6 : ARC_CY - Math.sqrt(ARC_R * ARC_R - (z - ARC_CZ) * (z - ARC_CZ));

function poly(pts) {
  // ensure CCW winding
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return geom.fromPoints(a < 0 ? pts.slice().reverse() : pts);
}

// Prism with profile in (s, z); s runs along horizontal azimuth thetaDeg,
// extruded ±L along the perpendicular horizontal direction.
function wedge(profilePts, thetaDeg, L = 14) {
  return poly(profilePts)
    .extrude(2 * L, 0, 0, [1, 1])
    .translate([0, 0, -L])
    .rotate([90, 0, 0])
    .rotate([0, 0, thetaDeg]);
}

const SQ2 = Math.SQRT2;

// ---- base block ----
let solid = Manifold.cube([9, 12, 24], true).translate([0, 0, 12]);

// ---- 1. front wall plane cut (X-prism) ----
solid = solid.subtract(wedge([[6.0, 4.0], [FP_B - FP_M * 26, 26], [12, 26], [12, 4.0]], 90));

// ---- 2. back wall arc cut (X-prism) ----
{
  const pts = [[-6, -2], [-6, 4]];
  for (let z = 4.5; z <= 25.01; z += 0.5) pts.push([yb(z), z]);
  pts.push([yb(25), 26], [-12, 26], [-12, -2]);
  solid = solid.subtract(wedge(pts, 90));
}

// ---- 3. front corner cuts (sheared planes, ±x) ----
{
  const s0 = 8.5 / SQ2;
  const prof = [[s0, -2], [s0, 4], [(9.106061 - FP_M * 26) / SQ2, 26], [12, 26], [12, -2]];
  solid = solid.subtract(wedge(prof, 45)).subtract(wedge(prof, 135));
}

// ---- 4. back corner cuts (sheared arc, ±x) ----
{
  const pts = [[8.5 / SQ2, -2], [8.5 / SQ2, 4]];
  for (let z = 4.5; z <= 25.01; z += 0.5) pts.push([(2.5 - yb(z)) / SQ2, z]);
  pts.push([(2.5 - yb(25)) / SQ2, 26], [12, 26], [12, -2]);
  solid = solid.subtract(wedge(pts, -45)).subtract(wedge(pts, -135));
}

// ---- 5. front scoop (X-prism) ----
{
  const AZ = 13.4979, AY = 6.9876, AR = 4.9924;   // blend arc center/r in (z,y)
  const pts = [[13.423 - 6.0, 6.0]];               // entry line y = 13.423 - z from z=6
  const zt1 = 9.9677, zt2 = 13.7411;
  pts.push([13.423 - zt1, zt1]);
  for (let z = zt1 + 0.1; z < zt2; z += 0.1) pts.push([AY - Math.sqrt(AR * AR - (z - AZ) * (z - AZ)), z]);
  pts.push([1.33001 + 0.048749 * zt2, zt2]);
  pts.push([1.33001 + 0.048749 * 25, 25], [12, 25], [12, 6.0]);
  solid = solid.subtract(wedge(pts, 90));
}

// ---- 6. top front chamfer y+z >= 24 (X-prism) ----
solid = solid.subtract(wedge([[18, 6], [-1, 25], [12, 25], [12, 6]], 90));

// ---- 7. side top chamfers x+z >= 27.5 (Y-prisms) ----
{
  const prof = [[8.5, 19], [2.5, 25], [12, 25], [12, 19]];
  solid = solid.subtract(wedge(prof, 0)).subtract(wedge(prof, 180));
}

// ---- 8. P2 corner planes sqrt2*x + y + z >= 28.9497 ----
{
  const S3 = Math.sqrt(3);
  const prof = [[(28.9497 - 19) / S3, 19], [(28.9497 - 25) / S3, 25], [12, 25], [12, 19]];
  const th = Math.atan2(1, SQ2) * 180 / Math.PI;   // 35.2644°
  solid = solid.subtract(wedge(prof, th)).subtract(wedge(prof, 180 - th));
}

// ---- 9. back top facets: z >= 24 - 0.593*((x∓y) - 5.28) ----
{
  const k = 0.593 * SQ2;                           // slope in s = (x-y)/sqrt2
  const s0 = 5.28 / SQ2;
  const prof = [[s0 - 0.3, 24 + 0.3 * k], [8, 24 - (8 - s0) * k], [8, 27], [s0 - 0.3, 27]];
  solid = solid.subtract(wedge(prof, -45)).subtract(wedge(prof, -135));
}

// ---- 10. top gap (Y-prism): z >= 19.5, |x| <= 1.6 + (z-19.5)/4.5 ----
{
  const xw = (z) => 1.6 + (z - 19.5) / 4.5;
  solid = solid.subtract(wedge([[-1.6, 19.5], [1.6, 19.5], [xw(25), 25], [-xw(25), 25]], 0));
}

// ---- 11. notch: swing cylinder r 4.7511 about X axis at (y=0, z=22), |x|<=1.6, y<=0 ----
{
  const cyl = Manifold.cylinder(3.2, 4.7511, 4.7511, 192, true)
    .rotate([0, 90, 0])
    .translate([0, 0, 22]);
  solid = solid.subtract(cyl.intersect(Manifold.cube([3.2, 8, 14], true).translate([0, -4, 21])));
}

// ---- 12. tab (added after cuts) ----
{
  let tab = Manifold.cube([3, 4.6, 9.75], true).translate([0, 2.4 + 2.3, 7.5 + 4.875]);
  // front plane
  tab = tab.subtract(wedge([[6.0, 4.0], [FP_B - FP_M * 26, 26], [12, 26], [12, 4.0]], 90));
  // corner cuts |x| + y + FP_M*z <= 7.60606
  const cp = [[(7.606061 - FP_M * 6) / SQ2, 6], [(7.606061 - FP_M * 19) / SQ2, 19], [12, 19], [12, 6]];
  tab = tab.subtract(wedge(cp, 45)).subtract(wedge(cp, 135));
  // top chamfer facet through (y=3.4918, z=17.25) and (y=4.0672, z=16.757)
  const m = (17.25 - 16.757) / (4.0672 - 3.4918); // dz/dy = 0.857
  tab = tab.subtract(wedge([[3.4918, 17.25], [6, 17.25 - m * (6 - 3.4918)], [6, 20], [3.4918, 20]], 90));
  solid = solid.add(tab);
}

// ---- 13. bore + mouth + chamfer + pocket ----
solid = solid.subtract(Manifold.cube([5.2, 5.2, 26], true).translate([0, 0, 12]));
solid = solid.subtract(Manifold.cube([5.2, 8.4, 7.2], true).translate([0, 0, 2.6]));  // z -1..6.2
{
  // 45° mouth chamfer: cut wall material BELOW line (y=4.2,z=6.2)→(y=2.6,z=7.8), |x|<=2.6.
  // Overshoot the diagonal to (2.4, 8.0) so no wedge face lands near-coplanar
  // with the bore face y=2.6 (rotation float dust leaves a phantom membrane).
  const prof = [[4.2, 6.2], [2.4, 8.0], [2.4, 6.0], [4.2, 6.0]];
  solid = solid.subtract(wedge(prof, 90, 2.6)).subtract(wedge(prof, -90, 2.6));
}
solid = solid.subtract(Manifold.cylinder(5.3, 3.2, 3.2, 96).translate([0, 0, -0.1]));

// ---- 14. pivot boss spheres ----
solid = solid.add(Manifold.sphere(0.9959, 64).translate([3.197, 0, 22]));
solid = solid.add(Manifold.sphere(0.9959, 64).translate([-3.197, 0, 22]));

return solid;
