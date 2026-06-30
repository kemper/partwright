// Dummy 13 — WAIST (1 of 28 frame parts).
//
// Inline body segment between abdomen and hips. Two 6mm sockets. Compatible
// with soozafone's Dummy 13 v1.0 (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Mating ball Ø' },
});

const waist = api.dummy13.waistPart({ spec: { ballD: p.ballD } });
return api.label(waist, 'waist', { color: '#6b8db4' });
