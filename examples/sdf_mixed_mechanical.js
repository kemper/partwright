// Joystick top on a mounting bracket — a deliberate showcase of mixing
// `api.sdf` (organic, smooth-blended ergonomic grip) with `api.Manifold`
// (crisp axis-aligned bracket plate + pedestal + chamfered cable slot).
//
// Why mix them: the grip wants free fillets between the shaft, the
// thumb-rest bulge and the spherical top — that's the textbook
// `smoothUnion` case. The base wants square edges, parallel sides and
// drilled bolt holes — that's plain Manifold CSG. `.build()` returns a
// normal Manifold, so the two halves compose with a single `.add()`.
//
// Four labelled paint regions:
//   - 'grip'     : the entire SDF stick (shaft + head + thumb rest)
//   - 'collar'   : a thin SDF torus where the grip meets the pedestal
//   - 'pedestal' : the Manifold riser block between plate and collar
//   - 'plate'    : the Manifold base plate with bolt holes + cable slot
const { Manifold, sdf } = api;

// ---- Parameters ----------------------------------------------------------
// Bounding box target: roughly fits in a 60-unit cube (plate 50x40,
// total height ~55 from plate bottom to grip top).
const plateW       = 50;     // plate X
const plateD       = 40;     // plate Y
const plateH       = 4;      // plate thickness (Z)
const boltR        = 1.6;    // M3-ish clearance
const boltInset    = 5;      // bolt distance from plate edges
const slotW        = 14;     // cable slot width (along X)
const slotD        = 4;      // cable slot depth (along Y, cut from front edge)
const slotChamfer  = 1.2;    // chamfer on slot lips

const pedW         = 18;     // pedestal X (slimmer than plate, axis-aligned)
const pedD         = 18;     // pedestal Y
const pedH         = 8;      // pedestal Z above plate top

const shaftR       = 4;      // grip shaft radius
const shaftH       = 22;     // grip shaft height (before head)
const shaftTwist   = 6;      // degrees per unit — gentle spiral feel
const headR        = 7.2;    // grip head (palm ball) radius
const thumbR       = 3.2;    // thumb rest bulge radius
const blendK       = 1.8;    // smoothUnion blend radius for the grip joins
const grRound      = 0.6;    // .round() — softens all grip edges uniformly

const collarMajor  = 5.2;    // torus major radius (sits over shaft base)
const collarMinor  = 0.9;    // torus tube radius

// Z origin convention: plate sits on z=0 to z=plateH. Pedestal on top of
// plate. Grip sits on top of pedestal. We assemble each piece in its own
// local frame and translate the whole grip stack up at the end.
const plateTopZ    = plateH;
const pedTopZ      = plateTopZ + pedH;

// ---- SDF half: the ergonomic grip --------------------------------------
// Built centered at origin first, then translated up so its base sits at
// pedTopZ. The shaft is twisted around Z for a subtle spiral; the head
// and thumb rest are welded on with smoothUnion so the joins fillet
// automatically. A final .round() softens any residual seams.
//
// All the grip pieces live UNDER one .label('grip') so the smooth blends
// are preserved — per sdf.md, smooth booleans don't propagate labels, so
// wrapping the outer expression is what keeps the join paintable as one
// region.
const shaft = sdf.cylinder(shaftR, shaftH)
  .translate(0, 0, shaftH / 2)            // base at z=0, top at z=shaftH
  .twist(shaftTwist, 'z');                // gentle spiral along the shaft

// Slightly oblate "palm head" — modelled as a stretched roundedBox so it
// has more grip surface than a pure sphere. Sits on top of the shaft.
const head = sdf.roundedBox([headR * 2.0, headR * 1.7, headR * 1.4], headR * 0.55)
  .translate(0, 0, shaftH + headR * 0.55);

// Thumb-rest bulge — a smaller sphere on the +Y side of the head, where
// the thumb naturally lands when the grip is held right-handed.
const thumb = sdf.sphere(thumbR)
  .translate(0, headR * 0.7, shaftH + headR * 0.35);

const gripRaw = shaft
  .smoothUnion(head, blendK)              // weld head to shaft top
  .smoothUnion(thumb, blendK * 0.7)       // softer weld for the thumb bulge
  .round(grRound);                        // uniform soft-edge pass

