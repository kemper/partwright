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

## Round 2 — painted-on round eyes (user feedback)

Human: "I like the old eyes better. The smaller irises don't look as good and the
pupils stand out like nipples. I was thinking the eyes would be completely round
with the irises and pupils painted on, or the sclera has an indention the iris
sits into — or just paint them perfectly. Either way, iterate."

**Redesigned the iris/pupil from raised lenses to flush painted-on discs.** The
forward-offset ellipsoid lenses protruded as beads (the pupil read as a
"nipple"). New approach: keep the eyeball a perfectly round sphere; build each
iris/pupil as a deep cylindrical plug clipped to a sphere CONCENTRIC with the
eyeball but a hair larger (`capR` = 1.012/1.024·rad). The plug's front face
follows the eyeball's exact curvature and wins the hard-union over its disc with
a sub-3%-of-radius step — sub-visual, so the silhouette stays round while the
iris/pupil read as flat painted concentric circles. The plug is deep (spans the
eyeball) so it always meshes; only its flush front cap survives the union and
carries the label. Went back to the bigger iris the user preferred
(0.55·rad / pupil 0.27·rad).

**Bug caught during iteration:** `SdfNode.rotate` takes DEGREES, not radians —
the first attempt passed `Math.PI/2` (≈1.57°), leaving the masking cylinder
vertical so the iris painted the eyeball's poles instead of the front. Fixed to
`rotate([90, 0, 0])`; verified the disc centres on the front and follows a
yaw/pitch/roll-posed head via `orientToHeadPose`. Re-rebaked `waving_kid`.

## Round 3 — smooth iris/pupil disc edges (user feedback)

Human: "Now the classic just-painting problem: the smoothness/roundness of the
pupils and irises isn't right. Either apply 'Smooth edges' (mesh subdivision) or
a 3d-modeling effect that approximates being painted on."

The iris/pupil circle edge is only as smooth as the local mesh; at the head
detail grid (~r.head·0.045) a disc that small facets into a polygon. Rather than
post-hoc subdivision/smoothing of the whole model, added a dedicated extra-fine
detail sphere over each eyeball front to `F.faceDetail` (mirroring the existing
mouth-groove sphere) so the SDF build direct-marches the small iris/pupil regions
finely and their circles tessellate round. Default `eyeEdgeLength` ≈ r.head·0.008
(overridable). Cost on the full waving-kid figure: +~14k triangles → 177k, under
the 200k catalog budget, no warnings. Added a `faceDetail` unit test for the two
eye spheres and re-rebaked `waving_kid`.

## Round 4 — rebake all figures + bound the triangle cost

Human: "Make sure the other catalog figures are fixed and rebaked."

The figure *code* needed no change — every figure calls `F.face.eyes`, so all
three eye improvements apply automatically on load; only the cached
thumbnails/stats were stale. Before rebaking all 11, an audit of the round-3
cost showed the fine eye detail had ballooned some figures (flexing_strongman
+62k → 232k, over the ~200k advisory budget): small-headed (tall) figures got a
very fine *absolute* eye edge, and the deep iris/pupil plugs were fully
fine-marched. Fixed both: shallowed the plug to reach from the front pole to ~the
eyeball centre (half the buried barrel) and relaxed `eyeEdgeLength` to
r.head·0.013 (still clean at full zoom; 0.018 visibly facets). Strongman dropped
to 186k; per-figure deltas are now +5k…+23k. Rebaked all 11 figure entries in a
real browser (xvfb + per-figure palette) — all manifold, all three eye labels
resolve. (chibi_wizard 303k and staff_mage 206k sit just over the advisory
budget — chibi was already 280k pre-change; the budget is advisory, not a CI
gate.)
