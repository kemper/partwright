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

> **Pick the method for the subject first.** The mass-decomposition loop below is for **rigid, faceted subjects** — buildings, vehicles, hard products. For an **organic / figural subject** (a person, child, animal, creature, figurine, or bust), the medium is SDF smooth blends, not a union of primitives: build the body from capsule limbs + ellipsoid masses welded with `smoothUnion` (`readDoc("sdf")` → "Organic figures & creature bodies"), and the success criterion is **resemblance to the photo**, not just `isManifold`. The `/portrait` slash command prefills this workflow for busts. **For a whole person or a Funko / chibi toy, start from a CharacterSpec instead of code** — `buildCharacter(spec)` → `photoMatch` → tweak spec fields from `worst[]` (see `/ai/figure.md#figure-from-a-photo--fill-a-spec-dont-write-code`); hand-write only what the spec can't express. Either way, compare your render against the reference at each stage.

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

For routine passes call **`photoMatch`** (below) — a text-only score that says how close the model is and where it's off. At checkpoints, call `renderViews({ views: "box" })` (or `renderView` at matching angles) and compare the model silhouette against the attached image at each angle. Focus on:
- Overall proportions and mass placement
- Roof profile (side view reveals pitch and overhangs)
- Feature alignment (windows, doors at correct heights)
- Porch depth and column spacing

### Photo match — a text-only likeness score {#photo-match}

Looking at renders every pass is slow and costs image tokens, and "does it look like the photo?" is a judgement call. **`photoMatch`** answers it with numbers, no image: it renders the current model flat (part colours, no lighting) from the photo's camera, segments the photo, normalises both silhouettes to a common height, and reports how close they are and *where* they differ.

```js
const m = await partwright.photoMatch({
  image: 'att-123',                                   // attachment id/label, or a data:image/ URL (omit if only one image is attached)
  view: { azimuth: 0, elevation: 0, ortho: true },    // match the photo's camera (default: front, ortho)
  exclude: ['base'],                                  // parts the photo doesn't show
  // crop: {x, y, w, h}, bg: '#000000', bgTolerance: 20, fit: 'box', pixelAspect: 0.6, overlay: true,
  // bands: 20, merge: [['jersey', 'ball']], ignore: ['pupils'], mask: 'att-mask', bgMode: 'grabcut'
});
m.silhouetteIoU  // 1.0 = identical outline after normalisation; ~0.8 = recognisably close
m.worst          // ["hair: model 27% narrower across bands 0–1 (…)", "shoes/socks: model 28% narrower across band 9 (…)", …]
m.outline        // ["photo-only at bands 2–4 left: up to 3.1% of height (hair) → grow", "model-only inside bands 8–9: … → photo has a gap the model fills", …]
m.bands          // slices top→bottom: {name (parts that dominate it), refWidth, modelWidth (% of height), widthDiffPct, dx, iou,
                 //                     left, right (edge offsets, outward-positive), innerPhotoOnly, innerModelOnly}
m.regions        // per labelled part: {iou, areaRatio, widthRatio, heightRatio, dx, dy (% of height), photoColor, colorShift, lowConfidence?}
m.warnings       // e.g. photo silhouette touches the crop edge, aspect differs wildly, subject too small, parts the photo can't separate
```

**Several photos at once.** Pass `views` to score every reference angle against the same model in one call — the number to watch is the mean:

```js
const m = await partwright.photoMatch({
  views: [{ image: 'front', azimuth: 0, elevation: 0 }, { image: 'back', azimuth: 180, elevation: 0 }],
  exclude: ['base'], pixelAspect: 0.6, bands: 20,     // top-level crop/bg/bgTolerance/pixelAspect are defaults for every view
});
m.silhouetteIoU  // mean over the views; m.minIoU = the worst view
m.worst          // the views' findings interleaved, each prefixed "[label]"
m.views          // the full per-view results (each with bands, outline, regions, …)
```

**The loop:**

