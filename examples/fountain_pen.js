// Fountain Pen — a capped-and-posted fountain pen: gold nib, black grip,
// burgundy barrel, gold trim band, a posted cap with a finial, and a sprung
// pocket clip. A stationery subject the catalog doesn't cover, and a tidy
// lesson in composing a turned object from stacked tapered cylinders along one
// axis, self-colored via api.label, then laid down horizontally.
//
// Built along +Z (nib at z=0 → cap finial at the top), every section overlapping
// its neighbor so the whole pen welds into one component, then rotated to lie
// flat for the catalog pose.
const { Manifold } = api;

const p = api.params({
  bodyColor: { type: 'color',  default: '#8a1f2d', label: 'Barrel color' },
  trimColor: { type: 'color',  default: '#d9a93a', label: 'Trim/clip color' },
  length:    { type: 'number', default: 150, min: 110, max: 190, step: 5, unit: 'mm', label: 'Overall length' },
});

const NIB = '#e8c14f';   // gold nib
const GRIP = '#26262b';  // black grip + finial
const cyl = (h, rl, rh, z, seg = 48) => Manifold.cylinder(h, rl, rh ?? rl, seg).translate([0, 0, z]);

const L = p.length;
const rBarrel = 6.2;
const rCap = 7.4;

// --- Nib: a flattened tapered cone to a rounded tip ------------------------
const nibCone = cyl(16, 1.4, 4.2, 0, 40)         // narrow tip (z=0) → grip width
  .scale([1, 0.62, 1]);                            // flatten like a real nib
const nibTip = Manifold.sphere(1.4, 20).scale([1, 0.62, 1]); // rounded point at z=0
const nib = api.label(nibCone.add(nibTip), 'nib', { color: NIB });

// --- Grip section: black taper the hand rests on ---------------------------
const grip = api.label(cyl(26, 4.2, 5.6, 13), 'grip', { color: GRIP });

// --- Barrel: the burgundy body, with a gold trim band at the joint ---------
const barrel = api.label(cyl(L * 0.5, 5.6, rBarrel, 36), 'barrel', { color: p.bodyColor });
const joinBand = api.label(cyl(3, rBarrel + 0.25, rBarrel + 0.25, 35), 'band-front', { color: p.trimColor });

// --- Posted cap: slides over the rear of the barrel ------------------------
const capZ = 36 + L * 0.5 - 10;                    // overlap the barrel by 10mm
const capLen = L - capZ - 6;
const cap = api.label(cyl(capLen, rCap, rCap, capZ, 48), 'cap', { color: p.bodyColor });
const capLip = api.label(cyl(2.5, rCap + 0.3, rCap + 0.3, capZ + 1), 'band-cap', { color: p.trimColor });
const finial = api.label(
  cyl(3, rCap, rCap * 0.6, capZ + capLen - 1.5).add(Manifold.sphere(rCap * 0.6, 28).translate([0, 0, capZ + capLen + 1.5])),
  'finial', { color: GRIP },
);

// --- Pocket clip: a flat sprung bar standing off the cap -------------------
const clipLen = capLen * 0.74;
const clipZ0 = capZ + 4;
const clipBar = Manifold.cube([2.4, 2.0, clipLen], false)
  .translate([rCap - 0.8, -1.0, clipZ0]);          // inner edge embedded in the cap to weld
const clipBall = Manifold.sphere(1.6, 18).translate([rCap + 0.8, 0, clipZ0 + clipLen]); // rounded tail
const clip = api.label(clipBar.add(clipBall), 'clip', { color: p.trimColor });

// --- Assemble + lay flat ----------------------------------------------------
const pen = Manifold.union([nib, grip, joinBand, barrel, cap, capLip, finial, clip])
  .rotate([0, 90, 0]);                             // pen axis → horizontal (X)
return pen;
