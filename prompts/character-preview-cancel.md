---
date: 2026-06-20
branch: claude/character-preview-cancel
files_changed:
  - src/main.ts
  - src/ui/characterCreatorPanel.ts
  - tests/character-creator.spec.ts
---

## Human

After merging the Character Creator (#804): "when I make changes I'm not sure
it's really cancelling. When I switch the presets at the top especially I don't
see the fast preview update right away and the render time takes a long time like
multiple renders stacked up or something."

## Assistant

Real bug. `partwright.buildCharacter`'s live-preview path called `runCodeSync`
directly, bypassing the cancellation that the interactive `runCode` path does.
A figure rebuild runs in the geometry Worker for ~20s, so switching presets
mid-build started a second build while the first kept churning — they contended
and stacked, exactly the symptom.

Fix:
- In `buildCharacter`'s non-save path, `cancelCurrentExecution()` (terminates +
  respawns the geometry Worker, the same call the Cancel button and `runCode`
  use) before the new `runCodeSync`, but only when `_running`, so an idle first
  preview doesn't needlessly restart the worker. `runCodeSync` already catches
  the resulting rejection and returns false, so no unhandled rejection.
- Panel: `preview({ immediate })` — discrete jumps (a character preset or the
  pose-preset dropdown) fire immediately instead of waiting out the slider
  debounce, so a preset switch shows its coarse fast-preview right away. Slider
  drags still debounce.

Verified in a real browser: switching presets mid-build logs
`[EngineWorker] Execution cancelled` once per switch (proof the prior build is
terminated, not stacked), and three rapid preset switches settle in ~25s instead
of ~60s+. Added a permanent regression test asserting a mid-build preset switch
triggers a worker cancellation.
