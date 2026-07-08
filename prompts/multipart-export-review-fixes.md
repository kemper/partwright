---
session: "cpf91h"
timestamp: "2026-07-08T19:35:00Z"
model: claude-opus-4-8
---

## Human

(Automated pre-ready gate) Run work-reviewer over PR #916's diff and address
its findings before marking ready.

## Assistant

## Key decisions

Acted on the two should-fix findings from the branch review; the rest were nits
or verified non-issues.

**1. Serialize concurrent export bakes (`bakePartsParallel`).** The geometry
pool (`enginePool`) is a process-wide singleton and each export batch sizes +
disposes it. Two overlapping bakes — reachable via the console/AI export twins
(`exportOBJParts` / `export3MFParts` / …) fired concurrently — would tear down
each other's workers, silently truncating one export's file. Added a
module-level `exportBakeMutex` promise chain so a second bake waits for the
first instead of colliding. Parallelism *within* a single export is unchanged;
only export-vs-export overlap is serialized. Regression test added
(`tests/multipart-export.spec.ts`): three console exports fired with
`Promise.all` must each still bundle all 4 parts.

**2. Companion-files back-compat.** Pre-1.10 SCAD versions saved no
`companionFiles`, so passing `version.companionFiles` (undefined) to the pool
would build an old `include <lib>` part with no companions → fail → silently
drop it from the export. The old `executeCodeAsync` path fell back to the live
session set, so restored that: `companionFiles: version.companionFiles ??
getCompanionFiles()`.

Nits deliberately left: current-part row skips the "rendering" state (it's
instant, from `currentMeshData`); the progress overlay follows the existing
`progressModal.tsx` precedent rather than `modalShell`; empty-selection modal
flash is unreachable from the picker. Verified non-issues: surface-texture gap
is pre-existing (not introduced), `sizeOverride`/worker teardown are balanced on
all paths.
