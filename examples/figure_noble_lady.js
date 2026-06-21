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

// Clothed surface (skin + gown) for conforming the choker.
const clothed = sdf.union(skin, gown);

// 5. NECKLACE (Ringed) conformed to the neck + a short pendant (Hung) sitting
// proud on the upper chest (offset forward so it doesn't embed the gown).
const neckFrame = rig.ring.neck;
const neckTube = r.neck * 0.10;
const necklace = F.ring(neckFrame, { tube: neckTube, drop: r.neck * 0.15, segments: 56, surface: clothed });
const frontNeck = F.ringPoint(neckFrame, 0, { drop: r.neck * 0.15, surface: clothed });
const proud = [0, -neckTube * 1.2, 0];   // push the pendant proud of the gown front
const chainTop = add(frontNeck, proud);
const gemPt = [chainTop[0], chainTop[1] - neckTube * 0.6, chainTop[2] - r.neck * 0.7];
const dropChain = sdf.capsule(chainTop, gemPt, neckTube * 0.45);
const gem = sdf.ellipsoid(neckTube * 2.4, neckTube * 1.3, neckTube * 3.2).translate(gemPt);
const jewelry = necklace.union(dropChain).union(gem).label('jewelry');
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }

// 6. HAIR + BASE
const hair = F.hair(rig, { style: 'long', length: 'long', volume: 1.1 }).label('hair');
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
