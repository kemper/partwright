// SPIKE: thi.ng-backed 2D sketch layer (api.geom). Parametric vector
// profiles — star, n-gon, ellipse, rounded rect — plus subdivision-curve
// smoothing, each lowering into a Manifold CrossSection so the usual
// .extrude() / Manifold.revolve() / boolean paths just work.
const { Manifold, geom } = api;

// 1) Extruded star — geom.star(radius, points, innerRatio) -> CrossSection.
const star = geom.star(10, 6, 0.5).extrude(6);

// 2) N-gon prism with an elliptical bore drilled through it.
const hex = geom.ngon(9, 6).extrude(8);
const bore = geom.ellipse(5, 2.5, 64).extrude(20).translate([0, 0, -6]);
const drilled = hex.subtract(bore);

// 3) Rounded-rect plate — a clean, filleted base profile in one call.
const plate = geom.roundedRect(28, 16, 4, 12).extrude(3);

// 4) Subdivision smoothing: a coarse 5-point blob -> smooth revolved vase.
//    Chaikin corner-cutting turns the hand-set profile into a fair curve.
const profile = geom.smooth(
  [[3, 0], [8, 4], [5, 10], [9, 14], [2, 18]],
  { iterations: 4, kernel: 'chaikin', closed: false },
);
const vase = Manifold.revolve(profile, 64);

// Lay the four demos out on a shared tray so it stays one printable solid.
const tray = geom.roundedRect(80, 26, 5, 12).extrude(3).translate([0, 0, 1.5]);
return Manifold.union([
  tray,
  star.translate([-28, 0, 3]),
  drilled.translate([-7, 0, 4]),
  plate.translate([14, 0, 1.5]).rotate([0, 0, 0]),
  vase.scale([0.7, 0.7, 0.7]).translate([32, 0, 1]),
]);
