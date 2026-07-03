// armor_upper_arm_2x — armor shell over the frame upper arm.
// Decoded from exact STL facet census (109 planes) + welded vertex dump:
//   OUTER solid is CONVEX (every facet is a supporting half-space) -> hull of
//   the 26 exact outer vertices (x>0) + mirror.
//   CAVITY = union of 5 convex prisms, all constants read off exact facets:
//     C1: chamfered inner-wall slab prism |x|<=2.5, floor z=0.85 / ceiling
//         z=6.15, 0.5 corner chamfers (planes x-z=1.15 / x+z=8.15 etc.),
//         through ALL y  -> makes walls + bridge floor/ceiling
//     B:  bottom opening y >= -1-z (45deg ramp), sharp |x|<=2.5
//     T:  top opening    y >= z-8  (mirror ramp)
//     C3: open front end y <= -3.5, chamfer-corner profile kept
//     BORE: 144-gon cylinder r=3.100 about y-axis at (x,z)=(0,3.5), y>=0.3
//   Genus 1 = the closed ring band y in [-3.5,-1.85].
const { Manifold } = api;

// --- outer convex hull: exact vertices from the target mesh (x>0 half) ---
const outerR = [
  [2.99913, -5.5, 2.5], [3.0, -5.5, 2.50122], [3.0, -5.5, 4.49878], [2.99913, -5.5, 4.5], // tip face
  [3.54152, -5.00173, 2.70761], [3.54152, -5.00173, 4.29239],   // tip chamfer / tilt-wall corner
  [3.14498, -3.74979, 0.74979], [3.14498, -3.74979, 6.25021],   // end-bevel x corner-chamfer
  [3.68858, -3.23702, 0.94291], [3.68858, -3.23702, 6.05709],   // corner-chamfer cluster
  [3.68544, -3.22693, 0.92720], [3.68544, -3.22693, 6.07280],
  [2.99502, -3.0, 0.0], [3.0, -2.99310, 0.0],                   // z=0 face meets end bevel
  [2.99502, -3.0, 7.0], [3.0, -2.99310, 7.0],
  [3.59806, -2.79002, 0.49029], [3.59806, -2.79002, 6.50971],   // steep chamfer / taper corner
  [4.0, 0.5, 2.5], [4.0, 0.5, 4.5],                             // tilt wall meets x=4
  [3.0, 5.5, 0.0], [3.59806, 5.5, 0.49029], [4.0, 5.5, 2.5],
  [4.0, 5.5, 4.5], [3.59806, 5.5, 6.50971], [3.0, 5.5, 7.0],    // +y end octagon profile
];
const outerPts = [...outerR, ...outerR.map(([x, y, z]) => [-x, y, z])];
const outer = Manifold.hull(outerPts);

// --- C1: chamfered inner slab, all y ---
const octXZ = [[2.0, 0.85], [2.5, 1.35], [2.5, 5.65], [2.0, 6.15]];
const c1pts = [];
for (const [x, z] of octXZ) for (const y of [-5.6, 5.6]) c1pts.push([x, y, z], [-x, y, z]);
const C1 = Manifold.hull(c1pts);

// --- B/T: bottom/top openings with 45deg ramp ends (planes y+z=-1, z-y=8) ---
const bYZ = [[-0.9, -0.1], [5.6, -0.1], [5.6, 1.4], [-2.4, 1.4]];
const bPts = [];
for (const [y, z] of bYZ) for (const x of [-2.5, 2.5]) bPts.push([x, y, z]);
const B = Manifold.hull(bPts);
const tPts = [];
for (const [y, z] of bYZ) for (const x of [-2.5, 2.5]) tPts.push([x, y, 7 - z]);
const T = Manifold.hull(tPts);

// --- C3: open front end y<=-3.5, keeps the wall corner-chamfer planes ---
const c3XZ = [[1.05, -0.1], [2.5, 1.35], [2.5, 5.65], [1.05, 7.1]];
const c3pts = [];
for (const [x, z] of c3XZ) for (const y of [-5.6, -3.5]) c3pts.push([x, y, z], [-x, y, z]);
const C3 = Manifold.hull(c3pts);

// --- BORE: r=3.100, 144 segments (vertices at 1.25deg + k*2.5deg), y 0.3..5.6 ---
const bore = Manifold.cylinder(5.3, 3.1, 3.1, 144)
  .rotate([0, 0, 1.25])
  .rotate([90, 0, 0])   // axis -> y (spans y -5.3..0)
  .translate([0, 5.6, 3.5]); // y 0.3..5.6, center (x,z)=(0,3.5)

return outer.subtract(C1).subtract(B).subtract(T).subtract(C3).subtract(bore);
