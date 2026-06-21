---
date: 2026-06-18
branch: claude/quirky-cerf-jik841
files_changed:
  - src/export/threemfProject.ts
  - tests/threemf-multipart.spec.ts
---

## Human

We're getting closer. I exported 6 parts of different shapes and colours and 4 of
them landed on plates, 2 of them were off plates (screenshot). I want any number
of exported parts (10, 20, 30, …) all centred on plates with their own colour.
Note: a part can have multiple components — those should sit on a plate together
since they're one "part" in the app.

## Assistant

Colour was already correct (the 6 parts used 3 distinct colours → extruders
1,2,3,1,1,1, right). The only bug was plate PLACEMENT: I laid plates out in a
hardcoded 2-column grid, so for 6 parts the row-2 parts (y=-660) fell outside
Bambu's grid and 2 plates were empty (Bambu CLI confirmed: "plate 3: no object is
fully inside", return_code -50).

Reverse-engineered Bambu's actual PartPlateList grid from two real data points:
the user's 3-plate reference placed plate 3 at grid cell (col0,row1) → 2 columns;
this 6-plate file's objects landed on plates 1,2,4,5 with the (col1,row1) object
on plate 5 (not 4) → 3 columns, numbered left→right/top→bottom. So Bambu uses
**⌈√N⌉ columns**. Fixed `plateGridCols(n) = ⌈√n⌉` (was the constant 2); cell
(col,row) centre = (bedW/2 + col·410, bedH/2 − row·410).

Disambiguated ⌈√N⌉ from floor(√N)+1 (they agree at N=3,6 but differ at perfect
squares) by slicing N=4 in the Bambu CLI: it tiled 2×2 (⌈√4⌉=2), all 4 plates
filled → ⌈√N⌉ confirmed. Validated N=3/4/6/10 in the Bambu CLI: every plate gets
exactly one object, return_code 0, no empty plates.

Multi-component parts: no change needed — each Part bakes to ONE MeshData (a
multi-component Manifold tessellates to a single mesh), so it's one object → one
plate and its components stay together inherently.

e2e: added a grid guard (6 synthetic parts → exactly 3 distinct X columns + 2 Y
rows) so a regression to a fixed column count is caught without a slow slice.
Stride stays 410 (H2C); very large bed-filling parts could still drift off a cell
at high column indices if Bambu's true stride differs slightly — noted for later,
not a concern for normal part sizes.
