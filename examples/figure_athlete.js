// Athletic Woman — a lean, toned sprinter in a ready stance. Showcases the
// `muscle` axis composed with the female anthropometric silhouette: `muscle:
// 0.55` defines the deltoids, biceps, abdominals and quads/calves while
// `weight: 0.34` keeps her lean, so the definition reads as athletic tone
// rather than bulk. Muscle is orthogonal to weight — lean AND defined.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — lean, toned woman. A grounded ready stance: feet apart, arms held
//    a little out and forward (the sprinter's set), a slight forward spine lean.
const rig = F.rig({
  height: 58,
  headsTall: 7.5,
  sex: 'female',
  build: 'slim',
  weight: 0.34,
  muscle: 0.55,
  pose: {
    // Arms a touch out from the body and forward, soft elbow bend — the toned
    // shoulders/biceps read from the front.
    armL: { raiseSide: 18, raiseFwd: 14, bend: 30 },
    armR: { raiseSide: 18, raiseFwd: 14, bend: 30 },
    // Athletic stance: feet apart, right foot a step back, knees soft.
    legL: { raiseSide: 9, bend: 8 },
    legR: { raiseSide: 9, raiseFwd: -8, bend: 14 },
    // A slight forward set of the upper body — coiled, ready.
    spine: { lean: 8 },
    head: { pitch: 6 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — focused, level gaze.
const mouthOpts = { style: 'smile', smirk: 0, width: r.head * 0.46 };
const head = F.head(rig, { faceShape: 'oval', cheek: 1.05 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: r.head * 0.09, length: r.head * 0.2 },
  mouth: mouthOpts,
  ears: { size: r.head * 0.22 },
});

const eyes = F.face.eyes(rig, { radius: r.head * 0.16, lids: 'upper' });

// 3. SKIN — weld every body mass; relaxed hands.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. SPORTS TOP — a short-hemmed crop so the toned midsection shows.
const top = F.clothing.top(rig, {
  sleeve: 'none',
  hemZ: rig.joints.chest[2] - r.chestY * 0.4,
  thickness: r.chestY * 0.22,
}).label('top');

// 5. SHORTS — high-cut track briefs (length:'briefs' = seat + hip coverage only)
//    so the quads and calves stay visible.
const shorts = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  length: 'briefs',
}).label('shorts');

// 6. HAIR — a ponytail for movement.
const hair = F.hair(rig, { style: 'ponytail', length: 'long' }).label('hair');

// 7. RUNNING SHOES — keyed off the sole frame, flat on the ground.
const shoes = F.clothing.shoes(rig, { label: 'shoes' });

// 8. BASE — a track-stand disc.
const base = F.base(rig, { radius: rig.opts.height * 0.24 }).label('base');

// 9. Hard-union the labelled regions and build.
return sdf.union(skin, eyes, top, shorts, hair, shoes, base)
  .build({ edgeLength: 0.5, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
