// Snap-fit parts box — lid clicks shut with cantilever tabs, no screws or glue.
// The rounded tab hook slides in smoothly and snaps into the catch window with
// less force than a sharp edge; flex the tab with a thumbnail to pop it open.
// Box and lid print flat, side by side. Fully parametric.
const { Manifold, printFit } = api;

const p = api.params({
  width:  { type: 'number', default: 56, min: 40, max: 120, step: 2, unit: 'mm', label: 'Width' },
  depth:  { type: 'number', default: 40, min: 30, max: 100, step: 2, unit: 'mm', label: 'Depth' },
  height: { type: 'number', default: 20, min: 10, max: 60,  step: 1, unit: 'mm', label: 'Height' },
  wall:   { type: 'number', default: 2.4, min: 1.5, max: 4, step: 0.2, unit: 'mm', label: 'Wall thickness' },
});

const { width: Wb, depth: Db, height: H, wall } = p;
const clipW = 16, clipLen = 12, clipT = 2.2, hookD = 1.8;

// ---- Box: open-top tray ----
let box = Manifold.cube([Wb, Db, H], false);
const cavity = Manifold.cube([Wb - 2 * wall, Db - 2 * wall, H], false)
  .translate([wall, wall, wall]);
box = box.subtract(cavity);

// Rounded cantilever tabs on the +Y / -Y walls. `rounded: true` adds a
// quarter-cylinder fillet at the hook retention edge for smoother operation.
const { clip, catch: catchWin } = printFit.snapFit({
  width: clipW, length: clipLen, thickness: clipT, hookDepth: hookD,
  fit: 'normal', rounded: true,
});

box = box.add(clip.translate([Wb / 2, Db, H - clipLen]));
box = box.add(clip.rotate([0, 0, 180]).translate([Wb / 2, 0, H - clipLen]));

// ---- Lid: top plate with a skirt that drops over the box ----
const skirtH = 14, skirtWall = 2.4, topT = 2.4;
const gap = 0.3;
const lidOuterW = Wb + 2 * (hookD + gap + skirtWall);
const lidOuterD = Db + 2 * (hookD + gap + skirtWall);

let lid = Manifold.cube([lidOuterW, lidOuterD, topT + skirtH], false);
const lidCavity = Manifold.cube([lidOuterW - 2 * skirtWall, lidOuterD - 2 * skirtWall, skirtH], false)
  .translate([skirtWall, skirtWall, 0]);
lid = lid.subtract(lidCavity);

// Catch windows in the +Y / -Y skirt walls, aligned with the hook tabs.
const skirtYpos = lidOuterD - skirtWall;
const zCatch    = skirtH - clipLen;
lid = lid.subtract(catchWin.translate([lidOuterW / 2, skirtYpos, zCatch]));
lid = lid.subtract(catchWin.rotate([0, 0, 180]).translate([lidOuterW / 2, skirtWall, zCatch]));
lid = lid.translate([Wb + 24, 0, 0]);

const boxColored = api.label(box, 'box', { color: '#7b6c9e' });
const lidColored  = api.label(lid, 'lid', { color: '#e3c79a' });
return boxColored.add(lidColored);
