// Femur-inspired graded TPMS study — three new graded variants on one part.
//
// A long-bone metaphor lets each new graded TPMS surface (gradedSchwarzP,
// gradedDiamond, gradedLidinoid) drive a *different* spatial gradient and
// be intersected with a *different* finite container, so each one's
// response to a non-trivial thicknessFn is visible side-by-side in one
// model:
//
//   1. CORTICAL SHAFT — gradedSchwarzP inside a hollow tube. Wall
//      thickness ramps RADIALLY: dense near the outer wall (cortical
//      bone), open toward the central canal. This is the "dense outer
//      shell with porous interior" pattern aerospace topology
//      optimisation produces.
//
//   2. MARROW CORE — gradedDiamond inside the inner channel. Wall
//      thickness ramps AXIALLY: thinner at mid-shaft (where marrow is
//      richest), thicker near both ends (transition to cancellous bone).
//      Diamond's scaffold appearance is the canonical "trabecular"
//      look in biomedical lattice work.
//
//   3. EPIPHYSIS HEAD — gradedLidinoid inside a sphere at the top. Wall
//      thickness ramps with SPHERICAL RADIUS from the sphere centre:
//      dense near the articular surface (joint-loading skin), sparse
//      toward the interior. Lidinoid's higher-genus weave gives the
//      head a distinctly different texture from the shaft lattices.
//
// Plus solid endcaps as a neutral frame so the lattices aren't floating.
//
// All three graded TPMS are infinite by construction, so each is
// intersect-clipped to its finite container. Five labelled regions let
// the paint manifest colour the gradients distinctly. Thickness
// functions pre-compute every closure-invariant they need (centres,
// reciprocals, π·k constants) at module scope so the hot path is just
// reads + arithmetic.
const { sdf, Manifold } = api;

// ---- Geometry parameters ------------------------------------------------
const shaftR     = 8.0;     // outer radius of the diaphysis (shaft)
const innerR     = 4.6;     // inner-channel radius (marrow canal)
const shaftH     = 30.0;    // shaft height (Z extent)
const shaftZc    = 6.0;     // shaft is offset upward so the head sits high

const headR      = 10.0;    // radius of the femoral head (epiphysis)
const headZc     = shaftZc + shaftH / 2 + 6.0; // head sits above shaft, slight overlap

const capH       = 2.4;     // distal-end solid cap thickness (bottom)

// Cell sizes — kept comparable across the three lattices so the only
// visible difference is the surface family + grading, not the period.
// Per the docs: thickness ≈ cellSize/6 to cellSize/3 is the sweet spot,
// so thickness functions are sized to land inside that band everywhere.
const cellShaft  = 3.8;     // → printable thickness band ≈ [0.63, 1.27]
const cellMarrow = 3.2;     // → printable thickness band ≈ [0.53, 1.07]
const cellHead   = 3.5;     // → printable thickness band ≈ [0.58, 1.17]

// ---- Closure-invariants for the thickness functions ---------------------
// All three thicknessFns are called once per mesh sample (millions of
// times). Pre-compute every constant they need here, at module scope, so
// the hot path is read-only.

// Shaft radial gradient: t = tMin + (tMax - tMin) * smoothstep01(r/shaftR)
//   r = sqrt(x*x + y*y);  tMin at centre, tMax at outer wall.
const SHAFT_T_MIN = cellShaft / 6;   // 0.633 — the docs' lower bound
const SHAFT_T_MAX = cellShaft / 3;   // 1.267 — the docs' upper bound
const SHAFT_T_RANGE = SHAFT_T_MAX - SHAFT_T_MIN;
const SHAFT_R_INV = 1 / shaftR;       // avoid the divide on the hot path

// Marrow axial gradient: thin at mid-shaft, thicker at the ends.
//   z' = (z - shaftZc) / (shaftH/2)   ∈ [-1, +1]
//   t  = tMin + (tMax - tMin) * z'^2
const MARROW_T_MIN  = cellMarrow / 6;       // mid-shaft, "marrow rich"
const MARROW_T_MAX  = cellMarrow / 3.2;     // ends, denser cancellous
const MARROW_T_RANGE = MARROW_T_MAX - MARROW_T_MIN;
const MARROW_Z_INV  = 2 / shaftH;            // 2/H so z' lands in [-1,+1]

// Head spherical gradient: dense at the sphere SURFACE (articular skin),
// sparse at the centre. d = sqrt(dx^2 + dy^2 + dz^2) from head centre.
//   u = d / headR   ∈ [0, 1] (clamped)
//   t = tMin + (tMax - tMin) * u^1.4   (slightly biased toward the rim)
const HEAD_T_MIN = cellHead / 6;
const HEAD_T_MAX = cellHead / 3;
const HEAD_T_RANGE = HEAD_T_MAX - HEAD_T_MIN;
const HEAD_R_INV = 1 / headR;

