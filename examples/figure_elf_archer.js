// Wood-elf archer — slim, alert, a longbow held upright in the left hand.
// Showcases POINTED ears (the elf/fantasy type) left fully exposed by hair worn
// BEHIND the ears. ~7.5 heads tall, athletic.
// Front = −Y, Z up, figure's left = +X, right = −X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — light, poised stance; left arm out holding the bow upright, right
// hand drawn back near the cheek as if nocking an arrow.
const rig = F.rig({
  height: 66,
  headsTall: 7.5,
  build: 'slim',
  sex: 'neutral',
  pose: {
    // Left arm extended forward/out, holding the bow upright.
    armL: { raiseSide: 60, raiseFwd: 34, bend: 18, twist: 10 },
    // Right hand drawn back toward the face (nocking).
    armR: { raiseSide: 38, raiseFwd: 40, bend: 95, twist: -12 },
    // Light bladed stance.
    legL: { raiseSide: 9, raiseFwd: 12 },
    legR: { raiseSide: 11, raiseFwd: -10 },
    // Head turned to sight down the arrow.
    head: { yaw: -16, pitch: -2 },
    spine: { turn: -6, lean: 3 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — narrow elf face, pointed ears LEFT EXPOSED (the hair below
// is worn 'behind' so these read fully).
const head = F.head(rig, { faceShape: 'diamond', chin: 1.1 });
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { tipRadius: r.head * 0.09, bridge: 1.05, width: 0.85 },
  mouth: { style: 'lips', fullness: 0.85, width: r.head * 0.38 },
  ears: { type: 'pointed', size: r.head * 0.4, tilt: 20 },   // ← swept-back elf ears
  brows: { lift: 0.6 },
});
// Seat the eyeballs proud of the face surface (the assembled brow/nose push the
// front forward of the eye anchor) so the eyes/iris/pupil regions stay paintable.
const fwd = rig.dir.headForward, ep = r.head * 0.12;
const eyes = F.face.eyes(rig, { radius: r.head * 0.16, lids: 'upper', gaze: 'left' })
  .translate([fwd[0] * ep, fwd[1] * ep, fwd[2] * ep]);

// 3. SKIN.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. CLOTHES — sleeveless ranger tunic + slim leggings + tall boots.
const tunic = F.clothing.top(rig, { sleeve: 'none', thickness: r.chestY * 0.16 }).label('tunic');
const leggings = F.clothing.pants(rig, { leg: 'slim', rise: 'mid', thickness: r.upperLeg * 0.18 }).label('leggings');
const boots = F.clothing.boots(rig, { label: 'boots' });   // self-labels 'boots' + 'sole'

// 5. HAIR — swept-back shoulder hair worn BEHIND the (pointed) ears so they show.
const hair = F.hair(rig, { style: 'long', length: 'mid', ears: 'behind', part: 'center' }).label('hair');

// 6. BASE.
const base = F.base(rig, { radius: rig.opts.height * 0.24 }).label('base');

// 7. LONGBOW — a tall limber arc held upright in the left grip. Built as a
// capsule chain bowing along −Y (away from the body), with a string chord.
const gL = rig.grip.L;
const bowH = r.head * 4.2;                 // bow reaches well above and below the grip
const belly = -r.head * 0.55;              // how far the limbs bow forward (−Y)
const grip = gL.point;
// Five points from bottom tip → grip → top tip, bellied toward −Y.
const bowPt = (t) => {                      // t in −1..1
  const z = grip[2] + t * bowH;
  const y = grip[1] + belly * (1 - t * t);  // max belly at the grip, tips pull back
  return [grip[0], y, z];
};
const N = 8;
let bow;
let prev = bowPt(-1);
for (let i = 1; i <= N; i++) {
  const t = -1 + (2 * i) / N;
  const p = bowPt(t);
  const rad = r.hand * 0.22 * (1 - 0.45 * Math.abs(t));  // taper toward the tips
  const seg = sdf.capsule(prev, p, rad);
  bow = bow === undefined ? seg : bow.smoothUnion(seg, r.hand * 0.18);
  prev = p;
}
// Bowstring: a thin chord from tip to tip, drawn back toward the right hand.
const topTip = bowPt(1), botTip = bowPt(-1);
const drawY = j.handR[1];                  // string pulled back to the nocking hand
const nock = [grip[0], drawY, (topTip[2] + botTip[2]) / 2];
const string = sdf.capsule(topTip, nock, r.hand * 0.05)
  .smoothUnion(sdf.capsule(nock, botTip, r.hand * 0.05), r.hand * 0.04);
// Riser: a short grip section through the hand CENTRE so the bow fuses to the
// fist into one printable piece (the grip point alone only grazes the fingers).
const riser = sdf.capsule(bowPt(0.18), j.handL, r.hand * 0.34);
const longbow = bow.smoothUnion(string, r.hand * 0.06).smoothUnion(riser, r.hand * 0.2).label('bow');

// 8. Union + build.
return sdf.union(skin, eyes, tunic, leggings, boots, hair, longbow, base)
  .build({ edgeLength: 0.78, detail: [...F.faceDetail(rig, { edgeLength: r.head * 0.06, eyeEdgeLength: r.head * 0.016, irisEdgeLength: r.head * 0.009 }), ...F.handDetail(rig)] });
