# Retro: "Built differently than saved" — fingerprints + newest mesh (#1185)

**Liked**
- The surface-texture persistence (`Version.surfaceTexture`, Blob-packed arrays) was a ready pattern for storing a mesh per version; the feature reused it instead of inventing storage.
- An independent work-reviewer pass before marking ready caught two real false-alarm sources (curvature quality isn't persisted; legacy stats from other machines) that my own tests had missed.

**Lacked**
- No single "what built this mesh" record: code, Customizer values, imports, companions, quality and the auto-format pass all feed a run, and a save or load has to match all of them. Each was a separate bug.
- My first quality test was vacuous: the sphere passed an explicit segment count, so quality couldn't affect it. Assert that the condition under test actually changes the output.

**Learned**
- A pure "fix" to a shared path (refuse to save an errored bake) can break an unrelated test that depends on the bug. Scope it out and file it (#1186) instead of widening the PR.
- An exact second moment per triangle (∫xxᵀ dA = A/12(Σvvᵀ + (Σv)(Σv)ᵀ)) is triangulation-invariant; the centroid approximation isn't.

**Longed for**
- A run-identity object produced by runCodeSync (code, params, inputs, quality, part) that save, cache and drift paths share, instead of each re-deriving it.
