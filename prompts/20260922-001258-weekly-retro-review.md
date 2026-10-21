---
session: "b0b38be2"
timestamp: "2026-09-22T00:12:58Z"
model: claude-sonnet-5
tools: [scheduled-task]
---

## Human

[Scheduled task] Run the `/retro-review` skill (`.claude/skills/retro-review.md`)
for `kemper/mainifold`: read every entry in `retros/inbox/`, cluster by theme,
weight by distinct-session cross-agent frequency, apply confident process
diffs directly to `CLAUDE.md`/`docs/`/`.claude/skills/`, file anything needing
new tooling or agent/hook changes as backlog items in the report instead of
auto-applying, write `retros/reports/{YYYY}-W{ww}.md`, archive the processed
inbox entries, and open a draft PR into `main` titled
`chore: weekly retro {YYYY}-W{ww}` with the `ignore-for-release` label. Then
send a completion summary to a configured Telegram channel.

## Assistant

## Key decisions

**Inbox:** 12 entries (2026-07-03 → 2026-07-20), 12 sessions — one entry
(catalog-refresh-agent-feedback) itself aggregates structured feedback from 16
rework subagents, so several of its sub-items carry their own internal vote
count (e.g. 4 agents on scatter placement feedback).

**Applied directly** (frequency ≥2 sessions, or a single high-signal factual
fix cheap enough to not need a second vote):
- `public/ai/deform.md` — worked numeric example for scatter's `offset` vs.
  instance thickness (buried two agents' first-pass instances); a
  radius-as-%-of-edge-length rule of thumb for `round`; `mode:'concave'`
  documented as the CSG-seam retrofit tool (a technique discovered mid-batch,
  previously unwritten); the manual "local weld" recipe for `smoothWeld`/
  `round` on a small-feature-on-large-body assembly, as a stopgap until a
  `region`/bbox scoping option exists. Treated `public/ai/*.md` as in-scope
  "docs" alongside CLAUDE.md/`docs/*` since prior retro-review passes already
  edited this same file (visible from the entries' own "doc updated this
  batch" notes) and CLAUDE.md itself designates `ai.md`/subdocs as the
  developer-doc counterpart for the in-browser-AI audience.
- `CLAUDE.md` — clarified the `main.ts` NUL-byte search note: `grep -a`/
  `rg -a` is a Bash-only workaround, since the harness's own Grep tool has no
  `-a` flag and silently no-ops it (cost one wasted attempt in the source
  entry).
- `docs/playwright-guide.md` — added the rail/list-drag tall-viewport gotcha
  (cost two runs + a debug scratch in the source entry).

**Left as backlog, not auto-applied** (needs new tooling, `.claude/agents/`,
or hook changes — out of this skill's direct-edit scope): a warm-browser UI
iteration harness (raised across 3+ weeks now — top item), `scatter`
`placedCount`/dry-run (already #928, this batch quadruples the vote — no new
issue filed), `region`/bbox scoping for `round`/`smoothWeld`, a label
surface-exposure stat, an inverse-CAD orchestration/status driver, a
three-way component-count reconciliation tool, a fixed-`waitForTimeout`
lint rule, and a build-plate-layout rasterizer.

**One-offs, no action:** tool-history repair single-source-of-truth (already
#914), `gates.mjs` version stamping, durable-by-default subagent workspaces,
overview-modal keyboard nav, landing-grid composite thumbnails, a
`convertToCode` progress channel/headless CLI twin — each raised by exactly
one session this batch; noted in the report rather than hardened into a rule,
per the skill's explicit anti-recency-bias guidance.

Archived all 12 processed entries to `retros/archive/2026-W39/`, wrote
`retros/reports/2026-W39.md`, and will open the draft PR next.
