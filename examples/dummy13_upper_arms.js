// Dummy 13 — UPPER ARMS (2 of 28 frame parts).
//
// A pair of upper-arm segments. Each has a 6mm socket on each end: the top
// (shoulder) socket accepts the hip/shoulder bridge ball; the bottom (elbow)
// socket accepts the knee/elbow bridge ball. ~16mm between socket centres.
// Compatible with soozafone's Dummy 13 v1.0 (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Mating ball Ø' },
});

const part = api.dummy13.upperArmPart({ spec: { ballD: p.ballD } });
const plate = api.dummy13.plateOf(part, 2, 8);
return api.label(plate, 'upperArm', { color: '#3f5878' });
