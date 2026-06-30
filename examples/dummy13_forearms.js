// Dummy 13 — FOREARMS (2 of 28 frame parts).
//
// A pair of forearm segments. Sockets on each end: elbow (top — knee/elbow
// bridge) and wrist (bottom — accepts the hand's wrist ball). ~20mm between
// socket centres. Compatible with soozafone's Dummy 13 v1.0 (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Mating ball Ø' },
});

const part = api.dummy13.forearmPart({ spec: { ballD: p.ballD } });
const plate = api.dummy13.plateOf(part, 2, 8);
return api.label(plate, 'forearm', { color: '#3f5878' });
