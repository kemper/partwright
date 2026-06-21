// Warrior figure holding a SWORD in the right fist + an empty SCABBARD
// hung at the left hip from a belt.
// Validates Held + Hung + Ringed composition modes.
// Front = −Y, Z up, figure-left = +X, figure-right = −X.
const { sdf } = api;
const F = sdf.figure;

// ── 1. RIG ──────────────────────────────────────────────────────────────────
// Right arm raised/forward so the sword tip points upward-forward.
// Left arm relaxed at the side.
const rig = F.rig({
  height: 66,
  headsTall: 6,
  build: 'average',
  muscle: 0.4,
  pose: {
    armR: { raiseSide: 40, raiseFwd: 20, bend: 30, twist: 0 },
    armL: { raiseSide: 12, raiseFwd: 6,  bend: 18 },
    legL: { raiseSide: 8 },
    legR: { raiseSide: 8 },
    head: { yaw: -8, pitch: -2 },
    spine: { lean: -3 },
  },
});
const r = rig.r;
const H = rig.opts.height;

// ── 2. HEAD + FACE ──────────────────────────────────────────────────────────
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { tipRadius: r.head * 0.09 },
  mouth: { style: 'smile', width: r.head * 0.32 },
  ears:  { size: r.head * 0.22 },
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.14, lids: 'upper' });

// ── 3. SKIN — right hand is a fist (holds the sword) ───────────────────────
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// ── 4. CLOTHING ─────────────────────────────────────────────────────────────
const pants = F.clothing.pants(rig, { leg: 'slim', rise: 'mid' }).label('pants');
const top   = F.clothing.top(rig, { sleeve: 'short', thickness: r.chestX * 0.12 }).label('top');

// ── 5. BELT (Ringed) ─────────────────────────────────────────────────────────
// Sits over the pants; clearance = pants thickness + tube + margin.
const pantsThick   = r.upperLeg * 0.30;
const beltTube     = r.waist * 0.14;
const beltClear    = pantsThick + beltTube * 0.55 + 0.5;
const beltFrame    = rig.ring.waist;
const belt = F.ring(beltFrame, {
  tube:      beltTube,
  clearance: beltClear,
  segments:  48,
}).label('belt');

// ── 6. SWORD (Held) ─────────────────────────────────────────────────────────
// Built along +Z centred at origin so holdAt seats the grip in the right fist.
// Proportions: grip is ~r.hand×2 long; blade = 0.60 × H; chunky enough to print.

const gripLen  = r.hand * 2.2;
const gripR    = r.hand * 0.26;          // chunky grip tube
const guardW   = r.hand * 3.2;          // cross-guard width — wider for readability
const guardH   = r.hand * 0.55;         // guard bar half-thickness
const guardD   = r.hand * 0.65;         // forward depth of guard
const bladeLen = H * 0.58;
const bladeW   = r.hand * 0.65;         // blade half-width at base (chunky for printing)
const bladeTip = r.hand * 0.14;         // blade half-width at tip
const bladeT   = r.hand * 0.34;         // blade THICKNESS (keep > edgeLength ~0.4)
const pommelR  = r.hand * 0.40;

// Origin = grip centre; +Z = sword axis.
// Pommel at -gripLen*0.55 below origin; guard at +gripLen*0.55; blade above.
const pommelZ  = -gripLen * 0.55;
const guardZ   =  gripLen * 0.55;
const bladeBot =  guardZ;
const bladeTip_z = guardZ + bladeLen;

// Grip cylinder
const grip = sdf.capsule([0, 0, pommelZ], [0, 0, guardZ], gripR);

// Cross-guard: a rounded bar along X, centred at guardZ
const guard = sdf.roundedBox([guardW, guardD, guardH * 2], guardH * 0.4)
  .translate([0, 0, guardZ]);

// Blade: tapered from base to tip along +Z. Use a box scaled by a taper node.
// Simple approach: union two roundedBoxes — one for lower half, one tapered upper.
// Or: use a capsule pair to get a natural taper.
// Blade built as a roundedBox with blend — we taper via translate + two blended boxes.
const bladeBase = sdf.roundedBox([bladeW * 2, bladeT * 2, bladeLen * 0.55], bladeT * 0.25)
  .translate([0, 0, bladeBot + bladeLen * 0.275]);
