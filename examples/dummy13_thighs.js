// Dummy 13 — THIGHS (2 of 28 frame parts).
//
// A pair of thigh segments. Sockets on each end: hip (top — hip/shoulder
// bridge) and knee (bottom — knee/elbow bridge). ~24mm between sockets.
// Compatible with soozafone's Dummy 13 v1.0 (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Mating ball Ø' },
});

const part = api.dummy13.thighPart({ spec: { ballD: p.ballD } });
const plate = api.dummy13.plateOf(part, 2, 10);
return api.label(plate, 'thigh', { color: '#3f5878' });
