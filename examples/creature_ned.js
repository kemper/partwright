// Ned — the shy horned creature from twenty one pilots' "Chlorine" video, as a
// stylized-realistic figurine. The worked example for api.sdf.creature
// (public/ai/creature.md): ellipsoid MASSES welded with smoothUnion for the
// body and head, then the creature kit for the features that make it read as
// sculpted — socketed glossy eyes under heavy lids, a surface-seated mouth
// crease, cupped veined bat ears, long clawed feet and small hanging hands.
// Front = −Y, Z up, soles on z = 0. About 100 tall without the base.
const { sdf, Manifold } = api;
const C = sdf.creature;
const P = api.params({
  earColor: { type: 'select', default: 'blue', options: ['blue', 'peach'], label: 'Inner ear color' },
});
const mir = (n) => n.mirrorPair('x');
const E = (rx, ry, rz, x, y, z) => sdf.ellipsoid(rx, ry, rz).translate(x, y, z);
const hc = 80; // head centre height

// ===== BODY — a bottom-heavy egg, short stumpy legs =====
const belly = E(26, 22, 23, 0, -1, 37);
const chest = E(18, 15.5, 14, 0, 1, 56);
const legs = mir(sdf.capsule([11.5, 1, 20], [12.5, -1, 6], 8));

// ===== HEAD — one deep skull; every feature only 1–2 units proud of it =====
// (features stacked far in front of the skull read as a flat mask from 3/4)
const cranium = E(18.5, 18.5, 16, 0, 0, hc + 3);
const jowls = E(21.5, 17.5, 12.5, 0, -2, hc - 5);
const cheekPads = mir(E(8, 5, 6.5, 8.8, -15, hc - 6.5));
const muzzle = mir(E(4.8, 3.8, 3.6, 3.6, -17.8, hc - 10.5)); // the "w" upper-lip pads
const chin = E(6, 4, 3.4, 0, -15.5, hc - 16.5);
const brow = E(13, 4, 3.6, 0, -15.5, hc + 8);
const bridge = sdf.capsule([0, -17.5, hc + 4], [0, -20, hc - 3.5], 2.2);
let head = cranium.smoothUnion(jowls, 11).smoothUnion(cheekPads, 4).smoothUnion(muzzle, 2.5)
  .smoothUnion(chin, 3).smoothUnion(brow, 7).smoothUnion(bridge, 3);

// mouth + philtrum + nasolabial folds, seated on the real face ([x, z] points)
head = C.crease(head, [[-7.6, hc - 11.2], [-5, hc - 12.6], [-2.4, hc - 13.4], [0, hc - 13.1],
  [2.4, hc - 13.4], [5, hc - 12.6], [7.6, hc - 11.2]], { radius: 0.9, depth: 0.7, soft: 1.3 });
head = C.crease(head, [[0, hc - 8], [0, hc - 12.6]], { radius: 0.8, depth: 0, soft: 1.6 });
for (const s of [1, -1]) {
  head = C.crease(head, [[4.8 * s, hc - 4.2], [8.4 * s, hc - 7.6], [9.4 * s, hc - 11]], { radius: 0.6, depth: 0, soft: 2 });
}
head = head.smoothUnion(E(4.2, 2.6, 1.9, 0, -16.6, hc - 14.6), 1.2); // pouty lower lip

// ===== ARMS — thin, hanging free of the belly =====
const arms = mir(sdf.capsule([17, 1, 62], [28, 1, 48], 4.6).smoothUnion(sdf.capsule([28, 1, 48], [30, -3.5, 36.5], 3.8), 2));
const tail = sdf.tube([[0, 16, 26], [0, 23, 30], [0, 28, 37], [0, 29.5, 44]], 5, { taper: 0.12 });

const skin = belly.smoothUnion(chest, 9).smoothUnion(legs, 5).smoothUnion(head, 9)
  .smoothUnion(arms, 2).smoothUnion(tail, 3);

// ===== FEATURES (each mirrored; each brings its own detail spheres) =====
const eyes = C.eyes({ at: [8.3, -13.3, hc + 1.5], radius: 6.6, hood: 1 });
const ears = C.ears({ root: [14, 3, hc + 6], length: 44, width: 30, lift: 18, sweep: 10 });
const feet = C.feet({ at: [13, -3], length: 36, width: 22, height: 10, yaw: 14 });
const hands = C.hands({ at: [30.5, -5, 32.5] });

// ===== HARD PARTS =====
const nose = sdf.ellipsoid(2.9, 2.3, 2.2).rotate(-18, 0, 0).translate(0, -21.4, hc - 4.6).label('nose');
const horns = mir(sdf.tube([[8.6, -1, hc + 13.5], [9.6, -0.5, hc + 19], [11.6, 0.8, hc + 24]], 2.5, { taper: 0.14 })).label('horns');

const model = C.build({
  skin,
  features: [eyes, ears, feet, hands],
  parts: [nose, horns],
  edgeLength: 0.6,
  detail: [{ center: [0, -14, hc - 3], radius: 17, edgeLength: 0.22 }], // the face
});

api.paint.label('skin', '#eeeeee');
api.paint.label('eyes', '#060606');
api.paint.label('nose', '#e8b4a0');
api.paint.label('horns', '#3e2c22');
api.paint.label('innerEar', P.earColor === 'blue' ? '#a9d4ea' : '#f2c4ae');
// plinth top 0.4 ABOVE the ground so the flat soles overlap it (coplanar faces leave slivers)
const base = Manifold.cylinder(4, 1, 1, 96).scale([42, 38, 1]).translate([0, -6, -3.6]);
return model.add(api.label(base, 'base', { color: '#1b1b1d' }));
