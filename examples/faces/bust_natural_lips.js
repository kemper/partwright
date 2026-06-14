// FACE LAB — natural two-lip mouth: a distinct UPPER and LOWER lip (the
// `divided` lip style) instead of a single flat line. Additive + painted, so it
// prints clean. `expression` / `curve` bows the lips (here a gentle smile);
// `fullness` sets lip thickness. Pass `mouth: false` to assemble so the labelled
// ridge from mouthAccents IS the mouth (a welded copy would swallow the label).
// Quick review:  npm run model:preview -- examples/faces/bust_natural_lips.js --view 270,-2
const { sdf } = api;
const F = sdf.figure;

const rig = F.rig({ height: 60, headsTall: 5 });
const head = F.head(rig);

const mouthOpts = { style: 'lips', divided: true, fullness: 1.4, expression: 'slightSmile', width: rig.r.head * 0.5 };
const face = F.face.assemble(head, rig, { eyes: false, mouth: false, brows: {} });

const cutZ = rig.joints.chest[2] - rig.r.chestY;
const body = F.weld(rig, [face, F.neck(rig), F.torso(rig)])
  .subtract(sdf.box([200, 200, 200]).translate([0, 0, cutZ - 100]))
  .label('skin');

const eyes = F.face.eyes(rig);
const lips = F.face.mouthAccents(rig, mouthOpts);  // upper + lower lip, labelled 'lips'

api.paint.label('skin', '#dba882');
api.paint.label('eyes', '#f6f4ef');
api.paint.label('iris', '#4a3826');
api.paint.label('pupil', '#1c1c1c');
api.paint.label('lips', '#b8506a');

return sdf.union(body, eyes, lips)
  .build({ edgeLength: 0.5, detail: F.faceDetail(rig) });
