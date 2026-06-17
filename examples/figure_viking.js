// Viking Warrior — burly raider in a ready battle stance, both hands gripping a
// battle-axe held across the front of the body. Fierce hooded glare, braided
// hair, a thick beard, square jaw, broad nose. Stocky 7-heads build, planted
// wide stance with a slight forward crouch.
//
// The axe is a two-handed prop: a HAFT capsule spanning both grip cups
// (F.spanGrips) and extended past the top end, with a broad wedge AXE HEAD
// welded near the top — all smooth-unioned into the figure so the whole thing
// stays ONE component.
//
// Front = −Y, Z up, figure's left = +X, right = −X.
//
// Paint regions: skin, beard, eyes, iris, pupil, lids, hair, tunic, pants,
//                boots, sole, axe, base
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — stocky, burly, 7 heads. Feet planted wide; both arms brought across
//    the front of the chest so the two grips sit a hand's-width apart, gripping
//    the axe haft. Slight forward crouch (spine lean) and lowered head.
const rig = F.rig({
  height: 58,
  headsTall: 7,
  sex: 'male',
  build: 'stocky',
  muscle: 0.7,
  weight: 0.55,
  pose: {
    // Both arms raised slightly out, swung forward and bent ~60° so the closed
    // fists meet in front of the chest gripping the haft a hand's-width apart.
    arms: { raiseSide: 25, raiseFwd: 35, bend: 60 },
    // Feet planted wide — a braced battle stance.
    legs: { raiseSide: 18 },
    // Slight forward crouch + head lowered, gaze forward, fierce.
    spine: { lean: 8 },
    head: { pitch: 6 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — square jaw, broad nose, hooded fierce frown.
const mouthOpts = { style: 'lips', lipShape: 'flat', expression: 'frown', width: r.head * 0.5 };
const head = F.head(rig, { faceShape: 'square', jaw: 1.4 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'broad', tipRadius: r.head * 0.12 },
  mouth: false,
  ears: true,
  brows: {},
});

// Paintable eyes — top-level, self-labelled (eyes/iris/pupil/lids). Hooded lids,
// forward gaze: a fierce glare from under the brow.
const eyes = F.face.eyes(rig, { radius: r.head * 0.15, lids: 'hooded', gaze: 'middle' });
// Flat, frowning lips — additive so they survive on the small head.
const lips = F.face.mouthAccents(rig, mouthOpts);

// 2b. BEARD — a rounded mass under the chin/jaw, its own paint label. Built as a
//     broad ellipsoid hung off the chin landmark and clipped above the lip line
//     so it reads as a beard sitting proud of the jaw (not swallowing the mouth).
const chinP = rig.face.chinTip;
const hf = rig.dir.headForward;
const beardC = [
  chinP[0] + hf[0] * r.head * 0.10,
  chinP[1] + hf[1] * r.head * 0.10,
  chinP[2] - r.head * 0.18,
];
const beardMass = sdf.ellipsoid(r.headX * 0.92, r.headZ * 0.80, r.headZ * 0.95)
  .translate(beardC);
// Clip away the upper portion so the beard starts below the mouth (keeps the
// lips/nose clear) and trim the back so it hugs the jaw rather than ballooning.
const beardClipZ = chinP[2] + r.head * 0.10;
const beard = beardMass
  .intersect(sdf.box([r.head * 4, r.head * 4, r.head * 4]).translate([0, 0, beardClipZ - r.head * 2]))
  .label('beard');

// 3. SKIN — weld every body mass; fists clenched on the haft.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. TUNIC — long-sleeved tunic over the torso.
const tunic = F.clothing.top(rig, {
  sleeve: 'long',
  hemZ: rig.joints.hips[2] - r.hipsY * 0.1,
  thickness: r.chestY * 0.16,
}).label('tunic');

// 5. PANTS — trousers.
const pants = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  thickness: r.upperLeg * 0.2,
}).label('pants');

// 6. BOOTS — keyed off the sole frame (own 'boots' + 'sole' regions).
const boots = F.clothing.boots(rig, { label: 'boots', shaftZ: rig.joints.lowerLegL[2] });

// 7. HAIR — viking braids.
const hair = F.hair(rig, { style: 'braids' }).label('hair');

// 8. BASE — display disc; auto-rises to the lower foot of the wide stance.
const base = F.base(rig, { radius: rig.opts.height * 0.3 }).label('base');

// 9. BATTLE AXE — a two-handed haft spanning both grip cups, extended past the
//    TOP end, with a broad wedge axe HEAD welded near that top end. spanGrips
//    aims the haft at the grip POINTS (the finger cups) so it sits in the fists
//    rather than through the hands; smoothUnion welds it into the figure so the
//    whole assembly stays ONE component.
const s = F.spanGrips(rig.grip.L, rig.grip.R);
// Orient so the haft's "top" (where the head goes) is the figure's-left end
// (+X side) — pick whichever span endpoint has the larger X.
const topIsB = s.b[0] >= s.a[0];
const topPt = topIsB ? s.b : s.a;
const botPt = topIsB ? s.a : s.b;
const topAxis = topIsB ? s.axis : [-s.axis[0], -s.axis[1], -s.axis[2]];

const haftR = r.hand * 0.34;            // haft radius — fits the closed fists
const topExt = r.head * 1.6;            // haft runs well past the top hand
const botExt = r.head * 0.5;            // a short stub past the bottom hand
const haftTop = [
  topPt[0] + topAxis[0] * topExt,
  topPt[1] + topAxis[1] * topExt,
  topPt[2] + topAxis[2] * topExt,
];
const haftBot = [
  botPt[0] - topAxis[0] * botExt,
  botPt[1] - topAxis[1] * botExt,
  botPt[2] - topAxis[2] * botExt,
];
const haft = sdf.capsule(haftBot, haftTop, haftR);

// AXE HEAD — a broad wedge blade near the top of the haft. Built as a flat box
// tapered to a cutting edge, set out to the front (−Y) of the haft. Place it a
// little below the top tip, centred on the haft axis, flaring forward.
const headAt = [
  topPt[0] + topAxis[0] * (topExt * 0.78),
  topPt[1] + topAxis[1] * (topExt * 0.78),
  topPt[2] + topAxis[2] * (topExt * 0.78),
];
const bladeW = r.head * 1.5;            // blade span along the haft
const bladeDepth = r.head * 1.55;       // how far the blade reaches out front
const bladeThick = r.head * 0.5;        // thickness, tapered to an edge
// A wedge: a box tapered toward the cutting edge (front, −Y) so it reads as a
// blade rather than a slab.
const blade = sdf.box([bladeW, bladeDepth, bladeThick])
  .taper(-0.72, 'y')                    // narrow the far (front) edge → cutting edge
  .rotate([0, 0, 0])
  .translate([headAt[0], headAt[1] - bladeDepth * 0.45, headAt[2]]);
// A rounded poll/back-knob behind the haft so the head reads two-sided.
const poll = sdf.sphere(bladeThick * 0.62).translate([headAt[0], headAt[1] + r.head * 0.3, headAt[2]]);

const axe = haft
  .smoothUnion(blade, haftR * 0.9)
  .smoothUnion(poll, haftR * 0.7)
  .label('axe');

// 10. Union all labelled regions and build. The haft passes through the closed
//     fists (grip cups inside the fists) so the axe welds to the figure → one
//     component.
// faceDetail is coarsened slightly (head*0.075 vs the default ~head*0.03) to keep
// the whole figure under the catalog triangle budget while the global 0.5 grid
// holds the beard/axe welds as ONE component (a coarser global grid breaks them).
return sdf.union(skin, beard, eyes, lips, tunic, pants, boots, hair, axe, base)
  .build({
    edgeLength: 0.5,
    detail: [...F.faceDetail(rig, { edgeLength: rig.r.head * 0.075 }), ...F.handDetail(rig)],
  });
