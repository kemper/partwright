---
session: "01QnZGNN9ZnQ4Din66rwmqU9"
timestamp: "2026-10-29T04:30:00Z"
tools: [playwright, vitest]
---

## Human

After the cost-controls PR merged, asked to start on the worker delegation tool from the tracking issue: the main (frontier) model hands work to a cheaper worker model to cut spend on long, iterative modeling sessions.

## Assistant

## Key decisions

**A tool the main agent chooses to call, not an automatic router.** `delegateTask` takes a self-contained `task`, a concrete `acceptance` check, and optional `context`/`maxSteps`. The main model keeps design decisions, ambiguity and user interaction. It delegates the iterate-to-a-number loops (run → render/measure → tweak) where most of the spend goes.

**The worker reuses runTurn rather than a new loop.** It is a nested `runTurn` in the same agent loop context, with new run options rather than a fork of the loop:
- `persist: false`, so its steps never enter IndexedDB or the transcript
- `maxIterationsOverride` and `spendCapUsd`
- `excludeTools`: no delegating, no askUser/proposePlan, since nobody is there to answer

It starts from an empty history with one brief, on the same session and tools, and the main chat's loaded tool groups are preloaded.

**Model choice.** It uses the same provider and API key, dropping to the provider's cheaper default (Sonnet 5.5 under Opus, GPT-5 mini, Gemini Flash). It keeps the main model when that is already no more expensive, or when either price is unknown: the fresh small context still saves the re-reads, and we don't guess prices. Local and Custom don't delegate; there's no cheaper tier.

**Getting a report out before the cap.** The last two steps get a countdown note appended to the tool-result turn through the existing `onDrainQueuedBlocks` hook. That's append-only, so the worker's cached history survives. Changing the system suffix per step would have broken the cache.

**Cost is accounted, not hidden.** The worker's spend is capped by min(worker limit, what's left of the session $ budget). It is added to the turn, and stored as `costUsd` on the tool-result message, so the session total and $ cap include it.

**Progress uses the tool phase.** The panel's stall watchdog only watches thinking/streaming. Showing worker activity as a tool step keeps the line informative ("worker · claude-sonnet-5-5 · step 2/4") and stops one slow worker call from aborting and re-running the whole delegation.

**Deferred** (tracked on #1206): a user-selectable worker model, showing the worker's steps in an expandable view, and measuring real cost and quality against the mask problem.

## Assistant

## Review follow-up

A review pass found eight gaps in this PR's own code. All are fixed in this push:
- **Stalled worker.** A stalled worker request would have hung the turn: worker progress uses the tool phase, which the panel's watchdog ignores. The worker now has its own stall timer (`ai.workerStallTimeoutMs`) on a chained AbortController that only counts model requests.
- **Crash or lost spend.** A throw in the nested loop would have crashed the main turn and lost the spend. `runWorkerTask` now never throws, and cost is summed per persisted step.
- **Confirm-gated tools.** Worker tools no longer include them. Otherwise the user would be asked to approve an action from a conversation they can't see.
- **Cut-off reports.** When the worker is cut off, its last message is flagged "not a final report" instead of passed off as the conclusion.
- **Session $ cap.** It is re-checked right after a worker's spend lands. No worker starts below `ai.workerMinBudgetUsd`, or on an unpriced model while a cap is set.
- **Main cache.** A main turn that offers `delegateTask` uses the 1-hour cache, so a long worker run doesn't make the next main request re-write the whole conversation. This trades 2× instead of 1.25× on new cache writes for avoiding a full re-write after long runs.
- **Nothing in scope.** No `delegateTask` when the scope toggles let nothing change the model.
- **Nits.** Only render-tool images count as the "last render". The tool schema is static, so it caches. The worker never thinks more than a user's Off/Low choice.
