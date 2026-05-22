// Desk organizer — rounded base, 3 pen holders, 1 wide compartment
const { Manifold, CrossSection } = api;

// --- Parameters ---
const baseW = 120, baseD = 60, baseH = 5, baseR = 6;
const penRi = 6, penWall = 2, penH = 80, penCount = 3, penSpacing = 25;
const penRo = penRi + penWall;
const compW = 40, compD = 50, compH = 40, compWall = 2, compR = 3;

// --- Rounded rectangle helper via hull of 4 corner circles ---
// Circle segment count is left to the user's Modeling Quality preset.
function roundedRect(w, h, r) {
  const hw = w / 2 - r, hh = h / 2 - r;
  return CrossSection.hull([
    CrossSection.circle(r).translate([hw, hh]),
    CrossSection.circle(r).translate([-hw, hh]),
    CrossSection.circle(r).translate([-hw, -hh]),
    CrossSection.circle(r).translate([hw, -hh]),
  ]);
}

// --- Base ---
const base = roundedRect(baseW, baseD, baseR).extrude(baseH);

// --- Pen holders (3 hollow cylinders) ---
const penY = -5;
const penHolders = [];
for (let i = 0; i < penCount; i++) {
  const x = (i - 1) * penSpacing;
  const outer = Manifold.cylinder(penH, penRo, penRo).translate([x, penY, baseH]);
  const inner = Manifold.cylinder(penH + 1, penRi, penRi).translate([x, penY, baseH]);
  penHolders.push(outer.subtract(inner));
}

// --- Wide compartment (hollow rounded box, open top) ---
const compX = baseW / 2 - compW / 2 - 6;
const compOuterCS = roundedRect(compW, compD, compR);
const compInnerCS = compOuterCS.offset(-compWall);
const compartment = compOuterCS.extrude(compH).translate([compX, 0, baseH])
  .subtract(compInnerCS.extrude(compH + 1).translate([compX, 0, baseH]));

// --- Combine ---
return Manifold.union([base, ...penHolders, compartment]);
