// SDF brick wall — showcases the `repeatN` stagger option for classic
// running-bond brick patterns. Without stagger, a grid of bricks looks
// stacked like a stack-bond wall (boring); with `{ stagger: { along:
// 'x', by: 'y' } }` every other Y row shifts by half a brick — the
// canonical brick-laying pattern that gives a real wall its strength.
//
// Two painted regions: the brick body (terracotta), and a recessed
// mortar slab behind it (charcoal). The bricks are union'd straight
// onto the slab; the slab is also a separate label so paint reaches
// it through the partition.
const { sdf } = api;

// --- Brick proportions -------------------------------------------------
// Real bricks are roughly 2:1:1 (length : width : height). We make them
// slightly bigger than the period gap so each brick has tiny mortar
// lines around it without the spacing growing unmanageable.
const BRICK_L = 4.4;          // length (X)
const BRICK_W = 1.5;          // depth into the wall (Z)
const BRICK_H = 1.6;          // height (Y) — slightly shorter than the row period for a mortar gap
const ROW_PX  = 5.0;          // X period — leaves ~0.6 of mortar between adjacent bricks
const ROW_PY  = 2.0;          // Y period — leaves ~0.4 of mortar between courses

const COLS = 6;               // bricks per course (odd → centre brick sits dead-centre)
const ROWS = 7;               // courses (odd → middle course sits unshifted)

// --- Brick unit cell ---------------------------------------------------
// A roundedBox gives the bricks the soft "weathered edge" feel they have
// on a real wall. The corners are tiny (0.15) so the rectangular face
// reads as a brick, not a pillow.
const brick = sdf.roundedBox([BRICK_L, BRICK_H, BRICK_W], 0.15);

// --- Brick course: repeatN with the stagger we want --------------------
// Running-bond: every Y row gets shifted by 0.5 * ROW_PX = 2.5 along X.
// The amount of 0.5 is the default — left explicit for clarity.
const bricks = brick
  .repeatN([COLS, ROWS, 0], [ROW_PX, ROW_PY, 0], {
    stagger: { along: 'x', by: 'y', amount: 0.5 },
  })
  .label('bricks');

// --- Mortar slab behind the bricks --------------------------------------
// A thin recessed slab covering the wall area, slightly oversized in X+Y
// and pushed back along -Z so it shows in the mortar gaps. The brick
// course is at z ∈ [-BRICK_W/2, +BRICK_W/2]; we place the slab so its
// face sits ~0.4 inside the brick faces (visible only through the gaps).
const wallW = COLS * ROW_PX;
const wallH = ROWS * ROW_PY + BRICK_H;
const slab = sdf.box([wallW + 0.5, wallH + 0.5, 1.2])
  .translate(0, 0, -0.6)        // sit behind the brick centre plane
  .label('mortar');

return slab.union(bricks).build({ edgeLength: 0.25 });
