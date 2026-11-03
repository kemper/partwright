---
date: 2026-10-28
task: api.headform metric head proxy; main red after parallel merges
pr: kemper/partwright#1191
---

**Liked:** Testing the docs' own recipe verbatim in the e2e spec. It caught
that the mask example's 2 mm `api.offset` was below the lattice minimum, so the
docs would have shipped a recipe that errors. Snapping landmarks onto the
surface with a sign-change walk made "on the skin" a guarantee rather than a
tuning target.

**Lacked:** A check on the merged result. Three PRs, each green on its own
branch, landed within minutes. Together they left four tools outside every
tool group and pushed ai.md over budget, so main's unit tier went red after
the merge with nobody's PR ever failing.

**Learned:** The tool-group and prompt-budget tests are cross-PR invariants: any
PR that adds a tool or ai.md text can break them only in combination with
another. After merging main into a branch, re-run `npm run test:unit` and don't
rely on the branch's last green run.

**Longed for:** A merge queue, or a "re-test against current main" step before
merge, for the unit tier at least (it's ~1 min). Also a subdoc registry
derived from `public/ai/*.md`, so a new doc can't be silently unreadable;
readDoc("enclosure") and readDoc("knurl") were rejected until this PR.
