// Dummy 13 — ANKLE bridges (2 of 28 frame parts).
//
// A pair of double-ball bridge pieces, one per ankle. Connects the shin's
// bottom socket to the foot's top socket. Compatible with soozafone's Dummy 13
// v1.0 (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Ball Ø' },
});

const part = api.dummy13.ankleBridge({ spec: { ballD: p.ballD } });
const plate = api.dummy13.plateOf(part, 2, 6);
return api.label(plate, 'ankle', { color: '#c97b6e' });
