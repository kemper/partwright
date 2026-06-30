// Dummy 13 — HEAD (1 part).
//
// A rounded head with a socket cup underneath that snaps over the torso's
// neck-ball. Print orientation: stand the part with the cup pointing UP and
// the head above it (as built) — the cup's spherical cavity is the only
// overhang and it self-supports at this scale. For a smoother face you may
// prefer to print head-up, supports on the cup.
//
// Sized for the default 135mm-tall skeleton. Override `height` for any other
// figure size — every Dummy 13 part scales from the same value.
const p = api.params({
  height: { type: 'number', default: 135, min: 60, max: 240, step: 5, unit: 'mm', label: 'Skeleton height' },
  style:  { type: 'select', default: 'box', options: ['box', 'sphere'], label: 'Head style' },
});

const head = api.dummy13.headPart({
  spec: { height: p.height },
  style: p.style,
});

return api.label(head, 'head', { color: '#d9b48f' });
