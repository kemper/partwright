// Olympic Weightlifter — overhead lockout (the jerk / snatch catch).
//
// A powerful, stocky lifter holding a loaded barbell locked straight overhead,
// in a wide receiving stance, determined. Both arms straight up (raiseSide ~172),
// wide squat (legs spread + slight knee bend), torso upright, head up, gaze
// forward. The barbell is a long capsule spanning both grip cups, extended past
// each hand along the grip span, with weight plates (flat cylinders) at each end,
// smooth-welded into the figure so the whole thing stays ONE component.
// Front = −Y, Z up, figure's left = +X, right = −X.
//
// Paint regions: skin, eyes, iris, pupil, lids, hair, singlet, shoes, sole,
//                barbell, base
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — stocky, powerful build; arms locked overhead, wide squat stance.
const rig = F.rig({
  height: 56,
  headsTall: 7,
  sex: 'male',
  build: 'stocky',
  muscle: 0.85,
  weight: 0.45,
  pose: {
    // Both arms straight up overhead. twist≈90 rolls the (barely-bent) elbow
    // plane so the hands face up to receive the bar above the head.
    arms: { raiseSide: 172, raiseFwd: 4, bend: 6, twist: 90 },
    // Wide receiving squat: legs spread out, knees bent, slight forward step.
    legs: { raiseSide: 25, raiseFwd: 6, bend: 30 },
    // Torso upright, head up with a level forward gaze.
    head: { pitch: -4 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — square jaw, straight nose, flat set mouth, determined.
// The mouth is a flat, stern lip set rendered PAINTED (additive, print-safe) and
// welded into the head — so it carries no separate label (it paints as 'skin'),
// matching the figure's label list. render:'painted' also avoids the carved-mouth
// tearing the guide warns about on small/tall heads.
const head = F.head(rig, { faceShape: 'square', jaw: 1.2 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', tipRadius: r.head * 0.11 },
  mouth: { style: 'lips', lipShape: 'flat', expression: 'slightFrown', width: r.head * 0.5, render: 'painted' },
  ears: { size: r.head * 0.24 },
  brows: {},
});

// Paintable eyes — top-level, self-labelled (eyes/iris/pupil/lids). Upper lids,
// forward gaze: focused and determined.
const eyes = F.face.eyes(rig, { radius: r.head * 0.15, lids: 'upper', gaze: 'middle' });

// 3. SKIN — weld every body mass; fists clenched on the bar.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. SINGLET — weightlifting singlet: sleeveless top + briefs as one garment.
const singletTop = F.clothing.top(rig, {
  sleeve: 'none',
  hemZ: rig.joints.hips[2] + r.hipsY * 0.2,
  thickness: r.chestY * 0.16,
});
const singletBottom = F.clothing.pants(rig, {
  rise: 'high',
  leg: 'slim',
  length: 'briefs',
});
const singlet = singletTop.union(singletBottom).label('singlet');

// 5. HAIR — short crop.
const hair = F.hair(rig, { style: 'short' }).label('hair');

// 6. LIFTING SHOES — flat, keyed off the sole frame (own 'shoes' + 'sole').
const shoes = F.clothing.shoes(rig, { label: 'shoes' });

// 7. BASE — platform disc; auto-rises to the lower foot of the wide stance.
const base = F.base(rig, { radius: rig.opts.height * 0.3 }).label('base');

// 8. BARBELL — long capsule bar spanning both grip cups, extended past each
//    hand along the span axis, with a flat weight plate at each end. spanGrips
//    aims the bar at the grip POINTS (the finger cups) so it sits in the fists
//    rather than through the hands; smoothUnion welds it into the figure so the
//    whole assembly stays ONE component.
const s = F.spanGrips(rig.grip.L, rig.grip.R);
const barR = r.hand * 0.34;             // bar radius — slim olympic bar
const ext = r.head * 1.6;               // how far the bar runs past each hand
// Bar endpoints: past each grip cup along the span axis.
const barA = [s.a[0] - s.axis[0] * ext, s.a[1] - s.axis[1] * ext, s.a[2] - s.axis[2] * ext];
const barB = [s.b[0] + s.axis[0] * ext, s.b[1] + s.axis[1] * ext, s.b[2] + s.axis[2] * ext];
const bar = sdf.capsule(barA, barB, barR);

// Weight plates: flat disc cylinders centred near each bar end. The bar is
// essentially horizontal along X overhead, so a cylinder built along Z and
// rotated [0,90,0] (axis → X) reads as a flat plate facing outward. Centred a
// touch inboard of the bar tip so the shaft passes through the hub.
const plateR = r.head * 0.95;           // plate radius
const plateT = barR * 2.6;              // plate thickness along the bar
const plateAt = (end, dir) => {
  const c = [end[0] - dir[0] * plateT * 0.7, end[1] - dir[1] * plateT * 0.7, end[2] - dir[2] * plateT * 0.7];
  return sdf.cylinder(plateR, plateT).rotate([0, 90, 0]).translate(c);
};
const plateL = plateAt(barA, [-s.axis[0], -s.axis[1], -s.axis[2]]);
const plateR_ = plateAt(barB, [s.axis[0], s.axis[1], s.axis[2]]);

const barbell = bar
  .smoothUnion(plateL, barR * 0.6)
  .smoothUnion(plateR_, barR * 0.6)
  .label('barbell');

// Weld the barbell into the figure (at the fists) so it's one component. A
// small smoothUnion of skin+barbell fuses them; we do the fuse inside the final
// union by overlapping the bar through the closed fists (the bar passes through
// the grip cups which sit inside the fists).
//
// 9. Union all labelled regions and build.
return sdf.union(skin, eyes, singlet, hair, shoes, base, barbell)
  .build({ edgeLength: 0.65, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
