// Free Hugs — warm, welcoming character with both arms opened wide forward
// as if going in for a big hug. Heart faceShape, full lips, beaming big smile,
// upper eyelids, female silhouette, soft bob hair.
// Showcases: heart faceShape, mouth.style:'lips' with lipShape:'full',
// female sex silhouette, and upper eyelids.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — female proportions, warm curvy build.
// Both arms open wide and forward — the inviting hug silhouette.
// raiseSide 35: arms lifted slightly to be open and welcoming (not T-pose stiff).
// raiseFwd 55: arms swung forward so the open hands come toward the viewer.
// bend 55: forearms curved gently inward to embrace.
// Head tilted slightly for warmth.
const rig = F.rig({
  height: 58,
  headsTall: 6.5,
  build: 'average',
  sex: 'female',
  weight: 0.45,
  bust: 0.4,
  pose: {
    // Both arms: wide open and swung forward in the open-hug gesture.
    // raiseSide 45: arms lifted higher to widen the silhouette from the front.
    // raiseFwd 50: arms swung forward so the hands reach toward the viewer.
    // bend 50: forearms curved gently inward to embrace.
    arms: { raiseSide: 45, raiseFwd: 50, bend: 50 },

    // Legs: natural relaxed stance — not too wide, just grounded.
    legs: { raiseSide: 7 },

    // Head: roll 6 tilts warmly to figure's left, slight yaw for friendliness.
    head: { roll: 6, yaw: -6, pitch: -3 },

    // Spine: very slight lean forward to project the welcome energy.
    spine: { lean: 3 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — heart faceShape for a warm, expressive look.
// Full lips with big smile. Upper eyelids for a bright-eyed look.
const head = F.head(rig, {
  faceShape: 'heart',
  chin: 0.78,
  cheek: 1.2,
});

// mouthOpts shared between assemble and mouthAccents so lips agree.
const mouthOpts = {
  style: 'lips',
  lipShape: 'full',
  expression: 'bigSmile',
  fullness: 1.35,
  width: r.head * 0.54,
};

const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'button', tipRadius: r.head * 0.078, flare: 0.55 },
  mouth: false,   // mouthAccents handles it at top level (lips label)
  ears: { size: 0.85 },
  brows: { thickness: 0.9, lift: 0.25 },
});

// Mouth accents: sculpted lips labelled 'lips' (top-level, not in skin weld).
const mouthParts = F.face.mouthAccents(rig, mouthOpts);

// Eyes: bright open eyes, upper lids for definition.
// Nudge eyes forward along headForward so a round/heart/cheeky face does not
// swallow the domes (else eyes/iris/pupil/lids paint to 0 triangles).
const hf = rig.dir.headForward, eyePush = r.head * 0.07;
const eyes = F.face.eyes(rig, {
  radius: r.head * 0.145,
  lids: 'upper',
  gaze: 'middle',
})
  .translate([hf[0] * eyePush, hf[1] * eyePush, hf[2] * eyePush]);

// 3. SKIN — weld all body masses; open hands reaching forward for the hug.
const skin = F.weld(rig, [
  F.torso(rig, { navel: false }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CLOTHES — a cheerful dress (top with long hem = dress with flared skirt).
// Slightly more generous thickness to fill the armpit/shoulder area.
const dress = F.clothing.top(rig, {
  sleeve: 'short',
  hemZ: rig.opts.height * 0.06,    // floor-length, covers legs fully
  thickness: r.chestY * 0.36,
}).label('dress');

// Simple flat shoes, friendly rounded look.
const shoes = F.clothing.shoes(rig, {
  size: 1.05,
  thickness: r.foot * 0.18,
  sole: { style: 'welt', lip: r.foot * 0.12 },
}).label('shoes');

// 5. HAIR — soft bob framing the heart face, slightly wavy.
// Part center for symmetry. Volume 1.1 for a full, bouncy bob.
const hair = F.hair(rig, {
  style: 'bob',
  length: 'mid',
  volume: 1.1,
  part: 'center',
  texture: 'wavy',
}).label('hair');

// 6. BASE — round disc; slightly wider for the open-arms stance.
const base = F.base(rig, {
  radius: rig.opts.height * 0.20,
  thickness: rig.opts.height * 0.04,
}).label('base');

// 7. Union and build.
// faceDetail meshes head/eyes/lips crisply; handDetail for open fingers.
// edgeLength 0.45 is coarse enough to stay under budget with wavy hair + lips.
return sdf.union(skin, eyes, mouthParts, dress, shoes, hair, base)
  .build({
    edgeLength: 0.45,
    detail: [...F.faceDetail(rig, { edgeLength: r.head * 0.065, eyeEdgeLength: r.head * 0.04 }), ...F.handDetail(rig)],
  });
