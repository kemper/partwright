---
date: 2026-07-10
branch: claude/ecstatic-ritchie-1hkqm0
files_changed:
  - CLAUDE.md
  - docs/playwright-guide.md
  - retros/reports/2026-W28.md
  - retros/archive/2026-W28/*.md (moved from retros/inbox/)
---

## Human

[Automated weekly trigger] Run the `/retro-review` skill: read every entry in
`retros/inbox/`, cluster by theme, weight by cross-agent frequency, apply
confident process diffs to CLAUDE.md/docs/skills, file anything needing new
tooling or agent/hook changes as backlog items in the report, write
`retros/reports/{YYYY}-W{ww}.md`, archive the processed entries, and open a
draft PR into main. Then send a summary to a configured Telegram channel.

## Assistant

## Key decisions

**Scope of the batch**: 9 unarchived inbox entries, spanning 2026-07-03 to
2026-07-07, from 9 distinct sessions/PRs (multi-part assembly view, tool-history
auto-repair, three inverse-CAD convergence phases, multi-part kits overview,
in-app mesh-to-code, part grouping, and two 3MF packing sessions). All had
actionable substance, so nothing was skipped as empty.

**Clustering and vote-weighting**: grouped by theme and counted distinct
sessions per cluster, per the skill's cross-agent-frequency rule. Two clusters
reached multi-session frequency and cost is high enough to warrant explicit
backlog items even though they need new tooling (out of scope for a direct
edit): a warm-browser harness for general UI iteration (2 sessions, plus
explicitly flagged as a recurring wish from prior retros — the strongest
signal in the batch), and an orchestration/convergence driver for
`scripts/inverse-cad/` subagent fleets (3 sessions).

**What I applied directly** (three single-session findings, but each cheap,
concrete, and clearly correct — no ambiguity to hedge on):
1. CLAUDE.md's NUL-byte `main.ts` section previously said "use `grep -a` or
   `rg -a`" without clarifying that the dedicated `Grep` tool has no `-a`
   flag at all — an agent burned a call trying it there first. Reworded to
   send agents straight to `Bash grep -a`/`rg -a`, and bumped the "N
   independent sessions" counter from three to four since this is a new
   session hitting the same class of trap via a different edge.
2. CLAUDE.md's messaging section described `showToast`'s *semantics* but
   never stated its actual call signature, so an agent guessed a positional
   `(msg, variant)` form and paid a typecheck round-trip. Added the real
   signature inline: `showToast(message, opts?)`, options as one object.
3. `docs/playwright-guide.md`'s "AI agent gotchas" list already had a
   viewport-clipping gotcha for the AI panel toggle strip; added a sibling
   entry for rail/list drag specs (parts-list rows sitting scrolled out of
   a ~55px-tall rail at the default viewport, silently no-op'ing the drag)
   since it's the same underlying failure mode and belongs next to the
   existing note rather than as a new section.

**What I deliberately left as backlog vs. one-off**: per the skill's
anti-bloat rule, single-session findings that would require new scripts,
`.claude/agents/*`, or hook/`settings.json` changes went to the Backlog
section rather than being auto-applied (a headless three-way component
counter, a headless plate-packing visualizer, a `waitForEngineReady`
readiness-poll helper, `Stop`-hook suppression during long agent waits).
Single-session findings that were narrow, inverse-CAD-tooling-specific, or
where a second data point would change the fix (e.g. the Worker
init/ready/error handshake gap, the `main.ts` module-scope-vs-setup-scope
friction) went to "One-offs noted" with no CLAUDE.md edit, to avoid
hardening a one-off into a permanent rule. The tool-history
four-implementations fragmentation was already filed as issue #914 by its
originating session, so I referenced it rather than re-filing.

**Report structure**: followed the skill's template exactly (What's
working / Top friction ranked / Changes applied / Backlog / One-offs).
Cited every claim back to its source entry by filename so a human reviewer
or `/issue-reconcile` can trace provenance.

**Process**: archived all 9 processed entries into
`retros/archive/2026-W28/` via `git mv` (preserving history, not rewriting),
confirmed `retros/inbox/` is back to just `.gitkeep`, and opened a draft PR
into `main` titled `chore: weekly retro 2026-W28` with the `ignore-for-release`
label, per the skill's step 8 — did not merge it.