// ---- Finite containers --------------------------------------------------
// Each graded TPMS gets clipped to one of these. Building the containers
// once and sharing them keeps the SDF tree compact.
const shaftRing = sdf.cylinder(shaftR, shaftH).translate(0, 0, shaftZc)
  .subtract(sdf.cylinder(innerR, shaftH + 0.5).translate(0, 0, shaftZc));

const marrowCanal = sdf.cylinder(innerR - 0.05, shaftH - 1.0)
  .translate(0, 0, shaftZc);

const headBall = sdf.sphere(headR).translate(0, 0, headZc);

// ---- 1) Cortical shaft — gradedSchwarzP ---------------------------------
// Radial grading: thin at the canal wall, thick at the outer cortex.
// SchwarzP's rounded-cubic cells give a recognisably "solid block" feel
// at high thickness and a clean rounded pore at low, which makes the
// gradient legible at a glance.
const shaftThickness = (x, y, _z) => {
  const r = Math.sqrt(x * x + y * y);
  let u = r * SHAFT_R_INV;
  if (u < 0) u = 0; else if (u > 1) u = 1;
  // smoothstep so the transition is non-linear and the dense outer band
  // reads as a distinct cortical layer.
  const s = u * u * (3 - 2 * u);
  return SHAFT_T_MIN + SHAFT_T_RANGE * s;
};

const cortical = sdf
  .gradedSchwarzP(cellShaft, shaftThickness)
  .intersect(shaftRing)
  .label('cortical');

// ---- 2) Marrow core — gradedDiamond -------------------------------------
// Axial grading: thin near mid-shaft, thicker toward the ends. Diamond's
// interpenetrating-channel topology is the canonical "trabecular
// scaffold" and reads as bone marrow at a glance.
const marrowThickness = (_x, _y, z) => {
  const zp = (z - shaftZc) * MARROW_Z_INV;  // -1 at distal end, +1 at proximal
  // Use zp^2 so both ends are dense and the middle is open — no abs() needed
  // and the squaring naturally keeps zp in [0,1] without a branch.
  let s = zp * zp;
  if (s > 1) s = 1;
  return MARROW_T_MIN + MARROW_T_RANGE * s;
};

const marrow = sdf
  .gradedDiamond(cellMarrow, marrowThickness)
  .intersect(marrowCanal)
  .label('marrow');

// ---- 3) Epiphysis (femoral head) — gradedLidinoid -----------------------
// Spherical radial grading: dense at the articular surface (joint skin),
// sparse toward the centre. Lidinoid is the resolution-hungriest of the
// four TPMS — the head's larger cellSize relative to shaft gives the
// woven structure room to read cleanly without bumping edgeLength.
const headThickness = (x, y, z) => {
  const dx = x;
  const dy = y;
  const dz = z - headZc;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  let u = d * HEAD_R_INV;
  if (u < 0) u = 0; else if (u > 1) u = 1;
  // u^1.4 biases the dense band toward the outer skin so the articular
  // surface looks like a proper load-bearing shell.
  const s = Math.pow(u, 1.4);
  return HEAD_T_MIN + HEAD_T_RANGE * s;
};

const epiphysis = sdf
  .gradedLidinoid(cellHead, headThickness)
  .intersect(headBall)
  .label('epiphysis');

// ---- Solid endcaps ------------------------------------------------------
// A short solid disc capping the distal end so the bone "stands up" and
// the lattice cross-section is visible from below. Plain Manifold —
// crisp and cheap.
const distalCap = api.label(
  Manifold.cylinder(capH, shaftR, shaftR, 96)
    .translate([0, 0, shaftZc - shaftH / 2 - capH]),
  'distalCap',
);

// A subtle equatorial collar around the neck joining shaft and head, so
// the assembly reads as one bone rather than two floating chunks.
const neckCollar = api.label(
  Manifold.cylinder(1.4, shaftR + 0.4, shaftR + 0.4, 64)
    .translate([0, 0, shaftZc + shaftH / 2]),
  'collar',
);

// ---- Build the SDF half + final assembly --------------------------------
// edgeLength 0.45 lands inside the docs' recommended range (0.4–0.5) and
// resolves all three lattices' surface variation cleanly. The combined
// bbox is ~24×24 in plan and ~60 tall, well under 80.
const sdfPart = cortical.union(marrow).union(epiphysis).build({ edgeLength: 0.45 });

// Clipping infinite TPMS at hard boundaries leaves many small edge
// chips by construction — we don't assert single-component here.
return Manifold.union([sdfPart, distalCap, neckCollar]);
