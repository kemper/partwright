---
session: "01BCrup7"
timestamp: "2026-10-11T19:48:18Z"
---

## Human

Add a Discord link (https://discord.gg/vbUy95fP3Q) for people to join: in the
header, the footer, as a /discord redirect, in the GitHub README, and on the
help page.

## Assistant

## Key decisions

**Single source of truth**: `DISCORD_INVITE_URL` lives in `src/feedbackLinks.ts`
next to the other community/feedback URLs; the shared header, content-page
footer, and help page all import it. `index.html`'s inline landing footer and
`public/_redirects` can't import, so they hard-code it (the redirect has a
"keep in sync" comment).

**Header placement**: a Discord-mark icon button beside "Open editor" rather
than another text nav link, so it survives the <768px breakpoint that hides the
nav links. Below 420px it would wrap the CTA, so it's hidden there; the footer
still links Discord on the narrowest phones.

**/discord redirect**: a Cloudflare `_redirects` 302 (not 301) so browsers
don't cache it forever if the invite is ever rotated. Like the existing `/ai`
alias it's production-only (the Vite dev server doesn't read `_redirects`).

**Links point straight at discord.gg** rather than through /discord, saving a
hop and working in dev too.
