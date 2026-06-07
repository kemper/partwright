---
session: "noethr"
timestamp: "2026-06-06T14:20:00Z"
model: claude-opus-4-8
tools: [playwright]
sequence: 3
---

## Human

I started a new session and the hints didn't come back. [Clarified: had
dismissed them with ✕; wants starting/opening a different session to restore
them — ✕ should mean "not now, this session".]

## Assistant

## Key decisions

**Root cause.** The ✕ dismiss writes a per-tab `sessionStorage` flag
(`partwright-hints-hidden`) that survives reloads *and* new design sessions in
the same tab, so creating a new Partwright session left the hints hidden. The
user's mental model is that ✕ is scoped to the *design session*, not the
browser tab.

**Fix.** The ticker now listens for the app's `session-changed` event and calls
`showHintsTicker()` (which clears the per-tab dismiss + re-mounts) when the
session **id** transitions to a different non-null value. It seeds
`lastSessionId` from `getState()` at mount so the initial session load on page
open is *not* treated as a transition — a plain reload keeps a same-session
dismiss in place, only a genuinely new/opened session restores.

**Guarding against over-firing.** `session-changed` fires on every state change
(version navigation, save, part switches), so gating on an id change is
essential — otherwise navigating versions would immediately un-dismiss the
hints the user just closed. The permanent Settings off-switch still wins:
`showHintsTicker` → `refreshHintsTicker` re-checks `editorHintsEnabled`, so a
session change never overrides a permanent disable.

**Verified** by Playwright: dismiss with ✕ → `partwright.createSession()` →
the `#editor-hints` strip reappears. Added as a permanent e2e case.
