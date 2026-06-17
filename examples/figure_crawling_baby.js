// Crawling Baby — a chubby chibi baby on hands and knees, crawling, head up with
// a happy face. Big-head proportions (headsTall 3.6). The quadruped sprawl needs
// a wide low base; an explicit base radius covers the hand+knee footprint so the
// whole figure stays one component.
//
// Paint regions: skin, eyes, iris, pupil, hair, diaper, base
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — big-head chubby baby.
// Arms reach down-forward to the floor (raiseFwd ~80, near-straight, open grip).
// Legs fold kneeling under the hips (raiseFwd ~80, deep knee bend ~95).
// Head up (pitch -25), gaze up — looking forward/up while crawling.
const rig = F.rig({
  height: 26,
  headsTall: 3.6,
  build: 'average',
  age: 1,
  weight: 0.6,
  pose: {
    // Torso pitched forward over the hands — the crawl posture.
    spine: { lean: 80 },
    // Arms reach forward and down to plant the hands on the floor in front.
    arms: { raiseFwd: 48, bend: 12 },
    // Thighs swing back under the hips; deep knee bend folds the shins so the
    // knees rest near the floor (kneeling crawl).
    legs: { raiseFwd: -22, bend: 100 },
    // Head cranked up so the baby looks forward/up despite the pitched torso.
    head: { pitch: -70 },
  },
});

// 2. HEAD + FACE — round chubby-cheeked baby face; button nose, big eyes, happy
// additive smile (no carved mouth on this small head).
// Round chubby-cheeked baby face. Cheek eased from 1.4 → 1.2: at 1.4 the chubby
// cheeks bulged forward past the eyeball fronts and swallowed the eyes, so the
// eyes/iris/pupil/lids paint labels collapsed to zero triangles. 1.2 keeps the
// chubby read while the (enlarged) eyes still protrude and paint.
const head = F.head(rig, { faceShape: 'round', cheek: 1.2 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'button', tipRadius: rig.r.head * 0.08 },
  mouth: false, // additive happy lips below
  ears: true,
  brows: {},
});

// 3. SKIN — weld the body. Bare chest with a baby navel (no nipples on a baby).
// Barefoot with cute toes (footDetail in the build resolves them).
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
]).label('skin');

// 3b. EYES — hard-unioned at top level (iris style self-labels eyes/iris/pupil).
// Big baby eyes, subtle upper lid, looking gently up. Eyes enlarged (0.24 → 0.28)
// and the gaze softened from the steep 'up' preset to a mild +12° pitch: the
// steep up-tilt foreshortened the iris/pupil discs so thin they aliased away to
// zero triangles. A larger eye + gentler up keeps the deep discs paintable while
// the baby still reads as looking up.
const eyes = F.face.eyes(rig, {
  radius: rig.r.head * 0.32,
  lids: 'upper',
  gaze: { yaw: 0, pitch: 8 },
});

// 3c. LIPS — additive natural lips with a slight happy smile.
const lips = F.face.mouthAccents(rig, {
  style: 'lips',
  lipShape: 'natural',
  expression: 'slightSmile',
});

// 4. DIAPER — briefs labeled 'diaper'.
const diaper = F.clothing.pants(rig, {
  rise: 'high',
  length: 'briefs',
  thickness: rig.r.upperLeg * 0.28,
}).label('diaper');

// 5. HAIR — short wispy.
const hair = F.hair(rig, { style: 'short', volume: 0.5 }).label('hair');

// 6. BASE — wide low disc to cover the hands+knees sprawl, keeping one component.
const base = F.base(rig, {
  radius: rig.opts.height * 0.5,
  thickness: rig.opts.height * 0.09,
}).label('base');

// 7. Hard-union all labelled regions and build. faceDetail for smooth baby
// features, handDetail for the open hands, footDetail for the cute toes.
//
// The enlarged eyeballs are pushed proud of the face, so the iris/pupil discs sit
// FORWARD of faceDetail's stock iris region (which is centred only ~0.22·head out)
// — the tiny pupil fell outside it and aliased to zero triangles. Add an explicit
// extra-fine sphere over each eye's true disc front (the same push the eye builder
// uses) so the pupil tessellates and paints.
const eyeRad = rig.r.head * 0.32;
const eyePush = Math.max(eyeRad * 0.28, rig.r.head * 0.09);
const ef = rig.dir.headForward;
// Centre the region on the eyeball FRONT SURFACE (anchor + push + rad along the
// head's forward axis) where the iris/pupil discs surface, with a radius that
// comfortably covers the iris disc (~0.55·rad), so the tiny pupil tessellates.
const pupilRegion = (anchor) => ({
  center: [
    anchor[0] + ef[0] * (eyePush + eyeRad * 0.95),
    anchor[1] + ef[1] * (eyePush + eyeRad * 0.95),
    anchor[2] + ef[2] * (eyePush + eyeRad * 0.95),
  ],
  radius: eyeRad * 0.85,
  edgeLength: rig.r.head * 0.005,
});
return sdf.union(skin, eyes, lips, diaper, hair, base)
  .build({
    edgeLength: 0.45,
    detail: [
      ...F.faceDetail(rig, {
        edgeLength: rig.r.head * 0.02,
        eyeEdgeLength: rig.r.head * 0.004,
        irisEdgeLength: rig.r.head * 0.003,
      }),
      pupilRegion(rig.face.eyeL),
      pupilRegion(rig.face.eyeR),
      ...F.handDetail(rig),
      ...F.footDetail(rig),
    ],
  });
