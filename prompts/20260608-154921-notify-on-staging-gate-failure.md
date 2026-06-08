---
session: "014Ay8"
timestamp: "2026-06-08T15:49:21Z"
model: claude-opus-4-8
tools: [WebSearch, WebFetch]
---

## Human

I get email when the main → staging deploy fails but have to log into
Cloudflare to see why. Can a remote agent listen for these failures? Research
my options. Follow-up: the key thing I want is to capture the stack trace so an
AI agent knows what to fix — which option does that? Decision: create an issue;
otherwise implement as proposed.

## Assistant

## Key decisions

**Clarified the real failure surface.** The "main → staging deploy" is not a
Cloudflare build — it's the `Gate main → staging` GitHub Action
(`staging-gate.yml`). The stack trace lives in the Actions job logs, not
Cloudflare. So the notification belongs on the GitHub side.

**Pull, don't push, the stack trace.** Rather than scrape failing log lines
into a Slack/issue body (brittle, partial), the issue carries only the failed
**run ID**. An agent picking it up fetches the full failed-job logs on demand
(`get_job_logs` with `failed_only`) plus the run's Playwright artifacts. This is
strictly more complete than any excerpt and keeps the notifier dumb.

**`workflow_run` trigger, not a step inside the gate.** A step inside the gate
can't reliably report the gate's own final conclusion after it has failed.
Observing from the outside via `workflow_run` (`types: [completed]`, guarded on
`conclusion == 'failure'`) is the standard pattern and sees the true outcome.

**Dedupe on run ID** via an HTML-comment marker (`<!-- gate-failure-run:ID -->`)
searched before creating, so a re-run of the same failed gate doesn't double-file.
The `staging-gate-failure` label is created idempotently (ignore HTTP 422).

**Added `if: failure()` Playwright artifact upload** to the gate's e2e job so the
agent gets traces/screenshots for e2e failures, not just the textual stack —
`trace: 'on-first-retry'` + `retries: 1` in CI means a failing spec produces a
trace.zip in `test-results/`.

**Included an `@claude` mention** in the issue body so that, where the Claude
GitHub App is installed, the issue can auto-kick an investigating session; it's a
harmless no-op otherwise.

**Did not** wire Slack/Discord/Cloudflare-native notifications — the user chose
the issue path, which needs no external account or secret.
