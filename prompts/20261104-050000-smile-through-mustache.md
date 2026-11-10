---
session: "01U8g7w9"
timestamp: "2026-11-04T05:00:00Z"
sequence: 18
---

## Human

Fix the smile through the mustache (#1168).

## Assistant

## Key decisions

**One mechanism for every face motion, replacing the jaw-only one.** The
beard is modelled on the rest face and carried rigidly by the head. The jaw
fix (#1166) undid only the jaw bone's motion, so a smile (the oris /
risorius bones lifting the upper lip and corners) still moved skin under a
beard that stayed put: the lifted lip split the mustache into two drips.

Each face vertex's actual displacement relative to the head (posed minus
rest, in the head's frame) is now splatted where the skin now is. It is
carried outward to the space the beard fills (a breadth-first fill, then a
blur) and subtracted from every beard sample. That covers the jaw, smiles
and any other expression. Skin that rides the head rigidly moves 0, so a
still face and the scalp are unchanged and the field is skipped.

**Only face-rig skin feeds the field.** Skin with at least 99% of its weight
on the head and its children counts. Neck skin moves with the head's pose,
not the face, and would drag a full beard's under-chin mass around when the
head turns. A turned, laughing full-beard figure renders clean and stays one
manifold piece.

**The test measures the symptom that was seen.** Several metrics didn't
separate old from new: coverage counts, front-on ray hits, poke-through
counts and per-vertex coverage flips. The one that did: over skin the laugh
moves, the beard just in front of each point should match the still face's.
The old code fails it (mean gap ~0.0011 H, worst ~0.0022 H), and the new
code passes (0.0003 H / 0.0008 H). The test was checked to fail with the old
code. The existing open-jaw and chin-coverage tests still pass.

Verified against the issue's exact repro (`laugh` + goatee, front view, zoomed
on the mouth), a grinning mustache, the neutral reference, a smiling full
beard, and a turned head.
