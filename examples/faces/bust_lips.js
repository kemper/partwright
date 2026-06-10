// FACE LAB — sculpted painted lips (additive ridge) + SOLID single-color eyes.
// mouth: false in assemble — the labelled ridge from mouthAccents IS the mouth
// (a welded copy would swallow the labelled one).
// Quick review:  npm run model:preview -- examples/faces/bust_lips.js --view 270,-2
const { sdf } = api;
const F = sdf.figure;

const rig = F.rig({ height: 60, headsTall: 5 });
const head = F.head(rig);

const mouthOpts = { style: 'lips', smirk: -0.15, width: rig.r.head * 0.45 };
const face = F.face.assemble(head, rig, {
  eyes: false,
  mouth: false,
  brows: {},
});

const cutZ = rig.joints.chest[2] - rig.r.chestY;
const body = F.weld(rig, [face, F.neck(rig), F.torso(rig)])
  .subtract(sdf.box([200, 200, 200]).translate([0, 0, cutZ - 100]))
  .label('skin');

// Solid bead eyes — the one-color option.
const eyes = F.face.eyes(rig, { style: 'solid' }).label('eyes');
const lips = F.face.mouthAccents(rig, mouthOpts);

api.paint.label('skin', '#dba882');
api.paint.label('eyes', '#262626');
api.paint.label('lips', '#a8344a');

return sdf.union(body, eyes, lips)
  .build({ edgeLength: 0.5, detail: F.faceDetail(rig) });
