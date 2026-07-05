# 4-Ls — generative repaint experiment (#885, paintByImageProjection)

**Liked**
- Cheapest de-risk of the whole PR: one render + one $0.01 Gemini call +
  one projection answered "is generative coloring the 2x path?" with a
  decisive yes (101k triangles painted better than ~40 agent ops).
- Building the experiment AS the eventual API (instead of a throwaway
  script) cost nothing extra — the back-projection needed main.ts mesh
  access either way, and the experiment left a shippable primitive.

**Lacked**
- No raw-mesh read API on `window.partwright` — any external experiment
  needing per-triangle geometry must either go through main.ts or bounce
  off renders. Fine here (the feature belonged in main.ts), but worth
  remembering for future probes.

**Learned**
- Modern image-editing models are far more geometry-faithful than the
  planning assumed: silhouette drift was 1–2 px at 1024², making
  bbox-level self-alignment sufficient — no feature-point registration
  needed.
- Palette snapping is the great forgiver: quantizing to 7 print colors
  absorbs the diffusion model's shading, JPEG artifacts, and minor
  misprojection. The smaller the target palette, the more slack the
  generative stage gets.
- The image model's character knowledge exceeds the paint spec: it added
  the correct yellow hat trim no prompt in six validation rounds ever
  mentioned. For known subjects, the reference is IN the weights.

**Longed for**
- Multi-view compositing + true occlusion (single view = ~50% coverage,
  facing-angle test samples occluders under overhangs) — tracked #885.
- Provider plumbing so in-app agents can drive the repaint through the
  user's stored Gemini key — tracked #885.
