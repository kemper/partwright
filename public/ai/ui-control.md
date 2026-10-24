# UI control — open a tool for the user and hand it over

Most requests you should just do: call the API (`applySurfaceTexture`, `scaleModel`, `paintByLabel`, …) and report back. But some requests are about the user doing it themselves:

- they want to **tweak it interactively** ("let me play with the knit size", "I want to dial in the fuzz"),
- they ask you to **show them** a tool ("show me how to paint the hat", "where's the resize tool?"),
- the result is **subjective** and they should judge it live (texture depth, colour, character proportions).

For those, **open the tool prefilled instead of applying**: `openTool(id, prefill, {note})` opens the panel with your values already in its fields and leaves it open. It **never applies anything** — the user previews, adjusts, and clicks Apply (or Cancel). The chat stays visible beside the panel (opening a tool from the AI doesn't step the AI panel aside).

```js
// AI chat tool: openTool({id, prefill?, note?})  ·  console: partwright.openTool(id, prefill?, {note?})
await partwright.openTool('tool-surface',
  { tab: 'knit', mode: 'whole', stitchWidth: 3, stitchHeight: 4, amplitude: 0.8 },
  { note: 'Knit at 3 mm stitches — drag Stitch width to taste, then Apply as code.' })
// -> { ok: true, id: 'tool-surface', applied: {tab, mode, stitchWidth, …}, ignored: [] }
```

- `applied` — the values that landed (normalized: colours become `[r,g,b]`, numbers snap to the field's step).
- `ignored` — valid keys that had no effect here (e.g. `preserveColor` on an unpainted model).
- `{ error }` — unknown key, wrong type, or a value outside the field's own range (many surface ranges scale with the model size, so the error states the range for *this* model). Nothing opens on an error.
- `note` (≤ 500 chars) shows at the top of the panel as **"Suggested by AI: …"**. Say what you set and what to try next.

Opening a docked tool panel closes the one that was open (one at a time); Measure and Cross section are viewport modes that sit alongside.

## Reading what's on screen

```js
partwright.getUiState()
// -> { activeTool: 'tool-surface' | … | 'other' | null,
//      openTools: [...], mode: 'paint'|'pen'|'text'|'select'|'imagePaint'|'voxelStudio'|null,
//      openModal: '<dialog title>' | null,
//      toolState: { …the open tool's CURRENT values… },
//      tab, codeView, camera, selection: {arrange, parts}, surfacePending: {ops} | null }
```

`toolState` uses the same keys as that tool's prefill, so after a hand-off you can see exactly what the user changed (`toolState.stitchWidth` went from 3 to 4.2) — useful for "what did I set?" questions or to write the final values into code.

Other read-only accessors:

| Call | Returns |
|---|---|
| `getPaintState()` | `{active, tool, color, slot, withinPart, bucket:{mode, angleDeg, tolerance, colorTolerance}, brush:{size, shape, surface, depth, wrapAngleDeg, smooth, divisor, spray, strength, softness}, slab:{axis}, box:{shape, mode}, regions, visible}` — even with the panel closed |
| `getUndoState()` | `{paint:{undo, redo, undoClear}, arrange:{undo, redo}, annotations:{undo, redo}, voxel:{undo, redo}}` |
| `listUiCommands()` | every drivable action: `[{id, title, hint, kind:'tool'|'command', enabled, open, prefill}]` — `prefill` is the tool's documented key schema |

## Other calls

| Call | What it does |
|---|---|
| `runUiCommand(id)` | Run any palette command by id (`'export-3mf-bambu'`, `'place-drop-floor'`, `'tab-notes'`, …); a tool id opens it with no prefill. `{ok}` / `{error}`. |
| `closeTool(id?)` | Close that tool, or whichever is open. `{ok, closed}`. |

`openTool` / `runUiCommand` refuse while a tool is unavailable (e.g. no model on screen) — the same gate as the command palette.

## Prefill keys per tool

All keys are optional. Unknown keys are rejected.

### `tool-surface` — Surface textures

| Key | Value |
|---|---|
| `tab` | `fuzzy` `knit` `cable` `waffle` `fur` `woven` `knurl` `voronoi` `voronoiLamp` `engrave` `smooth` `voxelize` (default `fuzzy`) |
| `mode` | `'whole'` — whole model, previews immediately; in a manifold-js session Apply writes `api.surface.<id>({…})` into the code. `'region'` — the user picks faces; Apply bakes the patch. Default `region` (nothing previews until faces are picked), so pass `'whole'` for a live preview. |
| `scope` | `{label}` (an `api.label` region) or `{point:[x,y,z], radius}` — scopes the in-code texture; implies `mode:'whole'`. Ignored on the bake path. |
| `preserveColor` | keep paint on bake (painted models) |
| `quality` | mesh detail 1–5 (texture tabs) |
| op fields | the tab's `api.surface` options, e.g. fuzzy `amplitude scale octaves seed`; knit `stitchWidth stitchHeight amplitude roundness grainAngleDeg variation seed algorithm`; cable `cableWidth cablePitch plyWidth amplitude grainAngleDeg variation seed`; waffle `cellWidth cellHeight amplitude sharpness rowOffset grainAngleDeg`; fur `fiberSpacing fiberLength amplitude octaves grainAngleDeg seed`; woven `threadSpacing threadWidth amplitude underDepth grainAngleDeg`; knurl `style profile cellWidth cellHeight amplitude sharpness grainAngleDeg`; voronoi `cellSize wallWidth amplitude jitter grainAngleDeg seed raised`; voronoiLamp `cellSize wallThickness strutWidth jitter grainAngleDeg seed resolution watertight output`; engrave `text font through raised size depth resolution watertight`; smooth `iterations subdivide`; voxelize `resolution smooth` |

A key that isn't on the chosen tab is an error naming the tab's fields. Engrave `text` is rasterized on open; the user still places it with "Click to place on model".

### `tool-paint` — Paint colours

| Key | Value |
|---|---|
| `tool` | `bucket` `brush` `slab` `box` `replace` |
| `color` | `[r,g,b]` 0..1 or `"#rrggbb"` (unslotted) — or `slot` (palette slot id or name), not both |
| `withinPart` | clip strokes to one part (`api.label` / accepted part name); `""` = whole model |
| `bucket` | `{mode:'color'|'geometry', angleDeg 0–180 \| tolerance -1..1, colorTolerance 0..1}` |
| `brush` | `{size ≥0, shape:'circle'|'square'|'diamond', surface:'slab'|'geodesic', depth ≥0, wrapAngleDeg 0–180, smooth, divisor 2–1024, spray, strength 0..1, softness 0..1}` |
| `slab` | `{axis:'x'|'y'|'z'}` |

Nothing is painted until the user clicks the model.

### `tool-resize` — Resize / scale

`scale` (number = uniform, or `[sx,sy,sz]`; 1 = unchanged, ≥ 0.01) **or** `size` (`[x,y,z]` target units) **or** `fitToBed: true`; `uniform` (bool); `mode` (`'parametric'` keeps editable code — manifold-js, unpainted — or `'bake'`); `preserveColor`. The scale is previewed; Apply saves.

### `tool-place` — Place / rotate

`rotate` (`[x,y,z]` degrees, staged in the Rotate boxes — the user clicks "Apply rotation"), `mode` (`'parametric'|'bake'`), `preserveColor`.

### `tool-quality` — Quality: simplify / enhance

`curvatureQuality` (`low` `medium` `high` `highest` `ultra` — previewed live, kept only on Apply), `mode` (`simplify|enhance`), `knob` (`count|edge|size`), `targetTris` (knob count; simplify ≤ base count, enhance ≥ base), `length` (knob edge/size, mesh units), `amount` (1–6, knob size), `preserveColor`.

### `character-creator` — Character Creator

`spec` — a Character Creator spec (the `buildCharacter` shape; a partial spec merges onto the default; every field validated). Shown **unbuilt**: the editor is untouched until the user edits a control, presses **Preview**, or **Save to session**. `toolState.spec` is the panel's current spec.

### `convert-to-code` — Convert model to code

`quality` (`draft|standard|fine`), `step`, `edge`, `dpTol` (positive numbers), `samples` (integer ≥ 1). The user clicks Convert.

### `detect-parts` — Detect parts

`detector` (a `listPartDetectors()` id), `params` (that detector's params — validated against its ParamSpecs). The user clicks Detect (or pins parts).

### `tool-measure` — Measure

`points: {from:[x,y,z], to:[x,y,z]}` pre-places a measurement (`applied.distance` is returned). The note shows as a toast (Measure has no panel).

### `tool-annotate` — Annotate

`mode` (`pen|text|select`, default pen), `color`, `width` (0.5–64 px; presets 2/4/7/12), `fontSize` (4–256 px; presets 16/22/32/48).

### No prefill (yet)

`tool-print`, `tool-cross-section` open with `openTool(id)` / `runUiCommand(id)` and report `getUiState().activeTool`, but take no prefill keys.
