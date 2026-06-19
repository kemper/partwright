---
date: 2026-06-18
branch: claude/quirky-cerf-jik841
files_changed:
  - src/export/threemfProject.ts
  - tests/threemf-multipart.spec.ts
---

## Human

Almost there — exported 15 parts, all on separate plates, but the position drifts
progressively farther from plate centre the more parts I have (down/forward and to
the right). I want any number of parts (10/20/30) centred on their own plate with
their own colour. (Parts can have multiple components — those sit on one plate
together since they're one "part" in the app.)

## Assistant

The drift was the plate STRIDE being wrong. I'd hardcoded a single 410mm stride;
the error compounds with plate index, pushing parts right + forward.

First established (via the Bambu CLI) what actually governs placement:
- Stacking all parts at one point leaves other plates empty → load rejected, so
  plate assignment is by WORLD POSITION, not the model_instance binding. Each part
  must sit at its plate cell's true centre.
- A 328mm-wide object passes at any stride 396–412, and a 2-object split threshold
  (~240) is a clustering heuristic — neither pins the stride. Bambu also echoes my
  positions verbatim on re-export (never re-centres). So headless slicing/rendering
  can't measure the stride (no GL for thumbnails).

Got the exact grid from BambuStudio source (src/slic3r/GUI/PartPlate.{cpp,hpp}):
- compute_colum_count(N) == ⌈√N⌉ (my column formula was already right).
- plate_stride_x = m_plate_width·(1 + LOGICAL_PART_PLATE_GAP) = width·1.2;
  plate_stride_y = m_plate_depth·1.2. STRIDE IS PER-AXIS. For the 330×320 H2C bed
  that's 396 (X) and 384 (Y) — not a single 410, which is exactly why a uniform
  stride drifted right (410>396) and forward (410>384), worse at higher indices.
- Plate origin is the cell corner (col·stride_x, −row·stride_y); printable area
  starts there, so cell centre = origin + (bedW/2, bedH/2).

Fix: derive strideX = bedW·1.2, strideY = bedH·1.2 from the parsed bed size, and
place each part at (col·strideX + bedW/2, −row·strideY + bedH/2). Validated: a
6-part export now sits at X 165/561/957, Y 160/−224 and slices to 6 plates, none
empty, rc 0. Multi-component parts already stay together (one Part → one mesh →
one object → one plate). e2e now asserts the exact per-axis strides (396/384) so a
regression to a uniform stride is caught.
