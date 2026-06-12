---
date: "2026-06-12"
task: "fix: boot sole fully encloses skin + base sits below soles (verified from underside)"
pr: 634
areas: [figure, sdf, catalog, tests]
---

## Human

Still bad — two screenshots: skin showing through the boot soles, and feet still going through the platform. By all means if you lack the tools to see clearly, let's stop and fix that. (Later: I shrank the platform so you can see its height relative to the feet.)

## Assistant

The tooling was fine; my *verification angle* was wrong — I'd checked the colored bake from iso/back, not the underside where the defect lives. Reproduced the user's exact view (colored bake, camera below) and immediately saw it: a tan (skin) oval poking through the base underside.

Then I stopped guessing analytically and **probed the real geometry**: a vite-node script that walks z down the footprint centre found the bare foot's true underside is **0.79·foot below the sole centre** — the sole⊔instep⊔ankle `smoothUnion` bulges well past the analytic instep (0.65·foot), which is why my earlier margin was too small and the skin poked through the flat cut.

Fixes:
- **groundZ = soleCenter − 0.95·foot** (clearly below the measured 0.79 underside). Footwear clips flat there, so the boot extends past the whole skin foot. Verified with a 1465-sample grid over the sole: 0 skin-solid points left uncovered by the boot.
- **Sole slab thickened to 0.75·foot** so it bridges groundZ up into the foot and welds.
- **buildBase redesigned as a proper pedestal**: top rises 0.7·foot into the lowest foot to weld it (one foot anchors the base — the body links everything, so a lifted foot can stay free), and the disc BOTTOM is forced below the lowest sole (`min(top−thickness, lowestGroundZ − 0.12·foot)`), so nothing hangs through the underside.
- Decoupled `buildFeet`/`buildFootwear` `sz` from `groundZ` (use `footSoleZ` directly) so the bare foot is unchanged regardless of the groundZ margin.

Verified in color from BOTH the underside (clean gray, no skin, no poke-through) and the front (red boots on the platform, platform below them). Updated the coverage/plane tests to the new geometry, rebaked the superhero entry.

**Process lesson:** verify from the angle of the complaint, and measure geometry empirically (probe) rather than trusting analytic primitive bounds when smoothUnion is involved.
