// FACE LAB — dreamy STARGAZER bust: chin lifted and eyes cast UP with a soft
// look. Showcases a gaze preset ('up') layered on a head pose + almond lids.
// Quick review:  npm run model:preview -- examples/faces/bust_stargazer.js --view 270,-2
const { sdf } = api;
const F = sdf.figure;

// Chin tipped up (negative pitch); the gaze then lifts the irises further.
const rig = F.rig({ height: 60, headsTall: 5, pose: { head: { pitch: -10 } } });
const head = F.head(rig);

const face = F.face.assemble(head, rig, {
  eyes: false,
  mouth: { style: 'lips', width: rig.r.head * 0.34, smirk: 0.1 },
  brows: { lift: 0.8 },
});

// Bust: face + neck + chest, cut flat below the chest.
const cutZ = rig.joints.chest[2] - rig.r.chestY;
const body = F.weld(rig, [face, F.neck(rig), F.torso(rig)])
  .subtract(sdf.box([200, 200, 200]).translate([0, 0, cutZ - 100]))
  .label('skin');

// Both eyes look up; almond lids give the calm, dreamy set.
const eyes = F.face.eyes(rig, { lids: 'almond', gaze: 'up' });

api.paint.label('skin', '#caa07a');
api.paint.label('lids', '#caa07a');
api.paint.label('eyes', '#f6f4ef');
api.paint.label('iris', '#5b4632');
api.paint.label('pupil', '#1a1410');
api.paint.label('lips', '#b96f63');

return sdf.union(body, eyes)
  .build({ edgeLength: 0.5, detail: F.faceDetail(rig) });
