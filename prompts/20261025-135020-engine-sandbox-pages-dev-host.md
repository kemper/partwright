---
session: "a6521761"
timestamp: "2026-10-25T13:50:20Z"
model: claude-opus-5-5
---

## Human

Another agent's plan for deploying engine-sandbox 'origin' mode assumed
sandbox.partwrightstudio.com plus a Cloudflare Redirect Rule. The user asked
for help with the Cloudflare side, then weighed alternatives (Namecheap
redirect, a new domain, localhost, opaque mode) and chose a separate Pages
project at partwright-sandbox.pages.dev, with the app itself refusing to run
on that host. They asked for the PR.

## Assistant

## Key decisions

**Host choice**: partwrightstudio.com is on Namecheap DNS, so a Cloudflare
Redirect Rule isn't available, and Pages `_redirects` can't match on the
hostname. A second Pages project on pages.dev (on the Public Suffix List, so
it's a separate site) needs no DNS. Unlike `opaque`, it keeps an HTTP cache
across page loads.

**Guard in entry.ts, not the edge**: the risk is only data the app writes on
the exact sandbox origin. entry.ts decides before any app bundle loads or
storage is touched, and redirects to the first VITE_APP_ORIGIN, keeping the
path. It shows a static notice when no app origin is configured. Per-deploy
hosts are other origins the frame never runs on, so the check matches only the
exact VITE_SANDBOX_ORIGIN. The pure decision lives in
src/sandbox/sandboxHostGuard.ts (unit-tested). The e2e test derives both
origins from the Playwright config, so it doesn't need WebGL. It was checked
to fail without the guard.

**Docs**: rewrote the doc's origin-mode deployment section, which recommended
host-specific `_redirects` rules that Pages doesn't support. Added a
never-delete warning for the project name, since a deleted pages.dev name can
be claimed by someone else.

## Human

(No new request. Follow-up from the pre-ready review of #1121.)

## Assistant

## Key decisions

**Fail closed without build env**: the guard only fired when the sandbox
project's own build carried VITE_SANDBOX_ORIGIN, so a missing env var would
have let the app boot there. The production sandbox host is now also matched
by name, with www.partwrightstudio.com as the fallback target. The constant
sits next to the `frame-src` it has to match. The doc now says storage
partitioning would usually hide that data from the framed Worker, but that
partitioning can't be relied on.
