// SDF showcase: a 28-tooth turbine/spur wheel built around polarRepeat.
//
// Why polarRepeat here: with 28 teeth, polarArray would union 28 rotated
// copies of the tooth SDF. polarRepeat folds the angular coordinate into a
// single sector, so the tooth field is evaluated ONCE per mesh sample —
// noticeably cheaper at this count and topologically identical.
//
// Regions (3, partition-friendly):
//   - "teeth" : the toothed outer rim (single child of polarRepeat)
//   - "web"   : the flat connecting web, with 6 lightening holes
//             (lightening holes are placed with polarArray — small count,
//             low-symmetry, exactly where polarArray shines)
//   - "hub"   : the central boss with a bore

const { sdf } = api;

// ---- Dimensions ---------------------------------------------------------
const R_OUTER = 30;        // tip radius of the gear teeth (≤ 35 for bbox<=80)
const R_ROOT  = 24;        // root radius (where the tooth meets the web)
const R_WEB   = 23;        // web disk outer radius (sits inside the root)
const R_HUB   = 7;         // central hub outer radius
const R_BORE  = 3;         // bore through the hub
const R_LIGHT_RING = 15;   // ring radius for lightening holes
const R_LIGHT_HOLE = 2.4;  // each lightening hole

const TEETH = 28;          // >=16 — the whole point
const LIGHTENING = 6;      // small count — polarArray is correct here

const WEB_T  = 3.0;        // web thickness
const TEETH_T = 6.0;       // tooth (rim) thickness
const HUB_T  = 7.0;        // hub thickness (taller than the web)

// ---- One tooth ---------------------------------------------------------
// We model ONE tooth at the +X side, sitting between R_ROOT and R_OUTER.
// polarRepeat then folds the whole angular coordinate into the sector
// containing this tooth, producing 28 perfect copies. We give the tooth a
// gentle taper toward the tip so it reads as a gear rather than a slab.
//
// Tangential width: pick a flank thickness ~ 60% of the sector arc length
// at the pitch radius so neighbouring teeth don't merge.
const PITCH_R = (R_OUTER + R_ROOT) / 2;
const SECTOR_ARC = (2 * Math.PI * PITCH_R) / TEETH;
const TOOTH_W = SECTOR_ARC * 0.55;       // tangential thickness

// Build the tooth in its own local frame, then translate to the rim.
// A roundedBox gives a clean tip and a soft engagement face for the flank.
// (Length runs along X = radial; width along Y = tangential.)
const TOOTH_L = (R_OUTER - R_ROOT) + 2;  // a bit of overlap into the rim
const tooth = sdf
  .roundedBox([TOOTH_L, TOOTH_W, TEETH_T], 0.6)
  .translate(R_ROOT + TOOTH_L / 2 - 1, 0, 0)
  // Trapezoidal profile: narrows at the tip.
  // taper(rate, 'x') scales the (Y,Z) cross-section by 1 + rate*x. We want
  // the tip (large x) to be narrower than the root, so use a small negative
  // rate. -0.012 ≈ 35% narrowing across the tooth length.
  .taper(-0.012, 'x');

// Continuous root cylinder so the teeth share a smooth annular base
// (otherwise neighbouring teeth would only touch at one line). Cored
// out to a true annulus so the central web stays visible — a solid
// disk here would swallow the web entirely, leaving no paintable
// surface for that region post-union.
const rootCyl = sdf.cylinder(R_ROOT + 0.4, TEETH_T)
  .subtract(sdf.cylinder(R_WEB - 0.6, TEETH_T + 1));

// One sector = root ring chunk + one tooth, smoothly welded at the fillet.
const sector = rootCyl.smoothUnion(tooth, 0.6);

// Fold 28 copies via polarRepeat. Single-child label propagation: tagging
// the polarRepeat result paints the whole toothed ring as ONE region.
const teethRing = sector
  .polarRepeat(TEETH, { axis: 'z' })
  .label('teeth');

// ---- Web (the connecting disk) -----------------------------------------
// A thin disk between hub and root, with 6 lightening holes drilled
// through it via polarArray (low count — fine and readable).
const webDisk = sdf.cylinder(R_WEB, WEB_T);

const lightHole = sdf.cylinder(R_LIGHT_HOLE, WEB_T + 1);
const lightRing = lightHole.polarArray(LIGHTENING, {
  axis: 'z',
  radius: R_LIGHT_RING,
});

// Web minus lightening holes — A's label survives subtract, so this whole
// part paints as "web". We use a soft subtract so the holes' rims read as
// printed-and-finished rather than knife-cut.
const web = webDisk.smoothSubtract(lightRing, 0.4).label('web');

// ---- Hub ---------------------------------------------------------------
// A central boss, slightly taller than the web, with a through bore.
const hubBoss = sdf.cylinder(R_HUB, HUB_T);
const bore = sdf.cylinder(R_BORE, HUB_T + 1);
const hub = hubBoss.subtract(bore).label('hub');

// ---- Compose -----------------------------------------------------------
// Three labelled regions; we use sharp unions between them so each region
// keeps its label (smoothUnion would erase them per the partition rules).
//
// Order: teethRing ∪ web → hub at the centre.
const wheel = teethRing.union(web).union(hub);

return wheel.build({ edgeLength: 0.4 });
