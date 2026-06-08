#!/bin/bash
# scripts/cf-build.sh — Cloudflare Pages build wrapper that pushes failure context out.
#
# Point the Cloudflare Pages build command at this (`bash scripts/cf-build.sh`)
# instead of `npm run build`. It runs the normal build; on failure it pushes the
# tail of the build log to one or both sinks below, then re-propagates the
# non-zero exit so the deploy still fails.
#
# WHY PUSH (vs the GitHub gate's pull model): an agent can fetch GitHub Actions
# logs through the API, but there is NO API to reach Cloudflare's build logs from
# outside. The build container is the only place/time that log is reachable, so
# it embeds the tail into the issue/webhook at failure time.
#
# SCOPE: this only catches failures INSIDE the build command. Cloudflare's
# pipeline is clone -> install deps -> build command -> upload. Install-phase and
# upload-phase failures happen outside this script; cover those with Cloudflare's
# native Notifications (webhook, Business+) if needed.
#
# Configure these as build environment variables in the Cloudflare Pages
# dashboard (Settings -> Environment variables), NOT in the repo. Both sinks are
# optional and no-op when their variable is unset:
#   GH_ISSUE_TOKEN   fine-grained PAT for kemper/mainifold, Issues: write (Sink B)
#   CF_FAIL_WEBHOOK  Slack/Discord/other incoming webhook URL (Sink A)

set -o pipefail

REPO="kemper/mainifold"
LOG=/tmp/cf-build.log

npm run build 2>&1 | tee "$LOG"
status=${PIPESTATUS[0]}

if [ "$status" -eq 0 ]; then
  exit 0
fi

short_sha="${CF_PAGES_COMMIT_SHA:0:7}"
export CTX="branch=${CF_PAGES_BRANCH:-?} commit=${short_sha:-?} url=${CF_PAGES_URL:-?}"
# Last ~6KB of output holds the actual error / stack trace; passed via env so the
# JSON encoder never has to deal with shell quoting of arbitrary log content.
export LOG_TAIL="$(tail -c 6000 "$LOG")"
export SHORT="$short_sha"

echo "cf-build: build failed ($CTX) — pushing failure context" >&2

# --- Sink A: webhook (Slack/Discord/any incoming webhook) -------------------
if [ -n "$CF_FAIL_WEBHOOK" ]; then
  payload="$(python3 -c 'import json,os; print(json.dumps({"text":"\U0001F534 Cloudflare build failed — "+os.environ["CTX"]+"\n"+os.environ["LOG_TAIL"]}))')"
  curl -s -X POST -H 'Content-type: application/json' --data "$payload" "$CF_FAIL_WEBHOOK" \
    || echo "cf-build: webhook post failed" >&2
fi

# --- Sink B: GitHub issue (joins the same @claude agent loop as the gate) ----
if [ -n "$GH_ISSUE_TOKEN" ]; then
  # Dedupe: skip if an open issue already exists for this commit.
  existing="$(curl -s -H "Authorization: Bearer $GH_ISSUE_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    "https://api.github.com/search/issues?q=repo:${REPO}+is:issue+is:open+in:title+${short_sha}+Cloudflare" \
    | python3 -c 'import json,sys
try: print(json.load(sys.stdin).get("total_count",0))
except Exception: print(0)' 2>/dev/null || echo 0)"

  if [ "${existing:-0}" -gt 0 ]; then
    echo "cf-build: issue already open for ${short_sha}; skipping" >&2
  else
    payload="$(python3 -c 'import json,os
body=(os.environ["CTX"]+"\n\n```\n"+os.environ["LOG_TAIL"]+"\n```\n\n"
      "An agent cannot fetch Cloudflare build logs via API, so the tail above is embedded.\n\n"
      "@claude please investigate this Cloudflare build failure and propose a fix.")
print(json.dumps({"title":"Cloudflare build failed on "+os.environ["SHORT"],"body":body,"labels":["cloudflare-build-failure"]}))')"
    curl -s -X POST \
      -H "Authorization: Bearer $GH_ISSUE_TOKEN" \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/${REPO}/issues" --data "$payload" >/dev/null \
      || echo "cf-build: issue creation failed" >&2
  fi
fi

exit "$status"
