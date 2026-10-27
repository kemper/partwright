---
session: "012KuBZA"
timestamp: "2026-10-26T20:58:00Z"
sequence: 2
---

## Human

(Continuation of the plan-mode work: do both PRs, starting with PR 1.)

## Assistant

## Key decisions

A review pass over PR 1 found five problems; all fixed here.

**Pre-rename tool names**: `executeTool` still dispatches `listParts`, `changePart`, … on
purpose (old chats, models that reach for the old name), but they're not in `ALL_TOOLS`,
so the new offered-tools gate refused them. `LEGACY_TOOL_ALIASES` maps each to the tool it
stands for, and the gate checks that name.

**Which text is "the plan"**: the approval and the bar label now use all reply text after the
last user message (a plan, a render check, a sign-off), skipping error bubbles, stop notices
and compaction summaries. A refine turn that only errored falls back to the previous plan.

**Compaction**: the pending plan is anchored by history index, so auto-compaction is skipped
and `/compact` asks the user to build or discard first while a plan is pending. Chosen over
snapshotting the plan text because it also keeps Discard's index correct.

**Polite closers**: a plan ending with one "Does this look good?" is still a plan (one trailing
question after a list of non-question steps), and the prompt asks the model not to end
plans with a question.

Also: Build keeps the plan pending until preflight passes (a key-modal retry used to lose it)
and ignores double clicks; copying a plan bubble copies the user's words; `/export` and the
publish summary show plan turns as the user's words rather than the app's instructions.