1. **Checklist first.** Before modelling, write down 5–10 defining, checkable features of the reference (proportions as fractions of height, silhouette masses, what's held where, colours) — e.g. as an `addSessionNote("[REQUIREMENT] …")`. Judge every round against it as well as the score, so a defining feature is never traded away for a better number.
2. **One change per round, kept or reverted by the score.** Fix the top `worst[]` / `outline[]` item, re-run `photoMatch`, and keep the change only if `silhouetteIoU` (the mean, with `views`) didn't drop beyond noise (~0.005) and no checklist item regressed — otherwise revert (`loadVersion`) and try the next item.
3. **Finer outline once the masses are right.** Coarse shape first with the default 10 bands; then `bands: 20` and the `outline[]` lines ("photo-only at band 2 left, 3.1% of height → grow") to push past the plateau where the region findings stop helping.
4. **Stop on a plateau, not after a fixed number of rounds:** when the last ~3 kept changes gained < 0.005 together, take a checkpoint — look at a real render at the photo's angle (`renderView`, or `overlay: true` for a small photo|model|diff strip), compare against the checklist, pick the top three visual fixes, and resume. Images only at checkpoints; `photoMatch` covers the routine rounds.

How it works, so you can read the numbers right:

- **Photo segmentation.** The backdrop colour is estimated from a ring just inside the photo border (the outermost ~1.5% is skipped, so frames and edge lines don't count) with a noise-adaptive tolerance; faint subject pixels (dark hair on a black backdrop) are kept when they connect to clear ones. When that ring is **busy** (halftone, scenery — no single backdrop colour) the default `bgMode: 'auto'` switches to a colour model (a GrabCut-lite: learns subject vs backdrop colours, border = backdrop) and says so in `warnings`. It can't recover a part that is the *backdrop's* colour (blue shorts on a blue backdrop) exactly — for a reliable outline pass `mask`: a silhouette image (white = subject, any resolution, same framing; an attachment id or data URL). Check `segmentation.photo.method` / `fgFraction` and the warnings.
- **Normalisation.** Both silhouettes are cropped to their bbox and scaled to the same height. `aspect` reports the overall width/height of each; with the default `fit: "height"` the band widths include that aspect error. `fit: "box"` stretches the model to the photo's width too, so bands compare *proportions* only. A photo whose silhouette touches the crop edge is truncated, which skews everything — widen the crop or `exclude` the model part it cuts off.
- **Reference size.** A subject under ~300 px tall (`segmentation.photo.subjectPx`) gets a warning: one source pixel is then > 0.3% of the height, so outline offsets of a percent or two are noise. Use the largest reference you have for fine work.
- **Stretched references.** Frames grabbed from video are often anamorphic (circles look like wide ellipses). Pass `pixelAspect` (< 1 squeezes the photo horizontally) — e.g. 0.6 for a frame that shows the subject ~1.7× too wide.
- **Outline.** Per band, `left`/`right` are the outer-edge offsets in % of height, outward-positive (image sides — the viewer's left/right): negative = the photo sticks out further (photo-only → grow the model there), positive = the model does (model-only → trim). `innerPhotoOnly`/`innerModelOnly` measure gaps inside the outline (the space between the legs). `outline[]` turns runs of these into at most a handful of lines, most severe first.
- **Regions.** Photo colours are clustered with k-means *seeded with your part colours*, so each part finds its pixels despite shading; parts sharing a colour (white shirt, socks, shoes) split the photo pixels spatially (nearest model part of that colour). Photo pixels far from any model part of their colour (a ball's black patches are not hair) are left unassigned. `areaRatio` compares each part's share of its silhouette. Tiny parts (< 1.5% of the figure) only get colour findings — their shape stats are a few pixels of noise.
- **Parts the photo can't tell apart.** Same-coloured parts that *touch* (a white ball held against a white jersey), parts whose photo colours converge (white jersey vs pale skin on a dim photo), or a part whose photo colour matches another part's are flagged `lowConfidence` and their size/position findings are suppressed — their numbers measure the split, not the figure. Score them as one with `merge: [['jersey', 'ball', 'socks', 'shoes']]`, or drop them from the findings with `ignore`.
- **Camera.** The browser API uses the `renderView` convention (azimuth 0 = camera at −Y, 90 = +X); `model:preview --match-photo` uses the CLI's `--view az,el` convention. Orthographic by default; product photos are mildly perspective, so expect a head shot from slightly above to read a little top-heavy.

Tuning knobs (target height, background tolerance floor, k-means iterations, bands, colour threshold, region reach, render size, minimum subject height, ambiguous-colour threshold, outline threshold / line cap, busy-background threshold) live in Advanced Settings → Import.

### 5. Iterate on details

Add features in order of visual impact: roof -> porch -> windows/doors -> trim details. After each addition, verify the relevant elevation matches the attached image.
