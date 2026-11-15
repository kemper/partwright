---
session: "5ecjfq"
timestamp: "2026-11-15T16:12:02Z"
sequence: 8
tools: [explore]
---

## Human

Proceed with the layer-colour print preview using best judgement; the owner
will test what gets built.

## Assistant

## Key decisions

**Declared in code, following `api.material`.** `api.print.layerColors(changes,
options)` is recorded by the manifold-js engine and threaded through the
Worker result exactly like `api.material`: engine local, `MeshResult` field,
Worker message, message validation, main-thread receive, and the export pool
(`PoolBuildResult`), which is the hop that is easy to miss and that
multi-object 3MF exports depend on. No session schema change: the colours are
versioned with the code.

**One validator for three callers.** `parseLayerColorsSpec` is used by the
engine recorder, by the Worker-message check (which re-runs it on what
crossed the boundary) and by the console API, so they cannot drift apart.
Unknown keys are rejected, per the repo's argument-validation rule.

**The preview is a way of looking, not model state.** It lives in per-tab
memory and is never persisted. While it is on, the one paint-refresh
chokepoint and the end of every run put the preview mesh back, and
`renderView` / `renderViews` render it too, so an AI that turns the preview
on sees the same thing the user does without a separate render method.

**With no entry on the bed, the base colour is the exporter's default grey,**
the filament an uncoloured object gets in the 3MF project export, so preview
and export agree.

**Layer numbers are 1-based at the API surface** (as a slicer shows them) and
0-based inside the pure module. `setPrintPreview({ layer })` maps to the middle
of that layer because the preview snaps a cut to the top of the layer it
falls in.

**Paint plus layer colours gets a warning, not a silent pick.** The slicer
ignores layer changes on painted objects, so `getLayerColors()` says so. The
export will write the layer colours and leave that object's paint out, since
that is what the preview shows.

**Tuning values are app config,** per the repo rule: default layer heights and
the blend estimate's depth, transmission distances and top-surface threshold
are `renderer.*` settings with bounds and Advanced Settings fields.

**Checked in the real app** through the warm-browser daemon: bands, a cut at
layer 45 with its cap, and the blend toggle all render; bad arguments return
`{ error }`.
