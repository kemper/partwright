// Snap-fit box — a parts box whose lid clicks shut with cantilever snaps, no
// screws or glue. Two tabs on the box click into windows in the lid skirt; flex
// the tabs with a thumbnail to pop it open. Box and lid print flat, side by side.
const { Manifold, printFit } = api;

const Wb = 56, Db = 40, H = 20;   // box outer footprint
const wall = 2.4;
const clipW = 16, clipLen = 12, clipT = 2.2, hookD = 1.6;

// ---- Box: an open-top tray ----
let box = Manifold.cube([Wb, Db, H], false);
const cavity = Manifold.cube([Wb - 2 * wall, Db - 2 * wall, H], false)
  .translate([wall, wall, wall]);
box = box.subtract(cavity);

// Cantilever clips on the +Y and -Y outer walls, hooks facing outward, tips at
// the rim. clip frame: beam back on y=0 rising +Z, hook juts +Y at the tip.
const { clip, catch: catchWin } = printFit.snapFit({
  width: clipW, length: clipLen, thickness: clipT, hookDepth: hookD, fit: 'normal',
});

// +Y wall: back of clip flush to outer face (y = Db), rooted clipLen below rim.
box = box.add(clip.translate([Wb / 2, Db, H - clipLen]));
// -Y wall: mirror the clip (hook faces -Y). Rotate 180° about Z flips +Y->-Y.
box = box.add(clip.rotate([0, 0, 180]).translate([Wb / 2, 0, H - clipLen]));

// ---- Lid: a top with a skirt that drops over the box, with catch windows ----
const skirtH = 14, skirtWall = 2.4, topT = 2.4;
const gap = 0.3;                          // skirt clears the box + clips
const lidOuterW = Wb + 2 * (hookD + gap + skirtWall);
const lidOuterD = Db + 2 * (hookD + gap + skirtWall);

let lid = Manifold.cube([lidOuterW, lidOuterD, topT + skirtH], false);
// Hollow the skirt: leave the top plate, carve the inside the box+clips drop into.
const lidCavity = Manifold.cube([lidOuterW - 2 * skirtWall, lidOuterD - 2 * skirtWall, skirtH], false)
  .translate([skirtWall, skirtWall, 0]);
lid = lid.subtract(lidCavity);

// Catch windows in the +Y / -Y skirt walls, aligned with the hooks. The lid's
// local origin: skirt outer at 0..lidOuterD. The +Y skirt wall inner face sits
// at lidOuterD - skirtWall. Align the catch to bite the hook ledge.
// In assembled position the hook sits just inside the +Y skirt wall; reproduce
// that offset relative to the lid's own frame.
const skirtYpos = lidOuterD - skirtWall;   // +Y skirt wall starts here (outer at lidOuterD)
const zCatch = skirtH - clipLen;           // skirt top aligns with rim when seated
const catchP = catchWin.translate([lidOuterW / 2, skirtYpos, zCatch]);
const catchN = catchWin.rotate([0, 0, 180]).translate([lidOuterW / 2, skirtWall, zCatch]);
lid = lid.subtract(catchP).subtract(catchN);
// Flip the lid upright-for-print (skirt down) and set beside the box.
lid = lid.translate([Wb + 24, 0, 0]);

const boxColored = api.label(box, 'box', { color: '#7b6c9e' });   // muted violet
const lidColored = api.label(lid, 'lid', { color: '#e3c79a' });   // warm cream
return boxColored.add(lidColored);
