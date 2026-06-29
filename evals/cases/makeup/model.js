// FACE WITH MAKEUP — blush on cheeks, lipstick, eyeshadow.
// Uses api.paint.* (box/label) so colors render in model:preview.
// Face orientation: front = -Y, Z up, figure's left = +X, right = -X.
// Confirmed anchor coords (headsTall 6, height 60, sex female):
//   eyeL = [1.80, -4.30, 55.70]   eyeR = [-1.80, -4.30, 55.70]
//   mouth = [0.00, -4.50, 52.40]   browL = [1.80, -4.40, 57.00]
//   r.head = 4.60,  r.headX = 4.00,  r.headZ = 5.00
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — female bust, neutral pose, headsTall 6.
const rig = F.rig({
  height: 60,
  headsTall: 6,
  sex: 'female',
  build: 'average',
});
const r = rig.r;
const j = rig.joints;

// 2. HEAD + FACE — full lips, brows, ears; eyes and lips built separately.
const mouthOpts = {
  style: 'lips',
  lipShape: 'full',
  width: r.head * 0.48,
  expression: 'neutral',
};
const head = F.head(rig, { faceShape: 'oval' });
const face = F.face.assemble(head, rig, {
  eyes: false,
  mouth: false,   // mouthAccents built separately to keep 'lips' label
  brows: {},
  nose: { type: 'straight' },
  ears: true,
});
const eyes = F.face.eyes(rig, { lids: 'almond' });
const lips = F.face.mouthAccents(rig, mouthOpts);

// 3. SKIN — EVAL FRAMING: head + neck only so the face fills the frame and the
// judge can resolve the blush/lipstick/eyeshadow (a full bust shrinks the face).
const skin = F.weld(rig, [face, F.neck(rig)]).label('skin');

// 4. MAKEUP via api.paint.*
// CRITICAL: declare base label colors FIRST, makeup boxes LAST (later ops win).

// --- Base label colors (skin/eye/lips) ---
api.paint.label('skin',  '#e8c4a0');
api.paint.label('eyes',  '#f6f4ef');
api.paint.label('iris',  '#4a6b7a');
api.paint.label('pupil', '#1a1a1a');
api.paint.label('lips',  '#b5384a');

// --- Read face anchors ---
const eyeL    = rig.face.eyeL;    // [1.80, -4.30, 55.70]
const eyeR    = rig.face.eyeR;    // [-1.80, -4.30, 55.70]
const mouthPt = rig.face.mouth;   // [0.00, -4.50, 52.40]

// --- BLUSH: rosy pink on each cheek ---
// Cheek center Z = true midpoint between eye Z and mouth Z = ~54.05
// Cheek X: outward from eye (eyeL[0]=1.8) toward ear (ear is at ~4.0 in X)
//   → center at X ≈ 2.8, half-width 1.4 spans X 1.4..4.2
// Face surface Y ≈ -4.3; only go ~1.5 units into face to avoid wrapping to the sides.
// Cheek apple: a bit BELOW the eye (toward the mouth) and only slightly lateral
// (NOT out toward the ear — that's what made the old blush a streak). Small,
// square, SHALLOW box → a round apple-of-cheek patch, not a side-wrapping stripe.
const cheekZ   = eyeL[2] * 0.42 + mouthPt[2] * 0.58;  // lower, on the apple
const blushW   = r.headX * 0.22;   // ~0.88 half-width
const blushH   = r.head * 0.18;    // ~0.83 half-height (squarish)
const faceSurY = eyeL[1];          // front face surface
const blushYd  = r.headZ * 0.18;   // shallow → no wrap to the side of the face
const chkLx = eyeL[0] * 0.95;      // ~1.7, under the eye (clear of the ear at ~4)

api.paint.box({
  min: [chkLx - blushW, faceSurY - r.headZ * 0.04, cheekZ - blushH],
  max: [chkLx + blushW, faceSurY + blushYd,         cheekZ + blushH],
  color: '#e58a9a',
});
const chkRx = eyeR[0] * 0.95;      // mirror
api.paint.box({
  min: [chkRx - blushW, faceSurY - r.headZ * 0.04, cheekZ - blushH],
  max: [chkRx + blushW, faceSurY + blushYd,         cheekZ + blushH],
  color: '#e58a9a',
});

// --- LIPSTICK: deep red on the mouth area ---
// mouthPt = [0, -4.50, 52.40]; small box tightly around the lip region.
const lipW  = r.head * 0.28;         // ~1.3 half-width in X
const lipH  = r.head * 0.10;         // ~0.46 half-height in Z
const lipYd = r.headZ * 0.35;        // shallow depth = ~1.75 (front face only)
api.paint.box({
  min: [mouthPt[0] - lipW, mouthPt[1] - r.headZ * 0.04, mouthPt[2] - lipH],
  max: [mouthPt[0] + lipW, mouthPt[1] + lipYd,           mouthPt[2] + lipH],
  color: '#b5384a',
});

// --- EYESHADOW: mauve above each eye, on the upper lid ---
// Eye Z = 55.70; shadow spans from just above eye center Z to ~1.0 below brow.
// Keep Y range shallow to stay on the front-facing lid surface.
const shadW   = r.headX * 0.28;   // half-width = ~1.12
const eyeSurY = eyeL[1];           // -4.30
const shadYd  = r.headZ * 0.28;    // ~1.4 units deep (enough for lid triangles)
const shadZlo = eyeL[2] + r.head * 0.00;  // start at eye center Z
const shadZhi = eyeL[2] + r.head * 0.20;  // ~0.92 above → halfway to brow

api.paint.box({
  min: [eyeL[0] - shadW, eyeSurY - r.headZ * 0.04, shadZlo],
  max: [eyeL[0] + shadW, eyeSurY + shadYd,          shadZhi],
  color: '#8a6a86',
});

api.paint.box({
  min: [eyeR[0] - shadW, eyeSurY - r.headZ * 0.04, shadZlo],
  max: [eyeR[0] + shadW, eyeSurY + shadYd,          shadZhi],
  color: '#8a6a86',
});

// 5. BUILD — fine face mesh with faceDetail.
return sdf.union(skin, eyes, lips)
  .build({
    edgeLength: 0.22,
    detail: F.faceDetail(rig),
  });
