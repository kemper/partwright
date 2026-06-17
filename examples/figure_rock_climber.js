// Rock Climber — an athletic woman mid-climb: both arms reaching up for holds,
// body coiled in a stepped climbing crouch, gaze up to the next move. Showcases
// asymmetric four-limb posing off the figure rig — both arms overhead (twist
// rotates the open hands up toward the holds), one leg high and deeply bent on a
// foothold while the other is more extended below, a slight forward spine lean.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — lean, toned woman. Both arms reach UP (twist ~90 rotates the
//    overhead curl so the open hands face the holds, not forward); legs in a
//    stepped crouch (right high + deeply bent on a hold, left lower + extended);
//    a small forward lean into the wall, head pitched up to spot the next grip.
const rig = F.rig({
  height: 52,
  headsTall: 7.5,
  sex: 'female',
  build: 'average',
  muscle: 0.5,
  weight: 0.3,
  pose: {
    // Right arm reaching high for a hold, nearly straight, slight bend.
    armR: { raiseSide: 150, raiseFwd: 6, bend: 18, twist: 90 },
    // Left arm up-and-out, more bent — a steadying grip.
    armL: { raiseSide: 120, raiseFwd: 8, bend: 30, twist: 80 },
    // Right leg high, knee deeply flexed onto a foothold.
    legR: { raiseSide: 30, raiseFwd: 25, bend: 80 },
    // Left leg lower, more extended — pushing/weighting below.
    legL: { raiseSide: 12, bend: 25 },
    // A little forward into the wall.
    spine: { lean: 6 },
    // Looking up to the next hold.
    head: { pitch: -22 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — square jaw, alert focused look, straight nose, eyes up.
const mouthOpts = { style: 'lips', lipShape: 'natural', expression: 'slightSmile', width: r.head * 0.42 };
const head = F.head(rig, { faceShape: 'square', jaw: 1.1, cheek: 1.05 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'straight', tipRadius: r.head * 0.09, length: r.head * 0.2 },
  mouth: false,
  ears: { size: r.head * 0.22 },
});

// Painted lips (additive — clean on a tall head) + paintable eyes looking up.
const lips = F.face.mouthAccents(rig, mouthOpts);
// Looking up to the next hold — a MODEST up-gaze so the pupil disc clears the
// upper lid margin (a full 'up' preset tucks the pupil behind the lid and it
// aliases to 0 triangles). Slightly lighter upper lid for the same reason.
const eyes = F.face.eyes(rig, { radius: r.head * 0.16, lids: { upper: 0.22, lower: 0.06 }, gaze: { yaw: 0, pitch: 12 } });

// 3. SKIN — weld every body mass; open hands gripping the holds.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. ATHLETIC TANK — sleeveless top.
const top = F.clothing.top(rig, { sleeve: 'none' }).label('top');

// 5. SHORTS — climbing shorts (briefs length so the quads stay visible).
const shorts = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  length: 'briefs',
}).label('shorts');

// 6. HAIR — box braids pulled back; coarse edgeLength so the strands don't break.
const hair = F.hair(rig, { style: 'boxBraids', length: 'mid' }).label('hair');

// 7. CLIMBING SHOES — keyed off the sole frame, flat under the feet.
const shoes = F.clothing.shoes(rig, { label: 'shoes' });

// 8. BASE — a display disc; rises to meet the lower (left) foot.
const base = F.base(rig, { radius: rig.opts.height * 0.26 }).label('base');

// 9. Hard-union the labelled regions and build. faceDetail meshes the head
//    finely; handDetail resolves the open fingers; the box braids want a
//    fine-enough grid (0.45) so the thin strands survive.
return sdf.union(skin, eyes, lips, top, shorts, hair, shoes, base)
  .build({
    edgeLength: 0.45,
    detail: [
      ...F.faceDetail(rig, { edgeLength: rig.r.head * 0.02, eyeEdgeLength: rig.r.head * 0.004, irisEdgeLength: rig.r.head * 0.002 }),
      ...F.handDetail(rig),
    ],
  });