const bladeUpper = sdf.roundedBox([bladeW * 1.2, bladeT * 1.5, bladeLen * 0.50], bladeT * 0.20)
  .translate([0, 0, bladeBot + bladeLen * 0.725]);
const bladeTipBox = sdf.sphere(bladeTip * 2.5).translate([0, 0, bladeTip_z]);

const blade = bladeBase.smoothUnion(bladeUpper, bladeT * 0.6)
  .smoothUnion(bladeTipBox, bladeT * 0.5);

// Pommel sphere
const pommel = sdf.sphere(pommelR).translate([0, 0, pommelZ]);

// Full sword local node
const swordLocal = grip.union(guard).union(blade).smoothUnion(pommel, pommelR * 0.5);

// Place into the right fist
const heldSword = F.holdAt(swordLocal, rig.grip.R);

// Weld bridge from hand joint to grip cup so sword fuses with the fist
const bridge = sdf.capsule(rig.joints.handR, rig.grip.R.point, r.hand * 0.55);
const sword = heldSword.smoothUnion(bridge, r.hand * 0.4).label('sword');

// ── 7. SCABBARD (Hung) ──────────────────────────────────────────────────────
// Built vertical along +Z, centred at origin.
// Slightly longer + fatter than the blade it would hold; collar at top.
// Scabbard dimensions — print-chunky; must be > 2× tube in every box dimension.
const scabbardLen  = bladeLen + gripLen * 0.3;  // slightly longer than blade
const scabbardW    = r.hand * 1.10;             // half-width (wide enough for the blade)
const scabbardT    = r.hand * 0.70;             // half-thickness (chunky for printing)
const scabbardTube = r.hand * 0.28;             // rounding radius — safe < min(W,T)
const collarH      = r.hand * 0.90;
const collarR      = scabbardW * 0.90;

// Main scabbard body: a smooth elongated capsule-like box
// Dimensions: [2W, 2T, 0.90×len] — smallest dim = 2T = r.hand*1.4, half = 0.7
// scabbardTube = 0.28 < 0.7 ✓
const scabbardBody = sdf.roundedBox(
  [scabbardW * 2, scabbardT * 2, scabbardLen * 0.90],
  scabbardTube,
).translate([0, 0, -scabbardLen * 0.45]);   // top near z=0, bottom near -scabbardLen*0.9

// Throat collar at the top — cylinder (no rounding needed)
const collar = sdf.cylinder(collarR, collarH)
  .translate([0, 0, collarH * 0.5]);

// Cap/chape at the bottom (a rounded point)
const chape = sdf.sphere(scabbardW * 0.80).translate([0, 0, -scabbardLen * 0.92]);

const scabbardLocal = scabbardBody
  .smoothUnion(collar, scabbardTube * 0.8)
  .smoothUnion(chape, scabbardTube * 0.8);

// Left-hip ring point: az=85 pushes more to the left (+X side), slightly behind.
// Extra clearance ensures the scabbard clears the left thigh and hangs freely.
const scabbardClear = beltClear + r.hand * 0.5;   // extra outward push past the thigh
const hipPoint = F.ringPoint(beltFrame, 85, { clearance: scabbardClear });

// Hang: drops top of scabbard onto the hip point, tilt ~20° forward (toward front)
const hungScabbard = F.hangFrom(scabbardLocal, hipPoint, { tilt: 20, anchor: 'top' });

// Frog strap: capsule from the belt ring-point to the scabbard collar top
// ensures fusion even though the scabbard hangs outward from the belt.
const frogBeltPt = F.ringPoint(beltFrame, 85, { clearance: beltClear });
const frogScabbardPt = [hipPoint[0], hipPoint[1], hipPoint[2] + collarH * 0.3];
const frog = sdf.capsule(frogBeltPt, frogScabbardPt, scabbardTube * 0.80);

const scabbard = hungScabbard.union(frog).label('scabbard');

// ── 8. HAIR + BASE ──────────────────────────────────────────────────────────
const hair = F.hair(rig, { style: 'short' }).label('hair');
const base = F.base(rig, { radius: H * 0.25 }).label('base');

// ── 9. ASSEMBLE + BUILD ─────────────────────────────────────────────────────
return sdf.union(skin, eyes, pants, top, belt, sword, scabbard, hair, base)
  .build({
    edgeLength: 0.44,
    detail: [...F.faceDetail(rig), ...F.handDetail(rig)],
  });
