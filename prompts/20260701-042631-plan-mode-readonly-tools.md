---
session: "pt-plan-readonly"
timestamp: "2026-07-01T04:26:31Z"
model: claude-opus-4-7
---

## Human

I've noticed multiple times that during the AI chat's "plan" phase, the model
thinks it has access to no tools and so can't really plan around using the
built-in tools. Then once the plan is approved it gets tool access, but by
then the plan is already grounded in guesses.

Handed off a long flag-pole modelling chat where the model literally said "I
don't see any tools available to me in this session" during planning. Asked
whether the app should expose read-only tools during the plan phase, and
after agreeing, asked me to implement it.

## Assistant

## Key decisions

**The gap was real, not just a prompt problem.** `buildToolList` in
`src/ai/tools.ts` returned `[]` for `planFirst`, and the plan-mode suffix in
`src/ai/systemPrompt.ts` explicitly said "do NOT call any tools." So the
model wasn't just being told to hold back — the schema list it received was
literally empty. That's why the handoff session's Claude said "I don't see
any tools available."

**Introduced a distinct `PLAN_MODE_TOOLS` set instead of reusing
`ALWAYS_AVAILABLE`.** The always-available set already lists a bunch of
mutating tools (`setCode`, `modifyAndTest`, `forkVersion`, `createPart`/
`deletePart`, `importImageAsRelief`, `setActiveLanguage`,
`setPrinterSettings`, `setReliefPreviewMode`), so I couldn't just reuse it.
Enumerated only the pure reads: getCode, getSessionContext, listVersions,
getGeometryData, getMeshSummary, listComponents, listLabels, listRegions,
listSessionNotes, readDoc, findFaces, probePixel, probeRay, sliceAtZVisual,
paintPreview (a dry-run), paintExplain, assertPaint, checkPrintability,
getPrinterSettings, listParts, getCurrentPart, query, and a few others.

**Kept renderView/renderViews on the plan-mode list, but still gated on the
Views vision toggle.** They snapshot the *current* saved geometry — no code
execution, no mutation — so they're safe. But images are the biggest token
cost in an agent turn, and the user's vision-off preference should still win
during planning. Belt-and-suspenders: the panel already forces all scope
toggles off for plan turns.

**Explicitly excluded runCode / runAndAssert / runAndExplain / runIsolated
from plan mode.** Even though those are read-safe (they don't commit), they
*execute arbitrary code* — which is exactly what "plan" is meant to defer.
Same reasoning for setActiveLanguage (non-destructive but still a state
change).

**Updated the plan-mode system-prompt suffix and both aiPanel plan prefixes**
to say "inspect freely, but do NOT mutate, execute code, or start building"
instead of "do NOT call any tools." Added a nudge to inspect only what's
needed to ground the plan — the main tradeoff of enabling reads is that a
model that *can* inspect *will* inspect, and fanning out on a greenfield
request wastes tokens before any work is approved.

**Left the `chatLoop.ts` malformed_function_call fallback in place** but
updated its comment — if the model tries to call a mutating/execution tool
during planning it still trips this path because that tool isn't in the
turn's schema. Behavior is unchanged; the rationale just no longer refers
to an empty tool list.

**What I skipped**: didn't add a per-tool `readOnly` capability tag (the
more structural design). An explicit `PLAN_MODE_TOOLS` set is smaller,
grep-able, and matches the existing gate-set style (RUN_GATED, SAVE_GATED,
PAINT_GATED). Worth revisiting if we grow more "read/write/execute" axes
where the current sets become fragile.
