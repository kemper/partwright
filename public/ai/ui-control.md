# UI control — open a tool for the user and hand it over

Most requests you should just do: call the API (`applySurfaceTexture`, `scaleModel`, `paintByLabel`, …) and report back. But some requests are about the user doing it themselves:

- they want to **tweak it interactively** ("let me play with the knit size", "I want to dial in the fuzz"),
- they ask you to **show them** a tool ("show me how to paint the hat", "where's the resize tool?"),
- the result is **subjective** and they should judge it live (texture depth, colour, character proportions).

For those, **open the tool prefilled instead of applying**: `openTool(id, prefill, {note})` opens the panel with your values already in its fields and leaves it open. It **never applies anything** — the user previews, adjusts, and clicks Apply (or Cancel). On the desktop layout the chat stays visible beside the panel (opening a tool from the AI doesn't step the AI panel aside); on a phone, where the chat is full-screen, the tool steps it aside like a user open so the panel isn't hidden behind it.

```js
// AI chat tool: openTool({id, prefill?, note?})  ·  console: partwright.openTool(id, prefill?, {note?})
await partwright.openTool('tool-surface',
  { tab: 'knit', mode: 'whole', stitchWidth: 3, stitchHeight: 4, amplitude: 0.8 },
  { note: 'Knit at 3 mm stitches — drag Stitch width to taste, then Apply as code.' })
// -> { ok: true, id: 'tool-surface', applied: {tab, mode, stitchWidth, …}, ignored: [] }
```

- `applied` — the values that landed (normalized: colours become `[r,g,b]`, numbers snap to the field's step).
- `ignored` — valid keys that had no effect here (e.g. `preserveColor` on an unpainted model).
- `pending: true` (+ `message`) — the dialog isn't up yet because something the user must answer first is showing (an export's "unsaved objects" confirm); it opens with your values once they answer. Check `getUiState()` later rather than assuming it's open.
- `{ error }` — unknown key, wrong type, or a value outside the field's own range (many surface ranges scale with the model size, so the error states the range for *this* model). Nothing opens on an error.
- `note` (≤ 500 chars) shows at the top of the panel as **"Suggested by AI: …"**. Say what you set and what to try next.
- In-app AI tool only: if your provider can't fill the free-form `prefill` object, pass the same values as a JSON string in `prefillJson` (used only when `prefill` is absent or empty; validated the same way).

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

`activeTool` is the open docked panel; Measure / Cross section (viewport modes that sit alongside a panel) are reported only when no panel is open. `openModal` is the title of an open shell modal (settings, export options, …) — the small confirm / prompt dialogs aren't tracked.

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

A key that isn't on the chosen tab is an error naming the tab's fields. Engrave `text` is rasterized on open. Engrave placement: `face` (`'+z'` top, `'-z'` bottom, `'-y'` front, `'+y'` back, `'+x'` right, `'-x'` left), `posU` / `posV` (0..1 across / up the face), `rotationDeg` (-180..180), `curve` (`'none'`, `'v'` wrap around the vertical axis, `'u'` around the horizontal) and `curveAngle` (10..360°) — the outline previews where it lands; the user can still re-place it with "Click to place on model". (`toolState.face` reads `'free'` after a click on a sloped face.)

### `tool-paint` — Paint colours

| Key | Value |
|---|---|
| `tool` | `bucket` `brush` `slab` `box` `replace` |
| `color` | `[r,g,b]` 0..1 or `"#rrggbb"` (unslotted) — or `slot` (palette slot id or name), not both |
| `withinPart` | clip strokes to one part (`api.label` / accepted part name); `""` = whole model |
| `bucket` | `{mode:'color'|'geometry', angleDeg 0–180 \| tolerance -1..1, colorTolerance 0..1}` |
| `brush` | `{size ≥0, shape:'circle'|'square'|'diamond', surface:'slab'|'geodesic', depth ≥0, wrapAngleDeg 0–180, smooth, divisor 2–1024, spray, strength 0..1, softness 0..1}` |
| `slab` | `{axis:'x'|'y'|'z'}` |
| `box` | `{shape:'box'|'sphere'|'cylinder'|'cone', mode:'translate'|'rotate'|'scale', center:[x,y,z], size:[x,y,z] (> 0; sphere/cylinder/cone: x = diameter, y = height), rotation:[x,y,z] degrees}` — places the translucent shape (previewed); `center`/`size`/`rotation` imply `tool:'box'`. The user still clicks **Paint inside shape**. |

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

`detector` (a `listPartDetectors()` id), `params` (that detector's params — validated against its ParamSpecs; with no `detector` they're checked against the method the panel shows). The user clicks Detect (or pins parts). If the panel is already open (e.g. an import-time proposal), the prefill and note land in place — its draft and context line are kept.

### `tool-measure` — Measure

`points: {from:[x,y,z], to:[x,y,z]}` pre-places a measurement (`applied.distance` is returned). The note shows as a toast (Measure has no panel).

### `tool-annotate` — Annotate

`mode` (`pen|text|select`, default pen), `color`, `width` (0.5–64 px; presets 2/4/7/12), `fontSize` (4–256 px; presets 16/22/32/48).

### `tool-image-paint` — Stamp an image onto the model

`src` — a `data:image/…` URL, an `https://` URL (the host must allow CORS; plain `http:` is refused), or an image **attachment** id / label (`getAttachments()`); SVG is fine. It is only downloaded into this tab (same timeout / 25 MB cap as Import from URL, and a pixel-count limit), never uploaded, and becomes the panel's remembered image only once the user stamps with it. `removeBackground` (bool), `bgColor` (colour to treat as background; implies `removeBackground`), `smooth` (bool — subdivide for crisp edges), `detail` (16–1024, smooth mode), `size` (stamp width ≥ 1, world units), `rotationDeg` (0–359). The image and settings are staged; nothing is stamped until the user clicks the model. A src that can't be loaded is an error and nothing opens. `applied.src` / `toolState.src` is a short label, not the data URL.

### `tool-palette` — Filament palette manager

`palette` (name or id of an existing palette), `capacity` (printer filament slots, 1–64), `constrained` (bool). The manager saves every edit immediately, so these are shown as a **Suggested** row — "switch to “Studio” · 4 printer slots · constrain painting" — that the user confirms with **Apply** (or Dismiss). `toolState` = the live (saved) values, so it changes once they apply. An unknown palette is an error.

### `tool-customize` — Customizer (api.params sliders)

`values` — `{key: value}` for the model's declared `api.params` (as `setParams`, but strict: an unknown key, wrong type, non-option select value or over-long text is an error; numbers past the slider range are allowed like the number box). Moving the sliders re-runs the model exactly like a drag — nothing is saved — so from the in-app AI, `values` needs the **Run code** scope (open it without `values` otherwise). Errors when the model declares no parameters. `toolState = {values}` (resolved).

### `tool-voxel-paint` — Voxel Studio (voxel sessions)

`tool` (`view` `paint` `add` `remove` `bucket` `level` `boxAdd` `boxRemove`), `color`, `brush` `{radius 0–16, shape:'sphere'|'cube'|'diamond', spray, sprayDensity 0.05–1, block:[x,y,z] 1–32 each, depth ≥ 0}`, `levelAxis` (`x|y|z`). Opening enters the studio (like the button); nothing is edited until the user clicks the model, and nothing is written to code until they click Update code / Save as raw.

### `tool-print` — Print tools

`bed` (`[x,y,z]` mm, 10–2000 each), `nozzleWidth` (0.05–2), `overhangAngleDeg` (1–89). Staged in the form with a "Suggested settings — not saved yet · **Use these** / Discard" row; the saved printer settings (`getPrinterSettings()`) change only when the user confirms (clicking Use these, or editing a field — which saves the whole form). Check printability checks what the form shows, staged values included, without saving them. The printability check never runs on open.

### `tool-cross-section` — Cross section

`z` — clip-plane height in world units, within the model's Z range (only a horizontal plane is supported). The note shows as a toast. `toolState = {z}`.

### `export-objects` — Export objects (object picker)

`format` (`3mf-bambu` default, `3mf`, `stl`, `obj`, `glb` — non-Bambu formats need a session with 2+ objects, since one object downloads straight away), `objects` (names or ids to tick; default the current object), and for `3mf-bambu`: `printer` (id), `nozzle` (`"0.2"` `"0.4"` `"0.6"` `"0.8"`), `filament` (id), `plateLayout` (`separate|grid|group`); `packStrategy` (`grid|horizontal|vertical`, any 3MF). Opens the export's picker with these ticked/selected — the user clicks **Export**. Every key (incl. `objects`, `plateLayout:'group'` needing grouped objects) is checked before anything opens. If a pre-export "unsaved objects" confirm comes first, `openTool` returns `pending: true` after a few seconds (`ui.toolDialogOpenWaitMs`) and the picker opens with your values once the user answers the confirm. `toolState` includes `format`.

### `export-session` — Export session (.partwright.json)

`includeThumbnails` `includeAnnotations` `includeNotes` `includeColorRegions` `includeChat` (bools), `versions` (indices to keep; must exist). Opens the options dialog staged; the user clicks Export.

### `publish-model` — Publish to a print site

`platform` (`printables` `makerworld` `thingiverse` `thangs`), `format` (one the platform accepts), `title`, `description`, `tags` (array), `includeCover`. Opens the publish dialog filled in; nothing downloads or opens until the user clicks.

### `import-relief` — Make a part from an image (relief / colour tile)

`src` (as image paint; omit to open the picker empty), `mode` (`quantized` colour tile | `luminance` relief / lithophane), `options` `{widthMm, layerHeight, baseThickness, maxHeight, resolution, smoothing, removeBackground}`, `luminance` `{invert, gamma, levels}`, `quantized` `{clusters, colorSpace, dither, output, shape, cornerRadiusMm, chamferMm, paintingMode, invertHeights, doubleSided, backMirror}`, `preprocess` `{brightness, contrast, saturation, levelsLow, levelsHigh}`, `crop` `{left, top, right, bottom}` (fractions, all four). Ranges as `importImageAsRelief`. Opens the wizard staged — the user clicks **Create**.

### `import-image-voxel` — Image → voxel

`src` (as above; not SVG), `options` — the `importImageAsVoxels` options (`maxSize mode depth maxHeight baseThickness invert alphaThreshold colorMode flatColor gamma brightness contrast saturation posterizeColors constrainToPalette removeBackground codeStyle`). Opens the dialog staged — the user clicks **Import**.

### `open-quality` — Settings

`focus` — `"section.key"` of a setting (e.g. `"renderer.fov"`, `"ui.toastDurationMs"`): scrolls to and highlights that field. No value is changed. An unknown key is an error listing that section's keys.

The dialogs and wizards above take one open at a time: if one is already open — or an export you opened is still waiting on the user — `openTool` returns an error rather than discarding what the user has in it or stacking another dialog. Dialogs you open never take keyboard focus on their Export button, and Enter doesn't export until the user has clicked or tabbed into the dialog.

## What the user applied

When the user applies / commits from a panel **you** opened (`openTool` from the AI), while that panel is still the one you opened — Apply on Surface, a hand-painted stroke / fill / slab / shape, a stamp, a successful Update code / Save as raw in Voxel Studio, Apply on the palette suggestion, Use these in Print tools, a slider move in Customize — your next turn starts with an app-generated line (not the user's words) like

```
[UI · app note] user applied Surface textures: knit {mode: "whole", applies: "code", stitchWidth: 3.5, amplitude: 0.8, …}
```

(the tool's `toolState` at that moment; latest per tool). Once the user closes that panel, later use of it sends no notes. Notes are per-tab memory only and are dropped when the session changes.