// Translate the whole grip stack onto the pedestal and wrap with the
// label. Label survives translate (transforms propagate labels per
// sdf.md), so wrapping before OR after the translate is fine; we wrap
// after so the .label() is visually next to the .build() call.
const grip = gripRaw.translate(0, 0, pedTopZ).label('grip');

// A decorative collar — a thin torus sitting at the seam between the
// grip shaft and the pedestal top. Its own label so the paint manifest
// can pick a contrasting accent color.
const collar = sdf.torus(collarMajor, collarMinor)
  .translate(0, 0, pedTopZ + 0.2)
  .label('collar');

// Build both SDF subtrees in ONE .build() call so they share a mesher
// pass (and so the labelled partition machinery sees both labels in the
// same registry). edgeLength 0.4 resolves the .round() / smoothUnion
// fillets and the twist without exploding triangle count.
const sdfPart = sdf.union(grip, collar).build({ edgeLength: 0.4 });

// ---- Manifold half: the bracket plate + pedestal -----------------------
// Both are axis-aligned blocks — no fillets needed, no organic geometry
// — so plain Manifold is the right tool. Each gets its own paint label
// via the pre-existing api.label() wrapper.

// Base plate, centered on XY, sitting flush at z=0..plateH.
const plateSolid = Manifold.cube([plateW, plateD, plateH], true)
  .translate([0, 0, plateH / 2]);

// Four bolt holes at the corners. Cylinder is along Z by default; height
// is plateH * 1.4 so it pokes through the plate cleanly even after the
// chamfered slot cuts in.
const boltHole = Manifold.cylinder(plateH * 1.4, boltR, boltR, 24)
  .translate([0, 0, -plateH * 0.2]);     // small Z overshoot for clean cut

const boltX = plateW / 2 - boltInset;
const boltY = plateD / 2 - boltInset;
const holes = [
  boltHole.translate([ boltX,  boltY, 0]),
  boltHole.translate([-boltX,  boltY, 0]),
  boltHole.translate([ boltX, -boltY, 0]),
  boltHole.translate([-boltX, -boltY, 0]),
];

// Cable slot through the front edge of the plate (front = -Y side).
// Built as a centered cube plus two chamfer prisms so the slot mouth is
// beveled, not razor-sharp — that's what mesh CSG is good at.
const slotCore = Manifold.cube([slotW, slotD * 2.2, plateH * 1.4], true)
  .translate([0, -plateD / 2 + slotD * 0.1, plateH / 2]);

// Two top-lip chamfers — small triangular prisms (cubes rotated 45° on
// the X-axis) intersected with the slot mouth, used as subtract tools.
// Approximate by simply growing the slot a hair at the top with a wider
// cube on top.
const slotChamferTop = Manifold.cube(
  [slotW + slotChamfer * 2, slotD * 2.2, slotChamfer * 2], true,
).translate([0, -plateD / 2 + slotD * 0.1, plateH - slotChamfer * 0.5]);

const plate = api.label(
  plateSolid
    .subtract(holes[0]).subtract(holes[1])
    .subtract(holes[2]).subtract(holes[3])
    .subtract(slotCore)
    .subtract(slotChamferTop),
  'plate',
);

// Pedestal — a chunky block centered on the plate, raising the grip up
// to comfortable Z. Axis-aligned, painted its own color so the riser
// reads as a distinct part of the bracket. Overlaps the plate by a tiny
// amount in Z so the boolean union sees real volumetric overlap (the
// 0.5+ unit rule of thumb from CLAUDE.md).
const pedestal = api.label(
  Manifold.cube([pedW, pedD, pedH + 0.8], true)
    .translate([0, 0, plateTopZ + (pedH + 0.8) / 2 - 0.8]),
  'pedestal',
);

// ---- Combine -----------------------------------------------------------
// .build() returned a normal Manifold so we just .add() it in. expectUnion
// also checks the result is a single connected component — a stray grip
// or floating chamfer would show up as componentCount > 1, surfacing the
// "I expected one piece, got three" class of bug immediately.
return api.expectUnion([plate, pedestal, sdfPart], { expectComponents: 1 });
