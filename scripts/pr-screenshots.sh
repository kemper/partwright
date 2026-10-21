#!/usr/bin/env bash
# Attach screenshots to a PR without an image host — the fallback for
# environments where `gh pr comment --attach` can't run (cloud Claude Code
# sessions block GitHub GraphQL, which gh needs to resolve the PR).
#
#   npm run pr:screenshots -- 'before.png#Before (main)' 'after.png#After — panel open'
#
# Pushes the images to the shared, never-merged `pr-assets` branch (under a
# folder named after the current branch) together with a gallery page
# (<stamp>-proof.md) that shows them inline with their captions (`file#caption`,
# the same syntax as `gh --attach`). Prints, pinned to that commit's SHA:
#   1. a root-relative link to the gallery — paste it into the PR body's
#      "## Visual proof" section. This is the form that works from cloud
#      sessions: the GitHub MCP tool strips image embeds (`![..](..)` becomes a
#      plain link) and code-wraps absolute URLs, but keeps root-relative links.
#   2. absolute Markdown image links, for anyone posting through a channel that
#      does render images (gh with a token, the GitHub web UI).
# Nothing is committed to your branch, so main's history stays free of
# screenshot commits whether PRs are merged or squashed.
#
# Uses git plumbing with a temporary index: your working tree, index and HEAD
# are never touched. Retries on a non-fast-forward push (another agent pushed
# to pr-assets at the same moment).
set -euo pipefail

ASSETS_BRANCH=pr-assets

if [ $# -eq 0 ]; then
  echo "usage: npm run pr:screenshots -- <image>[#caption]..." >&2
  exit 2
fi
files=(); captions=()
for arg in "$@"; do
  f="${arg%%#*}"
  [ -f "$f" ] || { echo "error: no such file: $f" >&2; exit 1; }
  files+=("$f")
  if [ "$f" = "$arg" ]; then captions+=(""); else captions+=("${arg#*#}"); fi
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
  # Gallery page: images referenced relative to the page, so GitHub's blob view
  # renders them inline at this same commit.
  gallery="# Visual proof — $folder"$'\n'
  for i in "${!files[@]}"; do
    f="${files[$i]}"
    name="$stamp-$(basename "$f")"
    path="$folder/$name"
    blob=$(git hash-object -w "$f")
    git update-index --add --cacheinfo "100644,$blob,$path"
    paths+=("$path")
    title="${captions[$i]:-$(basename "$f")}"
    gallery+=$'\n'"## $title"$'\n\n'"![$title]($name)"$'\n'
  done
  page="$folder/$stamp-proof.md"
  pageblob=$(printf '%s' "$gallery" | git hash-object -w --stdin)
  git update-index --add --cacheinfo "100644,$pageblob,$page"

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

echo "Pushed to $ASSETS_BRANCH at ${commit:0:7}." >&2
echo "Paste into the PR body's \"## Visual proof\" (works from cloud sessions):" >&2
echo "[View screenshots (${#paths[@]})](/$slug/blob/$commit/$page)"
echo "" >&2
echo "Inline images, for a channel that renders them (gh with a token, the web UI):" >&2
for i in "${!paths[@]}"; do
  p="${paths[$i]}"
  name=$(basename "$p" .png)
  alt="${captions[$i]:-${name#"$stamp"-}}"
  echo "![$alt](https://github.com/$slug/blob/$commit/$p?raw=true)" >&2
done
