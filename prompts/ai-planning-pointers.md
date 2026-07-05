---
date: 2026-06-30
branch: claude/elegant-pascal-wxi4d0
files_changed:
  - src/annotations/pointers.ts
  - src/annotations/pointerOverlay.ts
  - src/ui/pointerPanel.ts
  - src/main.ts
  - src/storage/sessionManager.ts
  - src/storage/db.ts
  - src/renderer/viewportRegistry.ts
  - src/renderer/viewportSubsystems.ts
  - src/ai/tools.ts
  - src/ai/types.ts
  - src/ai/anthropic.ts
  - src/ai/openai.ts
  - src/ai/gemini.ts
  - src/ai/local.ts
  - src/export/chat.ts
  - src/ui/aiPanel.ts
  - public/ai.md
  - public/ai/pointers.md
  - tests/unit/pointers.test.ts
  - tests/pointers.spec.ts
---

## Human

A coloring session with an AI agent went poorly because it confidently
misidentified parts of the model (a figure's bottom U-sockets read as "boots"
instead of the real feet) and silently painted against the wrong anchors. The
user proposed: what if the agent had to externalise its hypotheses BEFORE
painting — drop labelled leader-line pointers at every surface point it thought
was a particular feature, the user could see/agree/correct, and only then
paint against the agreed anchors? For curved features (eyeballs, irises) the
agent could also propose a triangle-angle threshold for a bucket-style flood
fill and let the user tweak the slider with a live preview.

After two rounds of ideation, the user asked me to implement Phase 1 + 2 + 3 as
one PR so they could test it end-to-end. The three phases were:
- P1 — pointer data model + per-session persistence + viewport overlay + panel
  with tolerance slider + console API.
- P2 — AI tool layer: `dropPointer` / `listPointers` / `previewPointerPaint` /
  `commitPaintFromPointer(s)` / `hidePointers` / `showPointers` / `clearPointers`
  / `getPointerCoverageReport`.
- P3 — structured 'plan' ChatBlock that the AI emits and the user approves;
  replayed to the model on the next turn (unlike `thinking`).

