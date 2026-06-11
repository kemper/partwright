// Warrior lunge figurine — one leg forward (knee bent), one leg back
// (nearly straight), both arms straight out to the sides (T-pose).
// Adult athlete, ~7.5 heads, slim build, fitted athletic top + slim
// leggings, hair in a bun. On a display slab with two ankle-support posts.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — warrior lunge.
//    legL = front leg: stepped forward, knee bent
//    legR = back leg: pushed back, knee nearly straight
//    Arms: both abducted 90° = straight out to sides (T)
const rig = F.rig({
  height: 60,
  headsTall: 7.5,
  build: 'slim',
  pose: {
    armL: { abduct: 90, flex: 0, elbow: 0 },
    armR: { abduct: 90, flex: 0, elbow: 0 },
    // Front leg: thigh forward 45°, knee bent 45° → shin vertical, foot
    // planted forward of the body. Back leg pushed back, nearly straight.
    legL: { abduct: 3, flex: 45, knee: 45 },
    legR: { abduct: 3, flex: -30, knee: 5 },
    head: { turn: 0, tilt: 0, nod: 2 },
    spine: { lean: 5, turn: 0, side: 0 },
  },
});

// 2. HEAD + FACE
// Eyes are lifted out to a top-level label (paintable independently of skin).
// Mouth uses the carved 'smile' style — calm, subtle, befitting a focused pose.
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { tipRadius: rig.r.head * 0.09 },
  mouth: { style: 'smile', smirk: 0.05, width: rig.r.head * 0.38 },
  ears:  { size: rig.r.head * 0.26 },
  brows: {},
});

// 2b. EYES — hard-unioned at the top level with their own paint label.
const eyes = F.face.eyes(rig, { radius: rig.r.head * 0.14 }); // iris style: labels eyes/iris/pupil itself

// 3. SKIN — weld all body masses.
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
], { k: rig.r.upperArm * 0.95 }).label('skin');

// 4. CLOTHES — athletic short-sleeve top + slim leggings
const top   = F.clothing.top(rig, { sleeve: 'short' }).label('top');
const pants = F.clothing.pants(rig, { leg: 'slim', rise: 'high' }).label('pants');

// 5. HAIR — bun
const hair = F.hair(rig, { style: 'bun' }).label('hair');

// 6. BASE — in a lunge both ankles sit higher than a standing pose (the bent
// bones shorten the legs' vertical reach), so the body is lowered until the
// back sole sinks into a display slab, and the front foot — still higher —
// gets a small stepping-stone.
const ankleL = rig.joints.ankleL;   // front-leg ankle (higher)
const ankleR = rig.joints.ankleR;   // back-leg ankle

const H    = rig.opts.height;
const midX = (ankleL[0] + ankleR[0]) * 0.5;
const midY = (ankleL[1] + ankleR[1]) * 0.5;

const sThick = H * 0.040;
const slab = sdf.roundedBox(
  [H * 0.48, H * 0.66, sThick],
  sThick * 0.35,
).translate([midX, midY, sThick * 0.5]);

// Lower the body so the lower sole is sunk `sink` into the slab top.
const soleL = ankleL[2] - rig.r.foot;
const soleR = ankleR[2] - rig.r.foot;
const sink  = 0.9;
const drop  = Math.min(soleL, soleR) - (sThick - sink);

// Stepping-stone under the higher foot, reaching from inside the slab to
// just above that foot's (lowered) sole.
const hiSoleAfter = Math.max(soleL, soleR) - drop;
const hiAnkle = soleL > soleR ? ankleL : ankleR;
const stoneTop = hiSoleAfter + sink * 0.7;
const footLen = rig.r.foot * 2.4;
const stone = sdf.roundedBox(
  [rig.r.foot * 2.6, footLen * 1.35, stoneTop - 0.5],
  sThick * 0.3,
).translate([hiAnkle[0], hiAnkle[1] - footLen * 0.12, (stoneTop + 0.5) * 0.5]);

const base = slab.union(stone).label('base');

// 7. Hard-union all labeled regions, lower the body onto the base, and build.
// detail: F.faceDetail(rig) meshes the head ~3x finer for smooth face features
// while the body keeps the global 0.5 grid; its sphere centers move down with
// the lowered body.
const body = sdf.union(skin, eyes, top, pants, hair).translate([0, 0, -drop]);
const detail = F.faceDetail(rig).map((d) => ({
  ...d,
  center: [d.center[0], d.center[1], d.center[2] - drop],
}));
return sdf.union(body, base)
  .build({ edgeLength: 0.5, detail });
