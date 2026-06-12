---
date: "2026-06-12"
task: "chore: weekly retro-review 2026-W25"
pr: draft
areas: [retro, tooling, docs, process]
---

## Human

Run the `/retro-review` skill for the week. Read every entry in `retros/inbox/`, cluster by theme, apply confident process changes to CLAUDE.md, file tooling asks as backlog items, write a report, archive the entries, and open a draft PR.

## Assistant

16 entries spanning 2026-06-09 → 2026-06-11 (16 distinct sessions, ~35 sub-agents across the figure/surface/tooling feature wave).

**Why I applied what I applied:**

1. **`src/main.ts` NUL bytes** — 3 independent sessions each spent 4+ turns re-discovering this; the fix (grep -a, Python slicing) is trivial once you know it. Added a dedicated CLAUDE.md subsection so the next session gets it in one read.

2. **`build-catalog-entry.cjs` xvfb** — 4 sessions (highest frequency in this batch) re-derived the same `xvfb-run -a` incantation from scratch. Added it as a callout to the model:preview section. The deeper fix (auto-wrap in the script) is a backlog item — it's a code change, not a doc change.

3. **`send_later` unavailability** — 3 sessions noted the PR-watch loop silently stalled after the last push. The CLAUDE.md "After Opening a PR" section mentions `send_later` without noting it's unavailable in web/remote sessions. Updated step 1 with the Monitor-poll fallback.

4. **E2E label string rename** — 1 session, 2 CI rounds. A one-line pre-rename grep check would have caught both. Added to the E2E tier section; cheap and directly actionable from the doc.

5. **Schema-bump checklist** — 1 session, 1 full CI re-run missed test. Seven synchronized locations; only one was missed. Added a numbered 7-point checklist as a new "Session Schema Migrations" subsection.

6. **`model:preview -p` paramsSchema** — 1 session, ~15 min sunk before detecting by file-size comparison. Added a callout to the model:preview section documenting the paramsSchema requirement.

**What I put in backlog (not applied):**
- Tooling changes to scripts (`build-catalog-entry.cjs` auto-xvfb, `--max-genus`/`--require-labels` flags, `--joints` readout, SDF label surfacing)
- Code-level helpers (`setVersionCode`, `v.solidifyDiagonals`, `F.spanGrips`, scaffold script)
- Platform-level asks (`send_later` in web sessions)
- API design work (`figure.poseProbe`, sandbox index doc)

**Anti-bloat check:** Every CLAUDE.md addition replaced or extended an existing concept rather than appending standalone rules. Total net addition to CLAUDE.md is ~30 lines across 6 targeted locations.
