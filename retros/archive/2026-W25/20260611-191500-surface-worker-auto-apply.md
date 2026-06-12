---
date: "2026-06-11T19:15:00Z"
task: "feat: off-thread, auto-applied, cancelable surface textures (PR #590)"
areas: [surface, renderer, tooling, testing]
cost: medium
---

## Liked / Worked
- **The explore agent's Worker-portability sweep paid for itself**: one
  delegated pass established that all 8 chain modifiers are pure math, that
  three.js/three-mesh-bvh are used data-only, and that the engrave IMAGE mask
  is the lone DOM blocker — so the Worker boundary was drawn correctly on the
  first try instead of discovered by runtime crashes.
- **The existing "Rendering… Xs + Cancel" pattern was a perfect template** for
  the "Applying textures…" status: generation-tokened timer, shared inline
  Cancel button, delayed show. Copying an established UX shape beat inventing
  one.
- **Prefix memoization design from the panel-as-code work carried over** —
  per-prefix cache keys meant the Worker only ever computes the uncached tail.

## Lacked
- **main.ts NUL bytes struck again** (cost: ~4 turns). `Edit` and even perl
  regex failed on the `surfaceBaseKey` template literal because it embeds
  literal NULs; only a python slice-between-anchors script worked. This is
  the third session to rediscover it.
- **A scratch-spec timing trap**: asserting on the "Applying textures" status
  text flaked because a light chain finishes inside the 400 ms delayed-show
  window. Burned a run before switching to a heavier chain (fuzzy q4 + knit
  q5). The delayed-show threshold isn't documented anywhere a spec author
  would look.

## Learned
- **`navigator.gpu` exists in Chromium Workers**, so the WebGPU knit path
  runs off-thread unchanged — no main-thread GPU proxy needed.
- **Latest-wins supersession needs the `pending` slot set synchronously in
  the Promise executor**: the superseded call's rejection handler runs as a
  microtask, so `surfaceComputeInFlight()` is only a reliable
  "was I superseded vs user-cancelled" discriminator because the new call
  registers before that microtask fires.
- **Posting a cached mesh to a Worker must NOT use a transfer list** — the
  structured clone protects the cache entry; a transfer would detach buffers
  still referenced by the memo cache.

## Longed for
- A **`docs/` note (or lint) for the main.ts NUL-byte zones** — even one line
  in CLAUDE.md's editing guidance ("main.ts contains NUL bytes; use grep -a
  and python slicing, Edit will fail") would save every future session the
  rediscovery.
- A **`test:e2e:one <grep>` alias** that also prints the resolved spec list
  before running — twice I waited on a spec I'd mis-greped to nothing.
