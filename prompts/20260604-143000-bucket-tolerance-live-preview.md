---
session: "01Q5PMQ8Lfu2dPbrdSAWsAko"
timestamp: "2026-06-04T14:30:00Z"
model: claude-opus-4-8
---

## Human

The bucket paint with color tolerance highlights the triangle instead of
walking the region that would actually be painted based on the tolerance
setting. I would like to preview the actual paint region that would be
painted based on the tolerance setting.

## Assistant

## Key decisions

**Diagnosis (empirical, not assumed).** The hover handler in
`processMouseMove` already calls `findColorRegion`/`findCoplanarRegion` and
passes the *whole* flood-fill region to `showHighlight`, so on hover the
region preview already works. Reproduced in a browser spec: hovering a
painted hemisphere highlighted 1024 triangles (the whole region), not one.
The real gap surfaced when changing the tolerance slider **without moving the
mouse** — the highlight stayed frozen (1024 tris) at the old tolerance
instead of growing/shrinking. The preview only ever recomputed on a
`pointermove`, so it never tracked the tolerance setting the user was
dialling in. That stale, setting-detached preview is what reads as
"highlights the [wrong] region instead of the region the tolerance would
paint."

**Fix.** Remember the triangle the bucket cursor last hovered
(`lastBucketSeed` in `paintMode.ts`) and expose `refreshBucketPreview()` that
re-runs the same flood-fill from that seed at the *current* tolerance/mode
and redraws the highlight. The paint UI calls it from the color/geometry
tolerance slider + number input and the color/geometry mode toggle, so the
previewed region updates live as the setting changes.

**Seed lifecycle.** `lastBucketSeed` defaults to null at the top of
`processMouseMove` and is only set in the bucket branch, so every hover-off /
other-tool path leaves it null and a later tolerance tweak can't redraw a
stale region. It's also cleared on mesh change (`updatePaintMesh`, where the
old triangle indices no longer apply) and bounds-checked in
`refreshBucketPreview`. `refreshBucketPreview` reuses the existing
`showHighlight` primitive, so commit-time and preview-time regions stay
computed by the identical code path.

**Test.** Added a permanent golden-path e2e in
`paint-controls-extended.spec.ts`: paint a hemisphere, hover the bucket at 5 %
tolerance, then crank to 100 % with no mouse move and assert the previewed
triangle count grows.
