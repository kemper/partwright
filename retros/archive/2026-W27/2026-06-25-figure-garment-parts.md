---
date: 2026-06-25
author: claude (opus-4-7)
task: garment parts (F.garment/F.parts) — root-cause fix for belt/armor on the arms (PR #830)
---

## Liked
- **Investigating before touching anything.** The user explicitly asked for a report first ("don't make any changes yet"). Mapping `buildBand`/`buildTorso`/`buildArms`/`F.layers` with an `explore` agent surfaced the exact mechanism — `surface.round()` is isotropic, so any sleeve in `surface` gets dilated into the band — which turned "the belt keeps failing" into a one-sentence root cause and an obvious fix. The three prior sessions had been treating a symptom.
- **Quantifying the fix on the SDF fields before baking.** A 12-line `vite-node` probe measured whole-body conform = 157u³ arm overlap, torso conform = 55u³, torso + `clear` = 0. That number is what told me my first test assertion (`torso conform === 0`) was *wrong* — the torso flank still pokes the bare arm internally — and that the real guarantee is torso-conform **plus** `clear`. Measuring beat asserting-from-belief.
- **Additive refactor.** `buildTop`→`buildTopParts` kept `.all` byte-identical, so 20+ catalog figures couldn't regress. Verified grandpa unchanged in one render. Low-risk path through a big core file.

## Lacked
- **A render from the failing angle, earlier in history.** This bug shipped "fixed" three times because every verification was a front view, and the belt-on-sleeve only shows from the side/back. I only trusted it this time because I cropped the waist/arm junction at 1200px from the 3/4-back angle — the exact angle the user caught it from. The lesson is now in CLAUDE.md but it cost three sessions to learn.
- **An automated "is this accessory on a limb" gate.** `F.sharedSolid` exists and I used it in a probe, but it's not wired into any build/CI check, so "verify from the side" is still a manual discipline. Pillar 2 (#853) is exactly this and it's still open — the `band.clear` + `sharedSolid` primitives now make it cheap to build.

## Learned
- **`round()` on an SDF union is isotropic — it dilates every child outward equally.** So conforming a band to `union(skin, coat, pants)` *builds* the band around the sleeves; you can't subtract that back cleanly (`occludeArms` tried for three sessions). The fix is to never put the arm in the conform surface — decompose the garment and conform to the torso panel. "Don't carve the mistake out; don't make it."
- **`clear: F.arms(rig)` succeeds where `occludeArms` failed** because it subtracts the *exact* arm from a band that no longer wraps the sleeve — a thin torso overhang, not a fat sleeve-ring — so there's no outer shell left behind and no tuned allowance to get wrong.
- **A passing unit test caught my over-claim.** I wrote `torsoOverlap === 0` from belief; the test failed at 64u³, which forced me to actually measure and discover the internal-residual nuance. Write the assertion that can fail loudly, not the one that confirms the story.

## Longed for
- **A typed/structural link between "garment" and "the parts an accessory may touch."** Right now nothing stops an author from passing `union(skin, coat)` (with sleeves) as a band `surface` again — the guardrail is docs + the `clear` habit. A capability where `F.band` *required* a parts-typed surface (and rejected one that contains arm geometry) would make the failure unrepresentable instead of merely discouraged.
- **The author-time invariant gate (pillar 2, #853) actually built.** Three sessions of the same class of bug is the strongest possible argument for it. The primitives are all here now (`sharedSolid`, `band.clear`, parts); what's missing is a `figure:invariants` headless gate that asserts `!sharedSolid(belt, F.arms(rig)).overlaps` on every build so the next author can't ship belt-on-arm at all.
