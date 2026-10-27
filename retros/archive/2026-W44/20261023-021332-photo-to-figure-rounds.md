# Retro: photo → Funko figure, rounds 1–2 (#1055, #1056, #1057)

**Liked**
- Converting "the agent eyeballs renders" into a text score (`photoMatch`) cut image reads from one per pass to 10 per 26 passes, and still lifted IoU from 0.82 to 0.88. Numbers made keep/revert decisions mechanical.
- Builder primitives turned a 184-line hand-rigged model into 65 lines, which is fewer tokens for any AI writing a figure.
- Building tools in parallel worktrees, then one validation run, gave the user a measured before/after, not a claim.

**Lacked**
- No warning when a conformal feature (brows) silently resolves to 0 triangles. That cost about 8 builds.
- Score passes needed two full builds (front and back).

**Learned**
- Collage product photos often carry stretched thumbnails. Check the aspect against a known proportion before trusting silhouette metrics (`pixelAspect`).
- Region-colour metrics are unreliable for white-on-white parts on dim photos; silhouette bands were the trustworthy signal.

**Longed for**
- Multi-view scoring in one build, and finer outline text, so agents can pass the IoU plateau without images.
- An anime hair helper, since hair is now the dominant likeness gap.
