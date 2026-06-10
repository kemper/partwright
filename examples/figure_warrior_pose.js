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
    legL: { abduct: 3, flex: 35, knee: 58 },
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

// 6. BASE — The lunge places both ankles elevated above z=0.
// Build a wide rounded-rectangle slab + two slim tapered posts under each
// ankle, smoothly blended together, then label the result 'base'.
const ankleL = rig.joints.ankleL;   // front-leg ankle
const ankleR = rig.joints.ankleR;   // back-leg ankle

const H    = rig.opts.height;
const midX = (ankleL[0] + ankleR[0]) * 0.5;
const midY = (ankleL[1] + ankleR[1]) * 0.5;

// Flat slab: rounded rectangle
const sThick = H * 0.040;
const sHalfX = H * 0.29;
const sHalfY = H * 0.33;
const slab = sdf.roundedBox(
  [sHalfX * 2, sHalfY * 2, sThick],
  sThick * 0.35,
).translate([midX, midY, sThick * 0.5]);

// Posts under each ankle — tapered cylinders, smoothly joined to the slab.
// Post top must be above ankle center to guarantee overlap.
const postR  = rig.r.foot * 1.6;
const postK  = postR * 0.7;  // blend radius

const postHL = Math.max(ankleL[2] - sThick + rig.r.shank * 0.85, postR * 1.0);
const postHR = Math.max(ankleR[2] - sThick + rig.r.shank * 0.85, postR * 1.0);

const postL = sdf.cylinder(postR, postHL)
  .translate([ankleL[0], ankleL[1], sThick + postHL * 0.5]);

const postRnode = sdf.cylinder(postR, postHR)
  .translate([ankleR[0], ankleR[1], sThick + postHR * 0.5]);

// If the two posts are close in XY, bridge them with a center mass so
// the base reads as one unified pedestal from the front view.
const bridgeR = postR * 1.05;
const bridgeH = Math.min(postHL, postHR) * 0.65;
const bridge  = sdf.cylinder(bridgeR, bridgeH)
  .translate([midX, midY, sThick + bridgeH * 0.5]);

const base = slab
  .smoothUnion(postL,     postK)
  .smoothUnion(postRnode, postK)
  .smoothUnion(bridge,    postK * 0.8)
  .label('base');

// 7. Hard-union all labeled regions and build.
// detail: F.faceDetail(rig) meshes the head ~3x finer for smooth face features
// while the body keeps the global 0.5 grid.
return sdf.union(skin, eyes, top, pants, hair, base)
  .build({ edgeLength: 0.5, detail: F.faceDetail(rig) });
