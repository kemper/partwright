---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-25T01:20:00Z"
model: claude-opus-5-5
sequence: 5
---

## Human

CI regression after 5aa05e5d: stl-import "binary STL creates a new session
with an editable Manifold.ofMesh wrapper" sees the starter's volume (7197)
instead of 1000 every time. Suspected a stale-domain refusal or an unposted
render after createSession. Root-cause it. A refused stale request must never
leave old geometry showing for new code. Re-run every spec that creates or
switches a session.

## Assistant

## Key decisions

**Root cause: no request was refused.** I logged the geometry state every
10 ms. The wrapper render always lands (volume 1000, not stale). What changed
is how long the window lasts between `setValue(wrapper)` and the render
finishing:
- 63507d54: about 350–560 ms.
- 5aa05e5d: about 590–610 ms.
- 5aa05e5d with isolation disabled: about 570 ms.

The cause is 5aa05e5d's item #9. A starter-only editor's runs are now tagged
`session:(none)`, so the first real session recycles the Worker and its first
run pays a fresh Worker plus manifold-3d init on the critical path. Before,
those runs left the Worker "unused" and nothing was recycled. The spec's
settle condition accepted any numeric `volume`, but the starter model's
volume is numeric too. During the longer window the main thread is idle, so
the spec's rAF poll caught the old value.

**Fixes.**
- engine.ts now pre-warms on a trust-domain change. It retires the old
  domain's Worker and starts the fresh one booting the moment the session
  switches, so the boot overlaps the rest of the session setup.
- The spec now waits for `getGeometryData().stale !== true`, the app's own
  signal that geometry matches the editor code, in addition to a numeric
  volume.
- I kept the isolation for the first switch. Code typed into a session-less
  editor is still code, and the coordinator asked for the startup sentinel.

**The refusal path is already safe.** A stale-domain refusal only hits a run
whose code belongs to the old session. Every flow that switches session
renders the new session's code through its own run or a part-cache hit, so a
refusal never pairs new code with old geometry. The refused run surfaces as
"Cancelled".
