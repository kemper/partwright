# 4-Ls — ID-buffer projection + multi-view Gemini loop (PR #870, #885 items 1+2)

**Liked**
- Inverting the sampling direction (pixels vote for triangles instead of
  triangles sampling pixels) solved three diagnosed defects — occlusion,
  speckle, rim bleed — with one structure. The GPU z-buffer is simply the
  correct occlusion oracle; everything approximating it was patchwork.
- The hallucination guard fell out of a principle worth reusing: *when a
  generative step is told to preserve X, measurable deviation from X is a
  free trust signal.* Rejection-instead-of-commit made retries free, and
  round 6 proved it live (a 92%-flip caught, retry passed).
- Validation-by-loop with the real Gemini key found protocol truths no
  amount of code reading would have: coarse-to-fine anchoring, the
  el-−90 prior fight, per-sample stochasticity.

**Lacked**
- A way to safely edit files while a Playwright run uses the dev server —
  one round died to a Vite reload triggered by appending a prompt log
  mid-run. Rule of thumb adopted: no repo writes while a browser spec is
  in flight; queue commits behind the run.
- Per-view working-frame axis documentation. I mis-derived screen-left/
  right for el −90 twice while diagnosing the flip; a tiny "which world
  axis is screen-right for this view" note in the render return would have
  saved two analysis cycles.

**Learned**
- Image models fight for their character priors harder than prompts can
  push back: three rounds of increasingly explicit mirror warnings never
  fixed straight-below completions. The fix was protocol (avoid the view)
  plus determinism (geometric fill), not better prose.
- Measuring guard evidence quality matters as much as the guard: counting
  grazing/fill paint as contradiction evidence punished exactly the views
  meant to replace it. Weight guards by the reliability of what they
  defend.

**Longed for**
- A first-class agent recipe format for multi-step generative loops
  (render → external model → project → retry → fill → audit), so the
  protocol validated here doesn't live only in a deleted scratch spec and
  an issue comment (#885 checklist item).
- Live per-region provenance in the viewport (which view painted this
  triangle?) — would have made the flip diagnosis instant instead of
  image-forensics.
