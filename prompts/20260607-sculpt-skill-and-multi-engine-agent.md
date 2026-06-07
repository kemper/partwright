---
session: "01CZby"
timestamp: "2026-06-07T17:30:00Z"
---

## Human

Add the thin launcher skill. Also generalize beyond voxel — I want an agent
across the engines (probably not BREP, unsure it works headlessly) with the same
context-optimized/cost workflow.

## Assistant

## Key decisions

**Generalized `voxel-sculpt` → `model-sculpt` (engine-aware) rather than adding
parallel per-engine agents.** The render→look→adjust loop, the text-only output
contract, and the cost discipline are identical across engines — the only
per-engine differences are the API idioms and the one-piece check. Keeping one
agent makes that shared discipline a single source of truth so it can't drift
between engines (drift in exactly that discipline is what we're trying to
prevent). Per-engine sections cover the differences: manifold-js (`return` a
Manifold, 0.5+ overlap to union, `componentCount === 1`), voxel (`keepLargest()`
weld because `componentCount` over-counts on a grid), scad (BOSL2, one CSG tree).

**Scoped to the three headless engines; replicad/BREP explicitly excluded.**
Verified against the source: `model:preview` resolves `--lang` and
`STATELESS_ENGINES = ['manifold-js','voxel','scad']`; replicad errors with a
daemon hint because its OpenCASCADE WASM won't init under Node SSR (matches the
prior retro). Smoke-tested `scad` and `manifold-js` headless previews (both
`ok / manifold=true / 1 component`) so the agent doc's commands are accurate. The
user's instinct was right — BREP can't be sculpted headlessly, so the agent says
so and stops rather than burning passes.

**Added a `/sculpt` launcher skill that stays deliberately dumb.** It picks the
engine, gathers the brief, launches `model-sculpt`, and surfaces the preview via
`SendUserFile` **without Reading it** — encoding the cost invariant as an
executable step instead of leaving it to prose. The skill never duplicates the
agent's geometry knowledge; the agent remains the single source of truth.

**Docs:** updated the `docs/agent-tooling.md` agent row + rationale with the
per-engine headless matrix and the `/sculpt` launcher relationship. Renamed via
`git mv` to preserve history; left the historical `voxel-sculpt` references in
the append-only retro and prior prompt log untouched.
