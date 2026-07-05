---
date: 2026-07-05
branch: claude/confident-carson-gpo63q
files_changed:
  - src/color/idProjection.ts
  - src/renderer/multiview.ts
  - src/main.ts
  - tests/unit/idProjection.test.ts
---

## Human

After the single-view Gemini repaint experiment, the owner reviewed the
results: the model's repainted image was near-perfect, but the projection
itself showed pixelation, gaps, and single-side coverage. He asked whether
we could reach a "pixel-perfect, wow-worthy" application of AI-generated
color, approved the roadmap order (triangle-ID voting projector, then the
multi-view sequential conditioning loop), and set hard constraints: no
external mesh/texture services — only general-purpose generative models
(Anthropic, Gemini, possibly OpenAI).

## Assistant

Rebuilt `paintByImageProjection` around a triangle-ID buffer instead of
centroid sampling, which addresses three of the four diagnosed defect
sources in one structure:

- **Exact occlusion.** The scope re-renders with every triangle in a unique
  flat 24-bit ID color (new `renderTriangleIdPixels` in multiview.ts —
  rendered into a non-multisampled WebGLRenderTarget so antialiasing can
  never blend two IDs into a third, and read back pre-color-transform so
  IDs round-trip exactly). Each pixel names one *visible* triangle; the GPU
  z-buffer replaces the facing-angle heuristic that previously painted
  ~8k occluded triangles per view.
- **Majority voting kills speckle.** Direction inverted: instead of each
  triangle sampling one image point, every ID pixel votes its
  palette-snapped image color for its triangle (~600k votes for the Pomni
  head at 2× supersampling); plurality wins, and background votes
  outnumbering all colors leaves silhouette-rim triangles unpainted rather
  than smearing background onto them.
- **Pinhole fill.** Subpixel triangles the buffer never saw fill from edge
  neighbors, gated conservatively (≥2 agreeing painted neighbors, facing
  gate) so fills grow from consensus and halt at color boundaries.

The multi-view loop is the compositing rule on top: `mode: 'bestFacing'`
stores a per-mesh facing-confidence per triangle (WeakMap keyed on
MeshData identity, so a re-run resets it) and lets a later view repaint a
triangle only when it faces it better — filled triangles carry half
confidence so a later direct look always beats a fill. Earlier projection
regions shrink as later views take triangles over (descriptor + resolved
set both updated), keeping every triangle in exactly one region for audits
and exports. `fillGaps` mode respects all existing paint instead.

Pure math (encode/decode, snapper, vote tally, scope edge adjacency, fill)
lives in dependency-free `src/color/idProjection.ts` with 18 unit tests;
main.ts keeps only orchestration. Validated on the Pomni head: the same
Gemini repaint that previously projected with speckle and false paint now
lands solid fills in 818 ms, and the sequential loop (render paint-so-far →
Gemini completes the gray areas → project back) drives coverage across
views. The Gemini key stayed in the session scratchpad; a repo-wide
pattern scan ran clean before commit.

**Follow-up (same session):** loop round 2 exposed the key remaining
failure mode — the underside completion mirror-flipped the lobe colors
(the model trusted its front-view prior over the paint it was told to
preserve; from below, left/right invert). Structural fix, not just a
prompt fix: a hallucination guard (`maxDisagreement`, default 0.35)
measures how much the image's votes contradict existing paint on the
already-painted triangles it covers and refuses to commit past the
threshold, telling the caller to regenerate. A completion that repaints
preserved areas differently is untrustworthy by definition — this turns
the failure from silently-committed into detected-and-retryable.
