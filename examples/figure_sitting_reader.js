// Storytime kid — sitting on a bench reading an open book.
// Chair-sit pose (raiseFwd 90 / bend 90 — thighs forward, shins straight down),
// both hands holding a chunky storybook at chest/belly level, bangs hair,
// gentle smile, head nodded down toward the page.
// ~5 heads tall (cute child proportions). Front = −Y, Z up.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — sitting pose.
// legs: raiseFwd 90 + bend 90 = pelvis at bench level, thighs forward.
// arms: low raiseSide, moderate forward flex, elbows bent inward — hands at chest.
const rig = F.rig({
  height: 60,
  headsTall: 5,
  build: 'average',
  pose: {
    legs:  { raiseSide: 8, raiseFwd: 90, bend: 90 },
    armL:  { raiseSide: 14, raiseFwd: 38, bend: 85 },
    armR:  { raiseSide: 14, raiseFwd: 38, bend: 85 },
    head:  { pitch: 22 },       // looking down at the book
    spine: { lean: 4 },       // gentle reading hunch
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — content expression: gentle smile, soft brows, clear eyes.
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { tipRadius: r.head * 0.10 },
  mouth: { style: 'smile', width: r.head * 0.40 },
  ears:  { size: r.head * 0.26 },
  brows: {},
});
// Eyes labelled separately: iris style gives eyes / iris / pupil labels.
const eyes = F.face.eyes(rig, { radius: r.head * 0.17, lids: 'half' });

// 3. SKIN — open grip: palms supporting the book's sides.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
], { k: r.lowerArm * 1.25 }).label('skin');

// 4. CLOTHES — short-sleeve t-shirt + slim pants.
const shirt = F.clothing.top(rig, {
  sleeve: 'short',
  thickness: r.chestY * 0.22,
}).label('shirt');
const pants = F.clothing.pants(rig, {
  leg: 'slim',
  rise: 'mid',
  thickness: r.upperLeg * 0.22,
}).label('pants');

// 5. HAIR — bangs style: straight fringe to the brows.
const hair = F.hair(rig, { style: 'bob' }).label('hair');

// 6. OPEN STORYBOOK — chunky board-book held at chest level, tilted for reading.
// Hand joints (raiseSide 16, raiseFwd 28, bend 82):
//   handL ≈ [+8.1, −15.1, 39]   handR ≈ [−8.1, −15.1, 39]   span ≈ 16.2
// Book is narrower than hand span so the hands clearly grip its outer edges.
// A thick body (2× hand radius) prevents topological holes at the hand boundary.
const hL = j.handL, hR = j.handR;
const handSpan  = Math.abs(hL[0] - hR[0]);   // ≈ 16.2

// Book center right at the hands, slightly pulled toward the body.
const bookCx    = 0;
const bookCy    = (hL[1] + hR[1]) / 2 - r.hand * 0.2;
const bookCz    = (hL[2] + hR[2]) / 2 + r.hand * 0.1;

// WIDER than the hand span: the side faces pass decisively THROUGH the
// palms (a transversal crossing), with the hands tucked behind the covers.
// A book narrower than the span leaves its faces kissing the fingertips at
// near-tangent angles — dozens of micro-handles (genus 23, measured).
const bookW     = handSpan + r.hand * 1.2;
const bookH     = bookW * 0.62;               // storybook page proportions
const bookT     = r.hand * 2.0;               // thick: reads as a real kids' book

// Tilt pages upward ~22° so they face the nodding head.
const book = sdf.roundedBox([bookW, bookH, bookT], r.hand * 0.22)
  .rotate([-22, 0, 0])
  .translate([bookCx, bookCy, bookCz])
  .label('book');

// 7. BENCH — sits under the pelvis (the weight-bearing seat surface).
// Pelvis center z ≈ 24.9, radius Y ≈ 3.6 → pelvis bottom ≈ 21.3.
// Raise seatTopZ slightly above pelvis bottom to ensure solid overlap.
const seatTopZ  = j.hips[2] - r.hipsY * 0.75;  // z ≈ 22.2 (above pelvis bottom 21.3)
const benchH    = seatTopZ;
const benchW    = r.hipsX * 4.2;   // covers the full hip width
const benchD    = r.head * 2.4;      // deep enough to sit on comfortably
// Bench Y center: aligned with pelvis Y so the seat is directly below the body.
const benchCy   = j.hips[1];        // = 0
const bench     = sdf.roundedBox([benchW, benchD, benchH], r.foot * 0.35)
  .translate([0, benchCy, benchH / 2]).label('bench');

// 8. Ground slab — oval base connecting bench, thighs, and feet into one piece.
// With the sitting pose the feet are near the knee height (z≈23), not at z=0.
// The slab at z=0 connects to the bench bottom and extends under the outstretched legs.
const ankleAvgY = (j.footL[1] + j.footR[1]) / 2;   // ≈ −11
const slabR     = rig.opts.height * 0.38;
const slabH     = rig.opts.height * 0.036;
// Center slab between the bench Y and the ankle Y.
const slabCy    = (benchCy + ankleAvgY) * 0.5;        // ≈ −5.5
const slab      = sdf.roundedCylinder(slabR, slabH, 0.5)
  .translate([0, slabCy, slabH / 2]).label('base');

// 9. Hard-union + build.
// Coarser hand detail (2× edgeLength multiplier) avoids topology artifacts
// where the book's side edges meet the hand detail region.
const handDet = F.handDetail(rig).map(d => ({ ...d, edgeLength: d.edgeLength * 2.0 }));

return sdf.union(skin, eyes, shirt, pants, hair, book, bench, slab)
  .build({ edgeLength: 0.67, detail: [...F.faceDetail(rig), ...handDet] });
