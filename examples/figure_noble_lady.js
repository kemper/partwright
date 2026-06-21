// Noble Lady — a showcase of the figure ACCESSORY ATTACHMENT system:
//   • Marked   → makeup (blush + lipstick + eyeshadow) via in-code api.paint
//   • Ringed   → a necklace around the neck (F.ring on rig.ring.neck) + pendant
//   • Hung     → the pendant dangling from the necklace (F.hangFrom)
// Front = −Y, Z up, figure-left = +X, figure-right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — poised adult woman, fitted gown.
const rig = F.rig({
  height: 66, headsTall: 7, build: 'slim', sex: 'female', bust: 0.4,
  pose: {
    armL: { raiseSide: 10, bend: 10 }, armR: { raiseSide: 10, bend: 10 },
    legL: { raiseSide: 5 }, legR: { raiseSide: 6 }, head: { pitch: -1 },
    spine: { side: 2 },
  },
});
const j = rig.joints, r = rig.r, H = rig.opts.height;

// 2. HEAD + FACE
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: false, nose: { tipRadius: r.head * 0.08 },
  mouth: { style: 'lips', lipShape: 'full', width: r.head * 0.34 }, ears: {}, brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.14, lids: 'almond' });
const skin = F.weld(rig, [F.torso(rig), F.neck(rig), F.arms(rig), F.hands(rig), F.legs(rig), F.feet(rig), face]).label('skin');

// 3. GOWN — a fitted dress (thin shell, so a sash reads on top of it).
const gown = F.clothing.top(rig, { sleeve: 'short', hemZ: H * 0.30, thickness: r.chestX * 0.08 }).label('gown');

// 4. NECKLACE (Ringed) + PENDANT (Hung) at the neck base.
const neckFrame = rig.ring.neck;
const neckTube = r.neck * 0.10;
const necklace = F.ring(neckFrame, { tube: neckTube, clearance: r.chestX * 0.05, drop: r.neck * 0.2, segments: 48 });
const frontNeck = F.ringPoint(neckFrame, 0, { clearance: r.chestX * 0.05, drop: r.neck * 0.2 });
// A teardrop pendant on a drop chain, hanging onto the upper chest where it reads.
const dropChain = sdf.capsule(frontNeck, [frontNeck[0], frontNeck[1], frontNeck[2] - r.neck * 1.4], neckTube * 0.5);
const pendantGem = sdf.ellipsoid(neckTube * 2.6, neckTube * 1.4, neckTube * 3.4)
  .translate([frontNeck[0], frontNeck[1], frontNeck[2] - r.neck * 1.7]);
const jewelry = necklace.union(dropChain).union(pendantGem).label('jewelry');

// 5. HAIR + BASE
const hair = F.hair(rig, { style: 'long', length: 'long', volume: 1.1 }).label('hair');
const base = F.base(rig, { radius: H * 0.24 }).label('base');

// 7. COLOR — base labels
api.paint.label('skin', '#e8c4a0');
api.paint.label('eyes', '#f6f4ef');
api.paint.label('iris', '#5b3a21');
api.paint.label('pupil', '#161616');
api.paint.label('lids', '#e8c4a0');
api.paint.label('hair', '#2a1d14');
api.paint.label('gown', '#7a2f52');
api.paint.label('jewelry', '#d9b24a');   // gold
api.paint.label('base', '#54504a');

// 8. MAKEUP (Marked) — painted regions on the face surface (api.paint.box).
const eyeL = rig.face.eyeL, eyeR = rig.face.eyeR, mouth = rig.face.mouth;
const surY = eyeL[1];
// Blush — round-ish patch on each cheek apple.
// A deep slab through the cheek (front → into the head) so it can't miss the
// curved cheek surface, kept small in X/Z so it stays an apple-of-cheek patch.
const cheekZ = eyeL[2] * 0.40 + mouth[2] * 0.60, bW = r.headX * 0.16, bH = r.head * 0.14;
for (const cx of [eyeL[0] * 0.98, eyeR[0] * 0.98]) {
  api.paint.box({ min: [cx - bW, surY - r.headZ * 0.22, cheekZ - bH], max: [cx + bW, surY + r.headZ * 0.04, cheekZ + bH], color: '#e58a9a' });
}
// Lipstick.
api.paint.box({ min: [mouth[0] - r.head * 0.28, mouth[1] - r.headZ * 0.04, mouth[2] - r.head * 0.10], max: [mouth[0] + r.head * 0.28, mouth[1] + r.headZ * 0.35, mouth[2] + r.head * 0.10], color: '#b5384a' });
// Eyeshadow — mauve on each upper lid.
for (const ex of [eyeL[0], eyeR[0]]) {
  api.paint.box({ min: [ex - r.headX * 0.28, surY - r.headZ * 0.04, eyeL[2]], max: [ex + r.headX * 0.28, surY + r.headZ * 0.28, eyeL[2] + r.head * 0.20], color: '#8a6a86' });
}

return sdf.union(skin, eyes, gown, jewelry, hair, base)
  .build({ edgeLength: 0.34, detail: [...F.faceDetail(rig)] });
