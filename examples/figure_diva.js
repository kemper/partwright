// Opera Diva — fuller-figured woman mid-aria. Dramatic singing pose.
// Floor-length gown, updo bun, painted lips, female + weight silhouette.
// Spotlights sex: 'female' + weight: 0.62 anthropometric axes on the rig.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — female proportions, weight 0.62 (fuller figure reads hourglass + bulk).
// Dramatic aria pose:
//   armL flung up overhead (figure's left side) — the big theatrical sweep
//   armR extended broadly out to the right — the grand side gesture
//   head slightly up (pitch negative) — projecting to the gallery
//   spine turns toward the raised arm for contrapposto drama
const rig = F.rig({
  height: 50,
  headsTall: 7,
  sex: 'female',
  weight: 0.62,
  build: 'average',
  pose: {
    // Left arm: flung overhead — classic operatic "reaching for the high note".
    // raiseSide 145: high above horizontal, nearly overhead.
    // raiseFwd 18: slight forward sweep so it reads from the front camera.
    // bend 38: graceful curve at the elbow, not stiff.
    // twist 90: curl plane rotates so the forearm bends upward (fist toward ceiling).
    armL: { raiseSide: 145, raiseFwd: 18, bend: 38, twist: 90 },

    // Right arm: sweeping grandly out to the side — the wide aria gesture.
    // raiseSide 88: just below horizontal, a graceful reach.
    // raiseFwd 30: angled forward so the gesture reads from the front.
    // bend 18: gentle elbow bend for elegance.
    armR: { raiseSide: 88, raiseFwd: 30, bend: 18 },

    // Stance: slight width, right leg marginally back for a planted feel.
    legL: { raiseSide: 6 },
    legR: { raiseSide: 6, raiseFwd: -5 },

    // Head: tilted up (pitch −14 = projecting upward to the audience),
    // slight yaw and roll for expressive tilt.
    head: { pitch: -14, yaw: -6, roll: 3 },

    // Spine: side lean toward the raised arm, slight turn for depth.
    spine: { side: 7, turn: 5 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — open mouth for singing; mouthAccents provides teeth + lips.
// Pass mouth: mouthOpts to assemble (carves the opening), mouthAccents fills it.
const mouthOpts = { style: 'open', open: 0.6, width: r.head * 0.52 };
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: r.head * 0.09, length: r.head * 0.22 },
  mouth: mouthOpts,
  ears: { size: 0.9 },
  brows: { lift: 0.3 },
});

// Mouth accents: teeth band + lips ring, self-labelled 'teeth'/'lips' by the helper.
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// Eyes — iris style self-labels (eyes/iris/pupil), union at top level.
const eyes = F.face.eyes(rig, { radius: r.head * 0.14 });

// 3. SKIN — weld all body masses. Open hands for the expressive pose.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. GOWN — floor-length dress (hemZ near the base so the flared cone covers the legs).
// generous thickness to fully hide legs and convey the full skirt volume.
const gown = F.clothing.top(rig, {
  sleeve: 'short',
  hemZ: rig.opts.height * 0.04,   // near ground — full floor-length flared skirt
  thickness: r.chestY * 0.46,     // generous: hides legs, adds silhouette volume
}).label('gown');

// 5. HAIR — updo bun: elegant operatic look. volume 1.8 makes the updo
// visually prominent on a bun style so it reads clearly even at small scale.
const hair = F.hair(rig, { style: 'bun', volume: 1.8 }).label('hair');

// 6. BASE — disc the gown hem reaches, connecting the figure to the stand.
// Slightly thicker so the hem welds firmly to it without a gap or double-ring.
const base = F.base(rig, {
  radius: rig.opts.height * 0.22,
  thickness: rig.opts.height * 0.055,
}).label('base');

// 7. Hard-union all labelled regions and build.
// faceDetail meshes the head finely (smooth open-mouth carve, round eyes).
// handDetail resolves sculpted open fingers on both hands.
return sdf.union(skin, eyes, mouthParts, gown, hair, base)
  .build({ edgeLength: 0.5, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
