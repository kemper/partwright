---
date: 2026-06-11
branch: claude/hopeful-franklin-6ucma0
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
---

## Human

(Same session.) Stage 3: hair variants — the style list was minimal (4) and
the face window one fixed shape.

## Assistant

Added two styles and one window parameter, keeping the existing carve-the-
face-window architecture (hair is a labelled region that must not occupy
face space):

- `bangs`: a wide fringe ellipsoid rooted in the cap over the forehead; the
  face window trims its bottom edge, so the fringe line comes from the same
  mechanism that prevents hair-through-mouth bleed.
- `ponytail`: anchor sphere high on the back + two chained tapered capsules
  (shared joint points → always one welded piece) swinging down.
- `hairline: 'high' | 'mid' | 'low'` slides the window's top edge on every
  style; `bangs` defaults to 'low' (hair at the brow line).

Unit-test probes are evaluate()-based at hand-derived points; bounds() is
conservative under smooth ops and the first bounds-based assertions were
false negatives. Verified visually on a five-heads probe row (short, bangs,
ponytail, long, bun) with skin/hair contrast colors.
