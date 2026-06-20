---
session: "01DnBahfEetNH5Enmu5CbJPB"
timestamp: "2026-06-13T20:00:00Z"
model: claude-opus-4-8
---

## Human

Asked whether the figure eye API supports eyelids, and to investigate by
creating preview photos of several eyelid styles on faces, then iterate on
feedback. After the first cut, the feedback was: keep the proposed style set,
**add `almond` and `tapered`**, keep the current boldness, leave `closed` as
smooth domes (no carved crease), and **update the existing catalog figures to
use eyelids**.

## Assistant

## Key decisions

**There was no eyelid feature.** `F.face.eyes` only built round eyeballs
(`'solid'`/`'iris'`) and brows were a separate part. Added a `lids` option to
`buildEyes` rather than a new builder, so it composes with both eye styles and
defaults to `'none'` — every existing figure is byte-unchanged until opted in.

**Lid geometry = clipped concentric cap.** A lid is the slice of a sphere a
little larger than the eyeball (so it wins the hard-union and reads as skin
sitting ON the eye), clipped to a half-space and to the front hemisphere. The
cut plane offset encodes coverage along its axis: upper/lower lids cut on Z;
the lateral corner caps that pinch an almond eye to points cut on X (symmetric,
so one node still mirrors onto both eyes). Built in the canonical head frame
then `orientToHeadPose(...).translate(c)` — the same path the iris/pupil plug
already uses — so lids follow head pose for free. Labelled `'lids'` so callers
paint them (skin tone, or eyeshadow).

**Boldness needed a second pass.** The first cut made the lid only fractionally
larger than the eyeball, so it barely protruded and the styles were
indistinguishable in preview. Bumped the `scale` (1.06→1.22, hooded 1.40) so
the fold reads as a distinct crease — confirmed against the user's "current is
right".

**Seven styles:** `none` (default), `upper`, `hooded`, `half`, `closed`,
`almond`, `tapered`. `closed` stays smooth domes per feedback (no crease).

**Solid eyes stay backward-compatible.** Bare `style:'solid'` still returns an
unlabelled pair for the caller to label; only when `lids` is present does solid
self-label (`'eyes'` + `'lids'`) so the two regions paint independently.

**Catalog update.** All 15 figure examples got a per-character lid style and a
`'lids'` entry (= skin tone) in their committed palette, then each
`.partwright.json` was rebaked with `build-catalog-entry.cjs` (xvfb + dev
server) using `--require-labels` (including `lids`, to catch a buried fold) so a
lid that resolves to zero painted triangles fails the bake. All stayed manifold,
`componentCount 1`. Verified headlessly with `model:preview` (shape) and the
colored bake thumbnails (paint).
