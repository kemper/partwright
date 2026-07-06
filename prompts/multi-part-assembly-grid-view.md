---
date: 2026-07-06
branch: claude/multi-part-grid-view-1xioll
files_changed:
  - src/assembly/layout.ts
  - src/assembly/sharedParams.ts
  - src/assembly/assemblyView.ts
  - src/assembly/assemblyParamsPanel.ts
  - src/geometry/enginePool.ts
  - src/renderer/viewport.ts
  - src/main.ts
  - src/ui/partList.ts
  - src/ui/paramsPanel.ts
  - src/storage/db.ts
  - src/config/appConfig.ts
  - src/ui/advancedSettingsModal.tsx
  - src/diagnostics/errorLog.ts
  - public/ai.md
  - tests/unit/assemblyLayout.test.ts
  - tests/unit/sharedParams.test.ts
  - tests/assembly.spec.ts
---

## Human

Feature request: when a session has multiple parts, add a view that shows all
the parts together in the interactive viewport, in a grid layout where the parts
don't overlap, so people can see them all at once. Because rendering many parts
can be slow, render them progressively (one at a time, in real time as each
finishes) and, if possible, build the individual parts in parallel with
Workers. Also add a shared parameter menu: the union of parameters across all
parts, and adjusting a parameter that several parts share should update all of
them at once, with an indicator of how many parts each parameter affects (hover
to see which parts) and a Save button to persist to every affected part.

Placement decision (clarified): NOT a new editor tab — each part keeps its own
separate code/editor (merging all code into one editor would be un-syncable and
would defeat parallel builds). Instead it's a display *mode* of the interactive
viewport, entered from a control above the part list AND a toggle in the
viewport. Render source: cache-first, rebuild only when needed. Shared params:
union (not intersection), live-preview with an explicit Save. Ship as one PR.

## Assistant

Built on the existing multi-part model: a session already holds many `Part`s
(`db.ts`), each with its own version (`code`, `paramValues`, cached mesh), and a
full `api.params`/`ParamSpec` Customizer layer already existed — everything was
just scoped to the single active part. So the work was de-scoping those to "all
parts" rather than inventing new concepts.

Key decisions:

- **Viewport mode, not a tab.** Added an `assemblyGroup` to the Three.js scene
  that holds one translated sub-group per part, shown instead of the single-part
  `meshGroup`. The viewport owns all the GPU-resource lifecycle (materials,
  sprite labels, disposal) via new `enterAssemblyMode`/`setAssemblyPart`/
  `moveAssemblyPart`/`frameAssembly`/`exitAssemblyMode`; the orchestration lives
  in the new `src/assembly/` feature layer, keeping the renderer a low layer
  (no back-edge, `lint:deps` stays acyclic). `resetView` was made
  assembly-aware so the "Reset View" button frames the grid, not the hidden
  single mesh.

- **Grid layout is a pure module** (`layout.ts`): near-square grid, uniform
  pitch = largest footprint + gutter, centred on the origin. Because the pitch
  is derived from current footprints, the grid reflows cheaply (O(n) repositions)
  as parts finish — which is what makes progressive fill + non-overlap coexist:
  a bigger part arriving just grows the pitch and moves the already-placed cells.

- **Parallel builds via a Worker pool** (`enginePool.ts`), separate from the
  editor's single long-lived `engineWorker` so a burst of assembly builds can't
  recycle/contend with the interactive engine. It speaks only the `execute`
  slice of the protocol. The non-obvious bug caught in browser verification: the
  pool must do the `init` → `ready` handshake before sending `execute` (the
  worker replies `Geometry engine not initialised` otherwise) and must handle
  the `type:'error'` message (otherwise a failed build's promise hangs forever
  and `Promise.all` never resolves). The current part is seeded from the live
  main-thread mesh so it appears instantly.

- **Shared params are the UNION by key** (`sharedParams.ts`, pure): one row per
  name, widest numeric range across the sharing parts, `partIds`/`partNames` for
  the "affects N parts" badge + hover tooltip, `mixed` when parts disagree. The
  panel (`assemblyParamsPanel.ts`) reuses the Customizer's `buildWidget` (now
  exported). Editing live-previews only the affected parts (rebuilt through the
  pool); Save writes each affected part's `Version.paramValues` via a new
  `updateVersionParamValues` db helper (following the read-then-write-in-one-txn
  pattern). A generation counter drops stale async builds when the view closes
  or reopens.

Parity + config per the house rules: `partwright.openAssembly()/closeAssembly()/
getAssembly()` console methods + `help()` entries + an `#assembly-view` ai.md
section; pool size and grid gutter are `appConfig` knobs surfaced in the
Advanced Settings modal (never hardcoded).

Verified in a real browser (Playwright spec → screenshots): a 3-part session
(Box, Sphere, Cylinder; Box+Sphere share `size`) lays out non-overlapping with
labels, the union panel shows the correct "affects N parts" counts, and dragging
the shared `size` slider grew Box+Sphere live while the Cylinder stayed put and
Save flipped to "Unsaved changes". Documented the one v1 limitation: the grid
renders each part's base executed mesh, so brush-painted regions / baked surface
textures aren't re-applied in the preview (they stay intact on the part itself).
