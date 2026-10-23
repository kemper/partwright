---
session: "01V7thZjELhuagRZSPvf2JQL"
timestamp: "2026-10-23T16:36:00Z"
---

## Human

Visual proof in PRs is broken: screenshot links in PR bodies point back at the
PR instead of rendering. Wants a way to attach visual proof without committing
screenshots into branch history and without a "weird trick"; open to installing
a plugin or library. Asked whether a tool installed in the cloud environment
could do it, then asked to run a test of posting via `gh api`.

## Assistant

## Key decisions

**Root cause**: the images on `pr-assets` serve fine (HTTP 200). The PR bodies
show every image link wrapped in backticks/quotes, i.e. the session's GitHub
tool rewrites image Markdown it posts; GitHub then reads the URL as relative.
Hosting is not the problem, the posting path is, so an image-host library would
not help.

**Test, then correction**: on this branch's draft PR, image Markdown written via
`create_pull_request`, `update_pull_request` and `gh api` (REST) all stored and
rendered intact. So the session's tooling does not mangle links; the broken
bodies were hand-typed by agents, and nothing checked that images rendered.

**Fix**: no GitHub Action (a WIP version was dropped). `npm run pr:screenshots`
(now `scripts/pr-screenshots.mjs`) keeps storing images on `pr-assets` (one
sub-folder per upload, so no history noise on main), then upserts one "Visual
proof" PR comment via `gh api` and reads the rendered HTML back, failing unless
GitHub shows every image. Agents never type an image URL. A comment rather than
the PR body, so later body edits can't clobber it. `--layout` covers
before/after tables; `--refresh` covers screenshots taken before the PR exists.
Rendering is a pure module (`scripts/lib/visualProof.mjs`) with unit tests.
CLAUDE.md and work-reviewer updated to the new flow.

**Review follow-up, and the real root cause**: a review pass found should-fixes
(non-ASCII names dropped by quoted `ls-tree` output, push errors hidden behind
a blind retry, fetch errors read as "no branch", `)` in names breaking links),
all fixed. Testing awkward names then reproduced the original mangling: the
cloud session's GitHub proxy wraps image (and plain) link URLs in backticks
unless they literally match a path this session pushed. A probe showed this
session's plain-named uploads pass while percent-encoded names and another
session's uploads get wrapped. So the old PRs broke because their links weren't
traceable to the posting session, not because agents typed them. Fix: store
images under URL-safe names (`safeFileName`), rewrite `--layout` references to
match, list legacy unsafe names without links, and keep the render check as the
backstop (its error says to re-upload from the current session). CLAUDE.md
corrected accordingly.
