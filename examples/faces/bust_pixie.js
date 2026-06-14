// BUST — bright youth, ROUND ears (clean cup) left exposed by a cropped pixie
// worn behind them. Full face: big iris eyes, button nose, grin, brows.
// Review: npm run model:preview -- examples/faces/bust_pixie.js --view 320,4
const { sdf } = api;
const F = sdf.figure;

const rig = F.rig({ height: 56, headsTall: 4.5, age: 14 });
const head = F.head(rig, { faceShape: 'round', cheek: 1.1 });

const mouthOpts = { style: 'smile', smirk: 0.5, width: rig.r.head * 0.52 };
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: rig.r.head * 0.1, width: 1.0 },
  mouth: mouthOpts,
  ears: { type: 'round' },
  brows: { lift: 0.8 },
});

const cutZ = rig.joints.chest[2] - rig.r.chestY;
const body = F.weld(rig, [face, F.neck(rig), F.torso(rig)])
  .subtract(sdf.box([200, 200, 200]).translate([0, 0, cutZ - 100]))
  .label('skin');

const eyes = F.face.eyes(rig, { radius: rig.r.head * 0.17, lids: 'upper', gaze: 'left' });
const hair = F.hair(rig, { style: 'short', length: 'short', ears: 'behind', part: 'right' }).label('hair');

api.paint.label('skin', '#d99a66');
api.paint.label('eyes', '#f6f4ef');
api.paint.label('iris', '#5a3b28');
api.paint.label('pupil', '#1c1c1c');
api.paint.label('lids', '#d99a66');
api.paint.label('hair', '#2b211a');

return sdf.union(body, eyes, hair)
  .build({ edgeLength: 0.42, detail: F.faceDetail(rig) });
