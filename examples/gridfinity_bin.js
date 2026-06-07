// Gridfinity bin + baseplate — the 42 mm modular storage standard.
// `api.Gridfinity` builds spec-compliant feet that seat into the baseplate.
const { Manifold } = api;

// A 2×1 bin, 6 height units tall (7 mm each = 42 mm), hollow with a stacking lip.
const bin = api.Gridfinity.bin({ cols: 2, rows: 1, heightUnits: 6 });

// A 3×2 baseplate to drop bins into, placed alongside for reference.
const plate = api.Gridfinity.baseplate({ cols: 3, rows: 2 }).translate([110, 0, 0]);

return Manifold.compose([bin, plate]);
