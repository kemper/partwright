---
session: "4qjg8h"
timestamp: "2026-06-10T13:30:32Z"
tools: [subagent-explore, subagent-general-purpose, model-preview]
---

## Human

Asked what category of higher-level shapes the app doesn't yet support (after recent
PRs added BOSL2 gears/threading and 2D stars/shapes). After discussion, approved one
PR covering "fasteners and joints" with parametric catalog entries demoing every new
capability, driven by the main agent with subagent workers to conserve context.

When exploration revealed that most of the proposed fasteners surface already existed
as `api.printFit` (screwHole, insertBoss, nutPocket, pin/socket, dovetail, snapFit,
M2–M8 table, clearance presets), asked whether migrating printFit into better-named
namespaces made sense, noting "printFit" reads poorly next to the other namespace
names but worried about migration cost.

## Assistant

## Key decisions

**Split `api.printFit` into `api.fasteners` + `api.joints` rather than bolting new
builders onto the old name.** The deciding factor: old saved sessions re-execute
their code from IndexedDB, so back-compat is satisfied by a frozen `api.printFit`
alias object spreading both new namespaces — making the rename nearly free at
runtime. The split mirrors the conceptual seam: screw-hardware-and-clearance lookups
(`fasteners`) vs part-to-part connections (`joints`). `clearanceCoupon` went to
`fasteners` because it calibrates clearance fits; `pin`/`socket` went to `joints`
because they form a mating pair.

**New builders added where gaps existed** (everything else was a faithful move, no
behavior change): `fasteners.tapHole` (thread-forming pilot bore — table already
carried `tap` diameters with no consumer), `joints.hinge` (print-in-place barrel
hinge, one Manifold, componentCount === 2, captive pin via odd knuckle count),
`joints.ballSocket` (snap-together pair, captive because opening < ball diameter),
`joints.snapRim` (press-on lid bead/groove pair following dovetail's two-tool
convention).

**Hinge correctness gate**: bbox-overlap interpenetration warnings are inherent to
interleaved print-in-place parts, so verification uses an explicit
`leafA.intersect(leafB)` → zero-volume probe plus `--expect-components 2`, not the
heuristic warning.

**Docs continuity**: `public/ai/print-fit.md` becomes a stub pointing at the new
`fasteners.md`/`joints.md` subdocs (external agents may hold the old URL), and the
`fetchSubdoc` enum keeps accepting `print-fit`.

**Work split across subagents** to conserve the main context: one geometry worker
(module split + new builders + unit tests + headless model:preview iteration), then
docs and catalog workers in parallel once the API was fixed; main agent kept git,
registration oversight, final verification, and the PR.

## Assistant

## Key decisions — docs migration phase

**Old subdoc URL kept alive**: `public/ai/print-fit.md` became a redirect stub
rather than being deleted, and `'print-fit'` stays in the `fetchSubdoc` enum
(deprecated, omitted from descriptions) — an older cached agent prompt fetching
it gets the redirect in one round-trip instead of an error + retry. New prompts
never learn the old name.

**New subdocs follow the gears/threads template** (option tables + verification
section) so the in-app AI's reading pattern stays uniform; hinge docs teach the
`maxComponents: 2` gate explicitly since the bbox-overlap warning is a false
positive for any interleaved print-in-place part.

## Assistant

## Key decisions — catalog phase

**Kept the `print-fit` catalog group id** — its display metadata was already
renamed for the split, and changing the id would touch six manifest entries plus
src for no user-visible gain.

**Hinge example coerces even knuckle-slider values up to odd** instead of
erroring, so the Customizer can't produce a run failure; leaves are decomposed
and labeled in two colors for a legible thumbnail. The snap-lid example derives
bead and groove from a single snapRim call at the body bore so the interface
diameter can't drift apart. The project box gained a `mountStyle` select
(heat-set insert vs thread-forming) as the tapHole demo.
