# Annotations

The user can mark up the model with the **Annotate** tool (✏️ in the viewport Tools). Two kinds of
mark:

- **Freehand strokes** (pen sub-mode) -- drawn on a flat plane frozen just in front of the model,
  perpendicular to the camera, and stored as 3D polylines on that plane (color + pixel width).
  They do **not** sit on the mesh surface.
- **Text labels** (text sub-mode) -- pinned to a 3D anchor on the same plane and rendered as a
  screen-facing label.

Annotate has two **styles** (`getAnnotateStyle()` / `setAnnotateStyle()`):

- **Snapshot** (default) -- the user marks up the frame they're looking at, then presses
  **Save view**. That stores an **annotation view** in the session's history: the exact camera,
  the frame as they saw it (marks drawn on it), the marks, and what each mark points at on the
  model. Unsaved Snapshot marks are *drafts*: they never persist on a version or appear in
  `listAnnotations()` once Annotate closes. The user picks which views to send to the AI with
  each view's **Attach to AI** button, which stages the image plus a line like
  `[Annotation view "View 2" (av_…): 1 stroke · on handle. …]` in the chat input.
- **Floating** -- the original behavior: marks stay pinned in space, are snapshotted onto each
  saved version, and are drawn in **every** render (the live viewport and `renderView()` /
  `renderViews()` images). **Save view** works here too and copies the floating marks into a view.

**Floating lifecycle**: marks are scoped to the current version. `runAndSave` / `saveVersion`
snapshots them into the new version, and `loadVersion` / `navigateVersion` swap them back in.
Unsaved floating marks are dropped when you switch versions -- same as unsaved code.

## Annotation views

A view answers "what was the user looking at, and what did they point at?" without a screenshot:

- `camera` -- `{position, target, up, fov, aspect}`, the live viewport camera when they saved.
- `marks2D` -- each mark in normalized image coordinates (`[0,0]` top-left, `[1,1]`
  bottom-right). A stroke with `closed: true` is a loop drawn **around** something.
- `hits` -- per mark, the result of ray-casting its screen points (plus the interior of a closed
  loop) from that camera: `{samples, hits, centroid, bbox, parts: [{name, hits}]}`. `parts` are the
  `api.label` names under the mark, most-hit first; `hits: 0` means the mark is off the model
  (e.g. "extend up to here" drawn in empty space -- read it from the image).
- `summary` -- the same thing in one line.

```js
await partwright.saveAnnotationView({ title: 'thinner handle' })  // capture the live frame -> summary
partwright.listAnnotationViews()        // -> [{id, title, createdAt, camera, size, marks2D, hits, summary, context}]
partwright.getAnnotationView(id, { includeImage: true })   // + image: the frame the user saw (JPEG data URL)
partwright.renderAnnotationView(id)     // CURRENT model from that exact camera, marks on top -> {image}
partwright.renderAnnotationView(id, { marks: false, width: 800 })
partwright.restoreAnnotationView(id)    // snap the live camera to the view
await partwright.renameAnnotationView(id, 'new title')
await partwright.deleteAnnotationView(id)
await partwright.attachAnnotationViewToChat(id)  // stage it in the AI chat input (not sent)
partwright.setAnnotateStyle('floating') // or 'snapshot'
```

Views are saved per session (IndexedDB) and exported in `.partwright.json` (schema 1.23+);
share links drop them.

**In-app chat:** `listAnnotations` also returns `views: [{id, title, summary, createdAt,
attached}]`, and **`viewAnnotationView({id})`** (inspect group) returns the frame plus the hit
data; `fresh: true` re-renders the current model from the same camera so you can check a fix
from the angle the user flagged.

When the user has annotated, treat the marks as a directional cue tied to the geometry under
them. For a saved view, `hits[].parts` / `centroid` already
name the feature under each mark. For floating marks, inspect `listAnnotations()` /
`listTextAnnotations()` and infer the feature from the 3D points/anchors (they're on the plane
in front of the model, so cast along the mark's `camera` with `probeRay`), and confirm your interpretation before making
changes.

**In-app chat:** the read-only **`listAnnotations`** tool returns strokes, text labels and the
count in one call — `{count, strokes: [{id, color, width, pointCount, bbox, centroid, points,
camera}], texts: [...]}` — with each stroke downsampled to `maxPointsPerStroke` points (default
16; 0 drops points but keeps bbox/centroid).

```js
partwright.listAnnotations()
// -> [{id, color: [r,g,b], width: 4, pointCount: 24, points: [[x,y,z], ...]}]

partwright.listTextAnnotations()
// -> [{id, text: "shorter here", color: [r,g,b], fontSizePx: 28, anchor: [x,y,z]}]

partwright.addTextAnnotation({ anchor: [4, -5, 3], text: "round this corner" })
// -> {id: "..."}

partwright.addStrokeAnnotation({ points: [[0, -6, 2], [3, -6, 4], [6, -6, 2]], color: [1, 0, 0] })
// -> {id, pointCount} -- a freehand stroke through world points (width: px, optional)
partwright.redoAnnotation()             // re-add the last undone stroke -> {redone, remaining, canRedo}

partwright.setAnnotateMode('pen')       // open Annotate for the user: 'pen' | 'text' | 'select' | null (close)
partwright.getAnnotateMode()            // -> 'pen' | 'text' | 'select' | null

partwright.getAnnotationCount()         // total: strokes + text
partwright.undoAnnotation()             // removes the most recent annotation of either kind
partwright.removeAnnotation("<id>")     // remove a specific one
partwright.clearAnnotations()           // remove all
partwright.clearAnnotationStrokes()     // remove only strokes
partwright.clearTextAnnotations()       // remove only text labels

partwright.setAnnotationsVisible(false) // hides everything (and excludes from renders)
partwright.areAnnotationsVisible()

partwright.setAnnotationColor([r, g, b])  // applies to new strokes AND new text
partwright.setAnnotationWidth(6)          // pixels, for strokes (0.5..64)
partwright.setAnnotationFontSize(32)      // pixels, for text labels (4..256)
```

Each stroke and text label records its own color/width/font-size at creation, so changing the
active settings only affects new annotations.

Annotations are intentionally separate from `paintRegion` colorization:
- **Annotations** are floating visual marks on top of the surface -- per-version, included in
  session exports (`.partwright.json`), but do not modify the model geometry.
- **Color regions** (`paintRegion`) modify the model's vertex colors -- persist with the
  version and export with the model (GLB/3MF). The editor stays writable, but re-running new
  geometry invalidates the painted triangle indices (call `clearColors()` first to iterate).
