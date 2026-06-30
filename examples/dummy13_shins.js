// Dummy 13 — SHINS (2 of 28 frame parts).
//
// A pair of shin segments. Sockets on each end: knee (top — knee/elbow
// bridge) and ankle (bottom — ankle bridge). ~33mm between socket centres.
// Compatible with soozafone's Dummy 13 v1.0 (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Mating ball Ø' },
});

const part = api.dummy13.shinPart({ spec: { ballD: p.ballD } });
const plate = api.dummy13.plateOf(part, 2, 8);
return api.label(plate, 'shin', { color: '#3f5878' });
