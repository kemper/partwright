---
session: "01Ew7GPV6ru4K9o8N7vkHCM7"
timestamp: "2026-10-25T12:53:19Z"
---

## Human

Can you make me a script to remove all the pages.dev preview environments from cloudflare?

## Assistant

## Key decisions

**Delete deployments, not "environments"**: Cloudflare Pages has no per-branch
environment object to delete — a branch's `<branch>.mainifold.pages.dev` URL
is an alias onto its newest preview deployment. Deleting every deployment of a
branch (with `?force=true`, which the API requires for the aliased one)
retires the alias, so the script works at the deployment level.

**Safe by default**: dry run unless `--yes`; only `env=preview` rows are
listed and each row's `environment` is re-checked before deletion so a
production deployment can never be selected. `main` and `staging` are also
preview environments but are load-bearing in the quality-gate pipeline
(bleeding-edge and known-good previews), so they are kept unless the caller
passes `--keep ''`.

**Filters**: `--branch <glob>` (e.g. only `claude/*` agent branches) and
`--older-than <days>` cover the likely "prune the stale ones" use without
forcing an all-or-nothing wipe. List everything first, then delete (oldest
first) with modest concurrency and 429/5xx backoff, since the API rate limit is
per account and paging while deleting would shift pages.

**Not done**: stopping new previews from being created is a dashboard project
setting (branch control), not an API call this script should make silently.

Verified against a stubbed fetch (pagination, kept branches, production guard,
429 retry, partial-failure exit code); no real Cloudflare token in the session.

## Assistant

## Key decisions (follow-up)

**All projects by default**: the Cloudflare Pages bot comment on the PR showed
this branch's preview deploying to a `partwright` project, while CLAUDE.md
documents `mainifold.pages.dev`. Rather than hardcode one name that may be
stale, the script now enumerates every Pages project in the account and
prunes each; `--project` (repeatable) or `CF_PAGES_PROJECT` narrows it. The
same keep/production guards apply per project.
