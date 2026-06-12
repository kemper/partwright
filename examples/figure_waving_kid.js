// Cheerful young child waving hello — one arm raised high, other relaxed.
// Cargo pants, short-sleeve shirt, longish hair, wide kid stance, flat base.
// ~5 heads tall for cute child proportions.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — child proportions (headsTall=5 = big cute head) + waving pose.
// Right arm (figure's right = -X) raised high waving.
// Left arm (figure's left = +X) relaxed at side.
// Wide kid stance for playful feel.
const rig = F.rig({
  height: 60,
  headsTall: 5,
  build: 'average',
  pose: {
    // Right arm raised high — waving hello. raiseSide 148 = up but slightly out.
    // raiseFwd 18 brings it forward so it's visible from the front view.
    // Slight elbow bend — natural "hi!" wave, not a stiff salute.
    armR: { raiseSide: 148, raiseFwd: 18, bend: 20 },
    // Left arm: relaxed hanging down, slight elbow bend for natural rest.
    armL: { raiseSide: 14, raiseFwd: 6, bend: 15 },
    // Wide kid stance
    legL: { raiseSide: 14 },
    legR: { raiseSide: 14 },
    // Head turned slightly toward viewer/wave side, looking up slightly (cheerful).
    head: { yaw: -10, roll: 6, pitch: -8 },
    // Slight spine lean — weight shift as arm goes up
    spine: { side: 3, lean: 2 },
  },
});

// 2. HEAD + FACE — big features for a child. Eyes stay OUT of the skin weld
// (step 7 unions them as their own labelled region so they paint separately).
const head = F.head(rig);

// Laughing open mouth — fits the cheerful wave. The same options feed the
// carve (in assemble) and the teeth + lips accents below.
const mouthOpts = { style: 'open', open: 0.55, width: rig.r.head * 0.5 };
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: rig.r.head * 0.10 },
  mouth: mouthOpts,
  ears: { size: rig.r.head * 0.28 },
  brows: {},         // expressive brows
});

// Paintable eyes: hard-unioned at the top level with their own label.
const eyes = F.face.eyes(rig, { radius: rig.r.head * 0.17 }); // iris style: labels eyes/iris/pupil itself
// Teeth band + lip ring inside/around the open mouth ('teeth' / 'lips' labels).
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// 3. SKIN — weld all body masses into one painted region.
// Raise k slightly so limb joints blend more softly (less balloon-animal look).
// Open grip on waving hand reads as open wave.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
], { k: rig.r.lowerArm * 1.4 }).label('skin');

// 4. CLOTHES — cargo pants + short-sleeve shirt
const pants = F.clothing.pants(rig, {
  leg: 'cargo',
  rise: 'mid',
  thickness: rig.r.upperLeg * 0.26,
}).label('pants');

const shirt = F.clothing.top(rig, {
  sleeve: 'short',
  thickness: rig.r.chestY * 0.22,
}).label('shirt');

// 5. HAIR — longish kid hair
const hair = F.hair(rig, { style: 'afro', volume: 1.3 }).label('hair');

// 6. BASE — flat disc so it stands upright on a shelf
const base = F.base(rig, {
  radius: rig.opts.height * 0.28,
  thickness: rig.opts.height * 0.04,
}).label('base');

// 7. Hard-union all labeled regions and build.
// The face detail region refines the head mesh (smooth carved smile, round
// eyes); the hand regions resolve the sculpted fingers — both stay local so
// the body keeps the cheap global grid.
return sdf.union(skin, eyes, mouthParts, pants, shirt, hair, base)
  .build({ edgeLength: 0.55, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
