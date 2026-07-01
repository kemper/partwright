---
date: 2026-06-29
branch: claude/confident-carson-gpo63q
files_changed:
  - src/color/meshIslands.ts
  - src/main.ts
  - src/ai/tools.ts
  - public/ai/colors.md
  - tests/unit/meshIslands.test.ts
---

## Human

After the v2 4-agent Pomni run, the two Opus agents shipped recognizable
Pomnis but were still "very far from completing the task successfully." The
user asked what it would take to close the gap and green-lit doing Tier 1
(shape metadata + island rendering + session stability) AND Tier 2 (reference-
image colour sampling), then re-testing with Opus.

## Assistant

Five additions, all wiring through existing infra rather than new subsystems.

**Tier 1a — shape metadata on each island (#871).** Extended
`src/color/meshIslands.ts`: single-pass BFS now also accumulates
`surfaceArea`, dominant-hemisphere `normalHistogram` (area-weighted), and per-
island `principalAxis` / `principalExtent` / `aspectRatio` derived from the
bbox. Whole-mesh aggregation yields `meshNormalHistogram` and
`modelUpAxis: {axis, sign, confidence} | null` — up-axis picked by the biggest
+/- hemisphere asymmetry, tie-broken by bbox extent so a flat-on-plate figure
prefers Y over Z. Exposed via `listComponents()` output (mesh-island branch).

**Tier 1b — `renderIsland({index})` thumbnail (#872).** New `subsetMesh(mesh,
triangleIds)` helper builds a compact MeshData containing only the selected
triangles with remapped vertex indices. The existing `renderSingleView` auto-
frames its camera to the passed mesh's bbox, so handing it a subset
automatically frames tight on that island — no renderer changes needed. New
`partwright.renderIsland({index, view?, size?=192})` returns a base64 PNG plus
the island's shape metadata. The identification bottleneck (61 visually-
similar islands, no way to tell glove from boot from bbox) is closed.

**Tier 1c — session-race helpers (#873).** New `partwright.
waitForSessionStable({minMs=800, timeoutMs=15000})` polls `getState().session
.id` and resolves once it's been stable for `minMs`. Two thin getters
(`getSessionId()` / `getVersion()`) so agents can capture-and-recheck around
paint batches. Full "guard every paint call" is bigger and deferred; these
three primitives are enough for external agents to compose their own guards
around the biggest hazard (post-import navigation).

**Tier 2 — `sampleReferenceColor` (the "match the photo" bridge).** New
`partwright.sampleReferenceColor({id?, rect?, point?, mode?})` decodes an
already-attached image (via the existing `_getImageAttachments()`) to an
offscreen canvas and reads pixels. `mode: 'dominant'` (default) buckets
pixels into a 6×3×3 HSV grid and returns the modal bucket's mean colour —
robust to photo shadow/highlight smear; `mode: 'mean'` is a plain average.
Returns `{color: [r,g,b] in 0..1, hex, samplePixels, ...}` — the exact RGB
agents can feed straight to `paintByCrease`/`paintIsland`/`paintInBox`. No
more guessing "red = [1,0,0]" when the reference red is `[0.87, 0.12, 0.18]`.

**AI-tool wrappers** for all five methods + read-only entries added to
`ALWAYS_AVAILABLE`. `renderIsland` and `sampleReferenceColor` land in
`PART_TARGETABLE_TOOLS` so `part` targeting works.

**`colors.md` gained a "Painting an imported STL to match a reference
photo — full workflow" section** — the six-step recipe
(`importMeshData` → `waitForSessionStable` → `listComponents` → attach photo
+ `sampleReferenceColor` → `renderIsland` for ID → paint with sampled
colour), with a short "why each step matters" tied to the actual v2 agent
failures.

**Tests.** 8 new unit tests: shape-metadata correctness on synthetic sticks
(`principalAxis='x'`, aspectRatio `[1, 0.1, 0]`), surfaceArea on a 3×4
rectangle (=12), normalHistogram sums to 1, `modelUpAxis` detects +Z on an
asymmetric hemisphere mesh, `subsetMesh` returns compact MeshData with
correct vertex compaction.
