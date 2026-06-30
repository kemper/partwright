// Dummy 13 — ABDOMEN (1 of 28 frame parts).
//
// Inline body segment between chest and waist. Two 6mm sockets — one on top
// (chest bridge), one on the bottom (waist bridge). Compatible with soozafone's
// Dummy 13 v1.0 (CC-BY 4.0).
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Mating ball Ø' },
});

const abdomen = api.dummy13.abdomenPart({ spec: { ballD: p.ballD } });
return api.label(abdomen, 'abdomen', { color: '#6b8db4' });
