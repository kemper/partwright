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

// 5. NECKLACE (Ringed + jeweled + draping pendant) — a bigger, jeweled piece: a
// gold collar hugging the neck, a ROW of emerald cabochons set proud around the
// front, and a large faceted teardrop pendant (a central sapphire) dropping down
// the chest. The collar conforms to the NECK PART (clean column, can't spread to
// the shoulders); the pendant drop + gems ride the conformed chest front; the hair
// occludes the nape.
const vadd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vscale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const neckFrame = rig.ring.neck;
const neckTube = r.neck * 0.085;            // chunkier chain than before
const neckClear = r.neck * 0.04;
const collar = F.ring(neckFrame, { tube: neckTube, clearance: neckClear, segments: 64, surface: F.neck(rig), occlude: [hair] });

// Radial outward direction in the ring plane at azimuth `az` (matches ringPoint's
// convention: 0 = front/−Y, +90 = figure-left/+X), so a stone seats proud of the chain.
const radialDir = (az) => {
  const a = az * Math.PI / 180;
  return [
    Math.sin(a) * neckFrame.xAxis[0] - Math.cos(a) * neckFrame.yAxis[0],
    Math.sin(a) * neckFrame.xAxis[1] - Math.cos(a) * neckFrame.yAxis[1],
    Math.sin(a) * neckFrame.xAxis[2] - Math.cos(a) * neckFrame.yAxis[2],
  ];
};
// A row of cabochon gemstones set around the FRONT of the collar — the centre stone
// larger. Each is seated just proud of the gold chain (pushed out along the radial).
const gemR = r.neck * 0.17;
let collarGems = null;
for (const az of [-54, -36, -18, 0, 18, 36, 54]) {
  const p = F.ringPoint(neckFrame, az, { surface: F.neck(rig), clearance: neckClear });
  const s = az === 0 ? gemR * 1.4 : gemR;           // bigger centre stone
  const g = sdf.ellipsoid(s, s * 0.85, s * 1.1).translate(vadd(p, vscale(radialDir(az), s * 0.5)));
  collarGems = collarGems ? collarGems.union(g) : g;
}
collarGems = collarGems.subtract(hair).label('gem');

// Pendant drop: conformed points from the front of the collar down the chest.
const dropLen = r.neck * 2.8;
const N = 7;
const dropPts = [];
for (let i = 0; i <= N; i++) {
  dropPts.push(F.ringPoint(neckFrame, 0, { surface: clothed, drop: dropLen * (i / N), clearance: neckClear }));
}
let pendant = sdf.capsule(dropPts[0], dropPts[1], neckTube * 0.8);
for (let i = 1; i < N; i++) pendant = pendant.union(sdf.capsule(dropPts[i], dropPts[i + 1], neckTube * 0.8));
// Two emerald accent stones along the chain.
let dropGems = null;
for (const i of [3, 5]) {
  const ag = sdf.ellipsoid(neckTube * 1.3, neckTube * 1.1, neckTube * 1.6)
    .translate([dropPts[i][0], dropPts[i][1] - neckTube * 0.9, dropPts[i][2]]);
  dropGems = dropGems ? dropGems.union(ag) : ag;
}
dropGems = dropGems.label('gem');

// Large faceted teardrop pendant (a brilliant-cut sapphire): a domed crown over a
// pavilion that TAPERS TO A POINT below, so it reads as a CUT stone, not a pearl.
// Built around the origin (crown at z≈0, tip at z=−pavL), then seated at the drop
// end pushed proud of the chest (−Y).
const lowPt = dropPts[N];
const cw = r.neck * 0.52;            // crown half-width — a bold statement stone
const ct = r.neck * 0.38;            // crown depth (proud of the chest)
const pavL = r.neck * 1.35;          // pavilion length down to the point
const crown = sdf.ellipsoid(cw, ct, cw * 0.62);                                  // domed top
// Cone: full radius at z=0, tapering to a point at z=−pavL (translate first so the
// taper anchor at z=0 leaves the top full-width and the bottom a point).
const pavilion = sdf.cylinder(cw, pavL).translate([0, 0, -pavL / 2]).taper(1 / pavL, 'z');
const centerGem = crown.smoothUnion(pavilion, cw * 0.35)
  .translate([lowPt[0], lowPt[1] - ct * 0.85, lowPt[2] - cw * 0.45])
  .label('gemCenter');
// Gold bail capping the drop where it meets the stone.
const bail = sdf.cylinder(neckTube * 1.3, neckTube * 1.4).translate([lowPt[0], lowPt[1] - ct * 0.7, lowPt[2] + cw * 0.2]);

const jewelry = collar.union(pendant).union(bail).subtract(hair).label('jewelry');

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
api.paint.label('jewelry', '#d9b24a');   // gold collar / chain / settings
api.paint.label('gem', '#1f8a5a');       // emerald cabochons
api.paint.label('gemCenter', '#2456c8'); // sapphire teardrop pendant
api.paint.label('base', '#54504a');

return sdf.union(skin, eyes, lips, blush, gown, jewelry, collarGems, dropGems, centerGem, hair, base)
  .build({ edgeLength: 0.32, detail: [...F.faceDetail(rig)] });
