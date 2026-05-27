// Spiral staircase with steps, column, and railing posts
// Right-handed, Z-up. Base sits on Z=0.
//
// Design:
//   - Central column (cylinder) anchors the staircase along Z.
//   - 16 wedge-shaped steps spiral around it via api.spiralPattern
//     (each rotated 22.5° AND lifted 15mm from the previous).
//   - Steps overlap the column radially (so they fuse to it) and
//     overlap each other slightly in Z (so they fuse to neighbors).
//   - Railing posts on every other step — another api.spiralPattern with
//     doubled angle/rise, so 8 posts evenly spaced up the spiral.
//   - A round platform sits on top via api.placeOn, anchored to the column
//     (with 'preserve' for the XY so we don't drag it onto the topmost step's
//     off-center bbox).
//   - A decorative ring of balusters circles the platform edge via
//     api.circularPattern with the radius shortcut.
//
// Final return is ONE Manifold, verified by api.expectUnion.

const { Manifold } = api;

// ---------------------------------------------------------------
// Parameters
// ---------------------------------------------------------------
const stepCount       = 16;
const stepAngleDeg    = 22.5;     // 16 * 22.5 = 360 degrees total
const stepRise        = 15;       // mm gained per step (Z)
const stepThickness   = 16;       // each step is 16mm tall, so consecutive
                                  // steps overlap by 1mm in Z (15 < 16)
const stepInnerR      = 20;       // step starts inside the column (col R=25)
const stepOuterR      = 130;      // outer reach of the tread
const stepWedgeDeg    = 26;       // each tread spans 26° (overlaps neighbor by ~3.5°)

const columnR         = 25;
const columnH         = stepCount * stepRise + stepThickness + 4;
                        // = 16*15 + 16 + 4 = 260mm — climbs to top step + cap

const postR           = 4;        // railing post radius
const postH           = 60;       // railing post height above the tread
const postEveryN      = 2;        // a post on every other step → 8 posts total

const platformR       = stepOuterR + 8; // platform overhangs the top step a touch
const platformH       = 6;

const balusterCount   = 8;
const balusterR       = 2.5;
const balusterH       = 14;
const balusterRingR   = platformR - 4; // balusters sit just inside the rim

// ---------------------------------------------------------------
// 1. Central column
// ---------------------------------------------------------------
const column = Manifold.cylinder(columnH, columnR, columnR, 64);

// ---------------------------------------------------------------
// 2. Spiraling steps — the rotate-AND-translate case that no single
//    pattern helper handles cleanly. A for-loop is the right tool.
//
//    Each step is a thin wedge of a hollow annular cylinder, made by
//    intersecting a flat cylinder with a wedge-shaped box that fans
//    out from the Z axis. The cylinder is centered on origin, so
//    rotating it around Z (the spiral) is trivial.
// ---------------------------------------------------------------
function makeStep() {
  // Thin disk that spans the outer radius — we'll carve the inside.
  const disk = Manifold.cylinder(stepThickness, stepOuterR, stepOuterR, 96);

  // A "pizza wedge" mask: a triangular prism wide enough to fully
  // bound the disk radially. Build it from a cube rotated and
  // intersected with another rotated cube to form a wedge.
  // Easier: two half-space cuts via subtract.
  const halfAngle = stepWedgeDeg / 2;
  const slab = Manifold.cube([stepOuterR * 2.5, stepOuterR * 2.5, stepThickness + 2], true)
                 .translate([0, 0, stepThickness / 2]);

  // Cut everything CCW past +halfAngle and CW past -halfAngle. We do
  // this by translating a big box past the cut plane and rotating it
  // so its inner face lies on the cut plane.
  const cutPos = Manifold.cube([stepOuterR * 3, stepOuterR * 3, stepThickness + 4], true)
                   .translate([0, stepOuterR * 1.5, stepThickness / 2])
                   .rotate([0, 0, halfAngle]);
  const cutNeg = Manifold.cube([stepOuterR * 3, stepOuterR * 3, stepThickness + 4], true)
                   .translate([0, -stepOuterR * 1.5, stepThickness / 2])
                   .rotate([0, 0, -halfAngle]);

  let wedge = slab.subtract(cutPos).subtract(cutNeg);
  // Intersect with the disk to give it a curved outer arc.
  wedge = wedge.intersect(disk);

  // Punch a small inner clearance hole so the wedge starts at stepInnerR,
  // not at the Z axis. We want stepInnerR < columnR so the step
  // overlaps the column volumetrically.
  const innerHole = Manifold.cylinder(stepThickness + 4, stepInnerR, stepInnerR, 48)
                      .translate([0, 0, -2]);
  wedge = wedge.subtract(innerHole);

  return wedge;
}

const stepProto = makeStep();

// ---------------------------------------------------------------
// 3. Spiral the steps + railing posts via api.spiralPattern
// ---------------------------------------------------------------
// Steps: 16 wedges, each rotated 22.5° AND lifted 15mm from the previous.
// This is the case spiralPattern is built for — replaces the rotate+translate
// for-loop I'd otherwise write by hand.
const steps = api.spiralPattern(stepProto, stepCount, {
  anglePerCopy: stepAngleDeg,
  risePerCopy: stepRise,
});

// Railing posts on every other step (8 total). Same helix, half the
// frequency: anglePerCopy and risePerCopy doubled, count halved.
const postProto = Manifold.cylinder(postH, postR, postR, 24)
                    .translate([stepOuterR - postR - 2, 0, stepThickness - 2]);
                    // Pre-position the post at the +X edge of the first step,
                    // 2mm sunk into the tread so the union welds it on.
const posts = api.spiralPattern(postProto, stepCount / postEveryN, {
  anglePerCopy: stepAngleDeg * postEveryN,
  risePerCopy: stepRise * postEveryN,
});

// ---------------------------------------------------------------
// 4. Top platform — sit it on top of the last step via api.placeOn.
//    Place it on the COLUMN so it's centered on Z; if we placed it on
//    the topmost step (off-center), placeOn would slide it sideways
//    to center on the step's bbox. The column's top is at columnH,
//    which is above the last step (z = 15*15 + 16 = 241) by ~19mm —
//    so use a small negative gap to actually bond to both the column
//    cap and the top step.
// ---------------------------------------------------------------
const platformBlank = Manifold.cylinder(platformH, platformR, platformR, 96);
// Lower platform slightly so it overlaps the top step's tread surface.
// Top step's top face is at: (stepCount-1)*stepRise + stepThickness = 15*15+16 = 241.
// We want platform bottom around z=238 so it overlaps by ~3mm.
const platform = api.placeOn(platformBlank, column, { gap: -(columnH - 238) });
// gap = -(columnH - 238) shifts the platform down from columnH to 238.

// ---------------------------------------------------------------
// 5. Decorative ring of balusters around the platform edge.
//    Perfect fit for circularPattern's `radius` shortcut: build the
//    baluster at the origin (with the right Z), then let the helper
//    push it outward by `balusterRingR` and stamp 8 copies.
// ---------------------------------------------------------------
const balusterProto = Manifold.cylinder(balusterH, balusterR, balusterR, 18)
                        .translate([0, 0, 238 + platformH - 2]);
                        // Z places it sunk 2mm into the platform top.
const balusters = api.circularPattern(balusterProto, balusterCount, {
  radius: balusterRingR,
});
// Default angle=360 spaces N copies at 360/N (no duplicate at the seam).

// ---------------------------------------------------------------
// 6. Assemble — verify it's one piece.
// ---------------------------------------------------------------
const stair = api.expectUnion(
  [column, steps, posts, platform, balusters],
  { expectComponents: 1 },
);

return stair;
