---
session: "01TLwb"
timestamp: "2026-06-08T16:15:00Z"
---

## Human

(work-reviewer follow-up on PR #511.) The reviewer flagged that the `_painted`
sidecar — a JS expando on the triColors `Uint8Array` — doesn't survive the
paint-subdivision Web Worker boundary, so on the worker path a legitimately
black base triangle could be misread as unpainted and render as the default
material, diverging from the synchronous path.

## Assistant

## Key decisions

**Reconstruct the `_painted` mask on the main thread after the worker returns.**
The worker transfers the colour BYTES of `triColors` but not the expando mask.
The main thread still holds the input mesh (mask intact) and the worker returns
`childToParent`, so `reattachPaintedMask` (subdivisionClient.ts) rebuilds the
mask as `painted[i] = inputPainted[childToParent[i]]` — exactly mirroring the
synchronous `propagateTriColors`. Wired it into the resolve path of
`refineInWorker` so every worker result is normalised. No-op when the input has
no mask, so the renderer's nonzero-channel fallback still governs both paths
identically; strictly improves consistency with zero downside.

**Left the brush-preview `inRange` nit alone.** `grid.has()` already
bounds-checks, so the paint/remove previews are correct; only the `add` preview
at the absolute coordinate extremes is affected, which is unreachable in
practice. Exporting a private helper just for that would be churn for no
real-world gain.

**Verification.** Build + 802 unit tests pass; the smooth-brush e2e suite (which
drives the subdivision worker) passes.
