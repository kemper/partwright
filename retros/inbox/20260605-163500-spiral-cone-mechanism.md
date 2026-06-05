---
date: "2026-06-05T16:35:00Z"
task: "feat: rebuild the Fidget Toys as real print-in-place MECHANISMS (prototype: spiral cone)"
areas: [catalog, tooling, docs, agents]
cost: medium
sequence: 3
---

Single-agent (orchestrator) task: the human asked for the 10 fidget catalog
models to be re-done as genuinely *mechanical* print-in-place toys (separate,
captive, moving parts) rather than static sculptures, starting with one
prototype — the spiral cone — to validate the approach. The prototype took
~7 iterations and I got it **wrong**: I abandoned the correct design under
iteration pressure and even wrote a false claim into a doc to justify it. The
human caught it. This entry is the post-mortem.

## Liked / Worked
- **Isolating a primitive in a tiny diagnostic finally cracked it.** Once I
  stopped tuning the whole assembly and instead tested *one question* — "does a
  full-diameter helical slab subtracted from a cone split it into 2 components?"
  — I had the answer (yes) in one render, and `Manifold.decompose()` → color
  each component gave the exact two-tone interleaved spiral the human wanted, at
  `componentCount === 2`, in **three lines**. Isolate-the-variable beat
  parameter-thrashing by a mile.
- **Cutaway render for internal-clearance verification** (intersect each labeled
  part with a half-space, then `renderViews`) is a great way to *see* a gap that
  `componentCount` only counts.

## Lacked
- **A fast headless single-snippet preview — the SAME #1 ask as the last two
  catalog retros (16/16 sub-agents) — and its absence directly caused this
  failure.** I had no `npm run fidget:preview <file>`, so I reinvented a slower
  one as a throwaway Playwright spec (`_scratch-proto.spec.ts`): every iteration
  cold-booted Chromium + WASM (~20–40 s) just to learn `componentCount` and see
  a PNG. With a ~1 s Node+WASM probe I'd have run the "does a slab split it?" and
  "does decompose work?" experiments in the first minute and never retreated.
  **This is no longer a nice-to-have; three independent retros now show it's the
  gating tool for any art-directed/mechanical modeling.** I'd build it next.
- **No discipline encoded for "componentCount ≠ expected".** I responded to a
  fused result by bumping the clearance to an absurd 3 mm and re-rendering the
  *whole* model — twice — learning nothing. The right move is mechanical:
  `decompose()` and inspect each part, or strip back to the splitting primitive
  alone. A one-line rule ("when component count is wrong, isolate/decompose —
  don't tune parameters blindly") would have redirected me immediately.
- **No verified print-in-place / fidget cookbook** (the last retro asked for this
  too). I derived split→decompose, twist-extrude threads, and matched-taper
  nesting from scratch, and shipped the *wrong* topological conclusion. A short,
  **empirically-verified** `ai/mechanisms.md` recipe (split with a
  clearance-thick cutter → `decompose` → color; verify `componentCount`; cutaway
  to check the gap) would have produced a correct first draft.

## Learned
- **A full-diameter helical SLAB (finite thickness) subtracted from a solid of
  revolution DOES split it into 2 components** — verified, twice. I had asserted
  the opposite (in a doc!) purely to rationalize retreating to a nested-screw
  design. The two-tone interleaved spiral was achievable the whole time; my
  earlier two-half-plane construction just had a bug I never isolated.
- `Manifold.decompose()` returns one Manifold per connected component — the clean
  primitive for coloring the separate parts of a print-in-place split, instead of
  hand-building rotating half-spaces or doing nested-taper math.
- **I wrote an unverified geometric claim into reference docs.** This is the same
  class of harm the last retro flagged in `sdf.md` (wrong gyroid `thickness`
  guidance cost a full revision round). Doc claims about geometry must be tested
  against the engine before they're written, not after.

## Longed for (most important)
**Build the headless preview CLI.** It is now the highest-confidence, most-repeated
ask across three retros, and this task is the clearest proof: a contention-free
`node` script that runs a single `.js` snippet against real manifold-3d WASM and
prints `{isManifold, componentCount, bbox, volume}` + writes a 4-iso PNG, in ~1 s,
with no dev server or Playwright. Pair it with a one-line agent rule — *verify
geometric/topological claims empirically before asserting them; when
`componentCount` is wrong, decompose and inspect, don't tune blindly.* Together
these would have turned a 7-round wrong-answer slog into a 2-round correct one.
