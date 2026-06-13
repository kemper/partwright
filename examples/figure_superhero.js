// Superhero taking off — one fist punched straight up, cape sweeping behind,
// chest emblem, boots and gloves. ~7.5 heads, stocky heroic build.
// Front = −Y, Z up, figure's left = +X.
const { sdf } = api;
const F = sdf.figure;

// 1. RIG — left fist straight up (sky-punch), right arm braced at the side;
// one knee slightly popped for the take-off look, head looking up.
// twist: 90 on the raised arm rotates the elbow-curl plane so the forearm
// curls UPWARD (not forward) — the fist ends up above the crown.
const rig = F.rig({
  height: 66,
  headsTall: 7.5,
  build: 'stocky',
  pose: {
    armL: { raiseSide: 178, raiseFwd: 0, bend: 12, twist: 90 },  // sky punch, twist rotates fist up
    armR: { raiseSide: 8,   raiseFwd: -8, bend: 22 },             // braced at the side
    legL: { raiseSide: 6 },
    legR: { raiseSide: 8, bend: 28, raiseFwd: 10 },                // popped knee
    head: { pitch: -12 },                                     // looking up
    spine: { lean: -3 },
  },
});
const j = rig.joints, r = rig.r;

// 2. HEAD + FACE — determined smile, strong brows, jaw set.
const head = F.head(rig);
const face = F.face.assemble(head, rig, {
  eyes:  false,
  nose:  { tipRadius: r.head * 0.10 },
  mouth: { style: 'smile', smirk: 0.12, width: r.head * 0.40 },
  ears:  { size: r.head * 0.24 },
  brows: {},
});
const eyes = F.face.eyes(rig, { radius: r.head * 0.17 });

// 3. SKIN — fists (detail region required for knuckles).
const skin = F.weld(rig, [
  F.torso(rig),
  F.neck(rig),
  F.arms(rig),
  F.hands(rig, { grip: 'fist' }),
  F.legs(rig),
  F.feet(rig),
  face,
]).label('skin');

// 4. SUIT — snug long-sleeve top + leggings.
const suitTop  = F.clothing.top(rig, { sleeve: 'long', thickness: r.chestY * 0.17 }).label('suit');
const suitLegs = F.clothing.pants(rig, { leg: 'slim', rise: 'high', thickness: r.upperLeg * 0.18 }).label('suitLegs');

// 5. EMBLEM — a proud disc on the chest, facing forward (front = −Y).
// A roundedCylinder oriented along Z, rotated 90° around X so flat faces
// point along ±Y. The back of the disc is buried inside the suit to guarantee
// solid overlap; the front sticks out past the chest surface.
// r.chestY ≈ 4.8 for stocky 66h; j.chest[1] is a small value near 0.
const emblemR       = r.chestX * 0.43;   // disc radius (≈ 2.5 units)
const emblemTotalH  = r.chestY * 0.90;   // full Y span: back buried + front proud
// Back face of disc = j.chest[1] − 0.8×r.chestY (well inside the suit).
// Front face = back − totalH (sticks out by ~30% of chestY past the suit).
const emblemBackY   = j.chest[1] - r.chestY * 0.80;
const emblemCenterY = emblemBackY - emblemTotalH * 0.5;
const emblem = sdf.roundedCylinder(emblemR, emblemTotalH, emblemR * 0.12)
  .rotate([90, 0, 0])
  .translate([0, emblemCenterY, j.chest[2] + r.chestY * 0.08])
  .label('emblem');

// 6. CAPE — swept slab from the upper back to near the knees.
// The cape overlaps the figure's back at the top (so the union fills any gap),
// then sweeps outward and downward. No separate pins needed — the top of the
// panel is buried a few units into the back and smoothly merges.
const SL = j.upperArmL, SR = j.upperArmR;
const shoulderSpan = Math.abs(SL[0] - SR[0]);

// Vertical span: from just above shoulder level down to just above the knees.
const capeTopZ  = SL[2] + r.neck * 0.3;
const kneeZ     = Math.max(j.lowerLegL[2], j.lowerLegR[2]);
const capeBotZ  = kneeZ + r.lowerLeg * 0.1;   // stop just above knee level
const capeH     = capeTopZ - capeBotZ;

