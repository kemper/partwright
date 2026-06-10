// FACE LAB — carved smile + iris eyes + arched brows.
// Quick review:  npm run model:preview -- examples/faces/bust_smile.js --view 270,-2
const { sdf } = api;
const F = sdf.figure;

const rig = F.rig({ height: 60, headsTall: 5 });
const head = F.head(rig);

const mouthOpts = { style: 'smile', smirk: 0.25, width: rig.r.head * 0.55 };
const face = F.face.assemble(head, rig, {
  eyes: false,
  mouth: mouthOpts,
  brows: {},
});

// Bust: face + neck + chest, cut flat below the chest.
const cutZ = rig.joints.chest[2] - rig.r.chestY;
const body = F.weld(rig, [face, F.neck(rig), F.torso(rig)])
  .subtract(sdf.box([200, 200, 200]).translate([0, 0, cutZ - 100]))
  .label('skin');

// Iris-style eyes (default): white eyeball + iris + pupil, each paintable.
const eyes = F.face.eyes(rig);

api.paint.label('skin', '#f2c7a8');
api.paint.label('eyes', '#f6f4ef');
api.paint.label('iris', '#4a7da8');
api.paint.label('pupil', '#1c1c1c');

return sdf.union(body, eyes)
  .build({ edgeLength: 0.5, detail: [F.faceDetail(rig)] });
