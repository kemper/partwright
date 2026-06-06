// Dovetail wall mount — a two-part removable hook. The WALL PLATE screws to a
// wall (countersunk M4 screws sit flush) and carries a vertical dovetail rail.
// The HOOK has a matching dovetail socket on its back; it slides down onto the
// rail and the dovetail keeps it from pulling off. Lift it up to remove. Great
// for headphones, keys, tools, or cables — print more hooks for one plate.
//
// Shown in mounted orientation: the plate's back (y=0) is the wall; +Y faces the
// room; +Z is up. Both parts print flat by laying them on their backs.
const { Manifold, printFit } = api;

const plateW = 38, plateT = 6, plateH = 70;   // wall plate: X, Y(thickness), Z
const railLen = 52;                            // rail length up the plate

const { tail, socket } = printFit.dovetail({ length: railLen, width: 16, depth: 6, angle: 14, fit: 'normal' });

// Orient the dovetail so it slides vertically (+Z), depth pointing into the room
// (+Y), widening across X. tail default: slide +X, depth +Y, widen in Z.
// rotate([0,-90,0]) maps X->Z (slide up), keeps depth +Y, widening -> X.
const railUp = tail.rotate([0, -90, 0]);
const grooveUp = socket.rotate([0, -90, 0]);

// ---- Wall plate ----
let plate = Manifold.cube([plateW, plateT, plateH], false);
// Rail on the front face, centered in X, embedded 0.5mm so the union fuses.
plate = plate.add(railUp.translate([plateW / 2, plateT - 0.5, 9]));

// Two countersunk M4 holes through the plate (front -> wall), above & below the
// rail. screwHole drills along -Z from its z=0 entrance; rotate so it drills
// along -Y with the countersink on the front face (y = plateT).
const drillY = (x, z) => printFit.screwHole({ size: 'M4', length: plateT, head: 'countersunk', through: true })
  .rotate([-90, 0, 0])           // axis Z -> Y, entrance toward +Y
  .translate([x, plateT, z]);
plate = plate.subtract(drillY(plateW / 2, plateH - 8));
plate = plate.subtract(drillY(plateW / 2, 8));

// ---- Hook ----
// A block that carries the dovetail groove on its back and a J-hook out front.
const hookBlockW = plateW, hookBlockT = 14, hookBlockH = 30;
let hook = Manifold.cube([hookBlockW, hookBlockT, hookBlockH], false);
// Groove on the back face (y=0) so it wraps the rail; mouth at y=0 into +Y.
hook = hook.subtract(grooveUp.translate([hookBlockW / 2, 0, -4]));

// A chunky J-hook out the front: a thick arm reaching +Y, then an upturned lip
// in +Z to cradle whatever hangs on it (cables, headphones, keys, tools).
const armW = 16, armThk = 10;          // X width, Z thickness of the hook bar
const armReach = 34;                   // how far it reaches out (+Y)
const lipH = 22;                       // height of the upturned tip
const armX = hookBlockW / 2 - armW / 2;
const armZ = 4;
const arm = Manifold.cube([armW, armReach, armThk], false)
  .translate([armX, hookBlockT - 0.5, armZ]);
const lip = Manifold.cube([armW, armThk, lipH], false)
  .translate([armX, hookBlockT - 0.5 + armReach - armThk, armZ]);
hook = hook.add(arm).add(lip);

// Lay the hook beside the plate for the catalog view.
const hookPlaced = hook.translate([plateW + 16, 0, 0]);

const plateColored = api.label(plate, 'plate', { color: '#b5764f' });   // soft terracotta
const hookColored = api.label(hookPlaced, 'hook', { color: '#5f8a8c' }); // soft teal
return plateColored.add(hookColored);
