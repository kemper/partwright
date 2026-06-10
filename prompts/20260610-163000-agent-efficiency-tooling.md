---
session: "e1m4pk"
timestamp: "2026-06-10T16:30:00Z"
tools: [explore-subagents, model-preview, snap, vitest]
---

## Human

Asked what extra scripts/commands the codebase should gain to make common
operations more efficient for agents (prompted by the recent agent-roles
update). After a survey grounded in the retro inbox/reports and the existing
script surface, approved items 1–9 of the recommendation in one PR; the
lower-urgency items go to another session.

## Assistant

## Key decisions

**Source of truth was the retro loop.** Ranked the work by what
`retros/inbox` + W23/W24 reports showed agents repeatedly asking for, then
added cheap workflow wins (typecheck/preflight/snap) that pay off every
session.

**Headless paint (`model:preview`) resolves by default, no `--paint` flag.**
The `api.paint.*` descriptors already ride the engine's `MeshResult` in Node
SSR; the only gap was a resolver. Extracted a pure one
(`src/color/paintOpsResolve.ts`) over the same `findSlab/Shape/Cylinder
Triangles` helpers the browser underlay uses, so logic isn't duplicated —
only the 4-way dispatch is. Default-on beats a flag because agents wouldn't
know to pass it; zero-triangle ops warn (the silent-paint trap).

**`rewriteVersionCode` is safe-by-construction.** It restamps
`geometryData.codeHash` ONLY when the old hash matched the old code, so
already-stale stats stay flagged stale (stricter than the converter's
original behavior). `simpleHash` moved to a dependency-free leaf
(`src/geometry/simpleHash.ts`) because `statsComputation.ts` is
browser-bound via the units→perTabPref localStorage chain — the very reason
the converter had inlined a copy. The converter now SSR-loads the canonical
helper instead.

**Voxel stats: `worldBBox = bbox × res`** with res tracked per grid; mixed
`res` values report `voxelResMixed` + a warning rather than guessing.
`sdfLabelCounts` seeds every requested `colors` key at 0 so an unmatched
label (the smoothUnion deepest-region trap) is loudly visible.

**Stamped preview PNG names.** Default output is
`<file>.preview-<base36 ms>.png` with older stamps cleaned up — the Read
tool caches images by path, and reusing one name served stale renders in a
past session. Explicit `--png` stays verbatim.

**Thumbnail camera reused existing plumbing.** `setThumbnailCamera` →
session `thumbCamera` → export already round-trips; only the bake entry
points lacked a hint. Added `thumbCamera` to all four `generators/*.ts`
entry interfaces, `THUMB_AZIMUTH/ELEVATION` env to `build-catalog-entry.cjs`
(mirroring `single-catalog-entry.cjs`), and `meta.thumbCamera` to
`partwright bake`.

**`snap.mjs` generates a temp Playwright spec** rather than driving the
browser directly, so the dev-server autostart, sandbox-Chromium detection,
and COEP headers from `playwright.config.ts` all apply for free. `/editor`
routes wait for `window.partwright.run` (a fixed wait raced WASM boot in
testing and screenshotted the splash).

Verified: typecheck, full unit tier (1035 passing, incl. new
versionRewrite/paintOpsResolve/voxelSdf tests), `npm run preflight`, full
build, converter dry-run via SSR, live `model:preview` runs showing painted
PNG + new stats/warnings, and `snap` against `/editor`.
