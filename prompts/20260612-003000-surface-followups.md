---
session: "funny-wozniak"
timestamp: "2026-06-12T00:30:00Z"
sequence: 1
---

## Human

Go ahead and do all the follow-up work I flagged after the surface
color/scoping PR (#590) merged, in a new PR:

1. Scoped previews in the Surface panel — the Scope picker applies correctly,
   but the Preview button doesn't simulate the scope (previewing "By label" /
   "Near point" still shows the whole-model texture). Thread the resolved scope
   into the preview so preview and apply match.
2. Move engrave into the surface Worker — the engrave SDF sweep still runs on
   the main thread with cooperative yields; a big engrave can jank the UI. The
   Worker/cancel/progress groundwork exists.
3. Knurl pyramid profile — port the triangle-wave min() diamond math into the
   canonical (#595) knurl as a `profile: 'pyramid'` option, inside main's
   cellWidth/cellHeight/style/sharpness vocabulary.
4. Brush-stroke paint through textures — verify manually brush-painted strokes
   survive an in-code texture apply; fix with the nearest-centroid remap if not.
5. Parametric scale — `scaleModel` always bakes even on manifold-js, unlike
   place/rotate which have a parametric `mode: 'auto'`. Add the same.

## Assistant

## Key decisions

**Scoped preview reuses the existing patch path, no new compute mode.** Preview
already accepts `selectedTriangles` (region mode). So instead of teaching the
preview about label/point scopes, `previewSurfaceModifier` (the API method)
resolves the scope to a concrete `selectedTriangles` set on the main thread
(`resolvePreviewScope` → `resolveSurfaceScopes` seeds+radius →
`selectTrianglesNearSeeds`) and strips the scope keys before calling
`buildSurfaceModifier`. The panel just folds `scopeOpts()` into the preview
call (empty unless apply-as-code), and each scope-picker change re-fires the
debounced preview. An unknown label resolves to an empty selection (previews as
a no-op, matching apply) rather than silently texturing the whole model; a
malformed region throws, surfaced as a preview error like apply's validation.

**Engrave moves to a dedicated Worker by splitting `applyEngrave`.** The SDF
carve (`engraveMesh` → `sdfModifier`) is pure JS (THREE + three-mesh-bvh, no
DOM), so it runs unchanged in a Worker. `applyEngrave` is split into the heavy
`engraveMesh` half and a cheap synchronous `buildEngraveResult` (paint transfer
+ version code). `main.ts`'s engrave branch now runs the carve via
`engraveInWorker` (new `engraveWorker.ts` + `engraveWorkerClient.ts`) and
assembles the result main-side. Cancel is terminate+respawn (the surface-Worker
idiom — the only true interrupt for the effectively-synchronous sweep), wired to
the existing `ctl.signal`; progress messages drive the same inline "Rendering…
Xs". The combine closure is rebuilt inside `engraveMesh` from serializable
options, so no function crosses the Worker boundary. `applyEngrave` stays for
the headless/test callers. modifiers.ts stays Worker-import-free (the client
lives in its own module) so no cycle and no worker-in-worker risk.

**Knurl pyramid is an orthogonal `profile` knob, not a 4th style.** `profile`
(`'round'` default | `'pyramid'`) applies across all three styles: round keeps
the cosine ridges; pyramid swaps in a triangle-wave ridge (`triRidge`) and, for
the diamond, `min()` of the two opposite-handed ramps → true straight-sided
machinist pyramids with continuous ridge lines. Added to the surfaceOpSpec
allow-list (append-only), `defaultKnurlOptions`, the panel's Knurl tab dropdown,
the AI tool, and docs.

**Parametric scale via a new `scale` TransformStep.** Rather than special-case
scale, I extended the `placement.ts` transform chain with
`{ kind: 'scale'; v }` (applySteps, the wrapper/parse regexes, normalizeChain
componentwise-merge, `scaleLabel`/`isNoopScale`), so `scaleModel` routes through
the same `commitTransform` as place/rotate and gets `mode: 'auto'|'parametric'|
'bake'` for free — `'auto'` wraps a manifold-js model in `.scale([sx,sy,sz])`.
The positive-finite factor guard moved up to `scaleModel` (it used to live only
in `applyScale`, which the parametric path bypasses). Resize panel gained the
same write-back radio as the Place panel.

**Brush strokes already survive — verified, not fixed.** Brush strokes are
stored as geometry descriptors (samples + radius), not triangle indices, so they
re-resolve against whatever mesh is current when colors resolve — which, for an
in-code texture, is already the textured mesh. Only `api.label`/`byLabel` sets
(triangle-index based) needed the nearest-centroid remap (done in #590). Added a
regression spec (`surface-paint-survival.spec.ts`) that paints a stroke, applies
an `api.surface.knurl` texture, and asserts the red survives via renderViews
pixel counting.
