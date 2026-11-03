---
session: "01QnZGNL"
timestamp: "2026-10-29T22:45:00Z"
tools: [subagent]
---

## Human

In plan mode, the in-app agent immediately reinterprets my words and plans,
then often goes down a rabbit hole and burns a lot of money before it lands.
I want different kinds of planning the user can pick when they send the first
plan-mode prompt (a question card): the default interprets the instructions and
writes a detailed plan; another looks at attached photos / the existing model
with the tools first and reports feasibility. Warn me ahead of time: is this
easy, medium or hard, do you have the tools you need, how confident are you of
landing it within some number of turns, and what quality to expect.

Follow-up: open the tracking issue and do all three parts together (estimate
on the plan, the style picker with assessment, and the build checkpoint plus
calibration). The build checkpoint overrides the default / selected turn limit.

## Assistant

## Key decisions

**The model estimates rounds, the app prices them.** `proposePlan` gained an
optional `estimate` (difficulty, confidence, roundsMin/Max, quality, gaps,
risks). Dollar figures come from the app — rounds × this chat's recent average
priced round — because models are bad at pricing themselves and the app
already has per-message costs.

**The checkpoint is what stops rabbit holes, not the estimate.** Build starts
an in-memory `BuildBudget`; `RunTurnInput.iterationLimit` replaces the ⟲ cap
for every turn of that build (as the user asked), so the build pauses at the
plan's roundsMax with a checkpoint card (Keep going +N / Accept as is). The $
cap still applies as the global safety net. In-memory like the existing stop
notices — a reload drops back to the normal cap rather than inventing state.

**Three styles, not four.** Quick plan (today's behaviour), Assess first (the
user's option 2, capped at `ai.planAssessMaxRounds`), Compare approaches
(2–3 routes, user picks — the repo's own lesson for subjective work).
"Interview me" is already covered by askUser. Each style is its own user-turn
prefix so the transcript, export and review keep recognising plan requests.

**Grounded difficulty.** A `feasibility` readDoc subdoc maps typical tasks to
difficulty and round ranges so estimates aren't vibes. Kept out of ai.md's
subdoc table because the turn-0 prompt budget was already at its ceiling; the
plan-mode suffix points at it instead.

**Calibration.** Each finished/accepted/abandoned build records estimate vs
actual in a localStorage ring; once there are enough, the summary shows on
plan cards and rides along with new plan requests as a `[UI · app note]` so
the planner can correct for optimism.

**Tuning knobs** live in appConfig + Advanced Settings; the style preference
lives in AiSettings with a Plan mode section in AI Settings. No console API:
plan mode is a chat-panel feature with no existing `window.partwright`
surface.

**Review fixes (independent work-reviewer pass).** Checkpoint notices carry
their build's id so a stale card can never extend or end a later build; a
message queued during the build that hits its checkpoint counts as the
go-ahead and gets a fresh batch; the picked style is passed as an argument
(no module state to leak); "Assess first" is told its round budget and its
cap stop is labelled as the assessment, not the ⟲ cap; stalled watchdog
rounds aren't billed to the budget; the picker takes Escape/arrow keys and
has a 44 px close target on mobile. The ai.md subdoc-table row stays out:
the turn-0 prompt budget test is at its ceiling.
