---
session: "qvftq5"
timestamp: "2026-06-08T14:50:00Z"
model: claude-opus-4-8
tools: [playwright]
---

## Human

Let's do paintImage as its own PR. (The last open paint parity gap from the
feature audit — image-stamp painting reachable only by clicking.)

## Assistant

## Key decisions

**The refactor was smaller than feared.** The heavy compute (footprint BFS +
confined subdivision + region remap) was already a reusable callback
(`smoothStampCb`, set from main.ts). The only UI-coupled piece was
`executeStamp`, which read panel state (picked image, size, rotation, detail,
preprocess, bg options) and committed the region. So I extracted a param-
explicit core `runStamp(StampRun)` in `imagePaintUI.ts`; `executeStamp` now
builds a `StampRun` from UI state and calls it, and a new exported
`stampImageProgrammatic(imageData, params)` builds one from explicit params.
Behaviour for the UI path is unchanged (the one latent inconsistency — the
descriptor keyed `entries`/smooth-params off the `stampSmooth` toggle while the
compute branch used the fuller `smooth && maxEdge>0 && cb` condition — is now
consistent via a single `useSmooth`, which only differs in a path unreachable
with the default detail=96 + always-set callback).

**`window.partwright.paintImage({imageUrl, at, normal, size, rotationDeg?,
detail?, removeBackground?, name?})`** — loads the image via the existing
`loadImageDataFromUrl`, then calls `stampImageProgrammatic`. `at`/`normal` are
the stamp centre + outward face direction (agent gets them from `probeRay` /
`measureAt` / a known face centre); only forward-facing footprint triangles are
painted. Returns `{ ok, name, triangles, avgColor }` or a clear `{ error }` when
the footprint is empty. Validated with guard/assert*; deferred the in-app AI
tool (consistent with the prior PRs — the chat AI would need an attached image's
data URL; noted as follow-up).

**Docs**: `public/ai.md` console list + a "Stamping an image" section in
`public/ai/colors.md` (incl. how to get `at`/`normal` and the saveVersion
reminder) + the `help()` table.

**Verification**: build (tsc) + 800 unit tests + `lint:deps` pass. A throwaway
Playwright spec generated a data-URL image (red disc on white), ran a 40mm cube,
and `paintImage`'d it onto the +Z face: 7,452 triangles painted (white bg
removed), exactly one region created, avgColor red; an off-surface stamp
correctly returned the "nothing painted" error. Screenshot showed the red disc
on the cube's top face.
