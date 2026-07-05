---
date: 2026-07-04
branch: claude/confident-carson-gpo63q
files_changed:
  - src/main.ts
---

## Human

After the generative-coloring research (#885) and the prioritization
discussion, the owner supplied a Gemini API key (kept strictly outside
the repo) and said to proceed with the best next step: the single-view
repaint experiment on the Pomni head.

## Assistant

The experiment needed per-triangle mesh access, which lives in main.ts's
closure — so the back-projection was built as the experimental API it
would become anyway: **`paintByImageProjection({image, view, within,
palette})`** (#885 item 2's receiving half).

How it works: the caller renders an ortho view (`renderIsland`), an image
model repaints it (colors only), and the repainted data URL comes back
with the same view spec. The method replicates `buildViewCamera`'s ortho
framing over the scope, projects every camera-facing scoped triangle's
centroid into the image, 3×3-samples, snaps to the print palette in a
shading-tolerant HSV space (neutrals match by lightness, saturated colors
by hue — so the model's shading can't flip red to black), and commits one
editable region per palette color. Alignment self-corrects by comparing
the silhouette bbox of a fresh internal render against the image's
(uniform shift/scale absorbed). Back-facing / background / off-image
triangles stay unpainted and are reported.

Experiment result (Pomni head, 205k tris, gemini-3.1-flash-image,
~1 cent): the model returned a near-pixel-exact repaint (silhouette drift
1–2 px), and one projection painted 101,862 triangles into 7 palette
regions — hat lobes with the character's yellow trim, bangs, outlined
eyes with correct per-side irises, blush, mouth. One API call produced a
better face than ~40 agent paint operations in prior rounds. The tilted
render confirms real surface paint with expected unpainted back faces
(multi-view coverage is the documented next step).

Marked EXPERIMENTAL in the help() entry; AI-tool schema, colors.md
workflow, and multi-view compositing deliberately deferred until the
approach is productized (#885). The API key touched only the session
scratchpad — a repo-wide scan for the key pattern ran clean before
commit.
