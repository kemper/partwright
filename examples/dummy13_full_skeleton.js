// Dummy 13 — FULL ASSEMBLED SKELETON (preview only — print individual parts).
//
// One model that snaps every Dummy 13 frame part together in a standing pose,
// so you can preview the whole figure before printing. NOT a single printable
// piece — open the other `dummy13_*` catalog entries to print the real parts.
//
// Compatible with soozafone's Dummy 13 v1.0 (CC-BY 4.0). The "13" in Dummy 13
// is a name (from Lucky 13 Toys), not a part count: a complete frame is
// actually 28 printable parts at the default ~170mm height.
const p = api.params({
  ballD: { type: 'number', default: 5.7, min: 4.5, max: 6.0, step: 0.1, unit: 'mm', label: 'Mating ball Ø' },
});

return api.label(
  api.dummy13.fullSkeleton({ spec: { ballD: p.ballD } }),
  'skeleton',
  { color: '#8896aa' },
);
