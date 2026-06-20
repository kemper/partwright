---
session: "friendly-volta"
timestamp: "2026-06-20T18:05:00Z"
model: claude-opus-4-8
---

## Human

CI e2e shard 3 failed on PR #802. The `smoke` and `startup-resilience` specs
(which assert zero app-relevant console errors) caught a CSP violation:
`Loading the script 'https://static.cloudflareinsights.com/beacon.min.js'
violates … script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'`.

## Assistant

## Key decisions

**Root cause**: the beacon was a literal `<script>` in the six HTML source
files, so it loaded in the **dev server** too — and the dev/preview CSP
(`vite.config.ts` `server.headers`, a separate source from `public/_headers`,
which is Cloudflare-only) did not list the beacon host. Browser blocked it and
logged a console error; the no-console-error smoke specs failed.

**Rejected the obvious fix** (add the host to the dev CSP). Two problems it
leaves: (1) the Cloudflare RUM beacon reports keyed by token regardless of
origin, so loading it from localhost + every CI e2e page load would pollute the
production analytics with non-user traffic; (2) it weakens the dev CSP's purpose
as a guard that surfaces stray external calls.

**Fix: make the beacon production-only.** Removed the six literal tags and added
a build-only Vite plugin `injectAnalyticsBeacon()` (`apply: 'build'`) that
injects the snippet into every emitted HTML via `transformIndexHtml`. Dev/test
never load it (smoke specs pass; no dev/CI analytics pollution); the production
build emits it into all 14 output pages, incl. `editor.html` (a closeBundle copy
of built index.html) and the `/v1/` nested deploy. Left the dev CSP without the
host and added a comment marking the intentional divergence from `_headers`, so
a future "keep in sync" edit doesn't reintroduce the dev beacon.

Verified: `npm run build` (beacon in 14 dist pages, 0 in source HTML),
`npm run typecheck`, and the two previously-failing specs (`smoke`,
`startup-resilience`) — 21 passed locally.
