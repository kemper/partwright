# Annotations

The user can mark up the model surface using the **Annotate** tool (✏️ button in the viewport
overlay). Two kinds of annotations:

- **Freehand strokes** drawn with the pen sub-mode -- raycast onto the mesh and stored as 3D
  polylines (color + pixel-width per stroke).
- **Text labels** placed with the text sub-mode -- pinned to a 3D anchor on the surface and
  rendered as a screen-facing label (so they stay readable from any angle).

Both kinds are **not part of the model** -- they're a visual feedback layer that
survives orbiting and appears in **every** rendered output: the live viewport and the
`renderView()` / `renderViews()` images.

**Lifecycle**: annotations are scoped to the current version. `runAndSave` /
`saveVersion` snapshots the current annotations into the new version, and
`loadVersion` / `navigateVersion` swap them back in when you return. Unsaved
annotations are dropped when you switch versions -- same as unsaved code.

When the user has annotated, treat the marks as a directional cue tied to the geometry under
them. Inspect them via `listAnnotations()` / `listTextAnnotations()`, infer which feature is
being pointed at from the 3D points/anchors, and confirm your interpretation before making
changes.

```js
partwright.listAnnotations()
// -> [{id, color: [r,g,b], width: 4, pointCount: 24, points: [[x,y,z], ...]}]

partwright.listTextAnnotations()
// -> [{id, text: "shorter here", color: [r,g,b], fontSizePx: 28, anchor: [x,y,z]}]

partwright.addTextAnnotation({ anchor: [4, -5, 3], text: "round this corner" })
// -> {id: "..."}

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
  session exports (`.partwright.json`), but do not modify the model geometry or lock the editor.
- **Color regions** (`paintRegion`) modify the model's vertex colors -- persist with the
  version, export with the model (GLB/3MF), and lock the editor while present.
