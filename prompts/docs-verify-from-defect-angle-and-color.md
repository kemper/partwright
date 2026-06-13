---
date: "2026-06-12"
task: "docs: codify multi-angle/underside + colored-bake + empirical-probe verification"
pr: 634
areas: [docs, process]
---

## Human

Should you be looking at more angles (as part of agent instructions) to confirm your work?

## Assistant

Yes — this session's footwear bug shipped "fixed" twice because I verified from iso/back angles and missed an underside defect (skin showing through the sole, foot poking through the base bottom), and because `model:preview` shades by normal so it couldn't show the skin-vs-boot color difference at all.

Codified three lessons into CLAUDE.md's `model:preview` section:
1. **Verify from the angle where a defect would hide — including the underside** (`--view az,el` with negative elevation), and **reproduce a user's exact reported angle first**.
2. **`model:preview` doesn't show paint/label colors** (shades by normal); use the **colored catalog bake** (`build-catalog-entry.cjs` under `xvfb`, `THUMB_AZIMUTH`/`ELEVATION`) when color correctness is the question.
3. **Measure geometry empirically when `smoothUnion` is involved** — it bulges past analytic primitive bounds; walk `evaluate()` in a vite-node probe and set clearances below the measured value, then confirm with a sample-grid coverage check.
