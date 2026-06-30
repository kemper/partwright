# AI-Planning Pointers — the review-before-paint workflow

When you're about to paint several features on a model (say, an iris and a
foot and a hat brim), it's easy to misidentify a part from a single render
and silently bake the mistake into 80 paint ops. The **pointer** workflow
externalises your interpretation BEFORE you paint, so the user can spot
your mistakes when they're cheap to fix — at the planning stage, not after.

A pointer is a labelled, mesh-anchored callout the user can see, drag,
rename, re-aim, or delete. Each pointer can carry a proposed flood-fill
recipe (a `paintHint`), and the user can tweak the threshold with a live
preview before you commit the paint. The eventual commit reuses the
existing flood-fill primitives (`connectedFromSeed` / `coplanar` /
`colorFlood`), so a committed pointer becomes a normal paint region —
nothing about export, re-resolve on mesh edit, or shading changes.

## Canonical loop

1. **Identify visually.** `renderViews({views:'auto', size:512})` so you can
   see the model in the chat. Read the image, decide where each part is.
2. **Probe + drop.** For each feature, either:
   - Call `dropPointer({ label: 'iris_L', fromPixel: { pixel: [...], view: {...} }, paintHint: { kind: 'connected', maxDeviationDeg: 18 }, proposedColor: [0.05, 0.05, 0.08] })`
     — the cheapest path; the same view/pixel you can see in the render.
   - OR call `probePixel` first if you want the surface point/normal in
     hand, then `dropPointer({ label, point, normal, paintHint, proposedColor })`.
3. **Coverage check.** Call `getPointerCoverageReport()`. It returns
   `{coveredFeatures, uncoveredFeatures, componentCount, coveredComponents}`.
   Any `uncoveredFeatures` carrying a centroid is a feature you forgot —
   drop a pointer for it (the report includes the exact `dropPointer({...})`
   call to paste). This is the gate that catches "you forgot the feet."
4. **Plan block.** Emit a text/answer turn that names every pointer you
   dropped, what you think each one is, and what colour you propose. The
   user reviews them in the **Pointer panel** (per-pointer tolerance slider
   with a live bucket preview) and either approves them, drags the wrong
   ones, or renames the ones that don't match.
5. **Verify before commit.** `previewPointerPaint(id)` returns the triangle
   count that would be selected. Compare to your eye-estimate; an
   unexpectedly tiny count means the tolerance is too tight, a huge count
   means it bleeds past the feature.
6. **Commit.** `commitPaintFromPointer(id, { color?, name? })` for one
   pointer, or `commitPaintFromPointers([ids], { color, name? })` to union
   several into ONE shared region (e.g. all four eye sub-parts → one eye
   colour). The pointer's status flips to `painted` and stays in the list
   so you can re-commit later if needed.

## Tool catalogue

| Tool | What it does |
|---|---|
| `dropPointer({label, point|fromPixel, normal?, paintHint?, proposedColor?})` | Drop a labelled callout at a surface point |
| `listPointers({status?})` | List every pointer with resolution status (stale/orphaned/painted) |
| `previewPointerPaint(id, {paintHint?}?)` | Dry-run a pointer's flood-fill; returns triangleCount + bbox |
| `commitPaintFromPointer(id, {color?, name?}?)` | Commit one pointer → paint region |
| `commitPaintFromPointers([ids], {color, name?})` | Union N pointers → one shared region |
| `getPointerCoverageReport({radius?}?)` | Which features have NO pointer? (call before declaring done) |
| `hidePointers({ids?})` / `showPointers({ids?})` | Toggle overlay visibility (omit `ids` for all) |
| `clearPointers({status?, ids?})` | Delete pointers (without args, all) |

## paintHint kinds — which one fits what

- **`connected` (default).** Seed-relative angle gate. The flood-fill walks
  outward from the anchor and admits any triangle whose normal stays within
  `maxDeviationDeg` of the SEED's normal — not the adjacent face's. The
  right default for organic curves: an iris, a fingertip, a button on a
  rounded surface. Start at 18–30°.
- **`coplanar`.** Adjacent-face gate. Each step admits a triangle only if
  the bend between adjacent faces is within `normalToleranceDeg`. The right
  pick for flat panels and feature edges — a hat brim, a sharp face on a
  bolt head. Start at 5°.
- **`colorFlood`.** Magic wand. The flood-fill admits triangles whose RGB
  colour is within `colorTolerance` of the seed colour. Only usable when
  the mesh already carries per-triangle colour (a coloured catalog import,
  or after an earlier paint pass).

## Stale and orphaned flags

After each code run the pointers re-resolve against the live mesh:

- **Clean re-resolve** — the anchor stays put (or snaps to a near-identical
  triangle). `listPointers` shows `stale:false, orphaned:false`.
- **`stale: true`** — the anchor still has a nearby surface, but it drifted
  or its normal turned. The pointer is still usable but flagged; review the
  feature before committing paint.
- **`orphaned: true`** — no surface anywhere within the model. The anchor
  has nothing to point at; re-aim it (`updatePointer(id, {point, normal})`)
  or `clearPointers({status:'orphaned'})`.

A bake op (surface modifier, voxelize, scale/place/rotate, engrave) flags
EVERY pointer stale up front, since the topology changes wholesale. The
post-run re-resolve recovers what it can; the rest needs your attention.

## Common shapes

**One feature → one pointer → one region:**

```js
const { id } = await dropPointer({
  label: 'iris_L',
  fromPixel: { pixel: [180, 220], view: { elevation: 0, azimuth: 0, size: 320 } },
  paintHint: { kind: 'connected', maxDeviationDeg: 18 },
  proposedColor: [0.05, 0.05, 0.08],
});
// User reviews, optionally tweaks angle in the panel...
await commitPaintFromPointer(id);  // colour from proposedColor
```

**Several sub-features → one shared region (the multi-eye case):**

```js
const ids = [];
for (const lbl of ['iris_outer_L', 'iris_inner_L', 'pupil_L', 'sparkle_L']) {
  const r = await dropPointer({ label: lbl, fromPixel: { ... }, paintHint: { kind: 'connected', maxDeviationDeg: 14 } });
  ids.push(r.id);
}
await commitPaintFromPointers(ids, { color: [0.06, 0.06, 0.10], name: 'eye_L' });
```

**Coverage check before declaring done:**

```js
const { uncoveredFeatures } = await getPointerCoverageReport();
if (uncoveredFeatures.length > 0) {
  // Address each one — usually `dropPointer({ label, point: f.centroid, normal: f.normal, ... })`.
}
```

## Why this loop is worth the round-trips

The cost of one back-and-forth with the user is two messages. The cost of
silently misidentifying a feature is 80 wrong paint ops + a confused user
who has to undo and re-explain. Pointers make your hypotheses visible at
the stage where they're cheap to correct.

**Don't skip the coverage check.** The absence of a pointer is exactly the
class of defect this workflow exists to catch.
