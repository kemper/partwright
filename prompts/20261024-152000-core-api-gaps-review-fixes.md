---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T15:20:00Z"
tools: [subagent, git-worktree, playwright]
sequence: 3
---

## Human

I definitely want core operations available to the agents. (Review round on
PR #1088: undo-clear could resurrect another model's paint; importFromUrl from
the AI must not run remote model code; close the redaction gaps and redact the
user's saved keys; default AI imports to a new object when the session holds
work; refuse in shared previews; reset an unsaved simplify on failure; nits.)

## Assistant

## Key decisions

**Internal paint resets no longer feed "Undo clear".** `clearRegions` takes
`{ snapshot: false }`, which records nothing AND drops a pending snapshot. Every
internal caller in main.ts uses it: version/object load, rehydrate, simplify's
colour carry, fork. The relief "replace with detected levels" stays a user
action. Unit-tested, plus an e2e check: clear, switch object, undo, refused.

**The AI never imports code.** `importFromUrl` gains `geometryOnly`, which
refuses share links, session files and .js/.scad by URL extension before
fetching, and by Content-Type after. The AI dispatch always passes it, and the
error tells the model to ask the user to use Import → From URL… (which shows a
preview). The console API keeps full behaviour. The confirm dialog wording now
comes from one exported `describeToolConfirmation`, which names the target.
For 'current-object' it says COMBINE rather than REPLACE, because a mesh import
composes into the object rather than replacing it.

**Default AI target.** `aiDefaultImportTarget` uses the same "real work" test as
the import helpers: a saved version, or the editor no longer showing starter
code. That gives 'new-object' when there is work, else 'new-session'. Only a
'current-object' import counts as model-changing for auto-review, so
`isModelChangingTool` now receives the call's input.

**Redaction.**
- New pattern coverage:
  - start-of-string `key=`;
  - URL userinfo;
  - JSON values with escaped quotes, and stringified JSON;
  - distinctive key prefixes without a word boundary;
  - generic `sk-`/`hf_` behind a soft boundary that accepts `%3D`, so `task-…` words survive.
- Known secrets: `src/ai/db.ts` registers every key it loads or saves, and
  `getDiagnosticLog` (now async) first loads all saved keys. A custom endpoint's
  key of any shape is therefore replaced, verbatim and URL-encoded.
- Test fixtures are assembled at runtime so no key-shaped literal is committed.

**Smaller fixes.**
- Shared-preview refusals in merge, reorder and setCurvatureQuality.
- simplifyModel resets to the baseline when the save fails or the op throws.
- The level/source lists are tied to the ErrorLevel/ErrorSource unions with
  `satisfies`, and the tool enums are derived from them.
- `addStrokeAnnotation` returns `{error}` instead of throwing.
- API mesh placement no longer toasts and returns an error for the same failure.
