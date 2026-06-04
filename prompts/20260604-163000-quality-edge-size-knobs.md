---
session: "quality-edge-size-knobs"
timestamp: "2026-06-04T16:30:00Z"
tools: [Read, Edit, Write, Bash, Grep, Agent]
sequence: 1
reconstructed: false
---

# Quality panel: edge-length & size knobs for simplify/enhance (PR1 of a larger plan)

The user asked how simplify/enhance pick triangles, noting that for a mesh with
mixed large/small triangles they'd expect *enhance* to hit the larger ones, and
floating a future paint-bucket region selector. After an investigation + plan +
clarifying-questions round, we agreed to land the work in phases. This is
**Phase 0 / PR1**: surface direct edge-length and size-threshold knobs on the
existing whole-mesh path, with no-op warnings. (Region selection + watertight
local refine/decimate are deferred to later PRs.)

## Human

How does the simplify/enhance select triangles? If I have a mix of small and
really large triangles I'd want enhance to impact the larger ones. I may also
want a paint-bucket style tool to enhance/simplify a selected region. Investigate
and consider what production-grade apps do; report back your plan and ask
questions.

## Assistant

### Key findings (the "why" behind the plan)

- **Today both ops are whole-mesh and curvature/edge driven, not selection
  based.** Simplify binary-searches a tolerance into `Manifold.simplify(tol)`
  (curvature-aware: flat regions collapse first). Enhance binary-searches an edge
  length into `Manifold.refineToLength(len)`, which **splits only edges longer
  than `len`** — so enhance *already* preferentially densifies the larger
  triangles. The gap is that the UI hides this behind an opaque "target triangle
  count" knob and offers no spatial control.
- The paint subsystem already has the machinery a future region feature needs
  (bucket flood-fill via `findCoplanarRegion`, the `connectedFromSeed`
  descriptor, and watertight-ish local subdivision), which is why the plan can
  defer the heavy region work and ship the cheap, high-value knob first.

### Clarifying answers that shaped this PR

The user chose the ambitious full plan (region enhance + simplify, all four
selection methods, **watertight required**) but for the *global knob* asked for
**both** a "target edge length" and a "size threshold + amount" control with a
toggle, simplify being the reverse of enhance, plus a warning when nothing
matches. This PR delivers exactly that global-knob slice.

### Implementation decisions

- **New direct (single-pass) primitives, not new search.** Added
  `simplifyToTolerance` and `refineToEdgeLength` to `geometry/simplify.ts`. They
  run one kernel call and **return null when the triangle count didn't change**
  (nothing below the tolerance / no edge long enough) — that null is what the UI
  turns into the "nothing to do" warning, rather than silently no-op'ing.
- **Threaded through the existing worker messages, not new ones.** The
  `simplify`/`enhance` worker messages gained an optional `tolerance`/`edgeLength`
  field; when present the worker takes the direct path and brackets it with 0/1
  progress so the modal behaves identically. `simplifyInWorker`/`enhanceInWorker`
  got an optional trailing arg. This kept the pending-map/cancel plumbing intact.
- **One knob, three framings, two backends.** The Quality panel now has a
  Count · Edge · Size pill row. Count keeps the original binary-search path; Edge
  and Size both funnel into the direct primitives. The UI does the framing math:
  enhance size = `edgeLength = X / 2^(amount-1)` (more detail levels on
  over-threshold triangles); simplify size = `tolerance = X * amount` (amount =
  strength). Edge mode passes the value straight through.
- **Why size threshold is honest but approximate on the whole mesh.** True
  per-triangle "only touch triangles past X" gating needs the selection service
  (a later PR); on the whole-mesh kernel path `refineToLength(X)` already refines
  exactly the triangles whose edges exceed X, so the Size framing is a faithful
  whole-mesh approximation. Labelled accordingly.
- **Dirty-tracking rewrite.** Replaced the count-only `appliedTarget`/
  `appliedMode` with a single `appliedKey` request signature so Apply correctly
  enables/disables across mode + knob + value changes. Extracted
  `commitMeshOpResult` in `main.ts` so the four handlers (apply/enhance/
  simplifyByTolerance/enhanceByEdgeLength) share the color-carry + viewport tail
  instead of copy-pasting it.
- Slider bounds derive from baseline geometry (`maxEdge`/`minEdge`/bbox diagonal
  via a new `minEdgeLength` helper) rather than hardcoded knobs — matching the
  existing panel's geometry-derived bounds.

### Verification

New unit tests pin the direct primitives' contract (non-positive arg → null,
no-change → null, sub-minimum collapse → null, throw → null, genuine change →
result; plus borrowed-input-never-deleted). Manual browser check: a coarse box
fused with a fine sphere (mixed triangle sizes); Enhance + Edge at length 3 took
1852 → 3464 triangles, visibly subdividing the big box faces while leaving the
sphere alone; Reset restored; an over-large edge length surfaced the warning
toast + status. Added a permanent golden-path e2e describe in `simplify.spec.ts`
covering edge-enhance, the warning, and size-simplify. Build + full unit tier
(625) + the simplify e2e suite all green.
