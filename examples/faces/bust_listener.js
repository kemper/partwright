// BUST — attentive adult, DETAILED ears (helix + concha + tragus + lobe) left
// exposed by short hair worn behind them. Full face: iris eyes, nose, smile,
// brows. Review: npm run model:preview -- examples/faces/bust_listener.js --view 320,4
const { sdf } = api;
const F = sdf.figure;

const rig = F.rig({ height: 60, headsTall: 5, sex: 'male' });
const head = F.head(rig, { faceShape: 'square', jaw: 1.05 });

const mouthOpts = { style: 'smile', smirk: 0.2, width: rig.r.head * 0.5 };
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: rig.r.head * 0.11, width: 1.1 },
  mouth: mouthOpts,
  ears: { type: 'detailed' },
  brows: { thickness: 1.2 },
});

const cutZ = rig.joints.chest[2] - rig.r.chestY;
const body = F.weld(rig, [face, F.neck(rig), F.torso(rig)])
  .subtract(sdf.box([200, 200, 200]).translate([0, 0, cutZ - 100]))
  .label('skin');

const eyes = F.face.eyes(rig, { lids: 'upper' });
const hair = F.hair(rig, { style: 'short', length: 'short', ears: 'behind', part: 'left' }).label('hair');

api.paint.label('skin', '#9c6b43');
api.paint.label('eyes', '#f6f4ef');
api.paint.label('iris', '#3a2c20');
api.paint.label('pupil', '#1c1c1c');
api.paint.label('lids', '#9c6b43');
api.paint.label('hair', '#241c16');

return sdf.union(body, eyes, hair)
  .build({ edgeLength: 0.45, detail: F.faceDetail(rig) });
