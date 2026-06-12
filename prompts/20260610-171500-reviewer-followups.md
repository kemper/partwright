---
session: "e1m4pk"
timestamp: "2026-06-10T17:15:00Z"
sequence: 3
---

## Human

(Work-reviewer follow-ups on PR #573.) The review reported zero blocking
findings, one should-fix, and confirmed paint-composite parity with the
browser path, `MeshResult` back-compat, the `simpleHash` extraction, and the
`rewriteVersionCode` semantics.

## Assistant

## Key decisions

**Threaded the new voxel fields through the worker boundary** (the
should-fix): `voxelRes` / `voxelResMixed` / `sdfLabelCounts` were set by
`voxelEngine.run` but dropped by the worker `postMessage` and the client
reconstruction, so the type advertised fields that browser callers would
read as `undefined`. All three are plain-serializable; forwarded in
`engineWorker.ts` and rebuilt in `engine.ts` next to
`voxelCount`/`voxelPieceCount`.

**Corrected the azimuth convention in my new comments.** I had written
"azimuth 0=+X 90=+Y"; the authoritative convention
(`src/renderer/multiview.ts:323`) is azimuth 0=front/−Y, 90=right/+X,
180=back/+Y — which also reconciles "iso az 45" with the catalog README's
"+X/−Y corner" description. Fixed in `generators/catalog-entries.ts` and
`scripts/build-catalog-entry.cjs`; the reviewer-flagged `ai.md` "az 135"
line predates this PR and is left for a separate docs pass.
