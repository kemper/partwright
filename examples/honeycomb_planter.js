// Colors below were migrated from saved paint into code via api.paint.*
// (the model is now self-colouring; see /ai/colors.md). Edit colours here.
const __pwModel = (() => {
// Honeycomb planter with hex-grid wall cutouts
// A cylindrical planter ~80mm wide x 80mm tall, with an outer wall pierced
// by a staggered honeycomb pattern. Solid bottom, open top for soil.
const { Manifold, CrossSection } = api;

// ---- Parameters ----------------------------------------------------------
const outerR = 40; // outer radius (planter ~80mm wide)
const wallTh = 4; // wall thickness
const innerR = outerR - wallTh;
const totalH = 80; // overall height
const floorH = 6; // solid floor thickness
const rimH = 6; // solid rim at the top (preserves a closed ring)
const hexR = 6; // hex cell circumradius (flat-to-vertex)
const honeyWall = 2.4; // min material left between adjacent hex cells

// Pointy-top hex honeycomb tessellation. If we wanted hexes touching edge-
// to-edge, center spacing would be sqrt(3)*hexR horizontally (in a row) and
// 1.5*hexR vertically (between staggered rows). To keep `honeyWall` of solid
// material around every cell, inflate by an effective radius (hexR + wall/2)
// so all six neighbor gaps (horizontal AND diagonal) are >= honeyWall.
const effR = hexR + honeyWall / 2;
const stepX = Math.sqrt(3) * effR; // center-to-center within a row
const stepY = 1.5 * effR; // row-to-row (rows are half-step offset)

// ---- Outer / inner shells ------------------------------------------------
const outerShell = Manifold.cylinder(totalH, outerR, outerR, 96);
const cavity = Manifold.cylinder(totalH - floorH + 1, innerR, innerR, 96)
  .translate([0, 0, floorH]);

// Verify the cavity actually carves something out (not e.g. a typo'd radius).
const hollow = api.expectDifference(outerShell, cavity, { expectNonEmpty: true });

// ---- Build one hex cell, oriented to punch through the wall --------------
// Pointy-top hex extruded along Y (radial direction once translated/rotated).
// Length must exceed wall thickness so the boolean cleanly tunnels through.
// circle(6,6) puts a vertex on +X; rotate 30deg so the vertices point along the
// profile's Y axis (vertical on the wall) -> pointy-top, matching the
// sqrt(3)*effR / 1.5*effR honeycomb steps below.
const hexProfile = CrossSection.circle(hexR, 6).rotate(30); // 6-segment circle == hexagon
// The cell is a straight prism along the radial axis; it starts well inside the
// cavity (radius innerR - cellIn) so even the cell's side corners, where the
// cavity wall curves away, open fully through the wall.
const cellIn = 4;
const cellLen = wallTh + cellIn + 4; // spans innerR-cellIn .. outerR+4
// CrossSection extrudes along +Z, so the hex lies in XY with thickness in Z.
// We want the hex face to be visible on the cylinder wall, so the cell's
// "thickness" axis must point radially (along +Y after we translate). Build
// it standing up in +Z first, then rotate -90deg about X so thickness -> +Y.
const hexCell = hexProfile
  .extrude(cellLen)
  .translate([0, 0, -cellLen / 2]) // center along its thickness axis
  .rotate([-90, 0, 0]) // thickness now along +Y
  .translate([0, innerR - cellIn + cellLen / 2 - outerR, 0]); // spans innerR-cellIn .. outerR+4 once placed at outerR

// ---- Hex grid in the unrolled wall band ----------------------------------
// The wall is cylindrical, but we can lay out cells by *angle* around Z and
// height along Z. Cell footprint on the cylinder is roughly hexW (arc) by
// hexH (axial). Convert horizontal step to an angular step.
const bandBottom = floorH + honeyWall;
const bandTop = totalH - rimH - honeyWall;
const bandH = bandTop - bandBottom;
// A row's vertical extent (vertex to vertex) is 2*hexR. Stacked rows occupy
// (rowCount-1)*stepY + 2*hexR. Fit that inside bandH.
const rowCount = Math.max(1, Math.floor((bandH - 2 * hexR) / stepY) + 1);
const totalRowSpan = (rowCount - 1) * stepY + 2 * hexR;
const yStart = bandBottom + (bandH - totalRowSpan) / 2 + hexR;

// Angular step: arc length stepX at the INNER radius, where neighbouring
// prism cells are closest, so webs stay >= ~2 mm everywhere through the wall.
const angStep = (stepX / innerR) * (180 / Math.PI);
const colCount = Math.max(1, Math.floor(360 / angStep));
// Snap angStep so cells tile evenly around the circle (no seam).
const angStepEven = 360 / colCount;

// One row of cells: a linear pattern *in angle* via circularPattern.
// We place a single cell on the +Y face of the cylinder, then circularPattern
// it around Z. (linearPattern wouldn't wrap around the cylinder.) We still
// use linearPattern below to stack rows vertically -- that's the 2D-grid
// half of the job.
function ringOfCells(z, rowOffsetDeg) {
  const cell = hexCell
    .translate([0, outerR, z]) // sit on +Y wall at height z
    .rotate([0, 0, rowOffsetDeg]); // half-step offset for odd rows
  return api.circularPattern(cell, colCount, { axis: 'z', angle: 360 });
}

// Stack rows: build the first ring, then linearPattern it up in Z. Odd rows
// get a half-angular-step offset to make the staggered honeycomb pattern,
// so we build them in a second pass.
const evenRowCount = Math.ceil(rowCount / 2);
const oddRowCount = Math.floor(rowCount / 2);

const evenRow0 = ringOfCells(yStart, 0);
const oddRow0 = ringOfCells(yStart + stepY, angStepEven / 2);

// linearPattern stacks rings of the same offset, every 2*stepY (skip odd row).
const evenRows = api.linearPattern(evenRow0, evenRowCount, [0, 0, 2 * stepY]);
const oddRows = oddRowCount > 0 ?
  api.linearPattern(oddRow0, oddRowCount, [0, 0, 2 * stepY]) :
  null;

const allCells = oddRows ? Manifold.union([evenRows, oddRows]) : evenRows;

// ---- Carve the honeycomb out of the hollow shell -------------------------
const carved = api.expectDifference(hollow, allCells, { expectNonEmpty: true });

// ---- Split into body + rim for a two-tone terracotta look ----------------
// The top `rimH` of the planter is a solid closed ring (no hex cutouts). Slice
// the carved planter at the rim seam with a boolean cut so we can color the
// rim a slightly darker terracotta than the body. Geometry is unchanged.
const RIM_Z = totalH - rimH;
const cutBox = Manifold.cube([2 * outerR + 20, 2 * outerR + 20, totalH], true);
const bodyCutter = cutBox.translate([0, 0, RIM_Z - totalH / 2]); // keeps z < RIM_Z
const rimCutter = cutBox.translate([0, 0, RIM_Z + totalH / 2]); // keeps z > RIM_Z
const bodyPart = carved.intersect(bodyCutter);
const rimPart = carved.intersect(rimCutter);

// ---- Final integrity check: one connected manifold -----------------------
const planter = api.expectUnion(
  [
    api.label(bodyPart, 'body'),
    api.label(rimPart, 'rim'),
  ], { expectComponents: 1 },
);

return planter;
})();
api.paint.label("body", [0.8, 0.42, 0.28]);
api.paint.label("rim", [0.64, 0.31, 0.2]);
return __pwModel;
