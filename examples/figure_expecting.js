// Expecting — pregnant woman cradling her belly in a serene standing pose.
// Showcases: weight:0.6 (belly 3D bulk + navel pushes outward), bust:0.6,
// navel landmark on the bulge, soft 'half' eyelids, female silhouette,
// bare midriff (cropped top + low skirt) so the rounded belly shows.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — adult female, weight 0.6 (belly rounds forward), bust 0.6.
// Pose: standing serene. Hands cradle the belly at waist level.
// Strategy: arms drop slightly (raiseSide 20 so they hang near the body),
// swing forward ~30 deg (raiseFwd), then bend ~85 to bring the forearm
// forward-and-across so the hands land at belly height in front.
// Slight spine back-lean (~-6) — the natural pregnancy counter-balance.
// Head pitched down gently (pitch 14) to gaze toward the belly.
const rig = F.rig({
  height: 52,
  headsTall: 7.5,
  sex: 'female',
  weight: 0.6,
  bust: 0.6,
  age: 30,
  build: 'average',
  pose: {
    // Cradling the belly: upper arms slightly back (raiseFwd -20 so the elbow
    // is behind/beside the torso), forearms curled forward (bend 75) so the
    // hands rest against the belly front at navel height.
    // raiseSide 18 gives the arms room to clear the torso width.
    arms: { raiseSide: 18, raiseFwd: -20, bend: 75 },
    // Feet close together — serene standing
    legs: { raiseSide: 5 },
    // Head pitches down — soft gaze toward the belly
    head: { pitch: 14, roll: 2 },
    // Slight back-lean — characteristic of late pregnancy
    spine: { lean: -6 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — soft expression. Half-closed lids for serene, dreamy gaze.
// Use painted lips (mouthAccents) for a clean print at high headsTall.
const head = F.head(rig, { faceShape: 'oval', chin: 0.9 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose:  { type: 'straight', tipRadius: r.head * 0.08, length: r.head * 0.22 },
  mouth: false,
  ears:  { size: r.head * 0.18 },
  brows: { lift: 0.1 },
});
// Painted lip accents — a gentle slight smile
const mouthOpts = { style: 'lips', lipShape: 'natural', expression: 'slightSmile' };
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// Eyes — self-labels (eyes/iris/pupil/lids); hard-union at top level.
// Half-lids for the soft, dreamy gaze downward.
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.12,
  gaze: 'down',
  lids: 'half',
});

// 3. NIPPLES / AREOLAE — top-level part (self-labels 'areola').
// Bare midriff means these are exposed under the cropped top — but we include
// them so the palette can colour them correctly.
const nipples = F.nipples(rig);

// 4. SKIN — weld all body masses. Relaxed hands for gentle cradling.
// navel:true adds the dimple landmark on the belly bulge.
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig, { toes: true }),
  face,
]).label('skin');

// 5. CROPPED TOP — sleeveless or short-sleeve, hem just below the bust
// so the rounded belly is fully exposed (bare midriff).
// hemZ sits just below the chest joint to leave the belly bare.
const chestZ = rig.joints.chest[2];
const topHemZ = chestZ - r.chestX * 0.55;
const top = F.clothing.top(rig, {
  sleeve: 'short',
  hemZ: topHemZ,
  thickness: r.chestX * 0.13,
}).label('top');

// 6. LOW SKIRT — low-rise pants/skirt that starts below the belly and covers
// the hips and legs. hemZ of the top creates the bare midriff gap.
// Using pants with low rise; full length covers the legs.
const skirt = F.clothing.pants(rig, {
  rise: 'low',
  leg: 'slim',
  thickness: r.upperLeg * 0.12,
}).label('skirt');

// 7. HAIR — long flowing hair
const hair = F.hair(rig, {
  style: 'long',
  length: 'long',
  volume: 1.1,
}).label('hair');

// 8. BASE — auto-sized disc under the feet
const base = F.base(rig, {
  radius: rig.opts.height * 0.22,
  thickness: rig.opts.height * 0.038,
}).label('base');

// 9. Hard-union all labelled regions and build.
// faceDetail, handDetail, footDetail for sculpted face/hands/toes.
return sdf.union(skin, eyes, nipples, mouthParts, top, skirt, hair, base)
  .build({
    edgeLength: 0.5,
    detail: [
      ...F.faceDetail(rig),
      ...F.handDetail(rig),
      ...F.footDetail(rig),
    ],
  });
