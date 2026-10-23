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

**Fix (in progress)**: keep `pr-assets` for storage (no history noise on main),
and have a GitHub Action post one "Visual proof" comment with its own token, so
the Markdown never passes through the session's tool. The rendering is a pure,
testable module (`scripts/lib/visualProof.mjs`). Before finishing it, test
whether plain `gh api` REST writes keep image links intact; if so, the script
can post directly and the Action is unnecessary.
