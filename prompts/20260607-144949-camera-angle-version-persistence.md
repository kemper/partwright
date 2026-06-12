---
session: "fvIqe7"
timestamp: "2026-06-07T14:49:49Z"
model: claude-opus-4-8
tools: [explore, playwright]
---

## Human

When I've changed the angle in the interactive view, and then when I switch
versions, the angle of the next version in the interactive view flips back to
some default angle. I don't want it to do that. When I'm changing between
versions within a session, whatever my most recent interactive view angle was,
I want it to be remembered — and as I switch versions, keep using that exact
same perspective (angle and distance) I previously picked. Implement this and
make it a PR.

## Assistant

## Key decisions

**Root cause**: Loading a version re-renders its geometry through
`updateMesh`, whose auto-frame calls `frameModel()` — which unconditionally
snaps `camera.position` + `controls.target` to the default 3/4 view. There was
no camera-state write-back path (`getCameraState` existed, but read-only).

**Approach**: Snapshot the live camera pose before the re-render and restore it
after, rather than skipping the auto-frame. `frameModel()` also recomputes
bounds-derived state (clip-slider range, grid height, near/far planes,
`maxDistance`) which *must* adapt to the new version's geometry — so we let it
run and only put the camera back.

- Added `getCameraPose()` / `setCameraPose()` to `src/renderer/viewport.ts`.
  These work in exact world-space (position + target) rather than the rounded
  azimuth/elevation/distance of the API-facing `getCameraState`, so the restore
  is lossless.
- Added `captureCameraToPreserve()` + a `lastFramedSessionId` tracker in
  `main.ts`. It returns the live pose **only** when a model is already on screen
  *and* we're staying in the same session — so the first render of a
  freshly-opened session still auto-frames, and opening a different session
  doesn't inherit the previous session's odd angle. This same-session gate is
  the safety net.

**Scoping — why an explicit `preserveCamera` opt on `runCodeSync`**: The naive
fix (preserve on every same-session re-render) broke genuine new-code runs:
`partwright.run(cube)` after a default-code session kept the stale (larger)
framing distance, leaving the new model mis-framed (caught by
`viewport-reset-view.spec.ts`). Version switches and plain re-runs both flow
through `runCodeSync`, so they're indistinguishable there. Resolution: gate the
preserve behind an explicit `opts.preserveCamera`, passed **only** by the
version-switch call sites — `loadVersionIntoEditor` (cache-miss),
`partwright.loadVersion`, `partwright.navigateVersion`, and the post-merge
active-version re-render. The cache-hit branch of `loadVersionIntoEditor`
(direct `updateMesh`, no `runCodeSync`) is covered by a capture/restore around
the function body. Genuine runs keep auto-framing.

**Note**: `setValue` already cancels the debounced auto-run on programmatic
value-sets, so there's no 300ms reframe echo to fight after a version load.

**Verification**: New `tests/viewport-camera-persistence.spec.ts` — one test
asserts angle+distance survive a version switch (via both console API and the
UI prev-arrow during dev), another asserts a freshly-opened session still
auto-frames (doesn't inherit the prior angle). Re-ran the camera-adjacent specs
(`viewport-reset-view`, `version-nav-language`, `thumbnail-camera`,
`paint-camera-passthrough`) — all green.
