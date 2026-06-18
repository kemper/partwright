---
date: 2026-06-18
branch: claude/kind-cerf-dikkfm
files_changed:
  - retros/inbox/20260618-conformal-marking-helpers.md
---

## Human

(close-out of PR #741, now green + ready) Run /retro.

## Assistant

4-Ls retro for the surfaceMarking/surfaceRecess helper work. Durable lessons:
(1) the design discussion clarified why proud and recessed can't be one helper
(a carved void can't carry a paint label); (2) work-reviewer caught that
defaulting `assembleFace` to the conformal brow would have added an unwanted
ridge to ~50 in-assemble figures — the rule "check every call site of a shared
builder before changing its default"; (3) "proud vs flush" is coupled to whether
the marking is painted, which is exactly why blanket-applying proud was wrong.
Reinforces the #732 stat-diff/catalog-freshness ask (would have answered the
blast-radius question mechanically).
