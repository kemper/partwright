// FACE LAB — natural two-lip mouth via `lipShape: 'natural'`: a refined
// cupid's-bow upper + fuller lower + parting groove, instead of a single flat
// line. Additive + painted, so it prints clean. `expression` / `curve` bows the
// lips (here a gentle smile); `fullness` sets lip thickness. Pass `mouth: false`
// to assemble so the labelled lips from mouthAccents ARE the mouth (a welded
// copy would swallow the label).
// Quick review:  npm run model:preview -- examples/faces/bust_natural_lips.js --view 270,-2
const { sdf } = api;
const F = sdf.figure;

const rig = F.rig({ height: 60, headsTall: 5 });
const head = F.head(rig);

const mouthOpts = { style: 'lips', lipShape: 'natural', fullness: 1.1, expression: 'slightSmile' };
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
