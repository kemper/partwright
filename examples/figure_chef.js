// Chef Presenting a Dish — a jolly stout chef beaming, presenting a domed
// serving cloche balanced on one open upturned palm, the other hand on the hip.
// Tall toque hat, chef whites, apron. ~6.5 heads tall. Front = −Y, Z up,
// figure's left = +X, right = −X.
//
// SHOWCASE: F.placeAt onto an open upturned palm (the cloche rests on the right
// grip point and is bridge-welded to the hand), F.placeOnHead (toque seated on
// the hair), open-mouth big smile with teeth, and a welded apron front panel.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — stout jolly chef, stocky build, a soft belly (weight 0.6), a little
// muscle. Right arm out to the side with the forearm up and palm open/upturned
// to carry the cloche; left hand resting on the hip.
const rig = F.rig({
  height: 56,
  headsTall: 6.5,
  sex: 'male',
  build: 'stocky',
  weight: 0.6,
  muscle: 0.2,
  pose: {
    // Right arm out to the side, forearm bent up, open upturned palm.
    armR: { raiseSide: 30, raiseFwd: 8, bend: 95, twist: 0 },
    // Left hand on the hip — bent elbow so the forearm comes back to the waist.
    armL: { raiseSide: 22, raiseFwd: 6, bend: 95, twist: 0 },
    legL: { raiseSide: 10 },
    legR: { raiseSide: 10 },
    // Head up, beaming, gaze forward.
    head: { pitch: -6 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — round full-cheeked jolly face, bulbous nose, big open smile
// with teeth (painted so it prints clean and the teeth band shows).
const head = F.head(rig, { faceShape: 'round', cheek: 1.0 });
const mouthOpts = { style: 'open', open: 0.5, expression: 'bigSmile', render: 'painted', teeth: 'both', width: r.head * 0.6 };
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'bulbous', tipRadius: r.head * 0.12 },
  mouth: false,           // the painted open mouth + teeth come from mouthAccents
  ears: true,
  brows: {},
});

// Paintable eyes — cheerful upper lid, gaze forward.
const eyes = F.face.eyes(rig, { radius: r.head * 0.18, lids: 'upper' });
// Open big smile with teeth + lips ring (labels 'teeth' + 'lips').
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// 3. SKIN — open grip on the right palm to hold the cloche, relaxed otherwise.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CHEF WHITES — long-sleeved jacket + pants.
const jacket = F.clothing.top(rig, {
  sleeve: 'long',
  thickness: r.chestX * 0.16,
}).label('jacket');
const pants = F.clothing.pants(rig, {
  rise: 'high',
  leg: 'slim',
}).label('pants');

// 4b. APRON — a CONFORMING front panel from chest down to the thigh. Derived
// from the real body masses (offset + front-clipped, the same "clothing = body
// region inflated and trimmed" rule as F.clothing.top/pants), so it drapes flush
// over the curved belly instead of passing through it the way a flat slab did.
const apron = F.clothing.apron(rig, { top: 'chest', bottom: 'thigh' });

// 5. SHOES — own their 'shoes' upper + 'sole' regions.
const shoes = F.clothing.shoes(rig, { label: 'shoes' });

// 6. HAIR — short under the toque.
const hair = F.hair(rig, { style: 'short' }).label('hair');

// 7. TOQUE — a tall white pleated chef's hat: a short band + a tall puffed
// cylinder on top, built centred on the ORIGIN (band in z=0 plane, puff rising
// +Z), then seated ON the hair with placeOnHead (embed welds it to one piece).
const bandR = r.head * 1.02;
const bandH = r.head * 0.5;
const band = sdf.cylinder(bandR, bandH).translate([0, 0, bandH / 2]);
// Tall puffed crown: slightly wider than the band, domed top, rising above it.
const puffR = r.head * 1.18;
const puffH = r.head * 2.3;
const puff = sdf.roundedCylinder(puffR, puffH, puffR * 0.5)
  .translate([0, 0, bandH + puffH * 0.5 - puffR * 0.1]);
const toqueLocal = band.smoothUnion(puff, puffR * 0.5);
const toque = F.placeOnHead(toqueLocal, rig, { rest: hair, embed: r.head * 0.3 }).label('hat');

// 8. CLOCHE — a domed serving cloche on a plate: a thin flat round plate + a
// half-sphere dome on top, built centred at the origin, then placed on the open
// upturned right palm and welded so it stays one component. (Label 'plate'.)
const plateR = r.head * 1.5;
const plateThick = r.head * 0.22;
const domeR = r.head * 1.25;
const plate = sdf.cylinder(plateR, plateThick).translate([0, 0, plateThick / 2]);
// Dome = TOP half of a sphere sitting on the plate. The clip box spans UPWARD
// from the plate top (z = plateThick) so it keeps the dome's upper hemisphere
// (a box below the plate would shear the dome off and leave the knob floating).
const domeSphere = sdf.sphere(domeR).translate([0, 0, plateThick + domeR * 0.02]);
const domeCut = sdf.box([domeR * 4, domeR * 4, domeR * 2]).translate([0, 0, plateThick + domeR]);
const dome = domeSphere.intersect(domeCut);
// Knob finial — a stout stalk + ball, sunk into the dome crown and HARD-unioned
// (a generous overlap with no smoothUnion field gap) so it can never split off.
const stalk = sdf.cylinder(domeR * 0.13, domeR * 0.55).translate([0, 0, plateThick + domeR * 0.9]);
const ball = sdf.sphere(domeR * 0.22).translate([0, 0, plateThick + domeR * 1.12]);
const knob = stalk.union(ball);
const clocheLocal = plate.smoothUnion(dome, domeR * 0.12).union(knob);
// Rest the plate's bottom on the right grip point (the open palm cup).
const clochePlaced = F.placeAt(clocheLocal, rig.grip.R.point, { anchor: 'bottom' });
// Weld a short bridge from the hand centre to the grip cup so the cloche fuses
// to the palm and stays one printable piece.
const bridge = sdf.capsule(rig.joints.handR, rig.grip.R.point, r.hand * 0.55);
const cloche = clochePlaced.smoothUnion(bridge, r.hand * 0.5).label('plate');

// 9. BASE.
const base = F.base(rig, { radius: rig.opts.height * 0.28 }).label('base');

// 10. Union all labelled regions and build with face + hand detail.
return sdf.union(skin, eyes, mouthParts, jacket, apron, pants, shoes, hair, toque, cloche, base)
  .build({
    edgeLength: 0.6,
    detail: [
      ...F.faceDetail(rig, { edgeLength: rig.r.head * 0.02, eyeEdgeLength: rig.r.head * 0.012 }),
      ...F.handDetail(rig),
    ],
  });
