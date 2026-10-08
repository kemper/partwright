// adapter_stand — keyhole hanger. Every dimension probed from target.stl:
//   ball: sphere r=3.000 @ (0,-5.5,2.5)  (probe fit: rms 0, inlierFrac 1.0)
//   neck: revolved traced r(y) polyline (band circle fits rms<0.001 + back-face rays;
//         single arc/cone fits were REJECTED: worst resid 0.05, curve is not one arc)
//   flange: disc r=4.0, rim y in [-1,0], front face y=0, curved back blending into neck
//   loop: outer circle R=1.4997 @ (0,2.1) + straight foot ±1.2 down to flange face;
//         inner circle r=0.6592 @ (0,2.1) + slot ±0.36; prismatic, extruded z 0..3
//   whole part clipped flat at z=0 (print bed)
const { Manifold, CrossSection, geom } = api;

const AXIS_Z = 2.5; // revolve axis height (all band circle fits: cy=2.500)
const BALL_Y = -5.5, BALL_R = 3.0;

// measured neck polyline (y, r) — band circle fits (mid-band) then back-face rays
const neck = [
  [-3.048, 1.7433], [-2.948, 1.6694], [-2.848, 1.6267], [-2.698, 1.6078],
  [-2.548, 1.6298], [-2.448, 1.6733], [-2.348, 1.7252], [-2.248, 1.7827],
  [-2.148, 1.8464], [-2.048, 1.9169], [-1.948, 1.9949], [-1.848, 2.0814],
  [-1.748, 2.1777], [-1.648, 2.2852], [-1.548, 2.4060], [-1.448, 2.5417],
  [-1.4109, 2.6], [-1.2947, 2.8], [-1.2005, 3.0], [-1.1271, 3.2],
  [-1.0709, 3.4], [-1.0313, 3.6], [-1.0181, 3.7], [-1.0025, 3.9], [-1.0, 4.0],
];

// profile polygon in the revolve half-plane: X = radius, Y = height (-> global Y)
const prof = [[0, BALL_Y - BALL_R]];
const yStartNeck = neck[0][0];
const t1 = Math.acos(-(yStartNeck - BALL_Y) / BALL_R);
const N = 48;
for (let i = 1; i <= N; i++) {
  const t = (t1 * i) / N;
  prof.push([BALL_R * Math.sin(t), BALL_Y - BALL_R * Math.cos(t)]);
}
for (const [y, r] of neck) prof.push([r, y]);
prof.push([4.0, -1.0]);
prof.push([4.0, 0.0]);
prof.push([0, 0]);
// force CCW winding
let area2 = 0;
for (let i = 0; i < prof.length; i++) {
  const [x1, y1] = prof[i], [x2, y2] = prof[(i + 1) % prof.length];
  area2 += x1 * y2 - x2 * y1;
}
if (area2 < 0) prof.reverse();

const body = geom.fromPoints(prof).revolve(128) // axis = Z, heights = profile Y
  .rotate([-90, 0, 0])                          // height axis Z -> +Y
  .translate([0, 0, AXIS_Z]);

// keyhole loop, extruded along Z from 0 to 3 (prismatic: verified z=0.3/2.7/2.95)
const R_OUT = 1.4997, R_IN = 0.6592, LOOP_CY = 2.1;
const outer = CrossSection.circle(R_OUT, 96).translate([0, LOOP_CY])
  .add(CrossSection.square([2.4, 1.7], false).translate([-1.2, -0.5])); // foot ±1.2, y -0.5..1.2
const inner = CrossSection.circle(R_IN, 64).translate([0, LOOP_CY])
  .add(CrossSection.square([0.72, 1.6], false).translate([-0.36, 0]));  // slot ±0.36, y 0..1.6
const loop = outer.subtract(inner).extrude(3.0);

const part = body.add(loop);
// print-bed clip at z=0
const ground = Manifold.cube([40, 40, 10], true).translate([0, -2.45, -5]);
return part.subtract(ground);
