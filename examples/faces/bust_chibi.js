// FACE LAB — chibi proportions (3 heads tall): big iris eyes + tiny smile.
// Verifies the face features scale with the head.
// Quick review:  npm run model:preview -- examples/faces/bust_chibi.js --view 270,-2
const { sdf } = api;
const F = sdf.figure;

const rig = F.rig({ height: 60, headsTall: 3 });
const head = F.head(rig);

const mouthOpts = { style: 'smile', smirk: 0, width: rig.r.head * 0.35 };
const face = F.face.assemble(head, rig, {
  eyes: false,
  mouth: mouthOpts,
  nose: { tipRadius: rig.r.head * 0.07 },
  brows: false,
});

const cutZ = rig.joints.chest[2] - rig.r.chestY;
const body = F.weld(rig, [face, F.neck(rig), F.torso(rig)])
  .subtract(sdf.box([200, 200, 200]).translate([0, 0, cutZ - 100]))
  .label('skin');

const eyes = F.face.eyes(rig, { radius: rig.r.head * 0.2 });

api.paint.label('skin', '#f5ccad');
api.paint.label('eyes', '#fbfaf5');
api.paint.label('iris', '#3a7d44');
api.paint.label('pupil', '#181818');

return sdf.union(body, eyes)
  .build({ edgeLength: 0.5, detail: [F.faceDetail(rig)] });
