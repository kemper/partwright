---
session: "voxelpieces"
timestamp: "2026-06-09T14:00:00Z"
model: claude-opus-4-8
---

## Human

For the engine-level one-offs raised across both retros: start from the latest
main, double-check they still need fixing, and if so implement and open a new PR.
(Earlier turn established the two items: the BREP `fillet(r)` preflight clamp and
the voxel `componentCount` over-count. The fillet one was deferred — already
mitigated by `formatOcctError`'s clear "radius too large" message. So this PR is
the voxel one.)

## Assistant

## Key decisions

**Re-verified the voxel over-count on latest main — still present.** A
face-connected hollow voxel shell (one printable piece with an enclosed cavity)
reports `componentCount: 2` because the cavity's inner surface is a separate
manifold component (`genus: -1`). `componentCount` comes from
`Manifold.decompose()` on the meshed solid (`statsComputation.ts:80`), which is
the wrong instrument for "how many separate printable pieces?" on a voxel grid.

**Also found a concrete bug my own #530 clearance warning introduced:** it
false-positived on that hollow shell ("separate parts whose bounds overlap, may
interpenetrate") — it's one piece. So this work both adds the trustworthy
measure and fixes that regression.

**Fix: a face-connected (6-neighbour) BFS piece count.** Added
`VoxelGrid.faceComponentCount()` (`grid.ts`) — pure, O(occupied), unit-tested —
since FDM fuses only across shared faces (edge/corner touches and enclosed
cavities don't make/break a single piece). Threaded it as `voxelPieceCount`
through the same path `voxelCount` already uses: voxel engine →
`MeshResult` (`types.ts`) → worker message (`engineWorker.ts`, `engine.ts`) →
both the headless stats (`previewModel.ts`) and the browser geometry-data
(`main.ts` `lastVoxelPieceCount` + `runIsolated`).

**Did NOT override `componentCount`.** It's deeply wired into the
printability/floating-parts logic (which already detects enclosed components via
WASM `intersect`), and the per-component breakdown comes from the same
decompose. Overriding it risked regressions for marginal benefit. Instead I
surface `voxelPieceCount` alongside it and, in `buildWarnings`: (a) gate the
clearance check on the real piece count (`pieces`, = voxelPieceCount for voxel)
so the hollow-shell false positive is gone, and (b) add a clarifying note when
`componentCount > voxelPieceCount` so the AI reads the right number.

**Verification.** `npm run build` clean; `npm run test:unit` 864/864 (new
`voxelFaceComponents.test.ts`, 8 cases incl. face/edge/corner/cavity). CLI:
hollow shell now `voxelPieceCount: 1` + note, clearance false-positive gone;
disjoint blobs `voxelPieceCount: 2`; the non-voxel (manifold-js) clearance
warning still fires (no regression). A throwaway Playwright spec confirmed the
browser worker path surfaces `voxelPieceCount: 1` in `runAndSave().geometry`.
Docs: `public/ai/voxel.md` fragmentation section + `CLAUDE.md` componentCount
discipline now point at `voxelPieceCount`.

**Left as-is (per earlier decision):** the BREP `fillet(r)` preflight clamp —
already mitigated, and a true clamp needs OCCT max-radius introspection
replicad doesn't expose, for little gain.
