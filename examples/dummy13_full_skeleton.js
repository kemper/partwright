// Dummy 13 — FULL ASSEMBLED SKELETON (preview only — print the individual parts).
//
// One model that snaps every part together in a standing pose so you can
// preview the whole figure before printing. NOT a single printable piece —
// it's the assembly-pose visual.
//
// To print, open the individual `dummy13_<part>` catalog entries (head, torso,
// hips, upper_arms, forearms, hands, thighs, shins).
const p = api.params({
  height: { type: 'number', default: 135, min: 60, max: 240, step: 5, unit: 'mm', label: 'Skeleton height' },
});

return api.label(
  api.dummy13.fullSkeleton({ spec: { height: p.height } }),
  'skeleton',
  { color: '#8896aa' },
);
