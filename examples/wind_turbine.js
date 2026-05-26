// Wind turbine — tower, nacelle, hub, and 3 blades.
//
// Coordinate system: Z-up, right-handed. Tower base sits on the XY plane.
// The nacelle's long axis runs along Y, so the rotor axis is +Y and the
// blades sweep through the XZ plane (like a real horizontal-axis turbine).
//
// Demonstrates the new mesh-ops helpers:
//   - api.placeOn       → drop the nacelle on top of the tower
//   - api.linearPattern → 8 ladder rungs marching up the tower face
//   - api.circularPattern with a non-Z axis → 3 blades around the rotor
//   - api.expectUnion   → assert the final assembly is a single component
const { Manifold, CrossSection } = api;

// ----- Tower: tapered cylinder, 200 tall, wider at base ----------------
// 24 sides keeps it round-looking without exploding the triangle count.
const TOWER_H = 200;
const TOWER_R_BASE = 9;
const TOWER_R_TOP = 5.5;
const tower = Manifold.cylinder(TOWER_H, TOWER_R_BASE, TOWER_R_TOP, 24);

// ----- Nacelle: rounded-ish box, long axis along Y (rotor axis) --------
// Built centered at the origin so placeOn can do the lifting onto the tower.
// Made with two cubes hulled to round the rear end slightly — purely cosmetic.
const NACELLE_LEN = 30;   // along Y
const NACELLE_W   = 14;   // along X
const NACELLE_H   = 12;   // along Z
const nacelleBody = Manifold.cube([NACELLE_W, NACELLE_LEN, NACELLE_H], true);
const tailDome = Manifold.cylinder(NACELLE_W * 0.9, NACELLE_H * 0.45, NACELLE_H * 0.45, 16)
  .rotate([90, 0, 0])                                // lie cylinder along Y
  .translate([0, -NACELLE_LEN / 2 + 1, 0]);          // poke out the back, with overlap
const nacelle = nacelleBody.add(tailDome);

// Drop the nacelle on top of the tower — no manual height math needed.
// Negative gap sinks the nacelle ~1mm into the tower top so the boolean
// union actually fuses them (placeOn with gap=0 leaves a touching seam,
// which the boolean treats as two components).
const nacelleOnTower = api.placeOn(nacelle, tower, { gap: -1 });

// We need the post-placement bbox of the nacelle to anchor the hub & blades.
const nacBb = api.bbox(nacelleOnTower);
const HUB_Y = nacBb.max[1] + 1;        // 1 mm past the front face (overlap inward by hub depth)
const HUB_Z = nacBb.center[2];         // rotor axis at nacelle mid-height
const HUB_R = 5;
const HUB_DEPTH = 6;

// ----- Hub: short cylinder along Y, sticking out of the nacelle nose ---
// Built along Z, then rotated so its axis runs along Y. The hub straddles
// the nose plane so it overlaps the nacelle (clean union) and the blades
// (which we'll plant inside it) by several units in every direction.
const hub = Manifold.cylinder(HUB_DEPTH, HUB_R, HUB_R, 32)
  .translate([0, 0, -HUB_DEPTH / 2])   // center on its own origin
  .rotate([90, 0, 0])                  // axis Z -> axis Y (then -Y becomes +Z)
  .translate([0, HUB_Y, HUB_Z]);

// ----- Blade: tapered slab, built at the 12 o'clock position -----------
// "12 o'clock" = blade pointing straight up (+Z) from the hub center.
// circularPattern around the +Y axis will then rotate +Z → +X → -Z, giving
// three evenly-spaced blades in the XZ plane.
//
// The blade is a CrossSection rectangle extruded with twist + scaleTop, then
// shifted so its root overlaps the hub by ~2 mm. Chord runs along X, span
// along Z, thickness along Y (parallel to the rotor axis — i.e. the blade
// face catches "wind" coming from +Y).
const BLADE_LEN = 95;
const ROOT_CHORD = 14;
const ROOT_THICK = 3.5;
const TIP_SCALE = 0.35;   // tip is 35% the chord/thickness of the root
const TWIST_DEG = -22;    // negative twist = leading edge pitches into the wind

const bladeProfile = CrossSection.square([ROOT_CHORD, ROOT_THICK], true);
let blade = bladeProfile.extrude(BLADE_LEN, /*nDiv*/ 12, TWIST_DEG, TIP_SCALE, /*center*/ false);
// extrude builds along +Z with base at z=0 — perfect for a 12 o'clock blade.
// Sink the root 2 units into the hub for a solid weld, then move out to the hub.
blade = blade.translate([0, 0, -2]);
blade = blade.translate([0, HUB_Y, HUB_Z]);

// Triplicate the blade around the rotor axis (+Y), pivoting through the hub
// center so each blade stays anchored to the hub. axis:'y' is the case I
// wanted to exercise — default is 'z', which would have spun them flat.
const rotor = api.circularPattern(blade, 3, {
  axis: 'y',
  center: [0, HUB_Y, HUB_Z],
});

// ----- Ladder: 8 rungs marching up the +X face of the tower ------------
// One rung is a small horizontal cuboid that pokes out of the tower side.
// linearPattern with a [0,0,dz] step stacks them vertically.
const RUNG_LEN = 7;       // along Y
const RUNG_THICK = 1.2;   // along Z
const RUNG_OUT = 2.2;     // how far the rung sticks out past the tower wall
const FIRST_RUNG_Z = 40;
const RUNG_SPACING = 18;

// Position the rungs so the inboard end is buried inside the tower at
// EVERY rung height. The tower tapers from radius 9 (base) to 5.5 (top);
// the top rung at z=40+7*18=166 sits where the tower radius is ~6.1, so
// we need rungInner ≤ ~5.5 for clean overlap at every rung.
const rungInner = 4;                          // well inside the tower at all heights
const rungOuter = TOWER_R_BASE + RUNG_OUT;
const rungLenX = rungOuter - rungInner;
const rung = Manifold.cube([rungLenX, RUNG_LEN, RUNG_THICK], false)
  .translate([rungInner, -RUNG_LEN / 2, FIRST_RUNG_Z]);

const ladder = api.linearPattern(rung, 8, [0, 0, RUNG_SPACING]);

// ----- Assemble + assert single connected component --------------------
// expectUnion throws immediately if anything failed to overlap (rather than
// silently producing a 3-component mesh that renders fine but exports broken).
const turbine = api.expectUnion(
  [tower, nacelleOnTower, hub, rotor, ladder],
  { expectComponents: 1 },
);

return turbine;
