#!/usr/bin/env bash
# PreToolUse guard for `git commit`.
#
# Requires a prompts/*.md log to be staged whenever a commit changes
# non-prompt files. This is a harness-level re-implementation of the lefthook
# `prompt-log` pre-commit rule (see lefthook.yml), which never fires in
# ephemeral web/remote sessions because git hooks aren't installed there
# (no `npm install`, no `lefthook install`, empty .git/hooks).
#
# Reads the PreToolUse JSON payload on stdin; emits a `deny` decision with a
# reason when the log is missing, otherwise stays silent (exit 0 = allow).
# See .claude/skills/promptlog.md for the workflow this enforces.

input=$(cat)

# Only inspect Bash tool calls.
[ "$(printf '%s' "$input" | jq -r '.tool_name // empty')" = "Bash" ] || exit 0
cmd=$(printf '%s' "$input" | jq -r '.tool_input.command // empty')

# Only guard actual `git commit` invocations (not commit-tree, log, etc.).
printf '%s' "$cmd" | grep -Eq '(^|[^[:alnum:]_-])git[[:space:]]+commit([[:space:]]|$)' || exit 0
# Honor git's own escape hatch.
printf '%s' "$cmd" | grep -q -- '--no-verify' && exit 0

# Files staged for this commit (mirrors the lefthook rule's `--cached` check).
staged=$(git diff --cached --name-only --diff-filter=ACM 2>/dev/null | grep -v '^$' || true)

# Commit touches only prompt files (or nothing) -> no log needed (backfills).
nonprompt=$(printf '%s\n' "$staged" | grep -v '^$' | grep -v '^prompts/' || true)
[ -z "$nonprompt" ] && exit 0

# A prompt log is already staged -> allow.
printf '%s\n' "$staged" | grep -Eq '^prompts/.*\.md$' && exit 0

reason='This commit changes non-prompt files but stages no prompts/*.md log. Per the promptlog workflow (.claude/skills/promptlog.md), write a sanitized prompt log at prompts/{YYYYMMDD-HHmmss}-{slug}.md capturing the human request and your key decisions behind these changes, stage it, then commit again. For a genuinely mechanical commit (merge/rebase/backfill) that needs no log, re-run the commit with --no-verify.'
jq -nc --arg r "$reason" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$r}}'