// Panel half-extents: slightly wider than shoulder span.
// Depth: the back of the torso is at roughly j.chest[1] + r.chestY (positive Y = back).
// Position the cape so its front face overlaps the back of the torso.
const capeW      = shoulderSpan * 1.05;  // half-width in X
const capeDepth  = r.chestY * 1.0;       // full depth so it sweeps visibly
// taper rate: wider at bottom. rate ≈ 0.55/capeH → bottom is ~27% wider than top.
const capeFlare  = 0.55 / capeH;

// The cape panel is built around Z=0, then rotated and translated.
// Back of the body centroid in Y ≈ r.chestY (positive Y = behind).
// We position the cape so its front face is at the back of the torso and overlaps.
// Midpoint Z of the cape = (capeTopZ + capeBotZ)/2.
// The cape's back face center Y = bodyBackY + capeDepth/2 + offset for sweep.
const bodyBackY  = j.chest[1] + r.chestY * 1.0;   // approximate back surface of torso

// Build the panel; slight backward lean (8°) so the bottom of the cape swings
// a little behind the figure — more "draping" than "swept".
// rotate([8,0,0]): top goes +Y (backward), bottom comes slightly forward.
const capePanel = sdf.roundedBox([capeW, capeDepth, capeH], r.chestY * 0.12)
  .taper(-capeFlare)
  .rotate([8, 0, 0])
  .translate([0, bodyBackY + capeDepth * 0.38, (capeTopZ + capeBotZ) * 0.5]);

// The cape panel overlaps the body's back surface at its top (capePanel front
// face is inside the torso), so no separate yoke connector is needed.
// Label directly.
const capeAll = capePanel.label('cape');

// 7. BOOTS — colored overlays following the shank bones, mid-shin cutoff.
// For each leg: capsule from mid-shank to ankle, with a toe cap.
// Mid-shin is roughly halfway between knee and ankle.
function makeBoot(knee, ankle) {
  const midShin = [
    knee[0] * 0.35 + ankle[0] * 0.65,
    knee[1] * 0.35 + ankle[1] * 0.65,
    knee[2] * 0.35 + ankle[2] * 0.65,
  ];
  const soleZ = ankle[2] - r.foot * 0.95;
  // Shank portion: capsule from mid-shin to ankle
  const shank = sdf.capsule(midShin, ankle, r.lowerLeg * 1.22);
  // Toe/foot cap: ellipsoid covering the foot
  const toeCap = sdf.ellipsoid(r.foot * 1.08, r.foot * 1.65, r.foot * 1.0)
    .translate([ankle[0], ankle[1] - r.foot * 0.5, soleZ + r.foot * 0.62]);
  return shank.smoothUnion(toeCap, r.foot * 0.65);
}
const boots = makeBoot(j.lowerLegL, j.footL).union(makeBoot(j.lowerLegR, j.footR)).label('boots');

// 8. GLOVES — colored overlays from mid-forearm to hand/fist.
// Each glove: capsule from mid-forearm to wrist + a sphere over the fist.
function makeGlove(elbow, wrist, hand) {
  const midFore = [
    elbow[0] * 0.45 + wrist[0] * 0.55,
    elbow[1] * 0.45 + wrist[1] * 0.55,
    elbow[2] * 0.45 + wrist[2] * 0.55,
  ];
  const fore = sdf.capsule(midFore, wrist, r.lowerArm * 1.28);
  // Fist cover: a rounded sphere over the hand joint (gloved fist reads cleanly)
  const fistCover = sdf.sphere(r.hand * 1.08).translate(hand);
  return fore.smoothUnion(fistCover, r.hand * 0.45);
}
const gloves = makeGlove(j.lowerArmL, j.wristL, j.handL)
  .union(makeGlove(j.lowerArmR, j.wristR, j.handR))
  .label('gloves');

// 9. HAIR — short heroic cut.
const hair = F.hair(rig, { style: 'spiked' }).label('hair');

// 10. BASE — wide disc to support the off-balance pose.
const base = F.base(rig, { radius: rig.opts.height * 0.24 }).label('base');

// 11. Union + build. Include both faceDetail and handDetail.
return sdf.union(skin, eyes, suitTop, suitLegs, emblem, capeAll, boots, gloves, hair, base)
  .build({ edgeLength: 0.55, detail: [...F.faceDetail(rig), ...F.handDetail(rig)] });
