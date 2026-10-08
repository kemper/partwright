---
date: 2026-10-08
branch: claude/modest-ptolemy-mls6fe
files_changed:
  - src/ai/reviewPrompt.ts
  - src/ai/autoReview.ts
  - src/ui/preact/settingsModal.tsx
---

## Human

Yes — recalibrate the review prompt and rerun the 20 verified catalog entries.

## Assistant

The full-catalog evaluation (kemper/partwright#983) showed the reviewer's
precision was decent but its calibration was off: 159/160 entries failed
(1 pass / 139 minor / 20 rework), so in-app nearly every task would trigger a
fix round, mostly for subjective notes (38% of findings were
proportion/pose/style). The 6-finding cap was padded with "render more views",
restated stats warnings and "X is correct" lines (6% of slots 1-2, 36% of slots
5-6). Changes:

- **Verdict semantics are explicit.** "pass" = no defects; "minor issues" = at
  least one objective defect with the core request met; "needs rework" = a core
  feature missing or broken, or the model structurally unusable. A clean pass
  is called out as valid. "Assume there is at least one defect" is gone.
- **A defect is defined.** Missing/wrong requested feature, count or
  dimension; broken structure; printability blocker; wrong colour/label; code
  that contradicts its own params. Style preferences, things that couldn't be
  confirmed, and warnings the stats already carry are explicitly *not* defects.
- **No padding.** "As few as there are, zero is fine", max 6. Requests for more
  views are banned (the reviewer can't get them), replaced by one "Unverified:"
  line. Style ideas go in an optional "Notes:" list of at most 2 "- " bullets,
  which never affects the verdict and doesn't count as a numbered finding.
- **Causes are hedged.** Verifiers found the reviewer's numbers usually right
  but its stated causes often wrong (surfer, d20, castle-tower), so it now names
  a cause only when it can see it and marks inferences "likely". It also checks
  its arithmetic against the stats.
- The fix-round prompt tells the agent the Notes are optional, so a fix round
  doesn't spend its iterations on them.
- The verdict line format is unchanged, so `parseReviewVerdict` and the
  fix-round loop are untouched.

### Follow-up: v2 → v3 after the first rerun

I reran the 20 entries with verified ground truth, using identical inputs.
Numbered-finding precision rose from 39% to 94%, and findings per review fell
from 4.95 to 1.6. But the first recalibration over-corrected in two ways:
- **Recall fell (91% → 75%).** Small *measurable* defects were demoted to
  Notes: knob bore clearance, a param the code ignores, a buried dial pointer.
  The off-centre gear plate went missing entirely.
- **Verdict accuracy fell (16 → 13 / 20).** Every miss was too lenient: a
  finding said a named requested feature was missing or wrong (pipe-tee is a
  4-port cross, machine-knob has no finger grip), yet the verdict stayed
  "minor issues".

v3 targets both:
- **Measurable means numbered.** Any measurable problem is a numbered defect
  however small, and the categories are named so the model can recognise them.
  Notes are explicitly taste-only.
- **Verdicts are keyed to request features.** "needs rework" means any feature
  the request names is missing or wrong. "pass" requires zero numbered findings.
