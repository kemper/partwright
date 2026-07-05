---
session: "b33cd8de"
timestamp: "2026-06-28T03:10:00Z"
---

## Human

(Merge-conflict resolution on the catalog-cleanup PR #862.) Main advanced
substantially while the PR was open — adding a new `F.grasp` / finger-cup
grip-point API, 4 new figures built on it (knight, lumberjack, noble-lady,
scholar), an accessory-attachment system, and an evals harness. The
`public/catalog/manifest.json` collided because main reformatted/preserved the
21 entries our PR deleted.

## Assistant

## Key decisions

**Take ours for every manifest.json conflict chunk — they're all the same
shape.** Every `<<<<<<< HEAD … >>>>>>> origin/main` block in the manifest
turned out to be HEAD-empty / main-kept: our PR deleted the entry, main left it
in place. So `git checkout --ours public/catalog/manifest.json` resolves the
*conflict* correctly, but it also drops everything main *added* that didn't
collide — including the 4 truly-new figures. Had to splice those back in by
hand. The new figures (knight, figure-lumberjack, scholar, noble-lady) are not
on the 21-cut list, they're additions, and they're built on the grasp API that
fixes the held-item grip system Cluster A (#866) was about — so keeping them
is the right call.

**`bake-manifest.json` auto-merged cleanly and was correct.** All 21 cut
entries stayed removed; all 3 main-side new bake entries (knight, scholar,
noble-lady — lumberjack wasn't opted into bake on main either) landed in
place. No manual splice needed there.

**Didn't audit the 4 new figures for held-item defects pre-merge.** The user
asked to resolve the conflict, not to re-cull. The figures may or may not pass
the "almost anything held in a hand is bad" bar — but the F.grasp commit
messages on main literally say "AI-first-try grasping" + "fix(knight): real
grip — clutch fingers wrap the sword," so the engineering effort that
motivated Cluster A is exactly what's been happening on main. They get the
benefit of the doubt; visual QC stays out of scope for this resolution.
