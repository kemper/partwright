// FACE LAB — a big painted SMILE showing teeth, print-safe (no carved cavity,
// so no support material lands inside the mouth). The toothy grin is built from
// paintable accents: a red lip ring bowed into a smile + a white teeth plate
// sitting flush in the opening. Pass `mouth: false` to assemble so the skin
// doesn't ALSO weld a lip ring that would bury the painted parts.
// Quick review:  npm run model:preview -- examples/faces/bust_grin_teeth.js --view 270,-2
const { sdf } = api;
const F = sdf.figure;

const rig = F.rig({ height: 60, headsTall: 5 });
const head = F.head(rig);

// `expression` picks the level (bigSmile … deepFrown); `render: 'painted'`
// keeps it a flat print-safe mouth; `teeth: 'both'` shows upper + lower teeth.
const mouthOpts = { style: 'open', open: 0.5, width: rig.r.head * 0.62, expression: 'bigSmile', render: 'painted', teeth: 'both' };
const face = F.face.assemble(head, rig, { eyes: false, mouth: false });

const cutZ = rig.joints.chest[2] - rig.r.chestY;
const body = F.weld(rig, [face, F.neck(rig), F.torso(rig)])
  .subtract(sdf.box([200, 200, 200]).translate([0, 0, cutZ - 100]))
  .label('skin');

const eyes = F.face.eyes(rig);
const mouthParts = F.face.mouthAccents(rig, mouthOpts);  // 'teeth' + 'lips'

api.paint.label('skin', '#e8b48f');
api.paint.label('eyes', '#f6f4ef');
api.paint.label('iris', '#5a4632');
api.paint.label('pupil', '#1c1c1c');
api.paint.label('teeth', '#fbfaf5');
api.paint.label('lips', '#c4574e');

return sdf.union(body, eyes, mouthParts)
  .build({ edgeLength: 0.5, detail: F.faceDetail(rig) });
