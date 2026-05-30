# Multi-view silhouette reconstruction (visual hull) — prototype

A way to turn **several silhouette views of a subject into a rough 3D voxel
model**, without any 3D-specific AI model. The intended workflow is to take one
photo, have a frontier image model (Gemini / GPT-image) synthesize a *turntable*
of that subject at known angles, then carve the **visual hull**: a voxel
survives only if it projects inside the silhouette in **every** view.

## Why this works with plain image models

Synthesized turntable views are **not** photometrically consistent — the texture
an image model invents at 90° need not match what it invents at 180°. Dense
multi-view stereo would choke on that. Silhouette carving only uses the
**outline**, a far weaker requirement that current image models can meet. The
result is robust to view-to-view colour/texture drift.

**Known limit:** a visual hull can never recover concavities invisible on every
silhouette (eye sockets, the dish under the chin). More views tighten the hull
but cannot add that information — for concavities you'd need depth or landmark
data, not more outlines. Expect a smooth, correctly-proportioned **bust**, not a
pore-level likeness.

## Camera angles

Degrees, matching the renderer / `renderViews`:

- `azimuth` — `0` = front (+Y), `90` = right (+X), `180` = back (−Y), `270` = left (−X)
- `elevation` — `0` = horizon, `90` = top-down (stay ≤ `89`; exactly 90 is gimbal-degenerate)

The subject **must be centred and at the same scale in every view** — that
single shared world scale is what makes the silhouette cones intersect
correctly. Put it on a plain, contrasting background so the silhouette extracts
cleanly (transparent PNGs are used via their alpha channel; opaque images are
chroma-keyed against an auto-detected background colour).

## API

```js
// Reconstruct from supplied silhouette images (the Gemini-turntable workflow).
const r = await partwright.reconstructFromSilhouettes({
  views: [
    { src: frontDataUrl,  azimuth: 0,   elevation: 0 },
    { src: frrDataUrl,    azimuth: 45,  elevation: 0 },
    { src: rightDataUrl,  azimuth: 90,  elevation: 0 },
    // … a full turntable, plus a high-elevation view to cap the top …
    { src: topDataUrl,    azimuth: 0,   elevation: 70 },
  ],
  options: {
    resolution: 96,        // grid cells per axis (8–256). Higher = finer + slower.
    frameFill: 1,          // fraction of the frame the subject fills (0.1–2). Tune
                           //   down if there's margin around the subject.
    smooth: 2,             // voxel surfacing iterations (0 = blocky).
    colorFromViews: true,  // colour each voxel from the view that most faces it.
    // alphaThreshold, backgroundColor:[r,g,b], bgTolerance — silhouette extraction knobs.
  },
});
// -> { sessionId, voxelCount, views }  (or { error } on bad input)
```

```js
// Self-test playground — no image generation or API key needed. Renders the
// CURRENT model's own silhouettes at a turntable of angles and carves them
// back, so you can feel out how faithfully the hull recovers a known shape.
const r = await partwright.reconstructFromCurrentModel({
  azimuthCount: 12,   // evenly spaced azimuths at elevation 0
  includePoles: true, // add high + low elevation caps
  resolution: 96,
  smooth: 2,
});
```

Both land the result as a **new voxel session** (non-destructive — your original
stays put), so you can inspect, paint, smooth, or export it like any voxel model.

## How many views?

For the visual hull, ~**12–16 azimuths plus 2–3 elevations** captures
essentially all the recoverable shape; going to 30–40 gives diminishing returns
because the hull has already converged. To get *past* the hull (real eye
sockets, surface relief) you need a different kind of information (depth /
landmarks), not more turntable frames.

## Suggested image-model prompt

> "Generate an orthographic turntable of THIS subject: the same person, identical
> scale and vertical position, centred, on a flat neutral background, at azimuths
> 0°, 45°, 90°, …, 315° (facing the camera at 0°), plus one view from ~70°
> above. Keep the silhouette accurate; consistency of the outline matters more
> than texture."
