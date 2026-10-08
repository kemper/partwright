---
date: 2026-10-08
branch: claude/tender-bohr-jznj25
files_changed:
  - .claude/skills/*/SKILL.md (moved from .claude/skills/*.md)
  - .claude/skills/release/SKILL.md
  - CLAUDE.md
  - .claude/hooks/promptlog-guard.sh
  - docs/agent-tooling.md
  - retros/README.md
  - scripts/refreshModelsSnapshot.mjs
---

## Human

After the v1.5.0 release: "fix or improve the agent instructions … break up the
agent instructions into skills files if we haven't done so, then I want the
minimal agent instructions I would give to my weekly deploy agent."

## Assistant

Two problems surfaced. (1) `.claude/skills/release.md` was stale and *contradicted*
CLAUDE.md: it committed changelog edits onto a release branch cut from staging,
the exact drift `production-promotion-guard` exists to reject, and it never bumped
the version. (2) None of the 11 flat `.claude/skills/*.md` files loaded as skills,
because Claude Code only discovers `.claude/skills/<name>/SKILL.md` with
`name`/`description` frontmatter. `/release`, `/retro`, `/scope` etc. were
invisible to agents. After the move, every one appears in the skill list.

The release skill is rewritten from what actually happened shipping v1.5.0:
bump + What's New via main → wait for the gate → pure promotion PR → pre-merge
checks table with the two known exceptions (the guard is held as
`action_required` because the gate's bot pushes staging, so verify
`main..staging == 0` by hand; and the by-design CodeQL `new Function` sandbox
alerts, where any *other* alert stops the run). It also covers bypass-merge only
with explicit authorization, `expectedHeadSha` pins, no CI re-runs (403), live
verification via /whats-new, and rollback (Cloudflare rollback preferred; the
revert-PR path flags the revert-the-revert trap). It also says to stop on a major
bump, which needs the /vN/ mount work.

CLAUDE.md keeps the pipeline policy every agent needs. Only the "Release is
manual" step now points at `/release`, so the procedure lives in one place.
Path references were updated. Historical prompt logs were left as written.
The "Weekly retro" routine's stored prompt still names
`.claude/skills/retro-review.md`, so the user should update it, or the skill name
alone resolves it.
