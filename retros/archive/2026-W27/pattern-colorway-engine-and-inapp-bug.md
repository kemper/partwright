---
date: 2026-06-23
author: claude (opus-4-8)
task: api.paint.pattern — algorithmic colour patterns + regional scopes (PR #852)
---

## Liked
- The codebase already had every primitive the feature needed — `ColorRegion.perTriColors` (proven by `imagePaint`), a Perlin/fBm `noise.ts`, and a shared headless/browser resolver split (`paintOpsResolve` ↔ `resolveDescriptorTriangles`). Reading those first turned "build a colour-texture system" into "add one descriptor kind + a pure field function." Survey the existing substrate before designing.
- `model:preview` colour renders made the four pattern fields self-correcting in ~2s each — stripes/spots/patches/gradient were dialed in headlessly without a browser round-trip, and the `model-sculpt`-style discipline (render→look→adjust) kept the loop tight.
- Reusing the model's own `markAnchorsFor()` for the siamese gradient anchors — no new anchor math, and it stays pose-aware for free.

## Lacked
- A reason to distrust the headless preview. It rendered the patterns perfectly, so I nearly shipped without the in-app check — but the live editor path (`setModelColorRegions`) silently dropped `perTriColors`, so the real app rendered every coat FLAT. The headless `paintOpsResolve` resolves `perTriColors` directly, so the two paths diverged exactly where no headless test could see it. The browser screenshot was the only thing that caught it.
- An SDF-label fact up front: `.label()` meshes each subtree independently, so labeling head/legs/tail would hard-seam every joint. I only found this by reading `sdf.ts` after the user asked for per-part labels. A one-line "labels seam smooth blends" note in the sdf docs would have saved a detour.

## Learned
- **For an app-facing engine change, the headless preview and the browser are DIFFERENT code paths — verify both.** A new `perTriColors`-bearing descriptor has to be threaded through *two* resolvers AND the underlay builder (`setModelColorRegions`); the headless one passing is no evidence the live one does. The eyes-on browser check is not ceremony here — it's the only coverage for the live path.
- Per-region colour on a fused SDF body wants a **geometric scope** (sphere/box/plane by centroid), not SDF sub-labels — same result, no seam.

## Longed for
- A console/API readback of composed per-triangle colours (`getMesh()` carries none), so a regression test could assert "coat has ≥2 colours" structurally instead of via a canvas-screenshot + `sharp` pixel count. The pixel test works but is heavier and coarser than a direct assertion would be.
- A typed link between "new `RegionDescriptor` kind" and "every site that resolves a descriptor," so dropping `perTriColors` in one of the three consumers would be a type error, not a silent flat render.
