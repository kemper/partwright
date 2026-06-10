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
    // Right arm raised high — waving hello. abduct 148 = up but slightly out.
    // flex 18 brings it forward so it's visible from the front view.
    // Slight elbow bend — natural "hi!" wave, not a stiff salute.
    armR: { abduct: 148, flex: 18, elbow: 20 },
    // Left arm: relaxed hanging down, slight elbow bend for natural rest.
    armL: { abduct: 14, flex: 6, elbow: 15 },
    // Wide kid stance
    legL: { abduct: 14 },
    legR: { abduct: 14 },
    // Head turned slightly toward viewer/wave side, looking up slightly (cheerful).
    head: { turn: -10, tilt: 6, nod: -8 },
    // Slight spine lean — weight shift as arm goes up
    spine: { side: 3, lean: 2 },
  },
});

// 2. HEAD + FACE — big features for a child
const head = F.head(rig);

const face = F.face.assemble(head, rig, {
  eyes: { radius: rig.r.head * 0.17 },  // big cute child eyes
  nose: { tipRadius: rig.r.head * 0.10 },
  mouth: { smirk: 0.40, width: rig.r.head * 0.52 },  // wide happy smile
  ears: { size: rig.r.head * 0.28 },
  brows: {},         // expressive brows
});

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
], { k: rig.r.foreArm * 1.4 }).label('skin');

// 4. CLOTHES — cargo pants + short-sleeve shirt
const pants = F.clothing.pants(rig, {
  leg: 'cargo',
  rise: 'mid',
  thickness: rig.r.thigh * 0.26,
}).label('pants');

const shirt = F.clothing.top(rig, {
  sleeve: 'short',
  thickness: rig.r.chestY * 0.22,
}).label('shirt');

// 5. HAIR — longish kid hair
const hair = F.hair(rig, { style: 'long' }).label('hair');

// 6. BASE — flat disc so it stands upright on a shelf
const base = F.base(rig, {
  radius: rig.opts.height * 0.28,
  thickness: rig.opts.height * 0.04,
}).label('base');

// 7. Hard-union all labeled regions and build
// edgeLength 0.55 → clean mesh, fewer sub-0.4mm slivers from face seams
return sdf.union(skin, pants, shirt, hair, base).build({ edgeLength: 0.55 });
