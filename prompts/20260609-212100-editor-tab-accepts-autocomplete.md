---
session: "ggdpve"
timestamp: "2026-06-09T21:21:00Z"
model: claude-opus-4-8
tools: [playwright]
---

## Human

Can we make it where, when the autocomplete shows in the editor, if somebody
hits the Tab key, it accepts the autocomplete and automatically inserts the
autocomplete code/text for them?

## Assistant

## Key decisions

**Where**: The CodeMirror editor (`src/editor/codeEditor.ts`) builds on
`basicSetup`, which wires the autocomplete tooltip to accept on Enter but
leaves Tab unbound. The fix is a single keymap binding for Tab.

**How**: Added `acceptCompletionWithTab` — a `Prec.highest`-wrapped
`keymap.of([{ key: 'Tab', run: acceptCompletion }])` using `acceptCompletion`
from `@codemirror/autocomplete`. `acceptCompletion` is a Command that returns
`true` (consuming the key) only when a completion tooltip is open; otherwise it
returns `false` so Tab falls through to its normal behavior. `Prec.highest`
ensures it wins over the default Tab handlers basicSetup installs.

**Scope**: Wired into `initEditor` only (the main code editor). The companion
SCAD editor doesn't carry the manifold completions, so it's left untouched.

**Verification**: Confirmed in a real browser via Playwright — typing
`Manifold.cyli` opens the tooltip with `cylinder` highlighted, and Tab inserts
`cylinder()` with the cursor inside the parens. Added a permanent golden-path
test ("Tab accepts the highlighted completion") to
`tests/editor-autocomplete.spec.ts`. The test needs a short settle wait after
the tooltip appears before pressing Tab; `acceptCompletion` no-ops if the
completion state hasn't fully activated even though an option already shows as
aria-selected.
