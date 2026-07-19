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

const cube = Manifold.cube([SIZE, SIZE, SIZE], true);
const rounded = api.round(cube, { radius: FILLET, resolution: 220 });

// ---------------------------------------------------------------
// 2. Pip layout — standard Western D6: opposite faces sum to 7,
//    pip dots arranged on a 3x3 grid per face.
// ---------------------------------------------------------------
const PIP_R = 1.5;   // pip sphere radius
const DEPTH = 1.0;   // desired max dimple depth below the flat face
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

// Refine before painting: round()'s remeshed surface has coarse, unevenly
// sized triangles, and api.paint.box selects by triangle centroid against
// the CURRENT triangulation (no smoothing option in-code) — painting
// straight onto that coarse mesh bleeds color onto oversized neighboring
// triangles (fan-bleed). Refining first shrinks triangles near each pip so
// the box selection hugs the recess instead of spilling past it.
body = body.refine(3);

// ---------------------------------------------------------------
// 3. Paint — white body, black pip recesses. Rounding discards labels, so
//    label/paint happens on this final shape, after carving.
// ---------------------------------------------------------------
body = api.label(body, 'body', { color: '#f2f0e8' });

// api.paint.box has no smoothing option, so it selects whole triangles by
// centroid against the refined mesh. Size the box's half-extent to the FULL
// pip sphere radius (not just the surface hole radius) — a box that stops
// at the hole radius clips the sphere's deepest point (the pole, at
// center - n*PIP_R), leaving the fan of triangles right at the bottom of
// the dimple unpainted (a tiny white pinhole at the center of every pip).
// A cube of half-side PIP_R fully contains the sphere in every direction;
// the mesh is refined enough that the small margin beyond the surface hole
// stays sub-pixel.
const boxHalf = PIP_R * 1.05;
for (let i = 0; i < pipCenters.length; i++) {
  const c = pipCenters[i];
  api.paint.box({
    min: [c[0] - boxHalf, c[1] - boxHalf, c[2] - boxHalf],
    max: [c[0] + boxHalf, c[1] + boxHalf, c[2] + boxHalf],
    color: '#1a1a1a',
  });
}

return body;
