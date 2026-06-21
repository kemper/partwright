// Runway Fashion Model — a very tall, elegant woman mid-strut on the catwalk.
// One leg forward, one back; one hand confidently on the hip; head turned in a
// three-quarter side gaze. Spotlights tall, elegant proportions (headsTall 8.5,
// slim build, weight 0.3) + full lips + sculpted cheekbones (diamond face).
// Floor-length elegant gown (a top hemmed below the pelvis) + simple flats.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — very tall, slim, lean. Mid-strut catwalk pose:
//   legL strides FORWARD (raiseFwd 20, slight bend), legR trails BACK (raiseFwd -15).
//   armR comes to the hip (raised a little to the side, bent ~95 so the forearm
//     folds in and the hand rests at the waist — verified via poseProbe).
//   armL swings relaxed at the side with a slight bend.
//   spine { turn 8, side -4 } for a touch of runway sass / contrapposto.
//   head yaw -22 (three-quarter to the figure's right) with the gaze to the side.
const rig = F.rig({
  height: 72,
  headsTall: 8.5,
  sex: 'female',
  build: 'slim',
  weight: 0.3,
  bust: 0.4,
  pose: {
    // Hand-on-hip (akimbo): wing the elbow back (raiseFwd -30) and bend the
    // forearm so the hand folds down to the right waist/hip crest. Verified via
    // poseProbe: handR ≈ [-4.1, -4.2, 42.9], resting at the right waist surface.
    armR: { raiseSide: 16, raiseFwd: -30, bend: 85, twist: -15 },
    // Relaxed swinging arm — slightly out, soft elbow.
    armL: { raiseSide: 12, raiseFwd: 8, bend: 18 },
    // Stride: left leg forward (slight knee bend), right leg back, planted.
    legL: { raiseFwd: 20, bend: 10 },
    legR: { raiseFwd: -15, bend: 6 },
    // Runway sass: slight upper-body turn + side lean.
    spine: { turn: 8, side: -4 },
    // Three-quarter head turn to the figure's right, confident.
    head: { yaw: -22 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — diamond face with HIGH cheekbones, narrow pointed nose,
//    tapered lids, side gaze; full lips with a slight smile (additive lips so the
//    small/tall head doesn't tear a carved groove — mouth:false in assemble).
// Diamond face already gives sculpted high cheekbones; keep cheek at the neutral
// 1.0 so the prominence doesn't bulge forward and swallow the eyeballs (high
// cheek pushed the cheek/brow skin past the eye fronts, collapsing the
// eyes/iris/pupil/lids paint labels to zero triangles).
const head = F.head(rig, { faceShape: 'diamond', cheek: 1.0 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'pointed', width: 0.8, length: r.head * 0.24 },
  mouth: false,
  ears: true,
  brows: { lift: 0.25 },
});

// Lips — additive full lips with a gentle smile (paintable 'lips' label).
const lipOpts = { style: 'lips', lipShape: 'full', expression: 'slightSmile', width: r.head * 0.44 };
const lips = F.face.mouthAccents(rig, lipOpts);

// Eyes — iris style self-labels (eyes/iris/pupil/lids). Tapered lids,
// gaze to the side (figure's own right, matching the head turn). Radius bumped
// (and pushed prouder via the larger eyeball) so the small/high-cheekbone head
// can't swallow the eye/iris/pupil/lids labels into zero triangles.
const eyes = F.face.eyes(rig, { radius: r.head * 0.19, lids: 'tapered', gaze: 'right' });

// 3. SKIN — weld every body mass. Relaxed hands read well on the runway.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. GOWN — an elegant floor-length dress: a top whose hem is dropped well below
//    the pelvis, so the flared skirt cone covers the legs down to the ankles.
const gown = F.clothing.top(rig, {
  sleeve: 'none',
  hemZ: rig.opts.height * 0.06,    // near the ground — full-length flared dress
  thickness: r.chestY * 0.34,
}).label('dress');

// 5. HAIR — long, wavy: elegant flowing hair.
const hair = F.hair(rig, { style: 'long', texture: 'wavy', length: 'long' }).label('hair');

// 6. FLATS — simple low shoes keyed off the sole frame (own their 'sole' region).
const shoes = F.clothing.shoes(rig, { label: 'shoes' });

// 7. BASE — a slim catwalk disc that the gown hem reaches and the rear foot meets.
const base = F.base(rig, { radius: rig.opts.height * 0.18 }).label('base');

// 8. Hard-union the labelled regions and build.
//    faceDetail meshes the head finely; handDetail resolves the sculpted hands.
return sdf.union(skin, eyes, lips, gown, hair, shoes, base)
  .build({ edgeLength: 0.5, detail: [
    ...F.faceDetail(rig, {
      edgeLength: rig.r.head * 0.02,
      eyeEdgeLength: rig.r.head * 0.004,
      irisEdgeLength: rig.r.head * 0.003,
    }),
    ...F.handDetail(rig),
  ] });
