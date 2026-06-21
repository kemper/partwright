// Toddler with Teddy Bear — chubby big-headed toddler, one arm cradling a small teddy.
// Spotlights the age (young) axis: age:4, headsTall:3.6 — big head, chubby body.
// One arm bent to cradle the teddy bear tucked against the chest.
// Other arm slightly out for balance. Bow-legged toddler stance.
// Romper outfit (top + briefs), short hair, face eyes.
//
// Paint regions: skin, romper, romperBottom, teddy, hair, base
// Eyes self-label: eyes, iris, pupil

const { sdf } = api;
const F = sdf.figure;

// 1. RIG — toddler proportions: age:4, headsTall:3.6 (big cute head), short height
const rig = F.rig({
  height: 26,
  headsTall: 3.6,
  age: 4,
  build: 'average',
  pose: {
    // Bow-legged toddler stance — legs spread out to sides slightly
    legs: { raiseSide: 18 },
    // Left arm bent to cradle teddy — raised forward and across body
    armL: { raiseSide: 30, raiseFwd: 45, bend: 80 },
    // Right arm slightly out — balance, reaching out a bit
    armR: { raiseSide: 28, raiseFwd: 12, bend: 20 },
    // Head tilted toward teddy — looking at it with affection
    head: { yaw: 12, pitch: 8, roll: 8 },
    // Slight lean — weight shift toward the cradled side
    spine: { side: 4, lean: 4 },
  },
});

// 2. HEAD + FACE — big cute toddler face; wide eyes, small nose, smile
const head = F.head(rig);
const mouthOpts = { style: 'smile', smirk: 0.2 };
const face = F.face.assemble(head, rig, {
  eyes: false,
  nose: { type: 'button', tipRadius: rig.r.head * 0.09 },
  mouth: mouthOpts,
  ears: { size: rig.r.head * 0.26 },
  brows: {},
});

// Paintable eyes — hard-unioned at top level with their own label
// Slightly larger eyes for toddler cuteness
const eyes = F.face.eyes(rig, { radius: rig.r.head * 0.20 });

// 3. SKIN — weld all body masses
// Open hands — toddler cuddling the bear with relaxed open arms
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'relaxed' }),
  F.legs(rig),
  F.feet(rig),
  face,
], { k: rig.r.lowerArm * 1.3 }).label('skin');

// 4. ROMPER — toddler one-piece outfit
// Top portion of the romper
const romperTop = F.clothing.top(rig, {
  sleeve: 'short',
  thickness: rig.r.chestY * 0.20,
}).label('romper');

// Bottom portion — briefs/diaper-cover style
const romperBottom = F.clothing.pants(rig, {
  rise: 'high',
  leg: 'slim',
  length: 'briefs',
  thickness: rig.r.upperLeg * 0.20,
}).label('romperBottom');

// 5. TEDDY BEAR — small bear tucked in the crook of the left arm
// Build from spheres and capsules, all labelled 'teddy'
// The bear body sits at about chest height, tucked against the left forearm
// Position near the left forearm cradling position
const j = rig.joints;
const bearScale = rig.r.head * 0.55;   // teddy is roughly half the toddler's head size

// Bear body center — cradled in the crook of the left arm, protruding forward
// Left arm is bent forward (raiseFwd:45, bend:80) so the forearm curves across
// Push the bear well forward of the chest so it's clearly visible from the front
const bearCenterX = j.spine[0] - rig.r.chestX * 0.5;
const bearCenterY = j.spine[1] - rig.r.chestY * 1.3;   // well forward of chest
const bearCenterZ = j.spine[2] + rig.r.chestY * 0.2;

// Bear body (rounded egg shape)
const bearBody = sdf.sphere(bearScale)
  .translate([bearCenterX, bearCenterY, bearCenterZ]);

// Bear head (slightly smaller sphere, above body)
const bearHead = sdf.sphere(bearScale * 0.72)
  .translate([bearCenterX, bearCenterY - bearScale * 0.1, bearCenterZ + bearScale * 1.35]);

// Bear ears (two small spheres on top of head)
const bearEarZ = bearCenterZ + bearScale * 1.35 + bearScale * 0.55;
const bearEarL = sdf.sphere(bearScale * 0.28)
  .translate([bearCenterX + bearScale * 0.52, bearCenterY - bearScale * 0.05, bearEarZ]);
const bearEarR = sdf.sphere(bearScale * 0.28)
  .translate([bearCenterX - bearScale * 0.52, bearCenterY - bearScale * 0.05, bearEarZ]);

// Bear arms (small capsule nubs sticking out from the body sides)
const bearArmL = sdf.capsule(
  [bearCenterX + bearScale * 0.75, bearCenterY, bearCenterZ + bearScale * 0.3],
  [bearCenterX + bearScale * 1.10, bearCenterY, bearCenterZ - bearScale * 0.1],
  bearScale * 0.22
);
const bearArmR = sdf.capsule(
  [bearCenterX - bearScale * 0.75, bearCenterY, bearCenterZ + bearScale * 0.3],
  [bearCenterX - bearScale * 1.10, bearCenterY, bearCenterZ - bearScale * 0.1],
  bearScale * 0.22
);

// Bear legs (small rounded nubs hanging below body)
const bearLegL = sdf.capsule(
  [bearCenterX + bearScale * 0.35, bearCenterY, bearCenterZ - bearScale * 0.65],
  [bearCenterX + bearScale * 0.38, bearCenterY, bearCenterZ - bearScale * 1.10],
  bearScale * 0.25
);
const bearLegR = sdf.capsule(
  [bearCenterX - bearScale * 0.35, bearCenterY, bearCenterZ - bearScale * 0.65],
  [bearCenterX - bearScale * 0.38, bearCenterY, bearCenterZ - bearScale * 1.10],
  bearScale * 0.25
);

// Weld the teddy bear parts together with a soft smoothUnion
const teddy = bearBody
  .smoothUnion(bearHead, bearScale * 0.15)
  .smoothUnion(bearEarL, bearScale * 0.08)
  .smoothUnion(bearEarR, bearScale * 0.08)
  .smoothUnion(bearArmL, bearScale * 0.10)
  .smoothUnion(bearArmR, bearScale * 0.10)
  .smoothUnion(bearLegL, bearScale * 0.10)
  .smoothUnion(bearLegR, bearScale * 0.10)
  .label('teddy');

// 6. SHORT HAIR — toddler with wispy short hair
const hair = F.hair(rig, {
  style: 'short',
  volume: 1.1,
}).label('hair');

// 7. BASE — flat disc the toddler stands on
const base = F.base(rig, {
  radius: rig.opts.height * 0.38,
  thickness: rig.opts.height * 0.05,
}).label('base');

// 8. Hard-union all labelled regions and build.
// Face detail for smooth toddler features. Hand detail for open relaxed hands.
// The teddy overlaps the forearm/chest region so it stays one component.
return sdf.union(skin, eyes, romperTop, romperBottom, teddy, hair, base)
  .build({ edgeLength: 0.5, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
