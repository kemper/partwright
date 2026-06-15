// Power Stance — confident full-figured woman, hands on hips, joyful smile.
// Showcases: weight:0.8 (fuller body as believable 3D bulk), bust:0.5,
// navel on the exposed midriff, coily afro with high volume, joyful bigSmile,
// hands-on-hips mechanics (arms raised to waist, bent to rest on the hips).
// Clothing: sports bra + high-waist leggings, bare feet with toes.
// Front = −Y, Z up, figure's left = +X, right = −X.

const { sdf } = api;
const F = sdf.figure;

// 1. RIG — full-figured confident woman.
// weight:0.8 gives full-body volume (waist, hips, belly, shoulders all wider/deeper).
// bust:0.5 for visible chest volume.
// muscle:0.2 adds just a trace of tone — powerful presence, not gym-bound.
// headsTall 7.3 for a slightly proportioned adult figure.
// Pose: classic "power stance" — hands planted on the hips, chin slightly up.
// raiseSide 25 lifts arms outward so the fists clear the waist width;
// raiseFwd 10 swings them very slightly forward (natural resting-on-hip position);
// bend 120 folds the forearm sharply so the hand drops down onto the hip/waist.
// Feet shoulder-width apart (legL raiseSide 12, legR raiseSide -12).
// Head pitched slightly UP (pitch -8) — "chin up" confident stance.
const rig = F.rig({
  height: 52,
  headsTall: 7.3,
  sex: 'female',
  weight: 0.8,
  bust: 0.5,
  muscle: 0.2,
  build: 'average',
  pose: {
    // Hands-on-hips. Upper arm raised out to the side (raiseSide 50) at
    // approximately waist height. twist -90 rotates the elbow-curl plane so
    // it faces downward (0 = curl forward, −90 = curl DOWN toward the hip).
    // bend 90 then folds the forearm DOWN toward the hip, placing the hand
    // resting on the waist. raiseFwd 8 slants slightly forward for natural feel.
    arms: { raiseSide: 50, raiseFwd: 8, bend: 90, twist: -90 },
    // Feet shoulder-width apart for that planted, confident stance
    legL: { raiseSide: 12 },
    legR: { raiseSide: 12 },
    // Chin slightly up — projecting confidence
    head: { pitch: -8 },
    // Very slight spine lean back to open the chest proudly
    spine: { lean: -3 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — joyful big smile, confident expression.
// faceShape 'round' suits a fuller-figured figure well.
// bigSmile expression curves the mouth line up in a wide joyful grin.
// Using lips+bigSmile style for a clean, lower-poly painted smile.
const mouthOpts = {
  style: 'lips',
  lipShape: 'full',
  expression: 'bigSmile',
  fullness: 1.2,
};
const head = F.head(rig, { faceShape: 'round', cheek: 1.2 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'broad', tipRadius: r.head * 0.11, flare: 0.9, bridge: 0.7 },
  mouth: false,    // mouthAccents handles this
  ears: { size: r.head * 0.22 },
  brows: { lift: 0.25 },   // slightly raised brows for the joyful look
});
// Painted mouth accents: sculpted lips with big smile, self-labelled 'lips'
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// Eyes — looking straight forward (gaze: 'middle'), slight upper lid definition.
// Increased radius so the dome clears the brow/cheek surface and protrudes
// visibly. Extra forward nudge (5% of head radius) ensures the dome stands
// proud even on this fuller face (cheek:1.2 pushes the face surface forward).
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.155,
  gaze: 'middle',
  lids: 'upper',    // slight lid definition — open, confident eyes
}).translate(rig.dir.headForward.map(v => v * r.head * 0.05));

// Nipples/areolae — self-labelled 'areola', hard-unioned at top level.
// The sports bra layer (thickness ~r.chestX*0.12) can bury the default areola
// coin if the disc's eps protrusion is smaller than the bra. Nudge the whole
// nipples node forward (−Y) by slightly more than the bra thickness so the
// disc always wins the hard union and exposes paintable triangles.
const nippleForward = r.chestX * 0.15;
const chestFwd = [0, -1, 0];  // front is −Y; spine.lean is only 3° so −Y is close enough
const nipples = F.nipples(rig).translate(chestFwd.map(v => v * nippleForward));

// 3. SKIN — weld all body masses. navel:true on the exposed midriff.
// Open hands for the relaxed-on-hips pose.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
]).label('skin');

// 4. SPORTS BRA — sleeveless (sleeve:'none'), hem at mid-rib to expose the midriff.
// The high-waist leggings will cover from above the hip up to the navel,
// so we want only the ribs and navel area bare between the two garments.
const chesZ = rig.joints.chest[2];
const braHemZ = chesZ - r.chestX * 0.55;   // ~mid-rib, just below the bust
const sportsBra = F.clothing.top(rig, {
  sleeve: 'none',
  hemZ: braHemZ,
  thickness: r.chestX * 0.12,
}).label('top');

// 5. HIGH-WAIST LEGGINGS — slim leg, high rise to show the navel zone.
// rise:'high' starts just below the navel, so the navel is on bare skin
// between the bra and the leggings waistband.
const leggings = F.clothing.pants(rig, {
  rise: 'low',      // low rise keeps the navel visible (not covered by the waistband)
  leg: 'slim',
  thickness: r.upperLeg * 0.11,
}).label('leggings');

// 6. AFRO HAIR — full halo silhouette. volume:1.4 gives a prominent shape.
// texture:'coils' adds the tight springy 4c coil relief — the key visual of
// this figure. Keep volume moderate so the coil geometry doesn't blow the budget.
const hair = F.hair(rig, {
  style: 'afro',
  texture: 'coils',
  volume: 1.1,
}).label('hair');

// 7. BASE — disc stand
const base = F.base(rig, {
  radius: rig.opts.height * 0.24,
  thickness: rig.opts.height * 0.038,
}).label('base');

// 8. Hard-union all labelled regions and build.
// faceDetail + footDetail for sculpted face and toes.
// handDetail omitted — the afro coil texture adds ~45k triangles, so we keep
// the total under ~230k by dropping hand detail (relaxed hands read fine).
return sdf.union(skin, eyes, nipples, mouthParts, sportsBra, leggings, hair, base)
  .build({
    edgeLength: 0.5,
    detail: [...F.faceDetail(rig), ...F.footDetail(rig)],
  });
