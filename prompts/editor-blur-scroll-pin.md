---
session: "01AhYR"
timestamp: "2026-06-09T19:15:00Z"
---

## Human

When I scroll all the way down in the code pane (with a lot of code — my model
has 170 lines) and then click to drag a tool modal, the code in the editor
shifts up about 1 to 3 lines. It only seems to happen when scrolled all the way
to the bottom (couldn't repro at other line numbers); feels like a stutter, as
if the code updated when it didn't. Make sure scrolling to the bottom and using
other parts of the app doesn't cause that stutter. (Clarified: it happens any
time focus leaves the editor pane, in Chrome, with a clean model and no error
panel.)

## Assistant

## Key decisions

**Diagnosed it as a CodeMirror focus-change re-measure that re-clamps
max-scroll.** Built faithful headless reproductions of every interaction —
opening/dragging the tool modal, blurring the editor, window resizes, the error
panel appearing (shrinking the pane 605→319px) — across device pixel ratios
1/1.25/1.5/2 and both caret positions. In headless Chromium the editor's
`scrollTop` stayed pinned at the bottom in every case (zero swing). The symptom
profile — only at the very bottom, only real Chrome, on any blur, never in
automation — points to real headed Chrome running CodeMirror's deferred
focus-change pass (`observers.blur → updateForFocusChange → view.update([])`),
which re-measures and lets the browser re-clamp `scrollTop` at exact max-scroll,
nudging the visible lines. Ruled out browser scroll-anchoring (CodeMirror
already sets `overflow-anchor: none` on `.cm-scroller`) and the app's
onBlur work (`surfacePendingError` is a no-op for a clean model; `autosaveDraft`
is an IndexedDB write).

**Fixed it with a targeted scroll-pin guard rather than chasing the exact
trigger.** Since the nudge can't be reproduced in this sandbox, I made the
symptom impossible regardless of source: `pinScrollAfterBlur` in
`src/editor/codeEditor.ts` snapshots the scroll offset when the editor loses
focus and holds it for a short window, re-applying it if something moves it by
less than a few lines — so the nudge never paints. It is deliberately narrow:

- **Engages only at the very bottom** (within one line-height of max-scroll),
  where the bug lives — inert everywhere else, so mid-document focus changes are
  untouched.
- **Bails out on any genuine scroll** — user wheel / touch / pointer gesture, or
  a large programmatic jump (> 4 line-heights, e.g. reveal-diagnostic) — so it
  can never block real navigation.
- Thresholds are **line-height-relative** (`view.defaultLineHeight`), not magic
  pixels.

**Made the window a tunable config knob, not a hardcoded constant** (per the
repo rule): `ui.codeEditorBlurScrollPinMs` (default 180 ms) in `appConfig.ts`,
surfaced in the advanced settings modal, with `0` disabling the guard.

**Verification.** Couldn't reproduce the original jump headlessly (it's
real-display-specific), so I verified the *guard* instead with three e2e tests
(`tests/editor-blur-scroll.spec.ts`): a simulated small post-blur nudge at the
bottom is reverted; a large programmatic scroll after blur is honored; and away
from the bottom the guard stays inert. Build + full unit tier green. The user
should confirm the stutter is gone in their real Chrome.
