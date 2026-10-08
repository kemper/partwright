// Casino-rounded D6 — a six-sided die with every edge uniformly filleted via
// api.round(), then pip recesses carved and painted after rounding (rounding
// first keeps the pip edges crisp; labels/paint never survive a round pass).
const { Manifold } = api;

// ---------------------------------------------------------------
// 1. Bare cube, rounded FIRST (round() remeshes the whole surface, so any
//    label/paint on the input would be discarded — carve + paint after).
// ---------------------------------------------------------------
const SIZE = 24;
const H = SIZE / 2;
const FILLET = 2.4; // casino-die style: generously rounded but pips stay legible

// EXACT rounded cube: the convex hull of eight corner spheres gives perfectly
// flat faces and perfectly cylindrical/spherical fillets. (api.round's SDF
// lattice is the tool for NON-convex shapes — boolean results, organic forms —
// but its ~voxel-scale field error reads as gentle waviness on large flat
// mirror-shaded faces; for a convex primitive like this, the hull is exact.)
const c = H - FILLET;
const corners = [];
for (const dx of [-c, c])
  for (const dy of [-c, c])
    for (const dz of [-c, c])
      corners.push(Manifold.sphere(FILLET, 48).translate([dx, dy, dz]));
const rounded = Manifold.hull(corners);

// ---------------------------------------------------------------
// 2. Pip layout — standard Western D6: opposite faces sum to 7,
//    pip dots arranged on a 3x3 grid per face.
// ---------------------------------------------------------------
const PIP_R = 2.2;   // pip sphere radius
const DEPTH = 1.2;   // recess depth (flush-filled; with PIP_R sets the visible pip circle ~2.0r)
const SPACING = 6;   // grid half-spacing (keeps pips well clear of the fillet)

// Local 3x3 grid positions (du, dv) on a face.
const GRID = {
  TL: [-SPACING, SPACING], TR: [SPACING, SPACING],
  ML: [-SPACING, 0], MR: [SPACING, 0],
  BL: [-SPACING, -SPACING], BR: [SPACING, -SPACING],
  C: [0, 0],
};
const LAYOUT = {
  1: [GRID.C],
  2: [GRID.TL, GRID.BR],
  3: [GRID.TL, GRID.C, GRID.BR],
  4: [GRID.TL, GRID.TR, GRID.BL, GRID.BR],
  5: [GRID.TL, GRID.TR, GRID.BL, GRID.BR, GRID.C],
  6: [GRID.TL, GRID.ML, GRID.BL, GRID.TR, GRID.MR, GRID.BR],
};

// Each face: outward normal + in-plane (u, v) basis. Chosen so opposite faces
// sum to 7: +Z/-Z = 1/6, +X/-X = 2/5, +Y/-Y = 3/4.
const FACES = [
  { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], value: 1 },
  { n: [0, 0, -1], u: [1, 0, 0], v: [0, -1, 0], value: 6 },
  { n: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1], value: 2 },
  { n: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1], value: 5 },
  { n: [0, 1, 0], u: [-1, 0, 0], v: [0, 0, 1], value: 3 },
  { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], value: 4 },
];

const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale3 = (a, s) => [a[0] * s, a[1] * s, a[2] * s];

// Sphere center = face-plane point, pushed OUT along the normal by (PIP_R -
// DEPTH) so only a DEPTH-deep spherical cap ends up inside the solid.
const pushOut = PIP_R - DEPTH;

const pipCenters = []; // world-space centers, for paint afterward
let pipCutter = null;
for (const face of FACES) {
  const facePoint = scale3(face.n, H + pushOut);
  for (const [du, dv] of LAYOUT[face.value]) {
    const center = add3(add3(facePoint, scale3(face.u, du)), scale3(face.v, dv));
    pipCenters.push(center);
    const s = Manifold.sphere(PIP_R, 24).translate(center);
    pipCutter = pipCutter ? pipCutter.add(s) : s;
  }
}

let body = rounded.subtract(pipCutter);

// ---------------------------------------------------------------
// 3. Pips as labeled INLAY geometry — not paint. Each recess is refilled
//    with a slightly larger sphere clipped to the original die surface, so
//    the pip is a flush circular fill (real casino "birdseye" dice are
//    flush-filled) whose color boundary is exact boolean geometry — a
//    perfect circle — rather than a per-triangle paint.box selection (the
//    old approach, which read as jagged squares). The oversize (+0.15)
//    guarantees volumetric overlap with the recess wall so everything
//    fuses into one printable solid; labels survive the union, so this
//    also slices as a clean two-material print.
// ---------------------------------------------------------------
let inlays = null;
for (const c of pipCenters) {
  const s = Manifold.sphere(PIP_R + 0.15, 32).translate(c).intersect(rounded);
  inlays = inlays ? inlays.add(s) : s;
}

body = api.label(body, 'body', { color: '#f2f0e8' });
const pips = api.label(inlays, 'pips', { color: '#1a1a1a' });
return api.expectUnion([body, pips], { expectComponents: 1 });
