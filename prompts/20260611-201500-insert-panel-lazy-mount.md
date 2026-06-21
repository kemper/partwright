---
session: "aiK0c"
timestamp: "2026-06-11T20:15:00Z"
sequence: 2
---

## Human

(CI follow-up on PR #205.) All three e2e shards failed.

## Assistant

## Key decisions

All 21 failures across the three shards traced to one cause: the insert palette
panel carries `role="dialog"` (the shared tool-panel chrome) and was appended to
the DOM at init, so an always-present *hidden* dialog made the app-wide
`[role="dialog"]` modal selector resolve to two elements. That broke a broad set
of unrelated specs — `dialogs`, `import-safety`, `export-safety`, `import-merge-url`,
`about-modal`, `feedback-a11y`, `ideas`, `paint-palette`, and
`tool-panel-consistency` (incl. "Escape closes the image-paint panel", whose
handler bails when any `[role="dialog"]` exists).

Fixed by mounting the panel **lazily on first open** (capture the host at init,
append in `openInsertPalette`), matching the other viewport panels — its hidden
dialog node never enters the DOM until the palette is actually used. Verified the
previously-red specs (dialogs/export-safety/import-safety/paint-palette/
tool-panel-consistency) plus the insert-palette suite all pass locally. This was
a latent issue the big main merge surfaced (main added many `[role="dialog"]`
tests); not introduced by the cross-engine feature itself.
