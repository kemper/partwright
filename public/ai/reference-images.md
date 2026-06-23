# Reference images & photo-to-model workflow

## Reference images

Attach reference photos so the model can be compared against them. Each image has just two user-facing fields:

- `src` — a `data:` URL or `http(s)` URL.
- `label` (optional) — a free-form caption. Common values like `"Front"`, `"Right"`, `"Back"`, `"Left"`, `"Top"`, and `"Perspective"` are **presets**: the UI offers them as one-click pickers and the system uses them to order the image strip. Any other string is also valid (`"south elevation, morning light"`, `"Inspiration: Frank Lloyd Wright"`). Empty / omitted means no caption.

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

Attached images appear in the Attachments tab and the Gallery; render the model with `renderViews` to compare it against them at matching angles.

**Seeing the references as the AI:** in the in-app AI chat, call the **`getReferenceImages`** tool — it returns every attached reference *image* as one labeled grid image (plus a text list of the labels), so the model can actually look at what the user attached on any turn rather than guess.

## Attachments

Reference images are one **kind** of a more general session **attachment** — any file the user pins to the session as durable project context. An attachment carries a `kind` (`image` · `model` · `document` · `text` · `other`) plus an optional `mediaType`, so a session can hold reference photos *and* a reference STL/STEP, a spec-sheet PDF, or design notes. Attachments are **durable**: they survive clearing the AI chat and are saved in the exported `.partwright` file, so an agent resuming a session — or one whose chat history was cleared — can still find the material the work was based on.

Each attachment has two text fields: a short **`label`** (a caption / perspective preset like "Front"), and a free-form **`description`** — *why* it matters (what to match, the constraint it captures, where it came from). **Read the descriptions** — they're the user's intent, the most important signal about what each file is for.

The `setImages`/`addImage`/`getImages`/etc. helpers above still work (they operate on the `image`-kind attachments). The general API mirrors them across all kinds:

```js
// Pin any file (kind + mediaType are inferred from the src/data URL or label
// when omitted). source defaults to 'user'.
partwright.addAttachment({ src: 'data:model/stl;base64,...', label: 'Reference bracket', description: 'Match the bolt-hole spacing on this part' })
// -> { id, kind: 'model', mediaType: 'model/stl', src, label, description, addedAt, source: 'user' }

// List everything pinned to the session
partwright.getAttachments()
// -> [{ id, kind, mediaType?, src, label?, description?, addedAt?, source? }, ...]

partwright.setAttachments([{ src, kind?, mediaType?, label?, description? }, ...])  // replace the whole list
partwright.removeAttachment(id)                                        // remove one by id
partwright.clearAttachments()                                          // remove ALL (images included)
```

`clearImages()` / `setImages()` touch only the image-kind attachments and leave non-image ones intact; `clearAttachments()` removes everything.

**Captured chat uploads.** When the user uploads or pastes an image into the AI chat drawer, it is automatically pinned to the session as an `image` attachment with `source: 'chat'` (deduped by content). So even if the chat is later cleared, those references remain available.

**Seeing all attachments as the AI:** call the **`getAttachments`** tool to get a manifest of every attachment — id, kind, media type, label, when it was added, and whether it came from the user or a chat upload. `text`-kind attachments include their contents inline. Use it to recover reference material an earlier conversation worked from; to actually *view* image attachments, call `getReferenceImages`.

## Photo-to-model workflow

> **Pick the method for the subject first.** The mass-decomposition loop below is for **rigid, faceted subjects** — buildings, vehicles, hard products. For an **organic / figural subject** (a person, child, animal, creature, figurine, or bust), the medium is SDF smooth blends, not a union of primitives: build the body from capsule limbs + ellipsoid masses welded with `smoothUnion` (`readDoc("sdf")` → "Organic figures & creature bodies"), and the success criterion is **resemblance to the photo**, not just `isManifold`. The `/portrait` slash command prefills this workflow for busts. Either way, compare your render against the reference at each stage.

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

Call `renderViews({ views: "box" })` (or `renderView` at matching angles) and compare the model silhouette against the attached image at each angle. Focus on:
- Overall proportions and mass placement
- Roof profile (side view reveals pitch and overhangs)
- Feature alignment (windows, doors at correct heights)
- Porch depth and column spacing

### 5. Iterate on details

Add features in order of visual impact: roof -> porch -> windows/doors -> trim details. After each addition, verify the relevant elevation matches the attached image.
