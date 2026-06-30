// Dummy 13 — THIGHS (2 parts: left + right).
//
// A pair of identical thigh segments. Each has a hip socket on the bottom
// (snaps onto the pelvis hip-ball) and a knee ball on top (the shin cup snaps
// onto this). Mirror-symmetric — left == right.
const p = api.params({
  height: { type: 'number', default: 135, min: 60, max: 240, step: 5, unit: 'mm', label: 'Skeleton height' },
});

const thigh = api.dummy13.thighPart({ spec: { height: p.height } });
const labelled = api.label(thigh, 'thigh', { color: '#3f5878' });

const gap = p.height * 0.05;
return labelled.translate([0, -gap, 0]).add(labelled.translate([0, gap, 0]));
