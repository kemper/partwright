# Reference images & photo-to-model workflow

## Reference images

Attach reference photos so the model can be compared against them. Each image has just two user-facing fields:

- `src` — a `data:` URL or `http(s)` URL.
- `label` (optional) — a free-form caption. Common values like `"Front"`, `"Right"`, `"Back"`, `"Left"`, `"Top"`, and `"Perspective"` are **presets**: the UI offers them as one-click pickers and the system uses them to order the strip in the Elevations tab. Any other string is also valid (`"south elevation, morning light"`, `"Inspiration: Frank Lloyd Wright"`). Empty / omitted means no caption.

Multiple images may share a label — nothing is overwritten. The label is what appears in the Gallery thumbnail caption, in the lightbox, and in tooltips. Items whose label matches a preset (case-insensitive) sort first in preset order; the rest keep their insertion order at the end.

```js
// Replace the full list. Each item is {src, label?}; the call returns the
// same items with a server-assigned `id` so you can remove individuals later.
const items = partwright.setImages([
  { src: 'data:image/jpeg;base64,...', label: 'Front' },                       // preset
  { src: 'https://cdn.example.com/view-right.jpg', label: 'Right' },           // preset
  { src: 'data:image/png;base64,...',  label: 'south elevation, morning' },    // custom
  { src: 'data:image/png;base64,...' },                                        // no label
])
// items -> [{id: 'A1bC2dE3fG', src: '...', label: 'Front'}, ...]

// Append one without disturbing existing items
const added = partwright.addImage({ src: '...', label: 'Perspective' })

// Remove a specific item by id
partwright.removeImage(added.id)

// Clear all attached images
partwright.clearImages()

// Get the currently attached images
partwright.getImages()  // -> [{id, src, label?}, ...]
```

When images are attached, the Elevations tab shows them in a strip alongside the model views, enabling direct visual comparison.

## Photo-to-model workflow

> **Optional tooling.** This workflow uses `scripts/generate-views.js` and Gemini, which may not be installed in every environment. If unavailable, skip the analysis step and supply images manually via `setImages()`.

To recreate a building or object from a photo:

### 1. Analyze the reference (optional helper)

Use `scripts/generate-views.js` to extract structural analysis:

```bash
node scripts/generate-views.js /path/to/photo.jpg
```

This calls Gemini to analyze the photo and produces a JSON file with:
- Building mass decomposition (main body, wings, garage, etc.)
- Proportion estimates (width:depth:height ratios)
- Roof style, pitch angle, overhangs
- Feature positions (windows, doors, porches) as percentages
- Elevation descriptions for all 4 sides

### 2. Attach images

If you have multiple angle photos (or Gemini-generated views), attach them:

```js
partwright.setImages([
  { src: frontDataUrl, label: 'Front' },
  { src: rightDataUrl, label: 'Right' },
  // ...
])
```

### 3. Build major masses first

Start with the largest geometric volumes and get proportions right before adding detail:

```js
// Decompose into: main body -> wings -> roof -> porch -> details
// Build each mass, validate proportions against reference
const r = await partwright.runAndAssert(code, {
  isManifold: true, maxComponents: 1,
  // Use proportion assertions to match reference
  boundsRatio: { widthToDepth: [1.2, 1.8], widthToHeight: [1.5, 2.5] }
});
```

### 4. Compare elevations after each structural change

Switch to Elevations tab and compare model silhouette against the attached image at each angle. Focus on:
- Overall proportions and mass placement
- Roof profile (side view reveals pitch and overhangs)
- Feature alignment (windows, doors at correct heights)
- Porch depth and column spacing

### 5. Iterate on details

Add features in order of visual impact: roof -> porch -> windows/doors -> trim details. After each addition, verify the relevant elevation matches the attached image.