The user locked in: per-session pointers; bake ops mark all pointers stale +
warn (not auto-delete); `commitPaintFromPointer` leaves the pointer in place
for repaint; `getPointerCoverageReport` IS in scope; `commitPaintFromPointers`
unions to one shared region (the implementer's call).

## Assistant

The crucial alignment that made the build cheap: **the data the AI persists for
a pointer is almost exactly the existing `connectedFromSeed` region descriptor
shape** (`{seedPoint, seedNormal, maxDeviationDeg}` in `src/color/regions.ts`).
A pointer is effectively an unbaked paint region with a label and a leader
line — promoting it to a real region at commit time is a one-liner, and
everything downstream (export, re-resolve on mesh edit, shading) works
unchanged.

### Architecture

- **`src/annotations/pointers.ts`** — pure module-level store mirroring the
  pattern in `annotations.ts`. Pointer carries `{id, label, point, normal,
  triangleId, paintHint?, proposedColor?, status, authoredBy, hidden, stale,
  orphaned, staleReason?, regionId?, lastPaintedAt?, createdAt}`. Three
  `PointerPaintHint` kinds map to the existing flood-fill primitives:
  `connected` → `findConnectedFromSeed`, `coplanar` → `findCoplanarRegion`,
  `colorFlood` → `findColorRegion`.

- **Mesh-change invalidation** — after every successful run, `main.ts` calls
  `resolvePointersAgainstMesh(mesh, adjacency)`. It tries `resolveSeed` first
  (the same ray-cast the existing region rehydrate uses), falls back to
  `findNearestTriangle` with a drift cutoff scaled to the mesh diagonal
  (5%), and flags `stale` when the snap's normal deviates >45° or the drift
  exceeds the cutoff (`orphaned` when no triangle is in range at all). A bake
  op (surface modifier, voxelize) calls `markAllStale(reason)` UP FRONT —
  the post-run resolve then recovers anything that still snaps cleanly.
  Stale/orphaned-flagged pointers stay in the list with a yellow ring; the
  user/AI sees the flag via `listPointers` and decides whether to re-aim or
  clear. Auto-delete was rejected as too aggressive — for a transform like
  `placeModel`, most pointers are still right, and the soft re-resolve catches
  it.

- **Schema 1.18** — pointer set is per-session on `Session.pointers`,
  serialised in the schema-version-laddered `ExportedSession.session.pointers`,
  read by both `importSession` and the URL-param import loop (which routes
  through `importSession`). The in-memory store is seeded from
  `Session.pointers` on every `openSession` (so tab switches don't bleed
  pointer state across sessions) and re-cleared on `closeSession` /
  `createSession` / `clearAllSessions`. A debounced `onPointersChange` listener
  in `main.ts` writes the live store back to IndexedDB via
  `persistSessionPointers` so closing a tab can't lose review state. Each
  entry runs through an `asPointer` validator on import — a malformed entry
  drops silently rather than poisoning a later paint commit.

- **Overlay + offscreen rendering** — the pointer overlay is a `THREE.Group`
  added by a `viewportRegistry` init hook (same inversion pattern annotation
  uses) with `Line2` leader lines + `Sprite` labels, plus a phantom
  highlight mesh when a tolerance slider is dragging. The registry was
  extended from one-slot to multi-provider so the overlay composites
  alongside annotations in `renderViews` snapshots; each provider's
  per-material disposal is routed via `userData.compositeChildren`.

- **Phase 3 — `'plan'` ChatBlock** — new variant on `ChatBlock` carrying
  `{summary, pointerIds[], approved?}`. The chat panel renders it as a
  teal-bordered card with the labels of every referenced pointer, an "Open
  in viewport" deeplink to the Pointer panel, and an "Approve all" button
  that flips every referenced pointer's status to `approved`. The block IS
  replayed to the model on the next turn (unlike `thinking`), so the model
  sees `[Plan (approved)]\n<summary>` and can act against what the user
  approved — every provider serialiser (Anthropic, OpenAI Chat &
  Responses, Gemini, local) was updated to emit the same prefix the user
  sees in the UI.

### What I deliberately didn't ship

- **No `setPointersVisible` / global show-toggle.** The hide/show API works
  per pointer; a top-level "hide every pointer in the overlay" toggle felt
  like a future polish pass that should be driven by real demand, not pre-
  built. Followed CLAUDE.md's "don't design for hypothetical future
  requirements."
- **No drag-to-re-anchor in the panel yet.** The pointer's anchor can be
  patched via `updatePointer(id, {point, normal})` from the console and AI;
  the in-viewport drag affordance is a polish pass for after the user has
  used the workflow once.
- **No `commitPaintFromPointer` deletion of the pointer.** Per the
  conversation, the pointer stays as a `'painted'` audit trail so a repaint
  is one click / one tool call.

### Verification

- 8 unit tests in `tests/unit/pointers.test.ts` cover add/remove/update,
  hidden filtering, status-scoped clear, serialize/deserialize round-trip
  including hidden + paintHint + proposedColor, the clean-snap path, the
  normal-flip → stale path, and `markAllStale`. All pass; full 1659-test
  unit tier stays green.
- `tests/pointers.spec.ts` covers the drop → list → preview → commit
  round-trip in a real browser plus the AI tool dispatch round-trip
  (`dropPointer`/`listPointers` go through `executeTool`).
- Manual browser check via a throwaway `_scratch-*.spec.ts`: rendered a cube,
  dropped two pointers, committed one. Screenshot showed the top face
  painted blue + the panel listing both pointers with the tolerance slider,
  mode dropdown, status pills, and Paint/Repaint buttons working. Sent to
  the user.
- `npm run typecheck`, `npm run lint:deps` (no new circular deps), and
  `npm run lint:deadcode` (no new unused exports — trimmed the visibility-
  toggle API and a couple of accessor helpers I'd added before realising
  they had no caller) all clean.
