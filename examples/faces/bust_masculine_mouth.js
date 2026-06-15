// FACE LAB — masculine mouth via the `lipShape: 'flat'` preset: a wide, thin,
// near-flat upper lip with a muted near-skin tone, defined by a parting-groove
// shadow rather than a bright lip. Pair with `expression: 'slightFrown'` for a
// stern, serious set. Additive + painted, so it prints support-free. Pass
// `mouth: false` to assemble so the labelled lips from mouthAccents ARE the mouth.
// Quick review:  npm run model:preview -- examples/faces/bust_masculine_mouth.js --view 270,-2
const { sdf } = api;
const F = sdf.figure;

const rig = F.rig({ height: 60, headsTall: 5, sex: 'male', build: 'stocky' });
const head = F.head(rig, { faceShape: 'square', jaw: 1.25, chin: 1.15 });

const mouthOpts = { style: 'lips', lipShape: 'flat', expression: 'slightFrown' };
const face = F.face.assemble(head, rig, { eyes: false, mouth: false, brows: {} });

const cutZ = rig.joints.chest[2] - rig.r.chestY;
const body = F.weld(rig, [face, F.neck(rig), F.torso(rig)])
  .subtract(sdf.box([200, 200, 200]).translate([0, 0, cutZ - 100]))
  .label('skin');

const eyes = F.face.eyes(rig);
const lips = F.face.mouthAccents(rig, mouthOpts);  // labelled 'lips'

api.paint.label('skin', '#d8a071');
api.paint.label('eyes', '#f6f4ef');
api.paint.label('iris', '#3d3020');
api.paint.label('pupil', '#1c1c1c');
api.paint.label('lips', '#a86f5a');  // muted near-skin brown — shape, not lipstick

return sdf.union(body, eyes, lips)
  .build({ edgeLength: 0.5, detail: F.faceDetail(rig) });
