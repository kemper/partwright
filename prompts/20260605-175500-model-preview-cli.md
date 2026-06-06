---
session: "trusting-dirac"
timestamp: "2026-06-05T17:55:00Z"
---

## Human

Build a headless CLI preview tool and use it to drive a good spiral cone. Make it
generic — `model:preview`, not `fidget:preview` — and have it return all the
information an AI might want to succeed. Keep in mind that a CLI-driven agent
working in the codebase isn't the same as the in-app / chrome-extension AI, so a
`mechanisms.md` for the internal agent may differ from the external `ai.md`.

## Assistant

## Key decisions

**Why this tool, now.** Three independent retros — most emphatically the fidget
one (16/16 sub-agents) — named a headless single-snippet preview as the top
recurring ask. The spiral-cone task was the proof: with no fast feedback I
thrashed parameters across ~20–40 s browser round-trips, retreated from the
correct design, and even wrote a false topological claim into a doc. So the
highest-leverage move was to build the thing that removes that failure mode.

**Faithful execution via vite SSR, not a reimplemented sandbox.** `ssrLoadModule`
loads the *real* `manifoldJsEngine` in Node — it only does `import('manifold-3d')`
+ `Module.default()`, with no browser coupling — so results match the app exactly.
A hand-rolled minimal `api` would have diverged and defeated the point. The engine
already returns the live `manifold` (volume/genus/decompose), the mesh, and
`labelMap`/`labelColors`, so the tool gets everything for free.

**No WebGL dependency.** Rendering uses a pure-JS z-buffer rasterizer → `sharp`
PNG, avoiding a native `headless-gl` dep that may not build in the sandbox. It's
not pretty, but it's enough to judge spirals, proportions, and model colors.

**Rich, decision-useful stats — `componentCount` is the headline.** For
print-in-place mechanisms `componentCount` is *the* instrument, so the block leads
with it and per-component volumes/bboxes, plus genus, aspect ratio, edge-length,
labels, and a `warnings[]` array (fused parts vs declared labels, tri-count over
the ~200k catalog budget, sub-0.4 mm detail). This immediately earned its keep by
catching a silent 2→10 component regression when I lowered the cutter's
resolution.

**Audience split (per the human's note).** `model:preview` is for CLI agents who
can run npm + read the repo → documented in `CLAUDE.md`. The in-app/extension AI
can't run a CLI, so its guidance stays in `ai.md`/`public/ai/*.md` subdocs and
uses the in-browser `renderViews()` / `runAndSave(..., {maxComponents})` /
sandbox `decompose()`. Same technique, audience-appropriate tooling.
