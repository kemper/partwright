# Reference images & photo-to-model workflow

## Reference images

Load reference photos to compare against your model's elevations:
```js
// Load reference images for side-by-side comparison in Elevations tab
partwright.setReferenceImages({
  front: 'data:image/jpeg;base64,...',   // or a URL
  right: 'data:image/jpeg;base64,...',
  back: 'data:image/jpeg;base64,...',
  left: 'data:image/jpeg;base64,...',
  top: 'data:image/jpeg;base64,...',     // optional
  perspective: 'data:image/jpeg;base64,...', // optional - original photo
})

// Clear reference images
partwright.clearReferenceImages()

// Get current reference image state
partwright.getReferenceImages()  // -> {front?, right?, ...} or null
```

When reference images are loaded, the Elevations tab shows each model view side-by-side with the corresponding reference image. This enables direct visual comparison for accuracy.

## Photo-to-model workflow

> **Optional tooling.** This workflow uses `scripts/generate-views.js` and Gemini, which may not be installed in every environment. If unavailable, skip the analysis step and supply reference images manually via `setReferenceImages()`.

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

### 2. Load reference images
If you have multiple angle photos (or Gemini-generated views), load them:
```js
partwright.setReferenceImages({ front: frontDataUrl, right: rightDataUrl, ... })
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
Switch to Elevations tab and compare model silhouette against reference at each angle. Focus on:
- Overall proportions and mass placement
- Roof profile (side view reveals pitch and overhangs)
- Feature alignment (windows, doors at correct heights)
- Porch depth and column spacing

### 5. Iterate on details
Add features in order of visual impact: roof -> porch -> windows/doors -> trim details.
After each addition, verify the relevant elevation matches the reference.
