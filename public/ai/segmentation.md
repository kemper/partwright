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

// 1. Multi-body file? Try the instant one first
await partwright.detectParts({ algorithm: 'pieces' })

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
await partwright.detectParts({
  algorithm: 'crease-watershed',
  seeds: [
    { label: 'hair',  point: [128, 128, 101] },   // several seeds per part are fine:
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

// 3. LOOK at it. Each part's number is drawn on a visible spot in every view.
partwright.renderParts({ views: ['front', 'right', 'back', 'iso'] })
// -> { image, legend: [{ id, name, visibleIn }], hiddenParts? }

// 4. Fix what's wrong (atomic batch; ids are the legend numbers, or part names)
await partwright.editParts({ ops: [
  { op: 'addSeed', seed: { label: 'shirt', point: [140, 140, 50] } },   // a pin: re-grows only nearby parts
  { op: 'merge', ids: [7, 9], name: 'shorts' },
  { op: 'reassign', point: [120, 140, 44], to: 'skin' },               // the region under the point
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
// The code becomes `return api.importWithParts(0);`, and each part is now a label.

// Later: re-open the saved parts (with their seeds) to refine them
await partwright.reopenParts({ importIndex: 0 })
```

## Parts own their pins

Every part has at least one **pin**, and pins are drawn on the model. Detection puts an automatic
pin in each region of every part; automatic pins are drawn smaller and see-through. Pins you add
with `addSeed` are placed pins. The summary's `seeds` list every pin (`auto: true` marks the
automatic ones), and each part reports its `pins` count.

- **Rename and merge carry pins along.** Renaming a part renames its pins. Renaming a part to another part's name **merges** the two, pins included.
- **Pin edits re-grow locally.** `addSeed` (a new name makes a new part), `moveSeed` and `removeSeed` re-grow only the parts around the pin. The rest of the model doesn't change. Removing a part's last pin dissolves it into its neighbours.
- **Hand fixes are fixed.** Triangles changed with `reassign` (or the panel's Fix brush) are **fixed**: a later pin edit never undoes them. A whole-model re-detection (`detectParts`, `rerun`, a preset) starts fresh.
- **Clear and reorder.** `{op:'clear'}` removes every part and pin (it can be undone). `{op:'reorder', id, position}` moves a part; the order becomes the label order on accept.

## The Part Detection panel (handing off to the user)

`detectParts` (from the in-app AI) and `reopenParts` open the **Part Detection panel**,
so the user can refine the draft by hand. `openPartsPanel()` opens it explicitly. The panel has three steps:
**Start** (method, presets, Detect), **Refine** (tools and the part list) and **Accept**.

- **Hover to find.** Hovering the model names the part under the cursor and jumps the list to it. Hovering a row highlights that part on the model.
- **Select tool (V).** Click a part to select it. Shift- or Ctrl-click toggles a part, Alt-click removes one, Shift-drag paints a selection across parts, and Esc clears it. An action bar then offers Merge (with a name), Solo, Lock, Colour, Re-detect inside (a focus) and Delete. `setPartSelection(parts, {mode})` / `getPartSelection()` drive the same selection, so select parts to show the user which ones you mean.
- **Solo (S).** Only the selected parts stay in colour; everything else turns grey. `setPartsView({mode:'solo', parts?})` does the same, and `{mode:'all'}` restores every colour.
- **Pin tool (P).** Click to add a pin for the named part, or type a new name to start a new part. Drag a pin to move it, right-click it to delete it, and hold **H** (or use the 👁 toggle) to hide pins.
- **Fix tool (B).** Drag to paint triangles into a part. These are fixed regions (`reassign` with a radius).
- **Presets.** "Try presets" runs every preset of the method and shows a strip of results, best first. Hover or press ←/→ to preview one; click to apply it. Applying closes the strip and offers Undo. This is `previewPartPresets` + `showPartPresetPreview` + `applyPartPreset`.
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
| `pieces` | none | Files that already ship one body per colour. Instant and exact. Finds nothing inside one fused shell. |
| `auto-merge` | none | **Auto patches**: a first pass on any fused sculpt. Over-segments into grid patches whose borders snap to grooves, then merges borders weaker than `mergeBelowDeg` (4°; higher is coarser). `patchSizePct` (1.5% of the diagonal) sets the starting patch size, and `minPatchPct` (0.02%) absorbs specks. The patch layout is cached, so changing `mergeBelowDeg` re-runs in a fraction of a second. |
| `crease-watershed` | required | Fused sculpts with grooved seams. Params: `growth` (`hybrid` default: grooves decide, path length breaks ties; `minimax`: grooves only; `summed`: path length plus a crease toll), `creaseQuantumDeg` (5: creases within this many degrees count as equal), `creaseWeight` (1). |

`comparePartDetectors([{algorithm, seeds, params}, …])` runs up to 6 configurations
side by side **without** touching the draft, and returns a quality table plus a contact sheet.

## Notes

- **Detection runs on the import's own mesh** (`importIndex`, default 0), in a background Worker. On a 460k-triangle scan, the first run analyses the surface in about 1 s; re-runs and edits take a fraction of that. Nothing is saved until `acceptParts`.
- **Code you've restructured is left alone.** `acceptParts` only rewrites `Manifold.ofMesh(api.imports[i])` to `api.importWithParts(i)`. If your code loads the import some other way, call `api.importWithParts(i)` yourself. It returns a Manifold like `ofMesh`, and the labels survive later booleans.
- **Re-detection keeps the draft.** A second `detectParts` goes into the existing draft as an undoable step: colours carry over by name, and locked parts and anything outside a focus stay as they are. `editParts({ops:[{op:'undo'}]})` steps back.
- **Presets are listed per detector** in `listPartDetectors()` (`presets: [{name, params, featureOptions?}]`). The ranking score balances `grooveCoverage` against `grooveFidelity` (F1), discounted by stray islands and unassigned area. It's a heuristic, so look at the thumbnails too.
- **Some operations drop parts.** Baking a surface texture or rescaling rebuilds the import's mesh, and the parts don't carry over yet. Re-detect afterwards.
