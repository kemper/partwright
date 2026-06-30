// Wide-brim hat figure — "Crowned" attachment via F.placeOnHead
// Figure faces −Y, Z up, +X = figure-left
// Default rig: height=60, headsTall=6 → headH=10, headX≈4, head(ry)≈4.6, headZ≈5

const { sdf } = api;
const F = sdf.figure;
const rig = F.rig({ height: 60, headsTall: 6 });

// --- Head radius reference -------------------------------------------------
const headR = rig.r.head;   // ~4.6  (lateral y-radius)
const headX = rig.r.headX;  // ~4.0  (left-right x-radius)
const headZ = rig.r.headZ;  // ~5.0  (front-back z-radius)
// Use the largest horizontal radius as the reference for hat sizing
const hR = Math.max(headR, headX);  // ~4.6

// ---------------------------------------------------------------------------
// HAT — built centred on origin, brim in XY plane, crown rising +Z
//
// Layout (all local z):
//   z=0           — hat brim bottom / bottom of the hat geometry
//   z=brimThk     — brim top / base of crown
//   z=brimThk+crownH — crown top
//
// placeOnHead with anchor='bottom' seats local z=0 at:
//   restZ (hair top ≈ 60.6) - embed
// embed = hR * 0.9 ≈ 4.1 → brim bottom at z≈56.5, just above the upper
// forehead → face clearly visible below brim from the front.
// ---------------------------------------------------------------------------

// BRIM: wide flat disc  (radius 2.4 × hR, thick 1.6, rounded edge 0.55)
const brimR   = hR * 2.4;    // ~11 units radius — genuinely wide
const brimThk = 1.6;
const brimEdge = 0.55;       // edge rounding gives a gentle upswept look

const brimDisc = sdf.roundedCylinder(brimR, brimThk, brimEdge)
  .translate([0, 0, brimThk * 0.5]);  // brim bottom at z=0, top at z=brimThk

// CROWN: tall tapered cylinder rising from brim top
// Make it appreciably taller than the brim: height ≈ 1.6 × hR ≈ 7.4 units
const crownBase   = hR * 1.10;     // ~5.06 — slightly proud of head radius
const crownHeight = hR * 1.3;      // tall enough to read, not a funnel
const crownEdge   = 0.6;

// NOTE: SDF .taper is NEGATIVE to narrow toward +Z (positive flares OUT into a
// funnel — the original bug). A gentle inward taper gives a real hat crown.
const crownBody = sdf.roundedCylinder(crownBase, crownHeight, crownEdge)
  .taper(-0.16, 'z')                // narrower at the top
  .translate([0, 0, brimThk + crownHeight * 0.5]);
// Domed top so the crown reads finished, not a hollow tube.
const crownTop = sdf.ellipsoid(crownBase * 0.86, crownBase * 0.86, crownBase * 0.5)
  .translate([0, 0, brimThk + crownHeight]);

// HATBAND: a slightly-proud ring right at the crown base (above the brim)
// Slightly larger radius than the crown base to stand out as a band
const bandH   = 1.3;
const bandR   = crownBase + 0.3;   // 0.3 units proud of crown surface
const bandEdge = 0.45;

const hatband = sdf.roundedCylinder(bandR, bandH, bandEdge)
  .translate([0, 0, brimThk + bandH * 0.5]);

// Assemble hat: brim + band (hard union so band reads distinct) then
// smooth-fuse crown into the combined base
const hatBase = brimDisc.smoothUnion(hatband, 0.5);
const hat = hatBase.smoothUnion(crownBody, 1.0).smoothUnion(crownTop, 0.8)
  .label('hat');

// ---------------------------------------------------------------------------
// FIGURE parts
// ---------------------------------------------------------------------------
const hair = F.hair(rig, { style: 'short' }).label('hair');

// Seat hat on hair. embed = hR * 0.9 (~4.1) sinks the brim bottom to
// just above the upper forehead so the full face reads below the brim.
const seatedHat = F.placeOnHead(hat, rig, {
  rest: hair,
  embed: hR * 0.9,
});

// Assemble figure
const headNode = F.head(rig);
const face     = F.face.assemble(headNode, rig);
const eyes     = F.face.eyes(rig);
const neck     = F.neck(rig);
const torso    = F.torso(rig);
const arms     = F.arms(rig);
const hands    = F.hands(rig);
const legs     = F.legs(rig);
const feet     = F.feet(rig);
const base     = F.base(rig);

// Weld all body parts
const body = F.weld(rig, [
  face, eyes, hair, neck, torso, arms, hands, legs, feet,
]);

// Union body + hat + base, then mesh
return body.union(seatedHat).union(base)
  .build({ edgeLength: 0.4, detail: F.faceDetail(rig) });
