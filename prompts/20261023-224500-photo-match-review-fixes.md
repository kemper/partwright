---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T22:45:00Z"
tools: [subagent, vitest, playwright]
sequence: 5
---

## Human

Do all remaining follow-ups of #1056. (Review round: fix the reviewer's blocking, should-fix and nit items in one commit.)

## Assistant

## Key decisions

**GrabCut never invents a subject.** The colour histograms are now normalised by their real mass with a pseudo-count, so an empty selection degrades to the flat prior instead of a confident uniform model. That was the bug: an empty subject set scored -0.7 everywhere and flipped the whole interior to "subject". The loop also stops as soon as the subject set is empty. A result that touches the border band on all four sides is rejected as backdrop. A uniform photo and a sub-tolerance subject now return the honest "No foreground found".

**Smaller default change for single-photo callers.**
- The automatic colour-model fallback runs only on a busy border or an (almost) empty border result. A frame-filling tight crop keeps the old warn-only behaviour.
- Ambiguity detection stays on, because it removes real false findings. The docs now say plainly that it suppresses shape findings and name the opt-out (`photoMatchAmbiguousDeltaE` 0). They also spell out the precedence: mask > bg > bgMode, and `bgTolerance` disables the fallback.

**Inputs that are per photo stay per photo.**
- A crop is in one photo's pixels, so it is no longer broadcast to several photos (CLI or API).
- Several API views must each name their `image`, so an omitted image can't silently score every view against the same attachment.
- `--match-pixel-aspect` takes the API's 0.05–20 bounds.
- Normalised widths are capped at 10× the height so an edge-on model can't allocate a huge canvas.

**Masks are trusted but sanity-checked.** Warnings fire for a likely inverted mask (more than 85% of the frame, or touching all four edges) and for an aspect mismatch with the photo above 1%.

**Small items.**
- GrabCut iterations, the foreground-fraction bounds, the views cap and the combined findings cap are named constants, not user knobs.
- The busy-threshold field max is 90, matching the estimator's cap.
- Named views are looked up with `Object.hasOwn`.
- Warnings repeated across views are listed once, tagged with every view.
- The critic writes scratch output to the session scratchpad.
