---
session: "01C12ZpRrhQPwoXD2UaueNnm"
timestamp: "2026-10-23T22:45:00Z"
---

## Human

A session file takes too long to render and times out. Fix it, and recommend a
way to show a progress bar, not lock up the page, and not time out unless the
user wants to quit waiting. Follow-up: the file is too big to attach; it has
paint strokes that take 60–90 s to replay on load. Make it possible to import
slow files if people want to.

## Assistant

## Key decisions

**Where the "timeout" came from.** Production (v1.8.0) predates #1052, so there
the stroke replay ran on the main thread for ~90 s (issue #1049's profile) and
the tab hung. Main already runs the replay in the subdivision worker behind a
cancellable modal with no time limit. A synthetic stand-in (245k-tri sphere +
19 dense smooth strokes, refined to 1.32M tris) reproduced a 47 s import on
main: the bar never moved, and the page still froze for up to 6.4 s at a time.

**Freeze fix.** A CDP profile put most of the main-thread block in
`buildAdjacency`, which paint mode pre-warms on idle after every mesh change.
Rewrote it with a numeric hash over the coordinate bit patterns (+0/-0 merged,
matching the old string keys) and CSR arrays + a stamp array instead of
Map<string>/Set-per-triangle. Same neighbour sets (unit test against the old
algorithm); ~4.8 s → ~50 ms on the repro. Longest stall 6.4 s → 2.7 s; the rest
is WebGL upload/thumbnail readback on the sandbox's software GL.

**Progress, no limit.** The worker now posts step progress (trace stroke i,
smooth edge i of N, footprints) through `refineMeshPipeline` /
`buildRefinedMesh`; the restore modal is determinate, names the step, ticks
elapsed seconds, and keeps Cancel/Escape as the only way to stop. Chose step
counts over time estimates: steps are coarse but honest.

**Not done here.** Skipping the rebuild entirely (cache/persist the refined
mesh) is in open PR #1074, so not duplicated.
