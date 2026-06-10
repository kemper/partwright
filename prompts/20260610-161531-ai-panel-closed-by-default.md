---
date: 2026-06-10
author: kriskemper@gmail.com
title: AI panel starts closed by default
---

## Human

When the app opens it auto opens the AI pane which I now find annoying in
almost all circumstances. Leave that pane closed until someone opens it using
the AI buttons. If someone had it opened and refreshed keep it open (and vice
versa keep it closed if it was closed), but new sessions should start with it
closed.

## Assistant

The open/close state was already persisted correctly: `showDrawer` writes
`drawerOpen: true`, `hideDrawer` writes `drawerOpen: false`, and `initAiPanel`
honors `settings.drawerOpen` on load. The only thing forcing auto-open was the
**default** value of `drawerOpen` in `AiSettings` — it was `true` ("open on
first visit for discoverability"). So the whole request reduces to flipping that
default to `false`; the existing persistence handles "keep it open if it was
open / closed if it was closed" across reloads for free.

- `src/ai/settings.ts`: `DEFAULT_SETTINGS.drawerOpen = false`, with updated
  JSDoc on both `drawerOpen` and `editorCollapsed`. `editorCollapsed` falls back
  to `drawerOpen` (`editorCollapsed ?? drawerOpen` in `layout.ts`), so a fresh
  visit now also shows the code editor pane instead of collapsing it — the
  desired outcome when no AI panel is competing for space.

Tests assumed default-open, so I updated `tests/smoke.spec.ts`:
- `toolbar button toggles the drawer` — now asserts hidden-by-default, opens via
  the rail, then toggles closed.
- `connected: reopening via the rail …` — starts closed, opens once.
- `code pane defaults hidden when the AI drawer is open` — seeds
  `drawerOpen: true` (guarded so the `addInitScript` re-run on reload doesn't
  clobber the persisted `editorCollapsed`) to keep exercising the
  `editorCollapsed ?? drawerOpen` coupling.
- renamed `drawer close state persists` → `drawer open/close state persists`,
  now verifying both directions survive a reload.

Updated the now-stale "panel opens by default" comment in
`tests/helpers/aiPanel.ts` (the helper is idempotent, so it already worked for
both defaults). Verified with a browser screenshot (panel closed, code editor
shown on fresh load) plus the full smoke, ideas, persist, and diagnostics
specs.
