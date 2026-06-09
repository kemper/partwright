// Parametric reduction gear pair — a meshing pinion + gear you can resize to any
// ratio. Two involute spur gears that share a module (so they mesh), auto-spaced
// at the correct centre distance and phased so the teeth interlock. Tweak the
// tooth counts to change the gear ratio. Built with api.gears.pair.
const { gears, labeledUnion } = api;

const p = api.params({
  module:      { type: 'number', default: 2.5, min: 1,  max: 5,  step: 0.5, unit: 'mm', label: 'Module (tooth size)' },
  pinionTeeth: { type: 'int',    default: 12,  min: 6,  max: 30,             label: 'Pinion teeth' },
  gearTeeth:   { type: 'int',    default: 24,  min: 8,  max: 60,             label: 'Gear teeth' },
  thickness:   { type: 'number', default: 8,   min: 3,  max: 20, step: 1,    unit: 'mm', label: 'Thickness' },
  bore:        { type: 'number', default: 5,   min: 2,  max: 12, step: 0.5,  unit: 'mm', label: 'Shaft bore' },
});

const pair = gears.pair({
  module: p.module,
  teeth1: p.pinionTeeth,
  teeth2: p.gearTeeth,
  thickness: p.thickness,
  bore1: p.bore,
  bore2: p.bore,
});

return labeledUnion([
  { name: 'pinion', shape: pair.pinion, color: '#4f86c6' },
  { name: 'gear',   shape: pair.gear,   color: '#e0a458' },
]);
