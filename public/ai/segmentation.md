# Part detection — split an imported mesh into named parts

An imported STL figurine is usually **one fused shell** with no colour and no
labels: hair, face, eyes, shirt and the ball it holds are all one surface. Box,
slab and normal-flood paint tools can't follow where one region ends and the
next begins, so the paint bleeds and the edges come out jagged. Part detection
finds those boundaries from the geometry itself, and then turns each part into
a real **label**. After that, `paintByLabel`, part colours, the object rail and
`listObjectParts` all work on the import.

**The rule of thumb for imported meshes: detect parts first, then paint by part.**

## How it works

- **The sculpted seams are the signal.** On sculpted/scanned figures, every colour change sits in a concave groove: around the eyes, under the brows, at each hair-lock tip, at hems and cuffs. Detection measures how sharply the surface folds inward between neighbouring triangles. These "creases" mark the likely boundaries; the default growth rule treats creases within 5° of each other as equal, so scan noise doesn't break them up.
- **You provide the meaning; the algorithm provides the edges.** `crease-watershed` grows named seeds across the surface. Each boundary settles on the strongest groove between two competing seeds, so a small gap in a groove doesn't leak.
- **No seeds yet? Start with Auto patches.** `auto-merge` splits the whole surface along its grooves into generic `patch N` parts. Name the patches you recognise, give two patches the same name to merge them, and move or add pins to refine the boundaries. Every patch already has an automatic pin.
- **It follows the surface, not the camera.** Seeds grow across the surface itself, so surfaces you can't see in any render get the right part too: the inner arm behind a held ball, or the palm wrapped around it.

## Workflow

```js
// 0. What's available (params, defaults, which need seeds, bestFor)
partwright.listPartDetectors()

// 1. Seedless first pass: previews every automatic detector (cheapest first);
//    the first that splits the mesh into 2+ parts becomes the draft (replacing
//    any current one). A multi-body file (one body per colour) is done here; a
//    fused shell returns proposed:false and leaves the draft untouched. More
//    parts than segmentation.autoDetectMaxParts (loose debris) is not proposed.
await partwright.autoDetectParts()
// -> { proposed: true, proposedBy: 'pieces', tried, parts, quality }
//  | { proposed: false, tried, reason }   → go to step 2

// 1b. Fused shell, no seeds yet: auto patches, then name/merge them
await partwright.detectParts({ algorithm: 'auto-merge', params: { mergeBelowDeg: 6 } })   // higher = coarser
await partwright.editParts({ ops: [
  { op: 'rename', id: 1, name: 'hair' },
  { op: 'merge', ids: [4, 7], name: 'shirt' },     // or rename a patch to an existing name
]})
// …or rank every preset of a detector and keep the best (draft untouched until you apply)
await partwright.previewPartPresets({ algorithm: 'auto-merge' })   // -> { presets: [{ index, name, partCount, score }], image }
await partwright.applyPartPreset(0)

// 2. Fused shell: place named seeds. Get points by clicking in your own
//    renders: renderViews → probePixel(view, [px, py]) → .point
//    An optional seed `color` becomes that part's colour (and its model colour on
//    accept). listPartDetectors().labelPresets has the panel's default colours.
await partwright.detectParts({
  algorithm: 'crease-watershed',
  seeds: [
    { label: 'hair',  point: [128, 128, 101], color: '#4a2e1c' },   // several seeds per part are fine:
    { label: 'hair',  point: [100, 128,  90] },   // add one on each side of big or wrapped parts
    { label: 'skin',  point: [151, 127,  66] },
    { label: 'eyes',  point: [150, 110,  75] },   // one seed per eye
    { label: 'eyes',  point: [150, 142,  75] },
    { label: 'shirt', point: [146, 128,  56] },
    { label: 'shirt', point: [104, 128,  50] },   // back of the shirt
    // …
  ],
})
// -> { parts: [{ id, name, triCount, areaFrac, neighbors, regions, anchor }], quality, unassigned }

// 2b. Optional: check the seeds land where you meant BEFORE detecting.
partwright.previewSeeds([{ label: 'eyes', point: [150, 110, 75] }])
// -> { seeds: [{ label, triangle, point, distance, onSurface, miss?, part? }], misses }
// A `miss` is off the surface; re-pick it with probePixel / probePixels.

// 3. LOOK at it. Each part's number is drawn on a visible spot in every view.
partwright.renderParts({ views: ['front', 'right', 'back', 'iso'] })
// -> { image, views, legend: [{ id, name, visibleIn }], hiddenParts? }
// Custom angles and a zoom onto one small part:
partwright.renderParts({ views: [{ azimuth: 90, elevation: 5 }], focus: 'eyes', size: 640 })

// 4. Fix what's wrong (atomic batch; ids are the legend numbers, or part names)
await partwright.editParts({ ops: [
  { op: 'addSeed', seed: { label: 'shirt', point: [140, 140, 50] } },   // a pin: re-grows only nearby parts
  { op: 'merge', ids: [7, 9], name: 'shorts' },
  { op: 'reassign', point: [120, 140, 44], to: 'skin' },               // the region under the point
  { op: 'brush', to: 'hair', points: [[118, 130, 80], [121, 133, 82]], radius: 1.5 },  // a brush stroke (fixed triangles)
  { op: 'brush', to: 'shirt', points: [[140, 130, 52]], radius: 2, mode: 'patches' },  // brush-merge: touched parts join whole
  { op: 'split', id: 'hair', seeds: [{ label: 'hair', point: [...] }, { label: 'brows', point: [...] }] },
  { op: 'absorbSmall', minAreaFrac: 0.002 },                            // fold specks into neighbours
  { op: 'setColor', id: 'skin', color: '#f2cfb0' },                     // becomes the model colour
]})

// 4b. Refine one area without disturbing the rest
await partwright.editParts({ ops: [
  { op: 'lock', id: 'skin' },          // locked parts keep their triangles when detection re-runs
  { op: 'focus', id: 'shirt' },        // later detections only change the shirt's triangles
]})
await partwright.detectParts({ algorithm: 'auto-merge', params: { mergeBelowDeg: 3 } })  // splits only the shirt
await partwright.editParts({ ops: [{ op: 'focus', id: null }] })  // clear the focus

// 5. Show the user, get their OK, then commit
await partwright.acceptParts({ label: 'Detected parts' })
// The code becomes `return api.importWithParts(0);`, and each part is now a label
// in the colour it shows: its setColor / seed colour, else its overlay colour.
// acceptParts({ applyColors: false }) saves the labels without colours.

// Later: re-open the saved parts (with their seeds) to refine them
await partwright.reopenParts({ importIndex: 0 })
```

