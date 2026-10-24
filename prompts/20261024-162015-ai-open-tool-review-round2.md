---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T16:20:15Z"
tools: [subagent, git-worktree, playwright]
sequence: 3
---

## Human

it would be cool if AIs could drive the partwright app and answer questions (even making tool modals appear that the user can then take control over with)

(Round-2 review of #1089: phone step-aside on re-open, proper surface panel teardown on re-open, detect-parts in-place bookkeeping, and nits.)

## Assistant

## Key decisions

**One explicit step-aside on phones.** A re-open or in-place prefill never re-fires the viewport-panel open listeners, so on the phone layout the chat stayed over a tool the AI had just staged. Programmatic opens now always run silently, and on a phone the registry calls a new `notifyPanelOpen()` exactly once after a successful open — covering a fresh open, a surface re-open, an already-open Quality panel and a detect-parts in-place prefill alike. A failed open leaves the chat alone.

**Replace a surface panel by closing it.** Re-opening used to detach the old panel's DOM only, so its teardown never ran and its in-flight stamp rasterization still believed it was live. The new panel now calls the old one's `close()` (preview, outline, pickers, drag handle, `panelClosed`). `runPreview` also checks `panelClosed` after each await; a preview that lands after its panel closed hands the viewport back — to the newer panel's own preview (it clears the stale mesh first, so a blocked region-mode preview leaves the real model up), or to the real model when no panel is open.

**Detect-parts method switch without touching the draft.** Staging a different detector in place now does the parts of `onMethodChanged` that aren't draft edits (clear the hovered preset preview and the carried denoise) and refreshes the pins hint; `buildParams` already re-renders the preset strip. The AI note goes right after the context line, and an in-place prefill without a note clears a stale one.

**Overlay modes only when nothing is docked.** `getOpenTool()` returns null when an unregistered docked panel (e.g. Customize) is up, so `getUiState().activeTool` reports `'other'` and `closeTool()` closes that panel rather than Measure beside it.

**prefillJson must be an object.** After parsing, `null`, arrays and scalars are rejected with an error naming `prefillJson`, before the API is called.
