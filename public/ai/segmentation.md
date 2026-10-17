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
- **It follows the surface, not the camera.** Seeds grow across the surface itself, so surfaces you can't see in any render get the right part too: the inner arm behind a held ball, or the palm wrapped around it.

## Workflow

```js
// 0. What's available (params, defaults, which need seeds, bestFor)
partwright.listPartDetectors()

// 1. Seedless first pass: tries every automatic detector (cheapest first) and
//    keeps the first that splits the mesh into 2+ parts. A multi-body file
//    (one body per colour) is done here; a fused shell returns proposed:false.
await partwright.autoDetectParts()
// -> { proposed: true, proposedBy: 'pieces', tried, parts, quality }
//  | { proposed: false, tried, reason }   → go to step 2

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
  { op: 'addSeed', seed: { label: 'shirt', point: [140, 140, 50] } },   // re-runs detection
  { op: 'merge', ids: [7, 9], name: 'shorts' },
  { op: 'reassign', point: [120, 140, 44], to: 'skin' },               // the region under the point
  { op: 'split', id: 'hair', seeds: [{ label: 'hair', point: [...] }, { label: 'brows', point: [...] }] },
  { op: 'absorbSmall', minAreaFrac: 0.002 },                            // fold specks into neighbours
  { op: 'setColor', id: 'skin', color: '#f2cfb0' },                     // becomes the model colour
]})

// 5. Show the user, get their OK, then commit
await partwright.acceptParts({ label: 'Detected parts' })
// The code becomes `return api.importWithParts(0);`, and each part is now a label.
```

## When the user imports an STL themselves

An interactive STL import already runs `autoDetectParts` (setting:
**Advanced settings → Part detection → Detect parts on STL import**, on by
default). If it splits the mesh, the Detect parts panel opens on that proposal
and a draft already exists, so check `getPartDraft()` before detecting again.
If the mesh is one solid, the convert-to-code prompt opens instead, with a
**Detect parts…** button. Imports made through the console
(`importMeshData`) never prompt: call `autoDetectParts` yourself.

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
| `sizeBalance`, `compactness` | Shape diagnostics, useful when comparing detectors. |

## Detectors

| id | seeds | best for |
|---|---|---|
| `pieces` | none | Files that already ship one body per colour. Instant and exact. The first automatic proposal (`autoPropose`). |
| `crease-watershed` | required | Fused sculpts with grooved seams. Params: `growth` (`hybrid` default: grooves decide, path length breaks ties; `minimax`: grooves only; `summed`: path length plus a crease toll), `creaseQuantumDeg` (5: creases within this many degrees count as equal), `creaseWeight` (1). |

`comparePartDetectors([{algorithm, seeds, params}, …])` runs up to 6 configurations
side by side **without** touching the draft, and returns a quality table plus a contact sheet.

## Notes

- **Detection runs on the import's own mesh** (`importIndex`, default 0), in a background Worker. On a 460k-triangle scan, the first run analyses the surface in about 1 s; re-runs and edits take a fraction of that. Nothing is saved until `acceptParts`.
- **Code you've restructured is left alone.** `acceptParts` only rewrites `Manifold.ofMesh(api.imports[i])` to `api.importWithParts(i)`. If your code loads the import some other way, call `api.importWithParts(i)` yourself. It returns a Manifold like `ofMesh`, and the labels survive later booleans.
- **Part edges are per-triangle.** On dense scans (0.3 mm triangles) that already looks smooth. On low-poly meshes the edges show stair-steps.
- **Some operations drop parts.** Baking a surface texture or rescaling rebuilds the import's mesh, and the parts don't carry over yet. Re-detect afterwards.
