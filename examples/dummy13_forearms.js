// Dummy 13 — FOREARMS (2 parts: left + right).
//
// A pair of identical forearm segments. Each has an elbow socket on the
// bottom (snaps onto the upper-arm elbow-ball) and a wrist ball on top (the
// hand cup snaps onto this). Mirror-symmetric — left == right.
const p = api.params({
  height: { type: 'number', default: 135, min: 60, max: 240, step: 5, unit: 'mm', label: 'Skeleton height' },
});

const forearm = api.dummy13.forearmPart({ spec: { height: p.height } });
const labelled = api.label(forearm, 'forearm', { color: '#c97b6e' });

const gap = p.height * 0.04;
return labelled.translate([0, -gap, 0]).add(labelled.translate([0, gap, 0]));
