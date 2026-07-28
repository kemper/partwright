---
session: "f3a9c1e2"
timestamp: "2026-07-28T00:00:00Z"
model: claude-sonnet-5
---

## Human

Run the /retro-review skill for kemper/mainifold: read every entry in
retros/inbox/, cluster by theme weighted by cross-agent frequency, apply
confident process diffs to CLAUDE.md/docs/skills (preferring edits over
appends), file anything needing new tooling or agent/hook changes as backlog
items, write a durable report to retros/reports/{YYYY}-W{ww}.md, archive the
processed entries, and open a draft PR titled "chore: weekly retro
{YYYY}-W{ww}" with the ignore-for-release label — then stop for human review.

## Assistant

## Key decisions

**Scale of this run**: a normal-sized batch — 12 entries spanning
2026-07-03 through 2026-07-20, all readable directly without needing a
fan-out of digest agents (unlike W27's 95-entry backlog catch-up).

**Two subsystems intentionally left untouched**: `scripts/inverse-cad/PLAYBOOK.md`
is a living document the inverse-sculpt agents themselves append to after
every converged part ("ready to append here" is literally in its own
instructions) — three sessions (v2, armor-genericity, benchy) raised
orchestration/bookkeeping gaps there, but editing that file isn't this
skill's job; it's out of the CLAUDE.md/docs/skills scope and the agents
already own its update loop. Filed the orchestration-driver ask as backlog
instead. Similarly left `deform.md` alone even though the catalog-refresh
entry (16 aggregated agents) raised heavy scatter/round/smoothWeld friction
— that entry states the doc was already updated within the same PR batch
for the parts that were doc-fixable; the remaining asks are API/tooling
changes tracked at #928, not documentation gaps.

**Two 1-session items got direct fixes anyway**: the NUL-byte `main.ts`
grep guidance and the rail/list-drag viewport gotcha each had only one
vote, but both were zero-ambiguity corrections (one told agents to reach
for a `Grep` tool flag that doesn't exist; the other was a specific,
cheap, one-line addition to an existing numbered gotcha list) rather than
new rules for one-off preferences — consistent with W27's same call on
similarly low-vote items.

**New CLAUDE.md content instead of just a backlog note**: added a callout
about self-touching/degenerate meshes making `decompose()` and mesh-vs-solid
genus non-deterministic, sourced from three independent sessions (benchy,
multipart-kits-overview, catalog-refresh) hitting the same underlying fact
from different angles. This is a "Learned" empirical fact that belongs
in the same genre as the surrounding componentCount/voxelPieceCount
guidance, not a process-instruction change — but the skill's in-scope list
(CLAUDE.md/docs/skills) covers it and it's the kind of content that section
already exists to hold. The tooling asks that came with it (a headless
"count three ways" diagnostic, a genus-change flag) went to backlog since
they require new stats fields.

**Confirmed rather than re-fixed**: the promptlog-guard sequencing issue
recurred in one entry (part-grouping) despite W27 already adding a CLAUDE.md
clarification for it. Grepped the current file to confirm the fix is still
there and accurate — it is — so this is muscle-memory catching up to an
already-correct doc, not a doc gap. Noted in the report, no new diff.
