---
date: "2026-06-12T17:27:44Z"
task: "feat: redo 8 catalog models with richer colors, paint, and surface textures"
pr: ~
areas: [catalog, modeling, agents, surface-textures, tooling]
cost: high
---

## Liked / Worked
- Launching 8 parallel model-sculpt subagents cut wall-clock time to ~10 min for 8 simultaneous models; the fan-out pattern was the right call for independent iterative tasks.
- `api.label(shape, 'name', { color: '#hex' })` inline coloring is clean and reliable — colors survive all boolean operations and don't require separate paint passes.
- The D20 die's `api.label(body).add(api.label(numbers))` two-color pattern works perfectly: separate labels survive `.add()` and the contrast (midnight blue body + gold raised numbers) is immediately striking.
- `api.expectUnion({ expectComponents: 1 })` caught several silent boolean failures during iteration — essential safety net that pays for itself every use.
- The treasure chest agent's "cage vs chest" insight (horizontal perimeter bands = cage look; front-face-only vertical straps + structural rims = chest) is a genuinely reusable design heuristic.
- The ghost silhouette insight: `CrossSection.ofPolygons` + `Manifold.revolve` from a hand-crafted profile produces the correct teardrop ghost shape; cylinder+dome always produces a "can with a lid" side view.
- Raised geometry reads far more legibly than subtracted grooves in flat-shaded 4-view renders at typical catalog mesh density.
- The "overlap and union" approach for bumps on a sphere (the ringed planet Great Red Spot) is more reliable than "carve from the outside" and avoids sliver artifacts.

## Lacked
- `api.surface.*` texture ops are completely invisible in `model:preview` PNG output — agents iterating on texture params work blind and must mentally project the in-browser result. A `--bake-textures` flag on model:preview would be the single highest-value addition.
- The `componentCount=1` + multi-color-label warning is a false positive for every intentional decorative multi-color model, generating noise in every catalog model's stats. A `{ decorative: true }` assertion or "expected-multi-color" flag on `runAndSave` / `expectUnion` would suppress it.
- `Manifold.cylinder(len, r, r, n)` places the base at origin and extends in +Z before rotation — after `rotate([0,90,0])` it goes X=0 to X=+len, not centered. This bit two different agents (lantern window cutters, ghost arm connectors). A `Manifold.cylinder(..., { centered: true })` option or clear doc note would save recurring confusion.
- `api.label` fails with "asOriginal() did not produce a valid originalID" when the preceding boolean tree includes `CrossSection.ofPolygons` paths. Workaround: use `Manifold.cube`-based shapes instead. This should be fixed or documented.
- The `paint.box` approach paints THROUGH curved geometry (both near and far face), producing color bleed artifacts. Agents repeatedly tried it and hit this wall. A clear warning in the docs ("paint.box is reliable only on flat faces") would redirect to separate mesh geometry sooner.

## Learned
- For window cutters in a dome shell: the cylinder must extend in BOTH directions from Z axis to punch through both sides cleanly — translate by `[-halfLen, 0, zLocal]` after `rotate([0,90,0])`, not `[0, 0, zLocal]`.
- The D20 icosahedron face enumeration O(n³) over 12 vertices is fine; but the face-coordinate transform (centroid → normal → up vector → rotation matrix) is where bugs hide — test with 1-2 faces before scaling to all 20.
- The "taller than wide" test for proportional correctness is specifically a side-view test. Front views of wrong-proportion models (too-squat lantern, cylinder ghost) can look fine; always check the right/left view after every iteration.
- For treasure chests: the keyhole bore subtraction can silently create a floating annular shell component if the bore starts before the plate's front face and ends past the body's front face — constrain bore depth to stay within the plate's proud zone.
- Boolean order for labeled multi-material models: label BEFORE union. Labeling on an already-unified solid overwrites ALL triangles to the last label.
- Non-uniform planet band widths (wider equatorial, narrower polar) are more visually credible than uniform widths — "organic barcode" vs "mechanical barcode."

## Longed for
- **`model:preview --bake-textures`**: Run the `api.surface.*` chain headlessly and apply it to the preview PNG. Even at low quality it would transform texture iteration from "trust + guess" to "see + adjust." This is the single most-requested tooling improvement from every agent in this batch.
- **`Manifold.cylinder(..., { centered: true })`**: An option to center the cylinder on its axis rather than basing it at origin. This would eliminate a recurring off-by-halfLength translation bug when building radial cutters.
- **`api.expectDecorativeMulticolor()`** or a `notes: 'intentional dual-color, not a mechanism'` field on assertions: suppress the false-positive "fused multi-color = mechanism warning" for catalog models that are intentionally single-piece with multiple paint labels.
- **`listFaceCenters(sphere, nSegs)`** utility: returns the world-space centers of each sphere face at the given segmentation, so window rings can auto-snap to face midpoints on low-segment geodesic domes.
- **Per-agent PNG diffs**: When an iteration produces a PNG identical to the prior pass (silent failure), flag it explicitly rather than letting the agent assume success based on unchanged stats.