## When the user imports an STL themselves

An interactive STL import already runs `autoDetectParts` (setting:
**Advanced settings → Part detection → Detect parts on STL import**, on by
default; skipped above **Auto-detect triangle limit**). If it splits the mesh,
the Detect parts panel opens on that proposal and a draft already exists, so
check `getPartDraft()` before detecting again. Closing the panel without
touching the proposal discards it.
If the mesh is one solid, the convert-to-code prompt opens instead, with a
**Detect parts…** button. Imports made through the console
(`importMeshData`) never prompt: call `autoDetectParts` yourself.

## Parts own their pins

Every part has at least one **pin**, and pins are drawn on the model. Detection puts an automatic
pin in each region of every part; automatic pins are drawn smaller and see-through. Pins you add
with `addSeed` are placed pins. The summary's `seeds` list every pin (`auto: true` marks the
automatic ones), and each part reports its `pins` count.

- **Rename and merge carry pins along.** Renaming a part renames its pins. Renaming a part to another part's name **merges** the two, pins included.
- **Pin edits re-grow locally.** `addSeed` (a new name makes a new part), `moveSeed` and `removeSeed` re-grow only the parts around the pin. The rest of the model doesn't change. Removing a part's last pin dissolves it into its neighbours.
- **Hand fixes are fixed.** Triangles changed with `reassign`, a `brush` stroke (or the panel's Fix brush) are **fixed**: a later pin edit never undoes them. A whole-model re-detection (`detectParts`, `rerun`, a preset) starts fresh.
- **Brush strokes.** `{op:'brush', to, points, radius}` moves every triangle within `radius` of the stroke's points (same piece only) into `to` — an existing part or a new name — as one undo step. `triangles: [...]` (source triangle indices of the import) adds exact triangles. `mode: 'patches'` instead moves every part the stroke touches into `to` **whole**, pins and locks included: a brush-merge across many small auto patches in one go.
- **Specks are absorbed.** After detection and after each pin re-grow, regions smaller than `segmentation.autoAbsorbSpeckFrac` of the surface (default 0.2%) join the neighbour they border most — only when nothing claims them: no pin of any kind, no hand fix, and a part nobody named (a detector's "patch 3"), coloured or locked (Advanced settings → Part detection; 0 turns it off). `absorbSmall` still does it on demand with any threshold.
- **Clear and reorder.** `{op:'clear'}` removes every part and pin (it can be undone); `{op:'clear', algorithm}` also switches the draft to that method, so new pins start fresh instead of re-growing inside old auto patches. `{op:'reorder', id, position}` moves a part; the order becomes the label order on accept.

## The Part Detection panel (handing off to the user)

`detectParts` (from the in-app AI) and `reopenParts` open the **Part Detection panel**,
so the user can refine the draft by hand. `openPartsPanel()` opens it explicitly. The panel has three steps:
**Start** (label chips, method, presets, Detect), **Refine** (tools and the part list) and **Accept**.

- **Label chips — the fast path.** A strip of named parts with default colours: *Figure* (hair, face, eyes, shirt, arms, shorts, socks, shoes, ball, base) or *Generic* (part 1…9), plus **+ custom** (a name and colour). Picking a chip (click, or keys **1–9**, **0** for the tenth) arms the Pin tool with that name and colour; each click on the model places a named pin and re-grows, so no typing is needed. The first chip pin detects right away. A chip shows ✓ once it owns a part, and "missed — click again" (plus a warning) when its pin grew nothing. Chips need a seeded method: picking one while Auto patches or Pieces is selected switches to Crease watershed, and clears a seedless draft so its patches don't mix with the new parts (Undo brings them back). The agent equivalent is `detectParts` / `addSeed` with seed `color`s.
- **Changing the method.** Switching to another method clears the draft (with Undo) — new pins would otherwise only re-grow inside the old patches, and a seedless method's Detect replaces it anyway. Seeded → seeded (e.g. Crease watershed → Random walker) keeps it, since its pins are the next method's input. Locked parts or a focus keep the draft, since then the next detection merges into it on purpose.
- **A fused figure opens ready to label.** When the import-time pass finds only 1–2 separate pieces and the largest is big (`segmentation.fusedPieceMinTris`, default 2000 triangles), the banner says so ("found 2 separate parts, and the largest is one fused solid…") and the first chip is armed: the first click on the model names that part (the method switches to Crease watershed on that click; one Undo restores the original pieces).
- **Start folds away.** Once a draft exists, the method, presets and Detect fold into a one-line summary (**▸ Detection settings** brings them back); the chips stay.
- **A pin that grows nothing is flagged.** A toast says so, and its row shows **⚠** with its size, so a missed pin is never silent.

- **Hover to find.** Hovering the model names the part under the cursor and jumps the list to it. Hovering a row highlights that part on the model.
- **Select tool (V).** Click a part to select it. Shift- or Ctrl-click toggles a part, Alt-click removes one, Shift-drag adds parts to the selection, and Esc clears it. An action bar then offers Merge (with a name), Solo, Lock, Colour, Re-detect inside (a focus) and Delete. `setPartSelection(parts, {mode})` / `getPartSelection()` drive the same selection, so select parts to show the user which ones you mean.
- **Brush-merge (Select tool).** "Grab your part and paint more of it": a drag that starts on the **selected** part brushes more of the model into it, with a live preview in its colour; release applies it as one `brush` edit (Undo reverts the stroke). Alt-drag swallows every touched part whole (`mode:'patches'`). Any other drag orbits as usual; on touch screens a one-finger drag always orbits (use the Fix tool to brush). The selection is cleared after.
- **Type a name.** With one part selected, just start typing: a small autocomplete opens at the cursor with the existing part names and the chip names. Enter renames the part to exactly what you typed (a suggestion is used only when picked with the arrows, Tab or a click, or when it matches exactly); a name another part already has merges the two; a chip name also gives a fresh part the chip's colour; Esc cancels. Panel shortcut letters (V, P, B, S, H, M, R) stay shortcuts, so for a name starting with one press **R** first: R opens the box empty for the part under the cursor. This is `rename` (which merges on a taken name).
- **Keys.** **M** merges the selected parts, **Enter** accepts (when no text box or button has focus), **R** renames, **1–9 / 0** pick chips, **V/P/B** switch tools, **S** solos, hold **H** to hide pins.
- **Phones.** Below 768 px the panel is a bottom sheet (`segmentation.mobileSheetHeightFrac`, default 45% of the window) so the model stays visible and usable above it; each part row shrinks to its swatch, name and size, with the rest under ⋯.
- **Solo (S).** Only the selected parts stay in colour; everything else turns grey. `setPartsView({mode:'solo', parts?})` does the same, and `{mode:'all'}` restores every colour.
- **Pin tool (P).** Click to add a pin for the named part, or type a new name to start a new part. Drag a pin to move it, right-click it to delete it, and hold **H** (or use the 👁 toggle) to hide pins. Automatic pins are hidden unless **Show automatic pins** is on (a selected part still shows its own).
- **Fix tool (B).** Drag to paint triangles into a part. These are fixed regions (`reassign` with a radius).
- **Presets.** "Try presets" runs every preset of the method and shows a strip of results, best first. Hover or press ←/→ to preview one; click to apply it. Applying closes the strip and offers Undo. This is `previewPartPresets` + `showPartPresetPreview` + `applyPartPreset`.
- **After Accept.** The panel shows **Parts saved** with the next steps instead of a live Accept button: **Open Paint** (scoped to the part you pick, so colour can't bleed across its edge) or **Edit parts** (`reopenParts`).
- **Merging clears the selection**, so the next Shift-drag starts a fresh set.
- **Part list.** Drag ⋮⋮ (or press Alt+↑/↓ in a name) to reorder. Each row has lock, ◐ solo and remove buttons. "Clear all" empties the list (it can be undone). Discard throws away the parts *and* pins.
- **Live** (off by default) re-runs detection after each setting change. Pin edits always update right away.

## Smooth edges

By default, part boundaries are drawn **through** triangles instead of along their edges
(`edgeSmoothing`, default 3 passes, 0–20; `editParts({ops:[{op:'setEdgeSmoothing', iterations}]})`).
More passes give rounder curves; 0 gives the raw per-triangle stair-steps. A boundary that
already runs along a hard fold (faces at least 60° apart, such as a box edge) stays where it is,
since it is already on the seam. Sculpted grooves on scans fold less than that per edge, so their
stair-steps still smooth. The overlay
shows the smooth boundaries. `acceptParts()` then **re-meshes the import** along them:
split triangles are cut and shared cut points are reused, so the mesh stays watertight. It
gains a few percent more triangles, and the parts are stored for the new triangles.
`acceptParts({ smoothEdges: false })` keeps the original triangles. If the model already
had brush paint, check it after a smooth accept, because painted edges can shift slightly.
A re-opened smooth-accepted import starts with smoothing at 0, since its mesh is already cut.

## Choosing seeds

- **Seed every colour region, including small ones.** Each eye, each brow and the logo need their own seed. An unseeded feature is absorbed by whichever neighbour reaches it first.
- **Big or wrapped parts need several seeds.** A shirt needs front, back and sleeves; hair needs top, back and sides. Without them, a nearby small seed such as a chest logo can claim the far side of the shirt. Seeds follow grooves, but on flat stretches the closest seed wins.
- **Separate pieces need their own seed.** A seed can't grow across a gap, so a base disc or loose accessory with no seed stays **unassigned**.
- **Featureless detail is paint, not a part.** If the mesh has no geometry for a detail (the panels on a smooth ball, a printed number), detect the containing part, then paint the detail inside it with `api.paint.pattern` scoped to that label, or with `paintImage`.
- **Ungrooved bands are boundary paint, not seeds.** A collar, a cuff, a sock band or a belt edge usually has no groove of its own: a seed on it has nothing to stop at and floods the shirt or the leg. Detect the parts on either side (shirt + neck, leg + shoe), accept them, then paint the band along their seam: `paintAlongBoundary({ between: ['shirt', 'skin'], width: 2, color: [1,1,1], side: 'a' })` (see `/ai/colors.md`). If you must seed one, cap it: a seed's `maxRadius` (model units, measured along the surface) stops its growth there, and the rest goes to the other seeds. The cap works in `crease-watershed`, `random-walker` (a part whose seeds are all capped can't win triangles outside their reach), seeded `thickness`, and the draft's pin edits; it is saved with accepted parts, so `reopenParts` → `rerun` keeps it.
- **Check seeds first.** `previewSeeds(seeds)` reports the triangle each seed lands on and its distance off the surface. Seeds farther than a few edge lengths off are flagged `miss`. Pick seed points with `probePixel`/`probePixels` (their points are on the mesh) and many seeds take one `probePixels` call.

## View axes: which angle is the front?

`renderParts`, `renderViews`/`renderView` and `probePixel` share one camera convention: **azimuth 0 looks from −Y** (the camera sits at −Y looking toward +Y), **90 from +X**, **180 from +Y**, **270 from −X**. Elevation 0 is the horizon, 90 straight down, negative from below. The named views (`front` = az 0, `right` = 90, `back` = 180, `left` = 270) assume the model faces **−Y**.

Scans and imported figures often face another way. For a figure facing **+X**:

| you want | azimuth | elevation |
|---|---|---|
| its front (face) | 90 | 5 |
| its back | 270 | 5 |
| its left side (the figure's own left, +Y) | 180 | 5 |
| its right side (−Y) | 0 | 5 |
| front three-quarter | 60 or 120 | 25 |

So `renderParts({ views: [{ azimuth: 90, elevation: 5 }, { azimuth: 270, elevation: 5 }] })` shows front and back, and the named `front` view shows the figure's right side. Check which way it faces first: render `iso` and look where the face is.

## Reading `quality`

| field | meaning |
|---|---|
| `boundaryCreaseMean` | Average groove strength (°) along part boundaries. Higher means the boundaries sit on real seams. Compare runs on the **same** feature options. |
| `islandCount` / `islandAreaFrac` | Extra disconnected regions beyond one per part. These are expected for paired parts (two eyes, two shoes: check each part's `regions`). Anywhere else they're usually leaks; fix with `absorbSmall` or another seed. |
| `unassignedAreaFrac` | Surface no seed reached (unseeded separate pieces). |
| `grooveCoverage` | Share of the mesh's strong grooves (≥ 15°) that lie on a part boundary. This is recall: are the real seams being used? Finer splits raise it. |
| `grooveFidelity` | Share of the boundary length that runs along strong grooves. This is precision: do boundaries sit on real seams? Coarser splits raise it. |
| `sizeBalance`, `compactness` | Shape diagnostics, useful when comparing detectors. |

## Detectors

| id | seeds | best for |
|---|---|---|
| `pieces` | none | Files that already ship one body per colour. Instant and exact. Finds nothing inside one fused shell. The first automatic proposal (`autoPropose`). |
| `auto-merge` | none | **Auto patches**: a first pass on any fused sculpt. Over-segments into grid patches whose borders snap to grooves, then merges borders weaker than `mergeBelowDeg` (4°; higher is coarser). `patchSizePct` (1.5% of the diagonal) sets the starting patch size, and `minPatchPct` (0.02%) absorbs specks. The patch layout is cached, so changing `mergeBelowDeg` re-runs in a fraction of a second. |
| `random-walker` | required | **Random walker (seeded)**: the same named seeds as `crease-watershed`, but each triangle goes to the seed a random walk is most likely to reach first, where walks rarely cross grooves (Lai et al. 2008). Boundaries come out straighter where grooves are faint or broken, and it is more robust on noisy scans (bench: 0.707 vs 0.652 noisy IoU). On the Tsubasa scan it keeps both sleeves with the shirt where `crease-watershed` gives one to the arm. It is **slow**: about 17 s for 9 parts on a 460k-triangle scan vs 0.5 s, so place seeds with `crease-watershed` first and switch to random-walker for the final pass. Params: `beta` (3: how strongly folds stop the walk; higher clings to grooves), `convexFactor` (0.2: how much ridges count vs valleys), `maxIterations` (300; the **Fast solve** preset uses 80, about 7 s, at some cost in accuracy), `minIslandPct` (0.05%). |
| `thickness` | optional | **Thickness (limbs vs body)**: splits where *no groove* separates parts, by how thick the solid is under each triangle (a voxel distance field, the shape-diameter idea). Seedless, it clusters thickness into `levels` (3) and names parts `thin`/`medium`/`thick` N. The **Limbs and torso** preset (`levels: 5, smoothing: 12`) separates head, torso, each arm, hand and leg on a fused figurine. With seeds it grows them like `crease-watershed`, but a thickness jump also counts as a boundary (`jumpWeight` 0.3, `creaseWeight` 1). Also: `resolution` (160 voxels on the longest side; the first run takes a few seconds on a 460k scan, the other sliders then re-run fast), `smoothing` (8), `minPartPct` (1%). Parts of similar thickness that touch (a ball held against a torso) stay together. |
| `planar-groups` | none | **Flat & smooth faces**: mechanical / CAD-like / low-poly parts, one part per face of the original model. `surfaces: 'smooth'` (default) cuts only at sharp edges (`angleDeg` 20), so a cylinder wall or fillet stays one face; `'flat'` splits curves into near-planar facets. `minPartPct` (0.1%) and `maxParts` (64, exact cap) merge small faces into the neighbour they share most boundary with. Useless on organic sculpts: everything is smooth, so it becomes one part (or shards in flat mode). |
| `crease-watershed` | required | Fused sculpts with grooved seams. Params: `growth` (`hybrid` default: grooves decide, path length breaks ties; `minimax`: grooves only; `summed`: path length plus a crease toll), `creaseQuantumDeg` (5: creases within this many degrees count as equal), `creaseWeight` (1). |

`comparePartDetectors([{algorithm, seeds, params}, …])` runs up to 6 configurations
side by side **without** touching the draft, and returns a quality table plus a contact sheet.
Each tile (and each result's `caption`) names the detector **and the params that differ**:
between configs of the same detector, the keys whose values differ; for a detector that
appears once, what it changed from its defaults (feature options included), e.g.
`2. crease-watershed · creaseWeight=4 growth=summed`.

## Editing the parts after accepting them

Accepted parts are ordinary labels, so the shaping ops can target them by name.
Edit the import in code on top of `api.importWithParts(0)`; the import itself is
never modified:

```js
let m = api.importWithParts(0);
m = api.sculpt.transform(m, { select: { label: 'head' }, scale: 1.2, blend: 3 });   // bigger head, eased into the neck
m = api.sculpt.transform(m, { select: { label: 'ball' }, translate: [4, 0, 0] });     // nudge the ball forward
m = api.twist(m, { select: { label: 'arm' }, degrees: 30, axis: 'x', blend: 2 });
return m;
```

Labels survive these ops, so the part colours and `paintByLabel` keep working.
The full selector syntax is in [/ai/deform.md](/ai/deform.md#selecting-part-of-a-shape).

## Notes

- **Detection runs on the import's own mesh** (`importIndex`, default 0), in a background Worker. On a 460k-triangle scan, the first run analyses the surface in about 1 s; re-runs and edits take a fraction of that. Nothing is saved until `acceptParts`.
- **Code you've restructured is left alone.** `acceptParts` only rewrites `Manifold.ofMesh(api.imports[i])` to `api.importWithParts(i)`. If your code loads the import some other way, call `api.importWithParts(i)` yourself. It returns a Manifold like `ofMesh`, and the labels survive later booleans.
- **Re-detection keeps the draft.** A second `detectParts` goes into the existing draft as an undoable step: colours carry over by name, and locked parts and anything outside a focus stay as they are. `editParts({ops:[{op:'undo'}]})` steps back.
- **Presets are listed per detector** in `listPartDetectors()` (`presets: [{name, params, featureOptions?}]`). The ranking score balances `grooveCoverage` against `grooveFidelity` (F1), discounted by stray islands and unassigned area. It's a heuristic, so look at the thumbnails too.
- **Bakes keep the parts.** Baking a surface texture, or a scale / rotate / place in bake mode, rebuilds the mesh; the parts (detected ones and `api.label` regions alike) are carried onto the baked import by position and the code loads it with `api.importWithParts(0)`, so they stay labels. The bake's result lists them as `partsCarried`. Part edges follow the new triangles, so on a heavily re-meshed bake (engrave, a coarse texture) re-check a boundary that matters. In code, `api.round` / `api.smoothWeld` keep the parts when you pass `keepLabels: true`. To edit one detected part as a solid (scale the head, turn an arm, delete or swap a piece), use `api.editPart(api.importWithParts(0), 'head', { scale: 1.2 })` — see [deform](/ai/deform.md#editpart--edit-one-part-as-a-solid) — and confirm only that part moved with `diffVersions(a, b, { geometry: true })`.
