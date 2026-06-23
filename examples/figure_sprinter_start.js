// Sprinter at the Blocks — a muscular man in a four-point sprint-start crouch:
// hands planted on the ground ahead, the lead leg deeply bent, the rear leg
// driven back and nearly straight, chest leaned forward over the line, head up
// and eyes locked down the track. Bare chest to show the athletic build
// (muscle: 0.6) — the torso carries a navel and paintable areolae; the arms
// reach down-and-forward to the ground (grip 'open', flat) and weld the hands
// to the figure so the whole crouch stays ONE component.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — muscular man, 7.5 heads tall. The set position: a forward spine lean
//    over the hands, the left (lead) leg forward and deeply bent, the right
//    (rear) leg extended back near-straight, arms swung straight down-forward to
//    the ground, head pitched up to look down the track.
const rig = F.rig({
  height: 56,
  headsTall: 7.5,
  sex: 'male',
  build: 'average',
  weight: 0.35,
  muscle: 0.6,
  pose: {
    // Arms straight down-and-forward, reaching toward the ground ahead of the
    // line (raiseFwd 30 swings them forward, near-straight, so the hands drop to
    // hip level and ahead — the four-point set reach).
    armL: { raiseSide: 0, raiseFwd: 30, bend: 10 },
    armR: { raiseSide: 0, raiseFwd: 30, bend: 10 },
    // Lead leg (left) forward, knee deeply flexed under the chest.
    legL: { raiseFwd: 55, bend: 95 },
    // Rear leg (right) driven back, nearly straight.
    legR: { raiseFwd: -30, bend: 20 },
    // Chest leaned forward over the hands; head up, eyes down the track. A
    // 15° lean is as far as the muscled torso can lean before the waist weld
    // and pec/trap muscle masses separate from the pelvis (the deep leg crouch
    // already pitches the body forward, so the set still reads correctly).
    spine: { lean: 15 },
    head: { pitch: -20 },
  },
});
const r = rig.r;

// 2. HEAD + FACE — square jaw, broad nose, an intense focused set (flat lips,
//    slight frown). Carved mouth would tear on a tall head, so paint the lips.
const mouthOpts = { style: 'lips', lipShape: 'flat', expression: 'slightFrown', width: r.head * 0.46 };
const head = F.head(rig, { faceShape: 'square', jaw: 1.12, cheek: 1.05 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'broad', tipRadius: r.head * 0.11, length: r.head * 0.22 },
  mouth: false,
  ears: { size: r.head * 0.24 },
  brows: { thickness: 1.25, lift: 0 },
});

// Painted flat lips (additive — clean on a tall head) + paintable eyes, intense
// upper-lid set, gaze straight ahead down the track.
const lips = F.face.mouthAccents(rig, mouthOpts);
const eyes = F.face.eyes(rig, { radius: r.head * 0.16, lids: 'upper', gaze: 'middle' });

// 3. SKIN — weld every body mass. Bare torso carries a navel; open flat hands
//    plant on the ground. The areolae are a SEPARATE top-level region (step 4b).
const skin = F.weld(rig, [
  F.torso(rig, { navel: true }),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'open' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4b. AREOLAE — flush paintable discs + tiny nipples, hard-unioned at the top
//     level so the 'areola' region survives the body weld.
const nipples = F.nipples(rig, { on: skin });

// 5. RUNNING SHORTS — high-cut briefs.
const shorts = F.clothing.pants(rig, {
  rise: 'mid',
  leg: 'slim',
  length: 'briefs',
}).label('shorts');

// 6. HAIR — a short coily fade.
const hair = F.hair(rig, { style: 'short', texture: 'coils' }).label('hair');

// 7. TRACK SPIKES — footwear keyed off the sole frame, flat under the feet.
const shoes = F.clothing.shoes(rig, { label: 'shoes' });

// 8. BASE — sizes to the footprint; rises to meet the lower foot so the figure
//    rests as one component. Hands weld via the arms (always one component).
const base = F.base(rig).label('base');

// 9. Hard-union the labelled regions and build. faceDetail meshes the head
//    finely; handDetail resolves the open fingers planted on the ground.
return sdf.union(skin, eyes, lips, nipples, shorts, hair, shoes, base)
  .build({ edgeLength: 0.5, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
