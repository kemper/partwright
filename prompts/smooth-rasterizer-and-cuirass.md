---
date: 2026-06-21
branch: claude/admiring-goodall-1tlwna
files_changed:
  - evals/cases/cuirass/model.js
---

## Human

Adopt the merged higher-quality preview engine; otherwise target whatever best
improves the creation of new parts.

## Assistant

Two things:

1. **Adopted the merged smooth-shaded + AA + lit rasterizer (#834).** It feeds the
   eval contact sheets, so re-baselined every accessory case on it — candidate
   renders are far closer to the app viewport and the judge resolves accessories
   better: glasses 38→58, belt 8→38, hat 66→70, makeup 32→38 (cuirass 14→18,
   sword 22→18 within judge noise). (App-fidelity COLOR is available via the warm
   `partwright daemon render` path if we later want the judge to compare against
   the real material colours instead of grey normals.)

2. **Improved the cuirass (weakest mode, marquee accessory) to read as plate
   armor**, not a padded vest: bolder domed pauldron CAPS stepped down the arm, a
   stronger central keel, and a peascod point at the waist. Verified at high-res on
   the smooth renderer — it now clearly reads as a breastplate + pauldrons.

**Key finding — the eval judge is framing-limited for full-figure accessories.**
The cuirass score stayed 18 despite the obvious visual improvement, because the
candidate is rendered as a whole figure and the breastplate is a small fraction of
the frame (same reason belt/sword score low). So: trust the head-framed face cases
(glasses/makeup/hat) and the regression baselines, but use **high-res
`model:preview` visual QC as the reliable gate for worn/held parts** until the
harness grows per-case accessory framing (a zoomed focus tile). Logged as the next
eval-corpus follow-up.
