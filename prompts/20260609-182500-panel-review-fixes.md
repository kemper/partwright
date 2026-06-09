---
session: "ibcg08"
timestamp: "2026-06-09T18:25:00Z"
model: claude-opus-4-8
tools: [subagent]
sequence: 2
---

## Human

(Follow-up on PR #540, after the work-reviewer pass.) Address the reviewer's
should-fix and nit findings on the window-anchored draggable panels.

## Assistant

## Key decisions

**Clamp tool panels on open.** `position: fixed` made `max-h-[calc(100%-…)]`
resolve against the window, so on the short stacked mobile layout a tall tool
panel docked near the top could extend off-screen, and `createToolPanelShell`
(unlike the params panel) never clamped on open — only on a later drag/resize.
Added a `requestAnimationFrame(() => drag.clampIntoView())` after
`setInitialPanelPosition`, mirroring `paramsPanel`'s open path, so the panel is
pulled fully into the window immediately.

**Doc + class cleanup.** Corrected `openPopoverGroupById`'s docstring (re-opening
an already-open group is idempotent, not a no-op) and switched the two flagged
class strings (`TOOL_PANEL_CLASS`, the params-panel root) from `absolute` to
`fixed` so the source reflects the actual positioning model instead of relying
purely on the inline `style.position` override. Left the percentage `max-h`
values as-is: under fixed positioning `100%` already resolves to the window, so
they're equivalent to `vh` and the on-open clamp keeps panels on-screen.

Verified: build + unit (909) green; `customizer`, `viewport-toolbar-groups`,
and `place-model` (docked tool panel) e2e specs all green.
