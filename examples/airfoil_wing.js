// Airplane wing — lofted between two NACA 4-digit airfoil sections.
//
// Demonstrates: Curves.naca4() for airfoil profiles, Curves.loft() to blend
// between a wide root section and a narrow tip section, smoothOut + refine to
// take the polygonal loft mesh to a smooth aerodynamic surface.

const { Manifold, CrossSection, Curves } = api;

const span    = 600;   // root-to-tip distance (Z before final rotation)
const samples = 64;    // points per airfoil cross-section
const rootCode = "2412";  // NACA 2412 — 2% camber at 40% chord, 12% thick
const tipCode  = "2410";  // thinner tip for less induced drag

// Profile points are in (chord, thickness) coordinates.
const rootPts = Curves.naca4(rootCode, { chord: 200, samples });
const tipPts  = Curves.naca4(tipCode,  { chord:  80, samples });

// Wrap in CrossSection so the loft can read the contour topology cleanly.
const root = CrossSection.ofPolygons([rootPts]);
const tip  = CrossSection.ofPolygons([tipPts]).translate([60, 0]);  // tip shifted aft (sweep angle)

// Loft from root at z=0 to tip at z=span. resolution must match `samples`
// closely; we let loft resample under the hood.
const wing = Curves.loft([root, tip], [0, span], {
  resolution: samples,
  smooth: true,    // call .smoothOut(60) for tangent-continuous span surfaces
  refine: 2,       // subdivide once for visibly curved upper/lower surfaces
});

// The loft built the wing along Z. Lay it flat: span along Y, chord along X.
return wing.rotate([-90, 0, 0]);
