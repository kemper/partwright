---
session: "jolly-faraday"
timestamp: "2026-06-09T19:00:00Z"
model: claude-opus-4-8
branch: claude/jolly-faraday-aqn0sg
files_changed:
  - src/geometry/gears.ts (new — involute spur/pair/rack namespace)
  - src/geometry/threads.ts (new — ISO-metric rod/bolt/nut namespace)
  - src/geometry/engines/manifoldJs.ts (register api.gears / api.threads)
  - src/ai/tools.ts, src/ai/systemPrompt.ts, src/editor/apiCompletions.ts (discoverability)
  - public/ai.md, public/ai/gears.md, public/ai/threads.md (docs)
  - tests/unit/gears.test.ts, tests/unit/threads.test.ts, tests/gears-threads.spec.ts
---

## Human

[After a discussion concluding SCAD's only real lead over the JS engines is
BOSL2's threads + involute gears, and that those are portable library math.]
Let's keep SCAD for now, but I like your idea of porting gears and screws into
the JavaScript engines. Do that and create a PR.

## Assistant

## Key decisions

**Scope & shape**: Modelled the two new sandbox namespaces on the existing
`printFit` pattern — a `create*Namespace(module)` factory registered in
`manifoldJs.ts`, `ValidationError` on bad input, and a `__testables__` export so
the pure math is unit-tested without booting WASM. Like `printFit`, these are
sandbox-only authoring helpers (no `window.partwright` / `tools.ts` dispatch
surface), so the UI↔JS-API parity rule is satisfied by being equally reachable
from console and in-app agents. They land in manifold-js, which closes the gap
the /ai.md verb table flagged as "(write a helix manually)" / "(sample involute
manually)".

**Gears** (`gears.ts`): Real involute tooth flanks. `spurOutline` walks each
tooth as left-flank-out / right-flank-in with the half-tooth angle narrowing by
the involute polar angle above the base circle (radial line below it), clamping
the effective tip radius so low-tooth-count gears don't self-intersect. Built by
extruding one CCW outline (cleaner than unioning per-tooth wedges). `pair`
phases the second gear by `(180 % pitchAngle) + pitchAngle/2` so valleys face
the pinion, with a small default backlash so the two stay separate components
(verified `componentCount === 2`). Added `rack` (straight-flank linear gear) and
`centerDistance`/`ratio`/`dimensions` helpers.

**Threads** (`threads.ts`): Hand-tessellated helical sweep of a truncated 60°
ISO profile → `Manifold.ofMesh`, unioned with the core cylinder and trimmed
flat. Two bugs caught during `model:preview` verification: (1) a full-pitch
profile made adjacent coils' back-faces coincident → non-manifold; fixed by
making the rib a sub-pitch tooth with the core filling the root. (2) The fan
caps were wound the same direction as the side faces → 12 same-direction
directed edges → "Not manifold"; flipped both caps. Locked both properties in
with a WASM-free edge-consistency unit test on `buildHelixMesh`. The nut carries
the print-fit clearance (`fit`, default 0.2 mm) so a nominal printed bolt threads
into a printed nut; union the full ridge then single-intersect to avoid a
degenerate sliver component.

**Verification**: `model:preview` (manifold/component/genus stats + 4-view PNGs)
for each builder, a 12-case e2e spec on the real kernel, and a full-app editor
screenshot of the gear pair + bolt + nut. Skipped catalog `.partwright.json`
entries — they require the heavyweight bake/thumbnail pipeline and the feature
is fully usable and documented without them (noted as a possible follow-up).
