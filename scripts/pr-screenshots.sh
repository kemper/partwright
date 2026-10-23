#!/usr/bin/env bash
# Upload screenshots as a PR's visual proof, without committing them to the PR
# branch.
#
#   npm run pr:screenshots -- test-results/feature-before.png test-results/feature-after.png
#   npm run pr:screenshots -- --layout proof.md before.png after.png
#
# Pushes the images to the shared, never-merged `pr-assets` branch as one
# upload batch (`<branch-folder>/<UTC stamp>/<image>`). The `Visual proof
# comment` workflow (.github/workflows/pr-visual-proof.yml) then posts them on
# the PR as a single comment, which it updates on each new upload. Don't paste
# image Markdown into the PR body yourself: agents' GitHub tools rewrite image
# links in text they post, which breaks them.
#
# --layout <file.md>  Optional Markdown for the comment (e.g. a before/after
#                     table). Reference images by file name, like
#                     `![after](after.png)`; the workflow pins them to the upload.
#                     Without it, images are laid out two per row.
#
# Uses git plumbing with a temporary index: your working tree, index and HEAD
# are never touched. Retries on a non-fast-forward push (another agent pushed
# to pr-assets at the same moment).
set -euo pipefail

ASSETS_BRANCH=pr-assets

layout=""
images=()
while [ $# -gt 0 ]; do
  case "$1" in
    --layout) layout="${2:-}"; shift 2 ;;
    --layout=*) layout="${1#--layout=}"; shift ;;
    -h|--help) sed -n '2,22p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) images+=("$1"); shift ;;
  esac
done

if [ ${#images[@]} -eq 0 ]; then
  echo "usage: npm run pr:screenshots -- [--layout proof.md] <image>..." >&2
  exit 2
fi
names=()
for f in "${images[@]}" ${layout:+"$layout"}; do
  [ -f "$f" ] || { echo "error: no such file: $f" >&2; exit 1; }
done
for f in "${images[@]}"; do
  name=$(basename "$f")
  case "$name" in
    *.png|*.PNG|*.jpg|*.JPG|*.jpeg|*.JPEG|*.gif|*.GIF|*.webp|*.WEBP) ;;
    *) echo "error: not an image (png/jpg/gif/webp): $f" >&2; exit 1 ;;
  esac
  for seen in "${names[@]+"${names[@]}"}"; do
    [ "$seen" != "$name" ] || { echo "error: two images named $name — rename one" >&2; exit 1; }
  done
  names+=("$name")
done

branch=$(git rev-parse --abbrev-ref HEAD)
folder=$(printf '%s' "$branch" | tr '/' '-')
stamp=$(date -u +%Y%m%d-%H%M%S)
batch="$folder/$stamp"

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
      'Screenshots for PR "Visual proof" comments, uploaded by `npm run pr:screenshots`' \
      'and posted by `.github/workflows/pr-visual-proof.yml`. One folder per PR branch,' \
      'one sub-folder per upload. **Never merge, rebase or delete this branch**: it' \
      "exists so images can be linked by commit SHA without landing in main's history." \
      | git hash-object -w --stdin)
    git update-index --add --cacheinfo "100644,$readme,README.md"
  fi

  for f in "${images[@]}"; do
    git update-index --add --cacheinfo "100644,$(git hash-object -w "$f"),$batch/$(basename "$f")"
  done
  if [ -n "$layout" ]; then
    git update-index --add --cacheinfo "100644,$(git hash-object -w "$layout"),$batch/proof.md"
  fi

  tree=$(git write-tree)
  commit=$(git commit-tree "$tree" ${parent:+-p "$parent"} -m "screenshots for $branch")
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

slug=$(git remote get-url origin | sed -E 's#\.git$##; s#.*[:/]([^/]+/[^/]+)$#\1#')
echo "Uploaded ${#images[@]} image(s) to $ASSETS_BRANCH/$batch (${commit:0:7})."
echo "The PR's \"Visual proof\" comment updates on the next PR event: opening the PR or pushing to it."
echo "PR already open and no push coming? Refresh it now with the GitHub MCP tool:"
echo "  actions_run_trigger method=run_workflow workflow_id=pr-visual-proof.yml ref=main inputs={\"pr\":\"<number>\"}"
echo "Image URLs (for chat, not for the PR body):"
for f in "${images[@]}"; do
  echo "  https://github.com/$slug/blob/$commit/$batch/$(basename "$f")?raw=true"
done
