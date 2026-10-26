---
session: "012KuBZA"
timestamp: "2026-10-26T20:30:00Z"
sequence: 1
---

## Human

Plan mode in the AI chat was hacked in by prepending a planning prompt. It usually
asks clarifying questions, but the only buttons are Approve and Reject; typing a
follow-up works but the buttons stay. On follow-up plans the model sometimes
ignores plan mode and just does the work. Propose an improvement that works across
the semi-arbitrary set of supported models (mostly modern frontier models). Then:
do both proposed PRs, starting with PR 1.

## Assistant

## Key decisions

**Root cause of "just does work"**: plan turns hid the mutating tools from the
tool list, but `executeAllWithRetry` ran any tool name the model emitted. After a
build, the history is full of `setCode`/`runAndSave` calls a model can copy. The
chat loop now refuses any call outside the turn's gated tool list (a plan-specific
message tells the model to finish its plan). Enforced against the permission-gated
list, not the custom-endpoint context trim, so small-context endpoints keep working
the way they did. This also closes the same hole for the Run/Save/Paint/Notes scopes.

**Questions vs plan**: a provider-agnostic text heuristic (`planReply.ts`) decides
whether a plan-mode reply ends in questions. It only changes the bar's label and
which button leads: "Build anyway" stays available, so a wrong guess never blocks
or misroutes a turn. The plan-mode suffix now asks the model to end with numbered
questions plus defaults, which both helps users and the heuristic.

**Approval carries the plan**: Build sends `[Plan approved — …]` + the last plan
reply, so the build turn is anchored to what the user approved and the switch from
planning is explicit. The old `PLAN_APPROVED_TEXT` is still recognised for saved chats.

**Display**: plan-mode user bubbles show the user's words under a small chip
instead of the app's instruction prefix; the approval renders as a one-line marker.
Plan turns now also carry the selected-part context, which they used to drop.

Structured `ask_user` / `propose_plan` tools are deferred to PR 2 (tracking #1142).
