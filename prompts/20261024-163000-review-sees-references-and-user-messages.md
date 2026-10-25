---
session: "013nfM6KYN7MMLz7oViRYqp2"
timestamp: "2026-10-24T16:30:00Z"
tools: [playwright, git-worktree]
---

## Human

I used the second opinion / review button to review a model and it doesn't look
like it has access to the original information like uploaded images. Maybe being
able to read the chat transcript would be good too? The modal lists only current
code, geometry stats, session notes and a 4-iso snapshot. Does the automatic review
have access to more? — (after the answer) Yes, implement both: give the 👁 review
the reference images + request, and send the user's own messages to reviews.

## Assistant

## Key decisions

**Finding**: the manual 👁 review sent code + stats + notes + snapshot only. The
automatic review already sent up to 4 user-attached images plus the latest
request text. Neither saw the conversation.

**User messages only, never the agent's replies**: the automatic review is
deliberately "fresh context" — showing the reviewer the agent's own account of
its work anchors it. Sending only what the user wrote gives every requirement and
correction while keeping the reviewer independent. A compaction summary (agent-
written) stands in for deleted early turns but is explicitly labelled as such,
since otherwise those requirements would be lost.

**Pure helper `userConversation` in autoReview.ts** returns `{ messages, omitted }`
(not a marker string mixed into the list) so the modal can count messages and the
prompt can say how many were dropped. Budget keeps the newest messages; only the
newest is ever truncated. Skips tool-result carriers, image-only turns, the
carried-attachments note, auto-continue nudges and review follow-up prompts.

**Config + settings**: `ai.reviewConversationMaxChars` (default 12 000) in
appConfig + Advanced Settings; `autoReview.includeConversation` (default on) as a
"Latest request / All your messages" pill in AI Settings → Automatic review, which
also seeds the 👁 modal's checkbox. The existing reference-image count now applies
to both reviews (label updated).

**Modal**: reference images and user messages appear in "Reviewer will see" as
checkboxes (disabled when empty), and the cost estimate counts them.

## Human

(Follow-up driven by the self-review pass on the PR — no new human prompt.)

## Assistant

## Key decisions

**Plan-first mode**: the stored user text carries app-written plan instructions
("Do NOT … start building") and the approval turn is just "Plan approved.
Please proceed." Both would have reached the reviewer as "the user's words", and
the fixed focus line would have pointed at the approval turn as "the task just
finished". Moved the three strings into a leaf `src/ai/planMode.ts`
(byte-identical, verified against main) so `userConversation` and
`latestUserRequest` strip/skip them, and the automatic review's focus keeps the
pinned request (the original ask on approval) with the conversation as context.

**Compaction summary** is returned separately (`earlierSummary`) rather than
mixed into the messages, so the modal doesn't count it as "you wrote", the prompt
labels it as agent-written with a warning not to treat its account of the work
as evidence, and the copy says it's included. It's sent only when no user
message was dropped and it fits the budget.

**Local reviewer**: the 👁 modal starts the image/message extras off when the
reviewer is a Local model (small window) and warns if they're ticked.

**Checkbox focus**: `Item`/`Toggle` moved to module scope so a re-render doesn't
remount the inputs.

## Human

You have conflicts on the PR, please fix. (Then: move the PR to ready for review.)

## Assistant

## Key decisions

**Merge, not rebase** (branch already pushed). Conflicts: main added a `cfgKey`
prop to Advanced Settings fields (kept on all three review fields) and
`uiNoteBlocks` ahead of plan turns (kept, with the plan constants).

**Main's "[UI · app note]" blocks** are app-written lines prepended to a user
turn; read back naively they'd count as the user's words and break the
plan-prefix match. Renamed the new `planMode.ts` leaf to `userWords.ts`, moved
`UI_APPLIED_NOTE_PREFIX` into it (toolRegistry re-exports it, so its importers
are unchanged) and added `userWords(blocks)`, which drops note blocks and strips
plan wrapping per block. Also registered `ai.reviewConversationMaxChars` in main's
new `APP_CONFIG_FIELD_BOUNDS` table (its parity test caught the omission).
