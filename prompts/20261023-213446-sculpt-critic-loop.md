---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T21:34:46Z"
tools: [subagent, git-worktree]
sequence: 3
---

## Human

Do all remaining follow-ups of #1056.

## Assistant

## Key decisions

**Checklist, then numbers, then eyes at checkpoints.** The sculpt loop used a fixed pass budget, and the agent judged its own renders, so it drifted and plateaued around IoU 0.87–0.88. The skill and the `model-sculpt` agent now work like this:
1. Extract a 5–10 item feature checklist once, up front.
2. Make one change per pass, kept or reverted by the multi-view photo-match score (noise floor about 0.005) and by checklist regressions.
3. Stop on a plateau rather than a pass count.

**The critic is a separate, read-only agent, called by the skill.** Subagents can't spawn subagents. So `/sculpt` orchestrates: `model-sculpt` runs until a plateau and returns, `model-critic` (Read + Bash only) renders at the reference angles and returns a ranked top-3 fix list, then `model-sculpt` resumes with those fixes. The critic spends image tokens, so it is documented as checkpoint-only (plateau, or about every 5 passes).

The in-app AI gets the same loop in `public/ai/reference-images.md`, adapted to the browser API (session notes for the checklist, `loadVersion` to revert, `renderView`/overlay at checkpoints). CLAUDE.md documents the new CLI flags.
