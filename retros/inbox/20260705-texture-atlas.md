# 4-Ls — baked texture-atlas layer (PR #870, #885 UV mode)

**Liked**
- "Persistence = one attachment + a formula" collapsed what looked like a
  schema-migration feature (7-location sync, viewport rewrite) into ~620
  lines. Asking "what is the MINIMUM state that must survive?" before
  reaching for the schema was the whole ballgame — UVs derived from
  triangle index need no storage at all.
- The strict-visibility-or-palette-fallback rule fell out of a real
  failure (Gemini recomposing a piece image) and generalizes: when an
  upstream generator is unreliable, gate its contribution on PROOF and
  fall back to known-good state, never interpolate trust.

**Lacked**
- A fast way to compare mesh indexing between pipelines. The scratch
  harness baked against a raw STL parse while region ids referenced the
  app's Manifold.ofMesh ordering — two debugging rounds (atlas dumps,
  base-color renders) to find it. A "mesh content fingerprint + ordering
  hash" utility would have made the mismatch a one-line check.
- Offscreen renders don't see the texture (viewport only), so the
  verification loop needed canvas screenshots with UI chrome instead of
  clean renderView output — awkward for showcase shots and for future
  texture QC (tracked on #885).

**Learned**
- Silhouette-bbox alignment is only as trustworthy as the generator's
  composition discipline: one displaced blob in the image stretches the
  map for everything. Alignment should key on the dominant component or
  per-component correspondence, not the global bbox.
- Palette snapping + majority voting had been silently absorbing large
  sampling errors in the paint pipeline; continuous-color sampling
  removed that safety net and exposed every upstream flaw. Removing a
  quantizer is an integration test for everything before it.

**Longed for**
- Progress reporting for long in-page bakes (18 s of frozen evaluate) —
  the engrave Worker pattern (terminate-on-cancel + progress messages)
  fits and the bake kernel is already Worker-clean.
- The completeness follow-ups now on #885: textured offscreen renders,
  GLB export with atlas, view blending at seams, export-duplicate strip.
