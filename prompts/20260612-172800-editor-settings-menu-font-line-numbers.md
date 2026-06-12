---
date: 2026-06-12
branch: claude/quirky-hypatia-2gegil
title: Consolidate editor toggles into a ⚙ settings menu; add font size + line numbers
---

## Human

Follow-up on the line-wrap PR: add font-size and line-numbers toggles, and move
the editor settings (Format, Auto-format, Word wrap, + the new ones) into an
"editor settings" submenu.

## Assistant

Added two new editor controls and collapsed all editor settings into a single
"⚙ Editor" popover in the editor-pane header.

Key decisions:

- **New controls follow the line-wrap pattern**: `getLineNumbers` / `setLineNumbers`
  and `getFontSize` / `setFontSize` in `codeEditor.ts`, each backed by a CodeMirror
  `Compartment` that reconfigures the live editor, with the value persisted per-tab
  (`editor-line-numbers`, `editor-font-size`) like the existing prefs.
- **Line numbers** are hidden via a scoped `.cm-lineNumbers { display: none !important }`
  theme rather than rebuilding `basicSetup` without its bundled `lineNumbers()`.
  The `!important` is required because CodeMirror's core gutter style is itself
  `display: flex !important` — verified in-browser (computed display went `flex` →
  `none` only after adding it). The fold/lint gutters stay.
- **Font size** moved out of the editor's base theme (was a hardcoded `13px`) into
  a `fontSizeCompartment`. The default/min/max are tunable knobs, so per the repo's
  no-hardcoded-constants rule they live in `appConfig.ui`
  (`editorFontSizeDefault/Min/Max`) and are exposed in the Advanced Settings modal.
  The live size is a per-tab pref clamped to those bounds; the −/+ stepper disables
  at the edges.
- **The ⚙ popover** is a self-contained dropdown in the editor header (open/close +
  click-outside + Escape, sticky on inner clicks), mirroring the toolbar
  Import/Export dropdown convention and reusing `createMenuSectionHeader` /
  `createMenuDivider`. Find/Replace and Hide-code stay as header buttons (they're
  actions, not settings). Toggles render as compact On/Off pills via one shared
  `syncTogglePill` helper.

Verified in-browser (throwaway Playwright spec, since deleted): opened the menu,
bumped font 13→17 px, toggled line numbers off (gutter hidden) and word wrap on;
screenshotted the result. build + 1273 unit tests + lint:deps (no cycles) green.
