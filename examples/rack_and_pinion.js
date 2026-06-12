// Parametric rack & pinion — converts rotation into linear motion. A round
// involute pinion meshing with a straight rack, both sharing the same module so
// they engage. Resize the rack length and pinion teeth for your mechanism.
// Built with api.gears.spur + api.gears.rack.
const { gears, labeledUnion } = api;

const p = api.params({
  module:      { type: 'number', default: 2.5, min: 1,  max: 5,  step: 0.5, unit: 'mm', label: 'Module (tooth size)' },
  pinionTeeth: { type: 'int',    default: 14,  min: 8,  max: 40,             label: 'Pinion teeth' },
  rackTeeth:   { type: 'int',    default: 10,  min: 4,  max: 30,             label: 'Rack teeth' },
  thickness:   { type: 'number', default: 8,   min: 3,  max: 20, step: 1,    unit: 'mm', label: 'Thickness' },
  bore:        { type: 'number', default: 5,   min: 2,  max: 12, step: 0.5,  unit: 'mm', label: 'Pinion bore' },
});

const rack = gears.rack({ module: p.module, teeth: p.rackTeeth, thickness: p.thickness });
const pinion = gears.spur({ module: p.module, teeth: p.pinionTeeth, thickness: p.thickness, bore: p.bore });

// Drop the pinion so its pitch circle is tangent to the rack's pitch line (y=0),
// centred along the rack. A small +Y gap keeps the parts as separate components.
const pitchR = gears.dimensions({ module: p.module, teeth: p.pinionTeeth }).pitchR;
const rackLen = Math.PI * p.module * p.rackTeeth;
const placed = pinion.translate([rackLen / 2, pitchR + 0.3, 0]);

return labeledUnion([
  { name: 'rack',   shape: rack,   color: '#7aa874' },
  { name: 'pinion', shape: placed, color: '#c4624b' },
]);
