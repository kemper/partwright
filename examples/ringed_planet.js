// Ringed Planet — a banded gas giant encircled by a tilted, multi-band ring
// system. An astronomy subject with no cousin in the catalog. Two techniques on
// show: building latitude color bands by intersecting a sphere with overlapping
// z-slabs, and a concentric multi-color ring disk welded into the planet's
// equator so the whole thing is ONE connected, self-colored piece.
//
// Z-up, mm. Bands and ring sub-bands overlap their neighbors slightly so the
// boolean unions weld (touching-at-a-plane wouldn't). The finished body is
// tilted on its axis for the iconic pose.
const { Manifold } = api;

const p = api.params({
  planetR:   { type: 'number', default: 18,  min: 10, max: 30, step: 1, unit: 'mm', label: 'Planet radius' },
  ringSpan:  { type: 'number', default: 2.35, min: 1.6, max: 3, step: 0.05, label: 'Ring outer (×R)' },
  bands:     { type: 'int',    default: 6,   min: 3,  max: 9,  label: 'Latitude bands' },
  tilt:      { type: 'number', default: 16,  min: 0,  max: 35, step: 1, unit: '°', label: 'Axial tilt' },
});

const Rp = p.planetR;
const OVER = 0.6; // band/shell overlap so neighbors weld volumetrically

// --- Planet: latitude bands from overlapping spherical zones ---------------
const planetSphere = Manifold.sphere(Rp, 72);
const BANDS = ['#f0e2c0', '#e3c98a', '#dcae6e', '#ecd6a4', '#cf9b54', '#e8d3a0', '#d4b878', '#f0e2c0', '#cf9b54'];
const zones = [];
for (let i = 0; i < p.bands; i++) {
  const z0 = -Rp + (2 * Rp * i) / p.bands - OVER;
  const z1 = -Rp + (2 * Rp * (i + 1)) / p.bands + OVER;
  const slab = Manifold.cube([4 * Rp, 4 * Rp, z1 - z0], true).translate([0, 0, (z0 + z1) / 2]);
  zones.push(api.label(planetSphere.intersect(slab), 'band' + i, { color: BANDS[i % BANDS.length] }));
}
const planet = Manifold.union(zones);

// --- Rings: one flat disk, colored into concentric sub-bands ---------------
// Inner edge tucks 0.96·R into the equator so the rings weld to the planet.
const ringOuter = p.ringSpan * Rp;
const ringInner = 0.96 * Rp;
const ringH = 1.1;
const tube = (r, h) => Manifold.cylinder(h, r, r, 96, true);
const disk = tube(ringOuter, ringH).subtract(tube(ringInner, ringH * 4));

const stops = [ringInner, 1.35 * Rp, 1.6 * Rp, 1.95 * Rp, ringOuter];
const RING_COLORS = ['#cdbb95', '#a89060', '#d8c9a4', '#b8a070'];
const ringParts = [];
for (let i = 0; i < stops.length - 1; i++) {
  const shell = tube(stops[i + 1] + 0.5, ringH * 4).subtract(tube(stops[i] - 0.5, ringH * 5));
  ringParts.push(api.label(disk.intersect(shell), 'ring' + i, { color: RING_COLORS[i % RING_COLORS.length] }));
}
const rings = Manifold.union(ringParts);

// --- Assemble + tilt on the axis -------------------------------------------
const saturn = api.expectUnion([planet, rings], { expectComponents: 1 }).rotate([p.tilt, 0, 0]);
return saturn;
