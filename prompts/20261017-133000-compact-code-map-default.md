---
session: "019jZz"
timestamp: "2026-10-17T13:30:00Z"
tools: [work-reviewer]
---

## Human

The code editor is an unimportant part of most model production — I only look
at it when I'm curious how something is made. Instead of the code pane being
open by default, make it a skinny, Sublime/VS Code-style minimap ("the shape of
the file") that can also be hidden, with a button to switch to full code mode.
Use your judgment, review it afterwards, and open a PR.

## Assistant

## Key decisions

**Three desktop modes instead of two.** The code pane is now `'mini'` (new
default), `'full'` (the existing CodeMirror editor) or `'hidden'`, persisted as
`codeView` in the AI settings blob next to the legacy `editorCollapsed`. A
stored `editorCollapsed: true` carries over as `'hidden'`; anything else starts
on `'mini'` — the old "Show code" choice predates the map, so it isn't a vote
for the full editor over it. Mobile ignores the mode (its stacked Code pane
always shows the full editor; a side strip makes no sense there).

**Canvas minimap over a scaled CodeMirror.** The map renders the live doc as
1.5px-per-character syntax-colored bars on a canvas that only paints the visible
slice (sticky canvas inside a virtual-height scroller), so huge inline-data
files stay cheap and native trackpad scrolling still works. The CodeMirror view
stays mounted (hidden) so every existing code path that reads/writes the editor
is untouched.

**Own tokenizer, no new dependency.** Coloring uses a tiny line tokenizer in
`src/editor/minimapModel.ts` (comments, strings incl. multi-line template
literals, numbers, keywords, calls, properties) rather than Lezer's
`highlightTree`, which would have meant adding `@lezer/highlight` as a direct
dependency. At 1.5px/char a lexer is indistinguishable, and it's pure, so it's
unit-tested.

**Make the map useful, not just decorative.** Hovering peeks the real code
around the pointer (so "how is this made?" usually doesn't need the full
editor), clicking opens the full editor with the caret on that line, a blue
gutter tick marks the lines that changed since the map last rendered (a
prefix/suffix line diff; wholesale replacements like a session swap are
ignored) so an AI edit shows where it landed, and the editor's error panel is
mirrored as a footer badge since the panel lives in the hidden full editor.

**Fixed a latent splitter bug on the way.** The splitter carried `hidden md:flex`,
and `md:flex` outranks `hidden` at desktop widths, so "hiding" it never worked —
the old collapsed mode left a live, draggable strip too. Visibility now toggles
both classes.

**Parity.** `partwright.setCodeView(mode)` + `getViewState().codeView`, help()
entry, ai.md line, and three command-palette entries. The tour's first step now
targets the whole code pane and explains the map. The mini width is an
`appConfig.ui.codeMinimapWidthPx` knob exposed in Advanced Settings.

## Assistant

## Follow-up: CI + review fixes

**CI root cause:** many e2e specs did `document.querySelector('canvas')` /
`locator('canvas').first()` assuming the first canvas is the 3D viewport; the
minimap's canvas now precedes it in DOM order. App code never relies on this,
so the specs now scope to `#viewport-container canvas` (the same element they
got before) rather than reshaping the DOM around a test assumption.

**Review fixes:** mode buttons/palette commands are desktop-only (mobile ignores
the mode); the mobile branch cancels an in-flight slide timer so a breakpoint
flip can't stamp a desktop width on the stacked pane; the hover peek is
dismissed on any mode change / keyboard open; a zero-width (hidden) map no
longer rebuilds, so the "changed since you last looked" marker survives several
AI edits while hidden; tokenization is clipped to the drawable/peekable columns
(state still carried) so long inline-data lines don't allocate; the collapsed
parts-rail chip no longer covers the map header; a splitter drag cancels the
mini→full width animation and records the dragged width.

**fast-preview-color crop:** that spec sampled a fixed-pixel crop tuned for the
old 40%-wide editor; with the narrow map the viewport is wider and the figure
moved right. The crop is now centred on the viewport screenshot.
