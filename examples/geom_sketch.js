// 2D sketch-primitive layer (api.geom). Dependency-free parametric profiles —
// star, n-gon, ellipse, rounded/chamfered rect, slot, teardrop, annulus,
// sector — plus subdivision-curve smoothing. Each returns a Manifold
// CrossSection, so the usual .extrude() / Manifold.revolve() / boolean paths
// just work. (Booleans/hull/offset live on CrossSection; smooth paths/sweeps
// on Curves; gears on the gears namespace — api.geom is just the primitives.)
const { Manifold, geom } = api;

// Row of extruded primitives.
const star   = geom.star(8, 6, 0.5).extrude(6);
const slot   = geom.slot(18, 4).extrude(6);
const tear   = geom.teardrop(6).extrude(6);              // printable horizontal-hole profile
const ring   = geom.annulus(7, 4).extrude(6);
const pie     = geom.sector(8, 0, 270).extrude(6);
const chamfer = geom.chamferedRect(14, 10, 3).extrude(6);

// Subdivision smoothing: a coarse profile -> smooth revolved vase.
const vase = Manifold.revolve(
  geom.smooth([[3, 0], [8, 4], [5, 10], [9, 14], [2, 18]],
              { iterations: 4, kernel: 'chaikin', closed: false }), 64);

// A rounded-rect tray ties it into one printable solid.
const tray = geom.roundedRect(96, 24, 5, 12).extrude(3).translate([0, 0, 1.5]);
return Manifold.union([
  tray,
  star.translate([-40, 0, 3]),
  slot.translate([-22, 0, 3]),
  tear.translate([-4, 0, 3]),
  ring.translate([12, 0, 3]),
  pie.translate([28, 0, 3]),
  chamfer.translate([42, 6, 3]),
  vase.scale([0.6, 0.6, 0.6]).translate([42, -6, 1.5]),
]);
