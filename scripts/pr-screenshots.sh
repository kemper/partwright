#!/usr/bin/env bash
# Attach screenshots to a PR body without an image host — the fallback for
# environments where `gh pr comment --attach` can't run (cloud Claude Code
# sessions block GitHub GraphQL, which gh needs to resolve the PR).
#
#   npm run pr:screenshots -- test-results/feature-before.png test-results/feature-after.png
#
# Makes two local commits on the current branch: one adding the images under
# pr-assets/, one deleting them again (so they never reach main's tree), then
# prints Markdown image links pinned to the first commit's SHA. Paste those into
# the PR body's "## Visual proof" section and push. The repo merges with merge
# commits, so the pinned commit stays reachable after merge.
set -euo pipefail

if [ $# -eq 0 ]; then
  echo "usage: npm run pr:screenshots -- <image>..." >&2
  exit 2
fi
if ! git diff --cached --quiet; then
  echo "error: you have staged changes — commit or unstage them first" >&2
  exit 1
fi

# owner/repo from the origin URL (https, ssh, or a local git proxy URL).
slug=$(git remote get-url origin | sed -E 's#\.git$##; s#.*[:/]([^/]+/[^/]+)$#\1#')

mkdir -p pr-assets
names=()
for f in "$@"; do
  [ -f "$f" ] || { echo "error: no such file: $f" >&2; exit 1; }
  b=$(basename "$f")
  cp "$f" "pr-assets/$b"
  names+=("$b")
done

git add pr-assets
git commit -q -m "chore: add PR screenshots"
sha=$(git rev-parse HEAD)
git rm -rq pr-assets
git commit -q -m "chore: drop PR screenshots from the tree (kept in history for the PR body)"

echo "Screenshots committed at $sha and removed in $(git rev-parse --short HEAD). Push, then paste:" >&2
for b in "${names[@]}"; do
  echo "![${b%.*}](https://github.com/$slug/blob/$sha/pr-assets/$b?raw=true)"
done
