# Low-poly / faceted modeling — `api.lowPoly`

**The look:** deliberately coarse, flat-shaded triangles — the angular "crystalline" style of low-poly game art and papercraft. A low-poly fox is not a boxy Minecraft fox and it is **not** a pile of unioned spheres and cylinders. It is one continuous surface reduced to a few hundred large, flat facets.

## The one rule that fixes bad low-poly

**Do NOT build a creature from a union of primitives to "get facets." That "primitive soup" looks wrong no matter how you tune it — the same failure mode as any organic model.** Build the smooth form first, then crystallize it:

```
1. Build the organic form with api.sdf (smoothUnion capsules + ellipsoids, mirrorPair for symmetry) — exactly as readDoc("sdf") / readDoc("figure") describe. Ignore polygon count here; make the SHAPE right.
2. Lower it to a mesh at a NORMAL resolution: shape = body.build({ edgeLength: 0.6 })
3. Crystallize: return api.lowPoly(shape, { targetTriangles: 800 })
4. Paint the coat with api.paint.pattern (see below) — never world-axis boxes.
```

Step 3 is the whole feature. You keep the good silhouette from the SDF and get an even, art-directed facet size across the entire surface in one call — no `edgeLength` tuning loop.

## `api.lowPoly(shape, opts)`

Decimates a Manifold to a coarse triangle count and (by default) tags it for flat/faceted shading. Returns a Manifold, so it drops straight into a `return`.

| Option | Meaning |
|---|---|
| `targetTriangles` | **Preferred.** Reduce to at most this many triangles. Gives a roughly **even facet size over the whole surface** — thin parts (ears, tail) and thick parts (torso) get proportional detail, which is how stylized low-poly art actually reads. Default `800` if you pass neither knob. |
| `facetSize` | Alternative: a single fixed facet edge length (a *uniform absolute* target size). Blunter than `targetTriangles` — it over-facets thin parts and under-facets thick ones. Use only when you want one literal facet dimension. Mutually exclusive with `targetTriangles`. |
| `flatShade` | Render with hard per-face normals (facet edges visible). **Default `true`** — this is what makes it look low-poly rather than a smooth low-res blob. Set `false` only if you want the coarse mesh smooth-shaded. |

```js
const { Manifold } = api;

// A low-poly creature: smooth SDF body → crystallize → paint.
const body = api.sdf.capsule([0,0,0],[0,0,20], 6)
  .smoothUnion(api.sdf.sphere([0,0,22], 7), 3)   // head
  .smoothUnion(api.sdf.capsule([0,0,0],[0,-14,-8], 3), 2); // tail
const mesh = body.build({ edgeLength: 0.6 });

return api.lowPoly(mesh, { targetTriangles: 700 });
```

**Picking `targetTriangles`:** more triangles = subtler facets (closer to smooth), fewer = chunkier. Rough guide for a single creature/prop:

- `250–500` — bold, chunky, unmistakably low-poly.
- `600–1200` — the sweet spot for a recognizable animal that still reads as faceted.
- `1500+` — subtle facets; approaching smooth. If you can barely see facets, you've gone too high — drop it.

Iterate with `renderView` and look at the facets directly. If the silhouette lost a feature (an ear vanished), the budget is too low for that detail — raise it, or build that feature slightly larger in the SDF so it survives decimation.

**Works on any mesh, not just SDF output** — it decimates whatever Manifold you hand it. To low-poly an imported STL: `return api.lowPoly(Manifold.ofMesh(api.imports[0]), { targetTriangles: 1000 })`.

**If the shape is already coarser than the target,** `lowPoly` leaves the geometry unchanged and just applies flat shading — so it's safe to wrap a low-res model without over-reducing it.

## Painting a low-poly coat — use `api.paint.pattern`, not boxes

Coat markings (muzzle, bib, socks, tail-tip, tabby stripes) are organic, curved, often asymmetric boundaries. **On a coarse mesh, a world-axis paint box saws straight across big triangles and reads as an obvious geometric jag** — the opposite of the look you want. `api.paint.pattern` places procedural markings that follow the form, and it's built for exactly this (see readDoc("colors") for the full reference):

```js
// After returning the low-poly mesh, paint it. Named coat presets:
api.paint.pattern({ pattern: 'patches', colors: ['#E8E2D0','#3A2A1A'], scope: 'body' }); // calico/cow
api.paint.pattern({ pattern: 'stripes', colors: ['#D6913E','#5A3A1F'] });                // tabby/tiger
api.paint.pattern({ pattern: 'gradient', colors: ['#EEE','#333'], anchors: [[0,0,24]] }); // siamese points
```

- Scope a marking to a body part with `scope: '<label>'` (label the SDF part with `api.label(...)`), or anchor it to a point with `anchors: [[x,y,z]]`.
- Multiple `api.paint.pattern` calls composite (later wins) — layer a base coat, then socks, then a tail tip.
- Because a painted mesh is already drawn flat-faceted, painting a low-poly model reinforces the facet look for free.

**Only reach for a paint box** when the boundary genuinely is a flat plane (e.g. a belly line). Even then, prefer painting by a labeled region so the boundary follows facets instead of an arbitrary cut.

## Photo → low-poly creature

Given a reference photo, the flow is the normal photo-to-model flow (attach the image; the model sees it natively) plus the crystallize step:

1. Read the animal's proportions and coat from the photo.
2. Build the body with `api.sdf` (readDoc("sdf")/"figure"). Get the silhouette right at normal resolution — verify with `renderView`.
3. `return api.lowPoly(shape, { targetTriangles })`.
4. Match the coat with `api.paint.pattern`, sampling the photo's colors.
5. `renderView` from several angles (including 3/4 and back) and compare to the photo; adjust budget and pattern.

## Verify

- `renderView` / `renderViews` — confirm the facets are visible and evenly sized, and no feature was decimated away.
- `getGeometryData` — check `triangleCount` landed near your `targetTriangles`, and `isManifold: true` / `componentCount: 1` (decimation preserves manifoldness; a jump in component count means the source mesh was already split).
