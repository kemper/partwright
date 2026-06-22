// Noble Lady — showcase of the figure ACCESSORY ATTACHMENT system:
//   • Marked   → makeup WITHOUT mesh-painting: the existing `lips` label as
//                lipstick, the `lids` label as eyeshadow, and proud CONFORMAL
//                blush patches (offset-skin ∩ a cheek cylinder) coloured by label
//   • Ringed   → a choker conformed to the neck (F.ring with `surface`)
//   • Hung     → a short pendant resting proud on the upper chest (F.hangFrom)
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

// 2. HEAD + FACE — mouth built separately (mouthAccents) so 'lips' is its own
// paintable label for lipstick.
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: false, mouth: false, nose: { tipRadius: r.head * 0.08 }, ears: {}, brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.14, lids: 'almond' });
const lips = F.face.mouthAccents(rig, { style: 'lips', lipShape: 'full', width: r.head * 0.34 });
const skin = F.weld(rig, [F.torso(rig), F.neck(rig), F.arms(rig), F.hands(rig), F.legs(rig), F.feet(rig), face]).label('skin');

// 3. MAKEUP (Marked) — no mesh paint. Blush = a thin CONFORMAL patch: the skin
// offset slightly proud, intersected with a forward (−Y) cylinder at the cheek,
// so it owns its own triangles and hugs the cheek. Coloured by its label.
const eyeL = rig.face.eyeL, eyeR = rig.face.eyeR;
const cheekZ = eyeL[2] * 0.45 + rig.face.mouth[2] * 0.55;
const cheekPatch = (cx) => skin.round(r.head * 0.045)
  .intersect(sdf.cylinder(r.head * 0.17, r.headZ * 3).rotate([90, 0, 0]).translate([cx, 0, cheekZ]));
const blush = cheekPatch(eyeL[0] * 0.92).union(cheekPatch(eyeR[0] * 0.92)).label('blush');

// 4. GOWN — a fitted dress.
const gown = F.clothing.top(rig, { sleeve: 'short', hemZ: H * 0.30, thickness: r.chestX * 0.08 }).label('gown');

// Clothed surface (skin + gown) for conforming the necklace; hair built first so
// it can OCCLUDE the necklace (drape over it).
const clothed = sdf.union(skin, gown);
const hair = F.hair(rig, { style: 'long', length: 'long', volume: 1.1 }).label('hair');

// 5. NECKLACE (Ringed) — a chain that DRAPES down the chest (conformed flush to
// the body, dipping at the front) and is OCCLUDED by the hair that falls over it,
// + a pendant at the low point.
const neckFrame = rig.ring.neck;
const neckTube = r.neck * 0.085;
const drape = r.neck * 1.7;
const chain = F.ring(neckFrame, { tube: neckTube, drape, segments: 72, surface: clothed, occlude: [hair] });
// Pendant at the draped loop's lowest front point (front = −Y), pushed proud.
const frontPt = F.ringPoint(neckFrame, 0, { surface: clothed });
const lowPt = [frontPt[0], frontPt[1] - neckTube, frontPt[2] - drape];
const gem = sdf.ellipsoid(neckTube * 2.6, neckTube * 1.4, neckTube * 3.4).translate([lowPt[0], lowPt[1], lowPt[2] - neckTube * 1.5]);
const jewelry = chain.union(gem).subtract(hair).label('jewelry');

// 6. BASE
const base = F.base(rig, { radius: H * 0.24 }).label('base');

// 7. COLOR (label-only — no coordinate mesh painting)
api.paint.label('skin', '#e8c4a0');
api.paint.label('eyes', '#f6f4ef');
api.paint.label('iris', '#5b3a21');
api.paint.label('pupil', '#161616');
api.paint.label('lids', '#9c7790');   // eyeshadow (the eyelid geometry)
api.paint.label('lips', '#b5384a');   // lipstick (the mouth's own label)
api.paint.label('blush', '#e58a9a');  // conformal cheek patches
api.paint.label('hair', '#2a1d14');
api.paint.label('gown', '#7a2f52');
api.paint.label('jewelry', '#d9b24a');
api.paint.label('base', '#54504a');

return sdf.union(skin, eyes, lips, blush, gown, jewelry, hair, base)
  .build({ edgeLength: 0.32, detail: [...F.faceDetail(rig)] });
