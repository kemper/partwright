---
session: "014MdiXX"
timestamp: "2026-06-12T18:10:00Z"
---

## Human

"Look at issue #615 — Real pupils & irises — eyes still read flat; investigate
why layered sclera/iris/pupil don't survive meshing and fix. Smallest,
self-contained. Then, investigate. Do we have work that needs to be done to
improve eyes?"

## Assistant

## Key decisions

**Diagnosed the real cause: not a meshing-survival failure, a proportion bug.**
The issue hypothesized the iris/pupil discs were aliasing away at the figure
`edgeLength`. I disproved that empirically — built a head with `F.face.eyes`
and `F.faceDetail`, painted the labels with `api.paint.label`, and read the
per-label triangle counts back from `model:preview`. All three labels survived
with healthy counts (eyes ~3k, iris ~1.2k, pupil ~400 on a full figure). The
labels are marched as separate small regions at the fine detail edge, then
hard-unioned, so they never collapse. The actual flatness came from
**sizing**: the iris in-plane radius was `0.52·rad`, spanning almost the whole
eyeball front, so no white sclera showed and the three colours read as one blue
bead.

**Fix is a few constants in `buildEyes` (the smallest possible change).** Iris
`0.52→0.36·rad`, pupil `0.30→0.18·rad`, with deeper concentric front offsets
(iris front `1.08→1.09`, pupil `1.15→1.24`) so the layers step proud of one
another. This leaves a generous white almond around the iris and a distinct
pupil dot — recognizable layered eyes from the front at print scale. Verified
on a head close-up and the full waving-kid figure: `isManifold` true,
`componentCount` unchanged (1), all three labels still resolve. The eyeball
`push` and the default `rad` were left alone — at every figure scale the push
floor (`head*0.09`) already dominates the `rad·k` term, so tuning `k` was a
no-op.

**Tuning loop delegated to the `model-sculpt` subagent** so the iterative
preview PNGs stayed out of the main context; it returned the winning constants
as text and I ported them.

**Scope decisions.** Added a structural regression test asserting the concentric
invariant (pupil < iris < eyeball in vertical extent, iris < 0.6·eyeball so
white shows) — this guards the specific "iris swallowed the white" bug. Updated
the `public/ai/figure.md` eyes section. All 11 catalog figures use
`F.face.eyes`, but their thumbnails are full-figure hero views where eyes are
~4px (no visible change) and loading a figure regenerates the new eyes from its
unchanged code; per the "smallest, self-contained" steer I rebaked only
`waving_kid` as the proof entry rather than all 11.
