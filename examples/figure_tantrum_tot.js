// Tiny Tantrum — toddler sitting on the floor mid-tantrum: both fists up, mouth
// wide open wailing, eyes squeezed shut. Showcases: headsTall:3.2 + age:2 (huge head,
// baby proportions), closed lids (squeezed eyes), open wailing mouth, splayed
// floor-sit pose, bare feet with toes.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — toddler proportions: age:2, headsTall:3.2 (enormous head = classic baby look).
// Floor sit: legs splayed forward and to the side, both arms raised for tantrum.
// Both fists pumped UP with twist:90 so the forearms curl upward (not forward).
const rig = F.rig({
  height: 22,
  headsTall: 3.2,
  age: 2,
  build: 'average',
  weight: 0.6,   // chubby baby
  pose: {
    // Splayed floor-sit: legs raised forward + spread out
    legL: { raiseFwd: 78, raiseSide: 22, bend: 62 },
    legR: { raiseFwd: 78, raiseSide: 22, bend: 62 },
    // Both fists raised up — raiseSide:28, raiseFwd:22, bend:115, twist:90 = fists up
    armL: { raiseSide: 28, raiseFwd: 22, bend: 115, twist: 90 },
    armR: { raiseSide: 28, raiseFwd: 22, bend: 115, twist: 90 },
    // Head tipped back in full cry
    head: { pitch: -18, roll: 4 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — huge baby head, SQUEEZED eyes, wide-open wailing mouth.
// Round face, chubby cheeks — the classic toddler look.
const head = F.head(rig, { faceShape: 'round', cheek: 1.5, jaw: 0.8, chin: 0.7 });

// Wide-open crying mouth: style:'open', open:0.72, expression:'deepFrown', render:'painted'
// Using render:'painted' avoids a cavity that could cause support issues.
const mouthOpts = {
  style: 'open',
  open: 0.72,
  expression: 'deepFrown',
  render: 'painted',
  teeth: false,
};
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'button', tipRadius: r.head * 0.085, projection: 0.7, nostrils: false },
  mouth: false,  // handled via mouthAccents below
  ears: { size: r.head * 0.28 },
  brows: { thickness: 1.1, lift: 0.0 },   // brows — no lift, set flat for cry
});

// Mouth accents — painted teeth-less opening with lip ring
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// Eyes: SQUEEZED SHUT — both lids closed
// Nudge eyes forward along headForward so a round/heart/cheeky face does not
// swallow the domes (else eyes/iris/pupil/lids paint to 0 triangles).
const hf = rig.dir.headForward, eyePush = r.head * 0.14;
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.195,
  lids: { upper: 0.62, lower: 0.52 },  // lids meet = closed/squeezed
  style: 'iris',
})
  .translate([hf[0] * eyePush, hf[1] * eyePush, hf[2] * eyePush]);

// 3. SKIN — weld all body masses; FIST grip for the tantrum hands.
// Large weld k for chubby baby joints
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),   // bare feet with toes — no shoes on this toddler!
  face,
], { k: r.lowerArm * 1.6 }).label('skin');

// 4. ROMPER — simple one-piece: short-sleeve top + briefs/diaper bottoms
const romperTop = F.clothing.top(rig, {
  sleeve: 'short',
  thickness: r.chestX * 0.18,
}).label('romper');
const romperBottom = F.clothing.pants(rig, {
  rise: 'high',
  leg: 'slim',
  length: 'briefs',
  thickness: r.upperLeg * 0.18,
}).label('romper');

// 5. HAIR — wispy baby hair, short
const hair = F.hair(rig, {
  style: 'short',
  volume: 0.85,
}).label('hair');

// 6. BASE — flat disc under the seated toddler.
// In the floor-sit pose, the seat (pelvis) is near the ground; feet also extend forward.
// F.base auto-sizes to the lowest foot ground contact. Make it generously sized.
const base = F.base(rig, {
  radius: rig.opts.height * 0.52,
  thickness: rig.opts.height * 0.05,
}).label('base');

// 7. Hard-union all labelled regions and build.
// Foot detail for sculpted toddler toes. Face detail for the mouth/eyes.
return sdf.union(skin, eyes, mouthParts, romperTop, romperBottom, hair, base)
  .build({ edgeLength: 0.5, detail: [
    ...F.faceDetail(rig),
    ...F.handDetail(rig),
    ...F.footDetail(rig),
  ]});
