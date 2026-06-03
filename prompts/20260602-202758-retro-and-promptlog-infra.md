---
session: "retro-promptlog-infra"
timestamp: "2026-06-02T20:27:58Z"
tools: [subagent-none, github-mcp, playwright-none]
---

## Human

Two related requests in one session:

1. Design a system where agents "retro" periodically when they complete a
   task, noting how things could be improved so they work better/faster/more
   reliably. Examples of pain: stale instructions (a since-removed pointer to a
   Playwright MCP that didn't exist), agents misunderstanding the human or not
   finishing all agreed tasks. Open to hooks. Updating agent instructions is
   assumed to be part of it.
2. After building the retro loop: "my prompt summary task hasn't been happening
   and I haven't written a prompt in a while. Why is that?" — then, on
   diagnosis, fix it via a harness hook + CLAUDE.md instruction.

## Assistant

## Key decisions

**Retro loop: capture cheap, promote deliberate, human-gated.** Split into a
low-friction append-only capture step and a deliberate weekly promotion step,
with a human PR-review gate between them. This avoids the three failure modes
of naive self-improvement: instruction bloat, write-only logs nobody acts on,
and one-off mistakes hardening into permanent rules.

**4-Ls framing (Liked / Lacked / Learned / Longed for)** over a plain
incident-report format, because the human explicitly wanted engineering-DX
*ideation* ("what would have made delivery faster"), not just postmortems. The
"Longed for" bucket is where the highest-value tooling ideas live; "Liked"
protects good setup from being stripped by over-correction.

**Frequency across independent agents = the vote count.** The weekly facilitator
(`/retro-review`) clusters entries and weights by how many distinct sessions hit
a theme — that's what separates systemic friction from noise, mirroring how a
human team retro aggregates opinion.

**Scheduling via a Claude Code web scheduled trigger, not a GitHub cron** (the
human's call). The weekly worker is then just a skill the trigger points at.

**Promptlog root-cause: a skill on disk doesn't run itself.** Diagnosed that
prompt logging stopped because its *only* trigger was a lefthook `pre-commit`
git hook that never installs in ephemeral web/remote sessions (no `npm install`
→ no `lefthook install` → empty `.git/hooks`; lefthook isn't even a dep
anymore). And even when it fired, it only *gated* commits — it never *wrote* the
log, and nothing in CLAUDE.md told agents to. 0 of the last 15 commits carried a
prompt log; the last real ones were ~May 28, right when work moved to the web
environment.

**Fix mirrors the retro lesson: drive automation from the harness, not git.**
Reimplemented the lefthook rule as a `PreToolUse` guard
(`.claude/hooks/promptlog-guard.sh`) that denies any `git commit` touching
non-prompt files without a staged `prompts/*.md`, with a `--no-verify` escape
for mechanical commits — plus a standing CLAUDE.md instruction so the workflow
is discoverable, not just enforced. Chose a tested script file over a fragile
JSON one-liner; verified deny/allow across non-Bash, non-commit, `commit-tree`,
`--no-verify`, missing-log, and log-staged cases.

**Packaging:** folded the promptlog fix into the retro PR (#404) since both are
the same theme — "agent self-improvement infra: skills need a harness trigger to
fire" — rather than opening a second watched PR.
