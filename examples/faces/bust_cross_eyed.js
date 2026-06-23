// FACE LAB — goofy CROSS-EYED bust: per-eye gaze (gazeL/gazeR) aims each eye
// toward the nose, with a big grin and raised brows. Showcases independent
// per-eyeball orientation.
// Quick review:  npm run model:preview -- examples/faces/bust_cross_eyed.js --view 270,-2
const { sdf } = api;
const F = sdf.figure;

const rig = F.rig({ height: 60, headsTall: 5 });
const head = F.head(rig);

const face = F.face.assemble(head, rig, {
  eyes: false,
  mouth: { style: 'smile', smirk: 0.45, width: rig.r.head * 0.58 },
  brows: { lift: 1.8, thickness: 1.1 },   // high comedic arch
});

// Bust: face + neck + chest, cut flat below the chest.
const cutZ = rig.joints.chest[2] - rig.r.chestY;
const body = F.weld(rig, [face, F.neck(rig), F.torso(rig)])
  .subtract(sdf.box([200, 200, 200]).translate([0, 0, cutZ - 100]))
  .label('skin');

// Per-eye gaze: the figure's LEFT eye looks right, its RIGHT eye looks left —
// both converge on the nose for a cross-eyed look. Upper lids keep the eyes
// wide and alert.
const eyes = F.face.eyes(rig, { lids: 'upper', gazeL: 'right', gazeR: 'left' });

api.paint.label('skin', '#f4c9a3');
api.paint.label('lids', '#f4c9a3');
api.paint.label('eyes', '#f8f6f1');
api.paint.label('iris', '#6a8f4a');
api.paint.label('pupil', '#1c1c1c');

return sdf.union(body, eyes)
  .build({ edgeLength: 0.5, detail: F.faceDetail(rig) });
