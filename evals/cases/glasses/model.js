// ACCESSORY MILESTONE — Perched mode: eyeglasses via F.onFace.
// Builds a head/bust and seats a pair of glasses on the facial landmarks.
const { sdf } = api;
const F = sdf.figure;

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = (v) => Math.hypot(v[0], v[1], v[2]);

const rig = F.rig({ height: 60, headsTall: 6, build: 'average' });
const r = rig.r;

const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  nose: {}, mouth: { style: 'lips' }, ears: {}, brows: {}, eyes: false,
});
const eyes = F.face.eyes(rig, { lids: 'almond' });
const skin = F.weld(rig, [
  F.torso(rig), F.neck(rig), F.arms(rig), F.hands(rig), face,
]).label('skin');

// --- GLASSES (perched) -----------------------------------------------------
const ff = F.onFace(rig);
const eyeSpan = len(sub(ff.eyeL, ff.eyeR));
const lensRad = eyeSpan * 0.44;
const rim = lensRad * 0.20;          // chunky rim (printable + survives the march)
const temple = rim * 1.25;           // temple arms — keep well over edgeLength so they don't fragment
const stand = r.head * 0.30;         // push lenses proud of the face

function lensRim(center) {
  const N = 26;
  const pts = [];
  for (let i = 0; i < N; i++) {
    const t = (2 * Math.PI * i) / N;
    pts.push(add(center, add(scale(ff.lateral, lensRad * Math.cos(t)), scale(ff.up, lensRad * Math.sin(t)))));
  }
  let ring = sdf.capsule(pts[N - 1], pts[0], rim);
  for (let i = 0; i < N - 1; i++) ring = ring.union(sdf.capsule(pts[i], pts[i + 1], rim));
  return ring;
}

const cL = add(ff.eyeL, scale(ff.forward, stand));
const cR = add(ff.eyeR, scale(ff.forward, stand));
// Points on the skull side at eye height (where temple arms rest on the head).
const sideL = add(add(ff.eyeL, scale(ff.lateral, r.headX * 0.55)), scale(ff.forward, -stand * 0.4));
const sideR = add(add(ff.eyeR, scale(ff.lateral, -r.headX * 0.55)), scale(ff.forward, -stand * 0.4));
const innerL = add(cL, scale(ff.lateral, -lensRad));
const innerR = add(cR, scale(ff.lateral, lensRad));
const outerL = add(cL, scale(ff.lateral, lensRad));
const outerR = add(cR, scale(ff.lateral, -lensRad));

const bridgeUp = scale(ff.up, lensRad * 0.30);
const bridge = sdf.capsule(add(innerL, bridgeUp), add(innerR, bridgeUp), rim * 1.05);
// Temple arms: outer rim → a point resting on the skull side → the ear. Routing
// it onto the head surface keeps the thick tube supported (no floating diagonal
// through open air that the march frays).
function templeArm(outer, side, ear) {
  return sdf.capsule(outer, side, temple).union(sdf.capsule(side, ear, temple));
}
const templeL = templeArm(outerL, sideL, ff.templeL);
const templeR = templeArm(outerR, sideR, ff.templeR);

const glasses = sdf.union(lensRim(cL), lensRim(cR), bridge, templeL, templeR).label('glasses');

return sdf.union(skin, eyes, glasses).build({
  edgeLength: 0.18,
  detail: [...F.faceDetail(rig)],
});
