---
date: 2026-09-30
branch: claude/modest-ptolemy-mls6fe
files_changed:
  - src/ai/reviewPrompt.ts
  - src/ai/review.ts
  - src/ai/autoReview.ts
  - src/ai/settings.ts
  - src/ui/aiReviewPromptModal.tsx
  - src/ui/preact/settingsModal.tsx
  - src/ui/aiReviewModal.tsx
  - src/ui/aiPanel.ts
  - src/content/data/help.ts
  - tests/unit/reviewPrompt.test.ts
  - tests/ai-auto-review.spec.ts
---

## Human

Make the review bot's prompt visible and editable in the same settings that
let people edit the system prompt. Also tell me what the current review prompt
is and whether it can be improved — the reviews don't seem to have much effect.

## Assistant

Where it lives: the review prompt was a private constant in `review.ts`, with a
second "verdict" block appended only for automatic reviews. Moved both to a
dependency-free `src/ai/reviewPrompt.ts` so the settings UI and unit tier can
use them, and split it into two parts on purpose:

- **Rubric (editable)** — `DEFAULT_REVIEW_PROMPT`, overridable through a new
  `AiSettings.reviewPromptOverride` (null = default). Editor is a modal opened
  from AI Settings → Automatic review → "View / edit review prompt", mirroring
  the per-provider system-prompt button. Saving text identical to the default
  clears the override, so later improvements to the built-in reach users who
  never customized it.
- **Output contract (fixed, shown read-only)** — the `Verdict: pass | minor
  issues | needs rework` line. `parseReviewVerdict` drives the fix-round loop,
  so letting users edit it would silently turn the loop off. It's now appended
  to every review (manual 👁 too), which removes the old contradiction where the
  base prompt asked for a free-form verdict and the auto suffix overrode it.

Why the reviews were weak, and the changes made:
- The old rubric asked for "4-10 sentences" of prose with no checklist, and
  told the reviewer to pass anything that "satisfies the request as stated" and
  to ignore style. Same-model reviewers (the default) tend to agree with the
  builder, so this mostly passed. The new rubric is explicitly skeptical and
  walks a checklist: request coverage, dimensions against the bbox, structure
  (manifold, component count, floating/buried parts), appearance, and code
  features that aren't visible. It also requires evidence plus a numeric fix
  for each finding, and caps findings at 6.
- The fix-round prompt invited the agent to dismiss findings ("if you
  disagree, say why"). Now it asks the agent to work through the numbered
  findings in order, allows disagreeing only when the reviewer plainly misread
  the render or stats, and asks for a re-render from the view where each
  problem showed. It still points at the review above rather than repeating it,
  which keeps the existing e2e contract.
- `requireVerdict` was removed because the contract is always on now. The
  manual-review cost estimate uses the real prompt length.

Not done: no `window.partwright` method. The AI-settings prompt overrides have
never been on the console API (system prompts aren't either), so this follows
the existing precedent.

### Follow-up: review-pass nits

A read-only review of the diff found three small issues, all fixed:
- **Manual reviews without a request.** The rubric assumed the focus was always
  the user's request. It now says what to do with a narrow 👁 focus (answer it
  first, still flag anything seriously wrong) and with no focus at all (judge
  against the notes and the code's evident intent).
- **Truncated session note.** The `[REVIEW from …]` session note was cut at a
  hardcoded 600 characters, which would chop the new numbered findings. It's now
  `appConfig.ai.reviewNoteMaxChars` (default 2000), exposed in Advanced
  settings, following the repo rule that tuning constants go through config.
- **Blank prompt badge.** A blank editor showed "Custom" even though saving it
  reverts to the default. It now reads as the built-in default.
