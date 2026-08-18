---
session: "b54a9fd7-c080-5604-9695-76474d7be26b"
timestamp: "2026-08-18T00:15:55Z"
model: claude-sonnet-5
---

## Human

[Scheduled task] Run the `/retro-review` skill for `kemper/mainifold`: read
`retros/inbox/`, cluster entries by theme weighting distinct sessions/agents
as votes, apply confident process diffs to `CLAUDE.md`/`docs/`/`.claude/skills/`,
backlog anything needing new tooling or `.claude/agents/`/hook changes, write
a durable report to `retros/reports/{YYYY}-W{ww}.md`, archive the processed
entries, and open a draft PR into `main` titled `chore: weekly retro {YYYY}-W{ww}`
with the `ignore-for-release` label, then stop. Finish by sending a summary to
a configured Telegram channel.

## Assistant

## Key decisions

**Scope of the batch:** 12 inbox entries spanning 2026-07-03 → 2026-07-20,
unprocessed since `2026-W27`. Split into two clusters: general app-feature
work (assembly view, tool-history repair, Blender-parity verbs + a 16-sub-agent
catalog-refresh aggregation, 3MF packing) and the `scripts/inverse-cad/`
reconstruction subsystem, which already carries its own self-updating
`PLAYBOOK.md` — treated as out of this report's CLAUDE.md/docs editing scope,
its asks captured as backlog items instead.

**Two direct diffs applied** (both cheap, concrete, and either a repeat-offender
count-bump or a natural extension of an already-established doc pattern):
1. `CLAUDE.md`'s NUL-byte `main.ts` section now says explicitly that the
   dedicated `Grep` tool has no `-a` escape hatch at all (a session burned a
   call finding that out) — go straight to Bash `grep -an`/`rg -a`. Bumped the
   "N independent sessions" counter from three to four.
2. `docs/playwright-guide.md` gained a numbered item: short scrollable lists
   clip drag targets below the fold at the default viewport; bump viewport
   height for rail/list drag specs. This is the same failure shape as the
   file's existing viewport-clipping gotcha, so it was safe to add from one
   session's report without over-generalizing.

**Left as backlog, not applied directly:** a warm-browser UI iteration loop
(2 votes this batch, recurring across prior cycles, but real infra, not a doc
fix); a headless plate-layout-to-PNG visualizer (2 independent PRs, #910 and
#904, same root wish as `model:preview` but for packing); a multi-method
component-count reconciler; several inverse-CAD-specific asks (orchestration
driver, gate-change re-validation stamping, `probe.mjs` raw-points output,
durable subagent workspaces). Two one-off asks (Worker init/ready-handshake
docs, `main.ts` module-scope-vs-setup-scope docs) were each raised by exactly
one session — noted but not hardened into a permanent doc addition per the
skill's anti-bloat rule ("don't add a rule for a one-off").

**Already-resolved items confirmed, not re-applied:** `model:preview --json
--silent`, `deform.md`'s round-first/paint-after rule and `api.paint.slab`'s
one-sided band, and the `promptlog-guard` compound-commit sequencing note —
all verified present in the current tree; the retro entries that raised them
predate (or were concurrent with) the fixes landing.

Report: `retros/reports/2026-W34.md`. Archived all 12 entries to
`retros/archive/2026-W34/`.
