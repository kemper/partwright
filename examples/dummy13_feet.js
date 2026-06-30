// Dummy 13 — FEET (2 of 28 frame parts).
//
// A pair of flat foot pads. Each has a 6mm socket on top (mates with the
// ankle bridge ball from above) and a flat footprint extending forward (-Y)
// for standing stability. Compatible with soozafone's Dummy 13 v1.0
// (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Mating ball Ø' },
});

const part = api.dummy13.footPart({ spec: { ballD: p.ballD } });
const plate = api.dummy13.plateOf(part, 2, 14);
return api.label(plate, 'foot', { color: '#3f5878' });
