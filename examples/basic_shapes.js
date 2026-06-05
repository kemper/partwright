// Twisted column — a rounded-square profile swept upward with manifold-3d's
// built-in twist and taper. Mesh kernels make this kind of continuously
// deformed solid cheap to build, and it renders in a blink.
const { CrossSection } = api;

// Rounded-square cross-section: the convex hull of four corner circles.
const r = 4, d = 9;
const profile = CrossSection.hull([
  CrossSection.circle(r).translate([ d,  d]),
  CrossSection.circle(r).translate([-d,  d]),
  CrossSection.circle(r).translate([-d, -d]),
  CrossSection.circle(r).translate([ d, -d]),
]);

// Extrude 60 tall: 48 slices, 160° of twist, tapering to 55% at the top.
return profile.extrude(60, 48, 160, 0.55);
