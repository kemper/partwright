---
date: 2026-06-14
branch: claude/versioned-deploy-routing
files_changed:
  - src/main.ts
  - src/storage/sessionManager.ts
  - src/ui/layout.ts
  - src/ui/uninstallModal.tsx
---

## Human

"proceed to the next step" of Phase 3 (versioned deployments) — after the
base-aware foundation merged (#656), wire the runtime route layer to use it.

## Assistant

Phase 3 **slice 2 of 5: the runtime route layer**. Converted every in-app route
read and write to go through the `appRoute`/`appPath` helpers from
`src/deployment.ts` (added in #656), so the app routes correctly whether mounted
at `/` or a future `/vN/`. A strict no-op at base `/` (both helpers are the
identity there).

- **Route predicates** (`src/main.ts`): added a `currentRoute()` helper
  (`appRoute(location.pathname)`) and routed `shouldShowLanding`,
  `shouldShowHelp/Catalog/Ideas/WhatsNew/Legal`, `shouldShow404`,
  `isEditorActive`, and the four `pathname !== '/editor'` guards through it.
- **Route writers**: wrapped every `updateAppHistory('/...')`, the two direct
  `history.replaceState(…, '/editor'…)` (incl. the `history.state` one the
  `?tour=1` handler uses), and the `location.assign('/')` calls (close+clear,
  uninstall, `showLandingPage`) in `appPath(...)`.
- **`updateURL`** (`sessionManager.ts`) basePath + the share/gallery URL
  builders (`origin + appPath('/editor')`); **`switchTab`** (`layout.ts`)
  basePath; **uninstall** redirect (`uninstallModal.tsx`).

Deliberately deferred:
- **The pre-paint landing-detection pair** — `src/entry.ts` `isLandingRoute()`
  and `public/route-init.js` — left as literal `'/'` checks. They're a matched
  pair that runs before the app bundle; `route-init.js` is a static file that
  can't import `deployment.ts`, so making them base-aware needs a base-injection
  mechanism that belongs with the actual `/vN/` mount (PR4). At base `/` all
  three landing predicates (these two + `shouldShowLanding`) still agree exactly,
  so the matching invariant holds for every real deployment today.
- SEO / content-page hrefs / redirects (PR3); launcher + base mount (PR4);
  storage scoping (PR5).

Verified: typecheck clean; `lint:deps` acyclic; `npm run build` clean; the
routing-critical e2e — smoke, landing-static, content-pages, version-nav,
versions-tab — all pass (35/35) confirming landing↔editor↔content-page
navigation, tab switching, the back button, catalog-into-editor, and share-hash
handling are unchanged; and a browser snapshot of /editor shows the engine boots
and renders. Swept `src/` (NUL-safe) for any remaining route literals in
nav/history writers — none outside the deferred content/SEO layer.
