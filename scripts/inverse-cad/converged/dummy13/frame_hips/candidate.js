// Dummy 13 frame_hips — 3 balls on a D-flat strut, bottom-clipped.
// All numbers probed:
//   sphere fits: r=3.000 at (-8,0,0),(0,0,0),(8,0,0)  rms 0, inliers 1.0
//   strut: cylinder r=1.500 axis +X, rms 0; chordal flat at z=-1.3 (D-section)
//   bottom clip plane z=-2.5 (bbox zmin; z=-2.48 section circles r=1.6867=sqrt(9-2.48^2))
const { Manifold } = api;

const ballR = 3.0;
const ballX = 8.0;
const strutR = 1.5;
const flatZ = -1.3;
const clipZ = -2.5;

let s = null;
for (const x of [-ballX, 0, ballX]) {
  const b = Manifold.sphere(ballR, 128).translate([x, 0, 0]);
  s = s ? s.add(b) : b;
}

// D-strut: full-length cylinder along X, flat cut at z=flatZ (cut BEFORE union —
// the balls are not flattened at that plane, only the strut is)
let strut = Manifold.cylinder(2 * ballX + 0.4, strutR, strutR, 96, true)
  .rotate([0, 90, 0]);
strut = strut.subtract(
  Manifold.cube([2 * ballX + 2, 2 * strutR + 2, 3], true)
    .translate([0, 0, flatZ - 1.5])
);
s = s.add(strut);

// bottom clip: keep z >= clipZ
s = s.intersect(
  Manifold.cube([24, 8, 6.5], true).translate([0, 0, clipZ + 3.25])
);

return s;
