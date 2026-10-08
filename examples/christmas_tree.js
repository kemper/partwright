// Low-poly decorated Christmas tree — self-colouring (labels + api.paint.label),
// with the bauble decorations scattered deterministically across the foliage
// via api.scatter (see /ai/deform.md) instead of a handful of hand-placed spheres.
const { Manifold, CrossSection, label } = api;

// ---- Trunk: octagonal cylinder, lengthened so a clear stub shows below the foliage ----
const trunk = Manifold.cylinder(4.5, 1.4, 1.2, 8).translate([0, 0, -0.8]);
// spans z = -0.8 .. 3.7 ; bottom tier base is at z=3, so z<3 of the trunk is visible

// ---- Foliage: stacked low-poly cones, decreasing radius, overlapping in Z ----
const tierData = [
  // [baseZ, height, radiusLow, radiusHigh]
  [3, 6, 7.0, 1.5], // bottom tier (widest)
  [7, 5, 5.5, 1.2], // middle tier
  [10, 5, 4.0, 0.8], // upper tier
  [13, 4, 2.8, 0.4], // top tier
];
const tiers = tierData.map(([baseZ, h, rLow, rHigh]) =>
  Manifold.cylinder(h, rLow, rHigh, 6).translate([0, 0, baseZ])
);
const foliage = Manifold.union(tiers);

// ---- Star: crisp 5-point star CrossSection, extruded thin, stood upright facing -Y ----
const POINTS = 5;
const rOuter = 2.2;
const rInner = rOuter * 0.42;
const starVerts = [];
for (let i = 0; i < POINTS * 2; i++) {
  const r = (i % 2 === 0) ? rOuter : rInner;
  const a = Math.PI / 2 + (i * Math.PI) / POINTS; // first vertex at top (+Y), CCW
  starVerts.push([r * Math.cos(a), r * Math.sin(a)]);
}
const starThickness = 1.4;
const star = CrossSection.ofPolygons([starVerts])
  .extrude(starThickness) // flat star in XY, thickness along +Z
  .translate([0, 0, -starThickness / 2]) // center the thickness on z=0
  .rotate([90, 0, 0]) // stand upright: +Y(up)->+Z, thickness ->-Y (faces front)
  .translate([0, 0, 18.3]); // seat on the apex

// Short stem so the star is one connected solid with the tree (it dives into the top tier)
const stem = Manifold.cylinder(4.6, 0.7, 0.7, 8).translate([0, 0, 14.0]);
// spans z = 14 .. 18.6 : base inside top tier (r~2.2 there), top inside the star body

// ---- Baubles: scattered across the sloped foliage faces, three colourways ----
// alignToNormal + a slight sink (offset) nestles each sphere into its facet so
// the union fuses; |n.z| < 0.9 keeps them off the flat tier shelves/caps, and
// the z band keeps them off the trunk stub and the star.
const foliageBottom = 3;
const foliageTop = 17;
const bauble = Manifold.sphere(1.05, 12);
function scatterBaubles(seed, name, count) {
  const instances = api.scatter(foliage, bauble, {
    count,
    seed,
    alignToNormal: true,
    spin: true,
    scale: [0.85, 1.2],
    offset: -0.35, // sink in slightly so every bauble fuses with the foliage
    minSpacing: 2.2,
    where: (p, n) => Math.abs(n[2]) < 0.9 && p[2] > foliageBottom + 0.5 && p[2] < foliageTop - 0.5,
  });
  return label(instances, name);
}
const baubles = [
  scatterBaubles(101, 'baubleRed', 18),
  scatterBaubles(202, 'baubleGold', 18),
  scatterBaubles(303, 'baubleBlue', 18),
];

// ---- Labelled assembly (labels survive booleans -> paint by name) ----
const foliageL = label(foliage, 'foliage');
const trunkL = label(trunk, 'trunk');
const starL = label(star.add(stem), 'star');

let tree = foliageL.add(trunkL).add(starL);
for (const b of baubles) tree = tree.add(b);

api.paint.label("foliage", [0.13, 0.42, 0.2]);
api.paint.label("trunk", [0.4, 0.26, 0.13]);
api.paint.label("baubleRed", [0.85, 0.12, 0.14]);
api.paint.label("baubleGold", [0.95, 0.75, 0.15]);
api.paint.label("baubleBlue", [0.15, 0.35, 0.8]);
api.paint.label("star", [1, 0.82, 0.1]);
return tree;
