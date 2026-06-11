---
session: "1kdce9"
timestamp: "2026-06-09T20:50:00Z"
model: claude-opus-4-8
tools: [playwright, vitest]
sequence: 4
---

## Human

Reported that an in-app AI used `api.surface.cable` and it "didn't appear to
work" — the AI then fell back to the bake tool call, which looked right.

## Assistant

## Diagnosis

`api.surface.cable` recorded correctly, but the texture was **gated behind the
Re-apply pill** — a UI affordance only a human can click. The in-app AI drives
via `runAndSave` + `renderViews()`; it has no way to press the pill, so its
render showed the untextured base mesh and it concluded the call failed and used
the baking `applyCableKnit` tool instead. This is a UI↔API parity violation
(CLAUDE.md: "anything a user can do from the UI, an AI agent can do through the
API").

## Fix

`surfaceErrors` already discriminates run kinds: the editor's live-typing
auto-run passes `surfaceErrors: false`; every explicit path (Run button,
`partwright.run`/`runAndSave`, version load) defaults `true`. So:

- **Explicit/console runs force the (memoized) compute** — `applySurfaceTextures`
  gained a `force` param; on a cache miss with `force` it computes the chain
  inline (progress modal) and swaps in the textured mesh, so an AI/console caller
  gets the real result with no extra step.
- **Only live-typing stays gated** behind the pill, keeping keystrokes snappy.
- Added a generation guard after the (awaitable) compute so a superseding run
  abandons the stale one.
- The Re-apply pill handler simplifies to "re-run the stored src" (which now
  force-applies). Docs (`ai.md`, `textures.md`) updated to tell agents that
  `run`/`runAndSave` apply textures automatically and the pill is human-only.

## Verification

E2e rewritten: a console run with `api.surface.cable` now returns a textured,
subdivided mesh (triangle count jumps, no pill). Browser-confirmed (73,728 tris,
no pill). Attempted to automate the human live-typing→pill path but CodeMirror
focus/overlay friction in headless made it flaky; the pill DOM logic is unchanged
and the gate trigger is covered by the unit memo tests + manual check. `tsc` +
936 unit tests green.
