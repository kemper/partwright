---
session: "figure-nipples-belly-buttons"
timestamp: "2026-06-14T19:40:00Z"
model: claude-opus-4-8
tools: []
---

## Human

We've been incrementally progressing toward this but I don't think we
implemented it: the figure API recently merged more realistic measurement data
(children/old/men/women/big/small), and one goal was the right *calculation* for
the location of nipples and belly buttons — but I don't think we ever put that
geometry on the models. Implement it and do a good job. Investigate as needed,
make preview images of the approach, and if confident create a plan file, add
some catalog entries demonstrating the feature, update any shirtless men already
in the catalog to use it, and open a PR.

## Assistant

Confirmed the gap: the anthropometric girth (sex/age/weight, MakeHuman-mined) had
landed, but `navelZ` was only a spine-pivot Z and there was **no** nipple data or
torso surface geometry — the "location calculation" was never built.

Design (`src/geometry/sdfFigure.ts`):
- **`rig.torso` landmarks** (`TorsoAnchors = {nippleL, nippleR, navel}`), the
  torso analog of `rig.face`. Computed in `buildRig` by projecting onto the
  chest/belly **front (−Y) surface**. Key realization that made this simple: the
  torso ellipsoids stay axis-aligned (only their *centres* are spine-transformed),
  so front=−Y holds under a lean. A shared `torsoMasses` helper is the single
  source for the masses, so `buildRig`'s anchors and `buildTorso`'s geometry can't
  drift. The anchors track sex/age/weight/build for free (a fuller chest spreads
  the nipples and pushes them forward; a heavier belly bulges the navel out).
- **`F.torso(rig, { nipples, navel })`** — opt-in, default OFF so every existing
  figure is byte-identical (matching the eyes-default-off precedent and the
  "existing figures unchanged" convention). Nipples are shallow flattened-ellipsoid
  mounds `smoothUnion`'d with a **tight local k**; the navel is a sphere
  `smoothSubtract`'d to a shallow dimple. Tight k (like the face features, not the
  soft body weld) keeps them crisp; both sit mid-torso, far from any limb seam, so
  the soft body weld never fills them.

Verified empirically with `model:preview` (CLAUDE.md's "verify the angle where a
defect hides" + high-res crops) across neutral/male/female/heavy builds before
wiring catalog: nipples track chest width, navel centres on the belly.

Catalog (only `strongman` + `sumo` are shirtless): `sumo` → `F.torso(rig,
{nipples,navel})`. `strongman` has a custom puffed-pec mass that sits *forward* of
the base chest, so its base-chest nipples would be buried — placed nipples on the
puff front manually (documented inline) and used `F.torso(rig,{navel})`. Added a
new **`swimmer`** entry (low-rise trunks → navel fully visible) to showcase it,
with palette + manifest + bake-manifest registration. All three re-baked manifold,
single-component, all labels present.

Docs (`public/ai/figure.md`): the torso opts, the `rig.torso` anchors, and a note
that custom pec geometry needs its own nipple placement. Tests
(`tests/unit/sdfFigure.test.ts`): nipple symmetry / front-of-chest / below-centre,
navel centring, proportion tracking, height scaling, opt-in build + unknown-key
rejection. `npm run preflight` + catalog lint green.

Left as an explicit follow-up (not in scope): true female **breast mounds** for
`sex:'female'` — the bust is currently a wider chest ellipsoid; nipples place
correctly but there's no mound.
