// BUST — wood-elf, POINTED ears left exposed by long hair worn behind them.
// Full face: almond iris eyes, a fine nose, calm lips, arched brows.
// Review: npm run model:preview -- examples/faces/bust_elf.js --view 320,4
const { sdf } = api;
const F = sdf.figure;

const rig = F.rig({ height: 60, headsTall: 5, build: 'slim' });
const head = F.head(rig, { faceShape: 'heart', chin: 1.05 });

const mouthOpts = { style: 'lips', fullness: 0.85, width: rig.r.head * 0.4 };
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: rig.r.head * 0.09, width: 0.85 },
  mouth: mouthOpts,
  ears: { type: 'pointed', tilt: 22 },
  brows: { lift: 0.7 },
});

// Bust: face + neck + chest, cut flat below the chest.
const cutZ = rig.joints.chest[2] - rig.r.chestY;
const body = F.weld(rig, [face, F.neck(rig), F.torso(rig)])
  .subtract(sdf.box([200, 200, 200]).translate([0, 0, cutZ - 100]))
  .label('skin');

const eyes = F.face.eyes(rig, { lids: 'almond', gaze: 'left' });
// Long hair worn BEHIND the ears so the points read; falls to the cut line.
const hair = F.hair(rig, { style: 'long', length: 'mid', ears: 'behind', part: 'center' }).label('hair');

api.paint.label('skin', '#e8b48c');
api.paint.label('eyes', '#f6f4ef');
api.paint.label('iris', '#4a7c59');
api.paint.label('pupil', '#1c1c1c');
api.paint.label('lids', '#e8b48c');
api.paint.label('lips', '#c77a63');
api.paint.label('hair', '#caa24b');

return sdf.union(body, eyes, hair)
  .build({ edgeLength: 0.45, detail: F.faceDetail(rig) });
