// Dummy 13 — SHINS + FEET (2 parts: left + right).
//
// A pair of identical shin segments with an integrated foot footprint. Each
// has a knee socket on top (snaps onto the thigh knee-ball) and a flat foot
// at the bottom that lets the figure stand. Mirror-symmetric — left == right.
//
// Print orientation: as built — foot-down, knee-cup-up. The flat foot is the
// build-plate footprint; no supports needed.
const p = api.params({
  height: { type: 'number', default: 135, min: 60, max: 240, step: 5, unit: 'mm', label: 'Skeleton height' },
});

const shin = api.dummy13.shinPart({ spec: { height: p.height } });
const labelled = api.label(shin, 'shin', { color: '#3f5878' });

const gap = p.height * 0.06;
return labelled.translate([0, -gap, 0]).add(labelled.translate([0, gap, 0]));
