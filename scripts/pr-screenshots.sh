#!/usr/bin/env bash
# Attach screenshots to a PR body without an image host — the fallback for
# environments where `gh pr comment --attach` can't run (cloud Claude Code
# sessions block GitHub GraphQL, which gh needs to resolve the PR).
#
#   npm run pr:screenshots -- test-results/feature-before.png test-results/feature-after.png
#
# Pushes the images to the shared, never-merged `pr-assets` branch (under a
# folder named after the current branch) and prints Markdown image links pinned
# to that commit's SHA — paste them into the PR body's "## Visual proof"
# section. Nothing is committed to your branch, so main's history stays free of
# screenshot commits whether PRs are merged or squashed.
#
# Uses git plumbing with a temporary index: your working tree, index and HEAD
# are never touched. Retries on a non-fast-forward push (another agent pushed
# to pr-assets at the same moment).
set -euo pipefail

ASSETS_BRANCH=pr-assets

if [ $# -eq 0 ]; then
  echo "usage: npm run pr:screenshots -- <image>..." >&2
  exit 2
fi
for f in "$@"; do
  [ -f "$f" ] || { echo "error: no such file: $f" >&2; exit 1; }
done

# owner/repo from the origin URL (https, ssh, or a local git proxy URL).
slug=$(git remote get-url origin | sed -E 's#\.git$##; s#.*[:/]([^/]+/[^/]+)$#\1#')
folder=$(git rev-parse --abbrev-ref HEAD | tr '/' '-')
stamp=$(date -u +%Y%m%d-%H%M%S)

GIT_INDEX_FILE=$(mktemp)
export GIT_INDEX_FILE
trap 'rm -f "$GIT_INDEX_FILE"' EXIT

commit=""
for attempt in 1 2 3 4; do
  parent=""
  if git fetch -q origin "+refs/heads/$ASSETS_BRANCH:refs/remotes/origin/$ASSETS_BRANCH" 2>/dev/null; then
    parent=$(git rev-parse "refs/remotes/origin/$ASSETS_BRANCH")
    git read-tree "$parent"
  else
    # First use: start the orphan branch with a README explaining it.
    git read-tree --empty
    readme=$(printf '%s\n' \
      '# pr-assets' '' \
      'Screenshots linked from PR descriptions ("## Visual proof"), written by' \
      '`npm run pr:screenshots`. One folder per PR branch. **Never merge this' \
      'branch** — it exists so images can be linked by commit SHA without landing' \
      "in main's history." | git hash-object -w --stdin)
    git update-index --add --cacheinfo "100644,$readme,README.md"
  fi

  paths=()
  for f in "$@"; do
    path="$folder/$stamp-$(basename "$f")"
    blob=$(git hash-object -w "$f")
    git update-index --add --cacheinfo "100644,$blob,$path"
    paths+=("$path")
  done

  tree=$(git write-tree)
  commit=$(git commit-tree "$tree" ${parent:+-p "$parent"} -m "screenshots for $folder")
  if git push -q origin "$commit:refs/heads/$ASSETS_BRANCH" 2>/dev/null; then
    break
  fi
  commit=""
  echo "push to $ASSETS_BRANCH rejected (attempt $attempt) — refetching and retrying…" >&2
  sleep $((attempt * 2))
done

if [ -z "$commit" ]; then
  echo "error: could not push to $ASSETS_BRANCH after 4 attempts" >&2
  exit 1
fi

echo "Pushed to $ASSETS_BRANCH at ${commit:0:7}. Paste into the PR body:" >&2
for p in "${paths[@]}"; do
  name=$(basename "$p" .png)
  echo "![${name#"$stamp"-}](https://github.com/$slug/blob/$commit/$p?raw=true)"
done
