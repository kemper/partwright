// Cheerleader Jump — a peppy cheerleader in a mid-air star/toe-touch jump:
// both arms up in a high V holding pom-poms, legs spread, a big open toothy
// smile, gaze forward. Airborne, but the jump is kept moderate so one foot can
// connect to the auto-rising base (one printable component).
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — slim peppy young woman, mid-jump.
//    Arms up in a high V: raiseSide 150 lifts them up-and-out, twist 90 rolls
//    the elbow-curl plane so the fists go UP by the head (the V of a cheer).
//    Legs spread mid-jump: raiseSide 30 splays them, a slight bend for energy.
//    The right leg stays a touch straighter/lower so its foot can reach the base.
const rig = F.rig({
  height: 52,
  headsTall: 7.5,
  sex: 'female',
  build: 'slim',
  muscle: 0.35,
  weight: 0.3,
  pose: {
    // High-V arms: up and out, fists by the head.
    arms: { raiseSide: 150, raiseFwd: 4, bend: 30, twist: 90 },
    // Spread legs mid-jump. Left splays wider/higher; right hangs a touch lower
    // and straighter so its foot can land on the base (keeps one component).
    legL: { raiseSide: 32, raiseFwd: 4, bend: 14 },
    legR: { raiseSide: 26, raiseFwd: -4, bend: 8 },
    // Head up slightly, gaze forward — peppy.
    head: { pitch: -6 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — heart face, button nose, big OPEN toothy smile.
//    mouth:false on assemble — the painted open mouth (teeth + lips) is built at
//    the top level via mouthAccents so the skin weld doesn't bury the labels.
const mouthOpts = {
  style: 'open',
  open: 0.55,
  expression: 'bigSmile',
  render: 'painted',
  teeth: 'both',
  width: r.head * 0.62,
};
const head = F.head(rig, { faceShape: 'heart' });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'button' },
  mouth: false,
  ears: true,
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.16, lids: 'upper', gaze: 'middle' });
const mouthParts = F.face.mouthAccents(rig, mouthOpts);   // 'teeth' + 'lips'

// 3. SKIN — fists (to grip the pom-poms).
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. POM-POMS — a fluffy ball at each fist, smoothUnion-welded to the hand so
//    the whole figure stays one component. Built at the grip cup, not the hand
//    centre, so it sits in the closed fingers. Both share the 'pompom' label.
const pomR = r.hand * 2.2;
const pomL = sdf.sphere(pomR).translate(rig.grip.L.point);
const pomR_ = sdf.sphere(pomR).translate(rig.grip.R.point);
// Weld each pom onto the welded skin would melt the label, so instead weld the
// poms to each other and give the pair one label, then smoothUnion onto skin
// via the top-level union below (the spheres overlap the fists by ~pomR, so the
// hard union keeps it one component).
const pompoms = sdf.union(pomL, pomR_).label('pompom');

// 5. CHEER TOP — sleeveless, cropped at the midriff.
const top = F.clothing.top(rig, {
  sleeve: 'none',
  hemZ: j.chest[2] - r.chestY * 0.5,
  thickness: r.chestY * 0.2,
}).label('top');

// 6. PLEATED SKIRT — briefs (so the pelvis is dressed) unioned with a short
//    flared cone at the waist. Anchored at rig.joints.spine, sized off r.waist.
const briefs = F.clothing.pants(rig, {
  rise: 'high',
  length: 'briefs',
  thickness: r.upperLeg * 0.2,
});
//    A solid short A-line skirt: a tapered cylinder with a ROUNDED bottom rim
//    (roundedCylinder) so the flared hem is a clean thick edge, not a thin
//    knife-edge that tears into a jagged, high-genus rim.
const waistZ = j.spine[2];
const skirtH = r.waist * 1.6;
const skirtCone = sdf.roundedCylinder(r.waist * 2.0, skirtH, skirtH * 0.42)
  .taper(0.42, 'z')
  .translate([0, 0, waistZ - r.waist * 0.55]);
const skirt = briefs.union(skirtCone).label('skirt');

// 7. HAIR — a high ponytail with bounce.
const hair = F.hair(rig, { style: 'ponytail', hairline: 'mid', length: 'long' }).label('hair');

// 8. SHOES — cheer sneakers (own 'shoes' + 'sole' regions).
const shoes = F.clothing.shoes(rig, { label: 'shoes' });

// 9. BASE — auto-rises to meet the lowest (right) foot.
const base = F.base(rig, { radius: rig.opts.height * 0.3 }).label('base');

// 10. Hard-union all labelled regions and build.
return sdf.union(skin, eyes, mouthParts, pompoms, top, skirt, hair, shoes, base)
  .build({
    edgeLength: 0.54,
    detail: [
      ...F.faceDetail(rig, { edgeLength: rig.r.head * 0.02 }),
      ...F.handDetail(rig),
    ],
  });
