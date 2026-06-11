// Parametric two-part project box, built with the api.enclosure namespace.
// Pick a lip-nesting lid (friction close, no hardware) or a screw lid (four
// tapped corner bosses + countersunk lid holes, sized from the metric table).
// Tune the size, wall, corner radius, and fit in the Customizer. A correct fit
// reports componentCount === 2 — base and lid stay separate across the gap.
const { enclosure, labeledUnion } = api;

const p = api.params({
  width:      { type: 'number', default: 70, min: 40, max: 140, step: 2, unit: 'mm', label: 'Width' },
  depth:      { type: 'number', default: 50, min: 30, max: 110, step: 2, unit: 'mm', label: 'Depth' },
  height:     { type: 'number', default: 30, min: 16, max: 70,  step: 1, unit: 'mm', label: 'Height' },
  wall:       { type: 'number', default: 2.2, min: 1.4, max: 4, step: 0.2, unit: 'mm', label: 'Wall thickness' },
  radius:     { type: 'number', default: 4, min: 0, max: 12, step: 0.5, unit: 'mm', label: 'Corner radius' },
  lidType:    { type: 'select', default: 'screw', options: ['lip', 'screw'], label: 'Lid type' },
  fit:        { type: 'select', default: 'snug', options: ['press', 'snug', 'normal', 'loose'], label: 'Lid fit' },
  screwSize:  { type: 'select', default: 'M3', options: ['M2.5', 'M3', 'M4'], label: 'Screw size (screw lid)' },
  explode:    { type: 'number', default: 10, min: 0, max: 40, step: 1, unit: 'mm', label: 'Explode (lift lid for view)' },
});

const opts = {
  size: [p.width, p.depth, p.height],
  wall: p.wall,
  radius: p.radius,
  type: p.lidType,
  fit: p.fit,
};
if (p.lidType === 'screw') opts.screw = { size: p.screwSize };

const { base, lid } = enclosure.box(opts);

// Lift the lid clear so the tile reads as a two-part box; set Explode = 0 to
// close it. The lid comes back seated on the base, so we just translate it up.
return labeledUnion([
  { name: 'base', shape: base, color: '#4f7da6' },
  { name: 'lid',  shape: lid.translate([0, 0, p.explode]), color: '#c2ad7e' },
]);
