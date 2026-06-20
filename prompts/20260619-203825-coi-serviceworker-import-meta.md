---
session: "fix-catalog-redirect"
timestamp: "2026-06-19T20:38:25Z"
model: claude-opus-4-8
---

## Human

When I click on a catalog image on the landing page or in the catalog, I get
redirected back to the landing page. Maybe you just need to update to the latest
main? There were some deployment/url/redirect changes.

## Assistant

## Investigation + decision

Could NOT reproduce the catalog→landing bounce in any fresh context: local dev,
production deep-link, and production tile-click all correctly load the editor
(`/editor?catalog=…` → `/editor?session=…&v=1`). Server returns 200 for `/editor`
everywhere (no server redirect). Both surfaces link tiles to `/editor?catalog=…`
(`landingEntry.ts:163`, `content/build/render.ts:282`) — same working path.

But every page load threw `Cannot use 'import.meta' outside a module`. Root
cause: `public/coi-serviceworker.js:56` referenced `import.meta.url`, introduced
10 days ago in #547 (`3bb99479`). The file is loaded as a CLASSIC `<script src>`,
so `import.meta` is a PARSE-TIME SyntaxError — the whole script is discarded.
Effect: the cross-origin-isolation service worker never registers/updates. On
Cloudflare the page still works (COOP/COEP come from `_headers`), which is why it
shipped invisibly — but a returning browser keeps an old, un-updatable SW
controlling every navigation (and the `else` branch's `window.location.reload()`
still fires when not yet isolated). That's the most likely source of the
returning-browser navigation weirdness the user saw; a fresh context (my tests,
incognito) never hits it.

Fix: replace `new URL("coi-serviceworker.js", import.meta.url).href` with
`document.currentScript.src` (standard coi-serviceworker v0.1.7 approach; still
base-correct for `/vN/` deploys since Vite prefixes the `src`; mirrors
`route-init.js`'s own currentScript pattern). Added `tests/coi-serviceworker.spec.ts`
asserting `/editor` and `/catalog` load with zero uncaught page errors and a
catalog tile opens the editor (not landing) — the cheap guard that would have
caught this. Verified locally: import.meta error gone, catalog click → editor.

Reported honestly that I could not reproduce the exact bounce in a fresh browser
and that production lags main (different bundle hashes) — so a hard-refresh /
SW-clear or a production promotion may also be part of the user's fix.
