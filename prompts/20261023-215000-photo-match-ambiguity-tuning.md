---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T21:50:00Z"
tools: [subagent, vitest, playwright]
sequence: 4
---

## Human

Do all remaining follow-ups of #1056.

## Assistant

## Key decisions

**Low-confidence must never hide the findings that fix the model.** The four-view Tsubasa check (front, back, q34, busy-backdrop hero) exposed two false triggers:

1. Tiny same-coloured parts (eye highlight, brows) flagged the HAIR. The flag is now size-aware: a partner only counts when its model area is at least 10% of the region's own.
2. When the model's hair was mis-shaped, the photo under it was skin, so hair looked "skin-coloured" and its size findings were suppressed. The swallowed-colour rule now requires the region's OWN colour to find almost nothing in the photo (under 25% of its model area), which is the real swallow case. The reason text is direction-neutral ("X looks Y-coloured in the photo").

**`--match-pixel-aspect` per photo.** Mixing anamorphic video frames (0.6) with a normal product shot (1) in one multi-view call needs per-view values. It now pairs by position like `--match-crop` and `--match-bg`. The API already allowed this per view.
