// Dummy 13 — HIPS / PELVIS (1 part).
//
// Pelvis box with a waist ball on top (snaps into the torso's waist socket)
// and a hip ball on each side (the thighs snap onto these). Print orientation:
// as built — waist-ball up, hip-balls horizontal. Hip balls are the largest
// joint on the figure (9mm at default scale) so they bear the most pose load.
const p = api.params({
  height: { type: 'number', default: 135, min: 60, max: 240, step: 5, unit: 'mm', label: 'Skeleton height' },
});

const hips = api.dummy13.hipsPart({
  spec: { height: p.height },
});

return api.label(hips, 'hips', { color: '#6b8db4' });
