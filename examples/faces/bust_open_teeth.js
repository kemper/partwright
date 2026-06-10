// FACE LAB — open laughing mouth with teeth band + lip ring, iris eyes.
// Quick review:  npm run model:preview -- examples/faces/bust_open_teeth.js --view 270,-2
const { sdf } = api;
const F = sdf.figure;

const rig = F.rig({ height: 60, headsTall: 5 });
const head = F.head(rig);

const mouthOpts = { style: 'open', open: 0.65, width: rig.r.head * 0.6 };
const face = F.face.assemble(head, rig, {
  eyes: false,
  mouth: mouthOpts,
  brows: {},
});

const cutZ = rig.joints.chest[2] - rig.r.chestY;
const body = F.weld(rig, [face, F.neck(rig), F.torso(rig)])
  .subtract(sdf.box([200, 200, 200]).translate([0, 0, cutZ - 100]))
  .label('skin');

const eyes = F.face.eyes(rig);
// Teeth + lip ring share the SAME mouth options as the carve above.
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

api.paint.label('skin', '#f2c7a8');
api.paint.label('eyes', '#f6f4ef');
api.paint.label('iris', '#5a4632');
api.paint.label('pupil', '#1c1c1c');
api.paint.label('teeth', '#fbfaf5');
api.paint.label('lips', '#c4574e');

return sdf.union(body, eyes, mouthParts)
  .build({ edgeLength: 0.5, detail: [F.faceDetail(rig)] });
