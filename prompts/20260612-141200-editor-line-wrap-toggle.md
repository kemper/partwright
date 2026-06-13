---
date: 2026-06-12
branch: claude/quirky-hypatia-2gegil
title: Add line-wrap toggle to the editor header
---

## Human

In the editor view, asked for a small toggle at the top to enable/disable line
wrap, and to be told about any other common/useful editor toggles worth adding.

## Assistant

Added a "Wrap" toggle to the editor pane header, mirroring the existing
auto-format toggle exactly so the two read as a pair.

Key decisions:

- **Followed the auto-format pattern end to end** rather than inventing a new
  surface: per-tab persisted pref (`editor-line-wrap` via `readPerTabPref` /
  `writePerTabPref`), a CodeMirror `Compartment` (`lineWrapCompartment`) holding
  `EditorView.lineWrapping` so the live editor reconfigures without a rebuild,
  and `getLineWrap` / `setLineWrap` exports parallel to `getAutoFormat` /
  `setAutoFormat`. The button is created in `layout.ts`, surfaced through the
  `LayoutElements` return, and wired (sync + click) in `main.ts`, reusing the
  same on/off class constants for visual consistency.
- **Default off** — matches the conventional code-editor default (horizontal
  scroll), and persists per-tab so one window's choice doesn't flip another's,
  consistent with the cross-tab isolation rule.
- Verified in-browser with a throwaway Playwright spec: confirmed the
  `.cm-content` `white-space` flips `pre` → `break-spaces` on toggle and that a
  long line visibly wraps; deleted the scratch spec before committing.
