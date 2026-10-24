// Ned — the shy horned creature from twenty one pilots' "Chlorine" video, as a
// stylized-realistic figurine. The worked example for api.sdf.creature
// (public/ai/creature.md): ellipsoid MASSES welded with smoothUnion for the
// body and head, then the creature kit for the features that make it read as
// sculpted — perfectly round glossy eyes with slim lid rings, a puffy
// Seuss-like cat muzzle (overhanging upper-lip pads, "w" smile, cat nose),
// lobed bat ears with ribbed inner membranes, clawed feet and small hands.
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

// ===== HEAD — ONE tapered egg (wide jowls, narrower crown) =====
// Two overlapping skull ellipsoids leave a visible "hood" crease where one
// emerges from the other; features stacked far in front of the skull read as a
// flat mask from 3/4. The face details come from the kit below.
const skull = sdf.ellipsoid(23, 21, 19).taper(-0.01, 'z').translate(0, -2, hc + 1);
const cheekPads = mir(E(9, 5.5, 7, 10.5, -16.5, hc - 8.5));
const chin = E(6, 4, 3.4, 0, -19, hc - 19);
const bridge = sdf.capsule([0, -21, hc + 4], [0, -23.5, hc - 4], 2.2);
let head = skull.smoothUnion(cheekPads, 6).smoothUnion(chin, 3).smoothUnion(bridge, 3);

// ===== ARMS — thin, hanging free of the belly =====
const arms = mir(sdf.capsule([17, 1, 62], [28, 1, 48], 4.6).smoothUnion(sdf.capsule([28, 1, 48], [30, -3.5, 36.5], 3.8), 2));
const tail = sdf.tube([[0, 16, 26], [0, 23, 30], [0, 28, 37], [0, 29.5, 44]], 5, { taper: 0.12 });

const skin = belly.smoothUnion(chest, 9).smoothUnion(legs, 5).smoothUnion(head, 9)
  .smoothUnion(arms, 2).smoothUnion(tail, 3);

// ===== FEATURES (each mirrored; each brings its own detail spheres) =====
const eyes = C.eyes({ at: [10, -14.6, hc + 3], radius: 6.8 });
const ears = C.ears({ root: [16, 3, hc + 6], length: 36, width: 26, lift: 8, sweep: 12, cup: 1.2, veins: 4 });
const feet = C.feet({ at: [13, -3], length: 36, width: 22, height: 10, yaw: 14 });
const hands = C.hands({ at: [30.5, -5, 32.5] });
const muzzle = C.muzzle({ at: [0, hc - 11], width: 22 });   // also adds the 'nose' part

// ===== HARD PARTS =====
const horns = mir(sdf.tube([[9.6, -1.5, hc + 15.5], [10.8, -1, hc + 21], [13, 0.3, hc + 26]], 2.7, { taper: 0.14 })).label('horns');

const model = C.build({
  skin,
  features: [muzzle, eyes, ears, feet, hands],
  parts: [horns],
  edgeLength: 0.6,
  detail: [{ center: [0, -15, hc - 2], radius: 18, edgeLength: 0.25 }], // cheeks + brow
});

api.paint.label('skin', '#eeeeee');
api.paint.label('eyes', '#060606');
api.paint.label('nose', '#e8b4a0');
api.paint.label('horns', '#3e2c22');
api.paint.label('innerEar', P.earColor === 'blue' ? '#a9d4ea' : '#f2c4ae');
// plinth top 0.4 ABOVE the ground so the flat soles overlap it (coplanar faces leave slivers)
const base = Manifold.cylinder(4, 1, 1, 96).scale([42, 38, 1]).translate([0, -6, -3.6]);
return model.add(api.label(base, 'base', { color: '#1b1b1d' }));
