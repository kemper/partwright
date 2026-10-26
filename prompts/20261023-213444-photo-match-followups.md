---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T21:34:44Z"
tools: [subagent, git-worktree, vitest, playwright]
sequence: 1
---

## Human

Do all remaining follow-ups of #1056.

## Assistant

## Key decisions

**Multi-view: build once, score many.** The expensive part of `model:preview --match-photo` is the model build (35–80 s for an SDF figure). The scorer is cheap, so repeated `--match-photo path@az,el` flags now share one build. The camera suffix is parsed only as a trailing `@az,el` or `@<named view>`, and only when the whole string isn't an existing file, so `photo@2x.png` stays a path.

A single photo keeps the exact old `stats.photoMatch` shape. With several photos, `stats.photoMatch` becomes the combined summary (mean `silhouetteIoU`, `minIoU`, `[label]`-prefixed findings) and `stats.photoMatches[]` holds each view. Putting the mean at the old key means a consumer reading `photoMatch.silhouetteIoU` gets the right single number, and no view is duplicated in the JSON. The browser API mirrors this with `views: [{image, azimuth, elevation, …}]`. `combinePhotoMatches` lives in the pure module so both share it.

**Outline as text, from band edges.** Each band now carries outward-positive `left`/`right` edge offsets plus interior photo-only / model-only widths. `outline[]` merges consecutive bands with the same side and sign into runs ("photo-only at bands 2–4 left: up to 3.1% of height (hair) → grow"), ranks them by magnitude × √length, and caps them with config knobs. Band counts are a tuning override (`--match-bands` / `bands`), so the default stays 10. Long runs in `worst[]` now list only their ends, so 20-band lines stay short.

**Ambiguity is auto-detected and suppresses shape findings only.** Three signals mark a region `lowConfidence`:
1. Colour clusters converge onto near-identical photo colours.
2. Same-colour regions touch in the model render, so the split is decided by distance, not by the photo.
3. A region's photo pixels match another cluster's colour. The cluster seeded by the model colour then ends up empty and its pixels inflate a neighbour (the false "jersey +88%").

Colour findings are kept, because they're still informative. One warning names the pairs and the exact `merge` to pass. `ambiguousDeltaE` = 0 turns the detection off. `merge` collapses groups into one scored region that keeps every member colour as a cluster seed. `ignore` hides regions from the results but keeps them seeding, so their pixels aren't stolen by others.

**Busy backdrops: GrabCut-lite, auto only when the border is busy.** A plain whole-interior GrabCut init inverted on the hero photo, because the backdrop dominated the subject histogram. Seeding pass 0 with a flat subject prior against the border histogram fixed it. Keeping every sizeable piece and bridging short vertical gaps between different pieces recovers a figure cut in two by backdrop-coloured shorts. `auto` switches to it only when the border tolerance hits `busyBorderTolerance` or the border result is implausible, so clean-backdrop photos keep the previous path and numbers. A manual `mask` (any resolution, same framing) overrides everything.

**Resolution warning** uses the subject bbox height in ORIGINAL photo pixels (prepare's downsample scale × crop), against a config knob that defaults to 300.
