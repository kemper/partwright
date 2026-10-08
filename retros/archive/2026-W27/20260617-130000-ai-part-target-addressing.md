---
date: 2026-06-17
task: give AI tools an explicit part target instead of the implicit current-part pointer (PR #719, follow-ups #720)
---

## Liked
- The dispatch in `tools.ts` was a single choke point: every tool routes through
  `executeTool` → `dispatch`, so the part-switch concern dropped in as one
  cross-cutting block instead of ~50 per-tool edits. Injecting the shared `part`
  schema prop with a post-array loop (guarded by a `PART_TARGETABLE_TOOLS` set)
  kept the description in one place and out of 50 hand-edits.
- The e2e harness's `import('/src/ai/tools.ts')` + `executeTool(...)` pattern let
  me test the *real* tool dispatch (not just the console API) headlessly — the
  three-test spec exercised name/index/error/commit-isolation in ~25s.

## Lacked
- No typed link between a tool's schema and the API method it dispatches to, so
  "which tools are part-scoped" is a hand-maintained set that can silently drift
  as tools are added. Same root gap CLAUDE.md notes for UI↔API parity (no shared
  capability registry).
- The Gemini schema sanitizer quietly coerces typeless props to `string` — fine
  here (Gemini loses only index addressing) but it's a non-obvious provider
  asymmetry I only caught by reading `sanitizeSchemaForGemini`. Nothing surfaces
  "this schema means different things to different providers."

## Learned
- The fragility the user spotted ("select part → get current part") was really a
  symptom of *shared mutable state between two actors in one tab* — the same
  bleed CLAUDE.md guards against across tabs, but the in-tab user↔agent case
  isn't called out. Worth a sentence in the cross-tab-isolation section.
- Switch-then-act has a hidden trap: reloading a part clobbers an in-progress
  editor draft. The no-op-when-already-current guard is load-bearing, not an
  optimization.

## Longed for
- A capability registry both the UI/command-palette and the AI tool layer derive
  from, so part-scoping (and gating, and parity) is structural rather than three
  hand-kept sets. That's the real fix for #720's whole class.
- A lint that flags AI tools which pass `input` straight to an unknown-key-
  rejecting API but aren't covered by a key-stripping step — I had to reason
  manually that `delete input.part` was needed before the pass-through APIs.
