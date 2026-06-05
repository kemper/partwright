// manifold-3d capability sampler — primitives, booleans, hull, twist-extrude,
// and a surface of revolution, mounted on one tray so it stays a single
// printable solid. Mesh booleans are fast even on odd shapes. Edit any block
// and re-run to experiment.
const { Manifold, CrossSection } = api;

// 1) Booleans: a cube with a sphere and a cross-bore subtracted.
const boolean = Manifold.cube([15, 15, 15], true)
  .subtract(Manifold.sphere(9.5, 48))
  .subtract(Manifold.cylinder(20, 3.5, 3.5, 48, true));

// 2) Rounded box: convex hull of eight corner spheres.
const r = 2.5, hx = 6, hy = 6, hz = 4;
const s = Manifold.sphere(r, 24);
const rounded = Manifold.hull([
  s.translate([ hx,  hy,  hz]), s.translate([-hx,  hy,  hz]),
  s.translate([ hx, -hy,  hz]), s.translate([-hx, -hy,  hz]),
  s.translate([ hx,  hy, -hz]), s.translate([-hx,  hy, -hz]),
  s.translate([ hx, -hy, -hz]), s.translate([-hx, -hy, -hz]),
]);

// 3) Twisted column: a rounded-square profile extruded with built-in twist.
const profile = CrossSection.hull([
  CrossSection.circle(2).translate([5, 5]),  CrossSection.circle(2).translate([-5, 5]),
  CrossSection.circle(2).translate([-5, -5]), CrossSection.circle(2).translate([5, -5]),
]);
const twisted = profile.extrude(24, 48, 180, 0.5);

// 4) Surface of revolution: a vase profile (X = radius, Y = height) spun on Z.
const vase = Manifold.revolve(CrossSection.hull([
  CrossSection.circle(1).translate([3, 0]), CrossSection.circle(1).translate([7, 7]),
  CrossSection.circle(1).translate([3, 16]),
]), 64);

// A tray base ties the four demos into one connected, printable solid.
const tray = Manifold.cube([86, 24, 3], true).translate([2, 0, 1]);
return Manifold.union([
  tray,
  boolean.translate([-30, 0, 9]),
  rounded.translate([-8, 0, 5]),
  twisted.translate([14, 0, 1]),
  vase.translate([34, 0, 1]),
]);
