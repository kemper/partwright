---
date: 2026-06-14
branch: claude/versioned-deploy-base-aware
files_changed:
  - src/deployment.ts
  - tests/unit/deployment.test.ts
  - src/ai/systemPrompt.ts
  - src/ai/tools.ts
  - src/ui/catalog.ts
  - src/landing/landingEntry.ts
  - src/geometry/bosl2Loader.ts
  - src/geometry/fontsLoader.ts
  - src/geometry/textGlyphs.ts
---

## Human

"start phase 3" of the versioned-deployment strategy — path-mounting each major
under its own base (`/v1/`, `/v2/`) on one origin, base-aware routing, SEO, and
cross-tab storage scoping. (Follows Phase 1 release tagging #651 and Phase 2
app-version provenance #653.)

## Assistant

Phase 3 is large and architecturally significant, so I mapped every touch-point
first (via the explore agent) and sliced it into reviewable PRs rather than one
risky diff. The map's decisive finding: NOTHING in the app read
`import.meta.env.BASE_URL` — every path was a literal or built from
`location.origin` — so changing vite `base` alone fixes nothing. ~50 route sites
+ ~30 localStorage keys would need to become base-aware/version-scoped.

This PR is **slice 1 of 5: the base-aware foundation**, deliberately scoped to
be a **no-op at the current `/` mount** so it's safe and verifiable:

- **New `src/deployment.ts`** — the single source of truth for the deployment
  base and the major it serves. Pure, dependency-free helpers (`normalizeBase`,
  `majorFromBase`, `joinBase`, `routeFromPath`) take the base explicitly so
  they're unit-testable without stubbing `import.meta.env`; thin wrappers
  (`BASE`, `currentMajor`, `appPath`, `appRoute`, `assetPath`) bind the build's
  actual base. At base `/` every helper is the identity.
- **Converted the asset `fetch()` paths** that would 404 under `/vN/`:
  `ai.md`, `ai/<subdoc>.md`, the catalog manifest (two call sites), and the
  OpenSCAD BOSL2 + fonts prefixes — all routed through `assetPath()`. These
  fetch from `public/`, which vite serves under the base, so they must follow it.
- Kept `src/deployment.ts` dependency-free specifically so `landingEntry.ts`
  (which documents a "tiny import graph only" rule) can use it.

Deliberately deferred to later slices (documented in
.plans/versioned-deployments-design.md): PR2 runtime route layer (main.ts
predicates+writers, updateURL, switchTab, entry/route-init); PR3
SEO/content-prerender/HTML/redirects; PR4 root launcher + actually mounting at
`/v1/`; PR5 (v2-time) storage share-vs-isolate decisions + DB-by-major +
migration. Storage-key scoping was pulled out of this PR on purpose — the map
showed session-scoped keys use per-DB UUIDs (no real cross-major collision) and
some prefs (theme) are arguably desirable to share, so it needs per-key judgment
best made when v2 is concrete, not a blind namespacing now. No vite `base`
change here either: `import.meta.env.BASE_URL` is already '/', and when a later
PR sets the base these fetches become base-aware automatically.

Verified: typecheck clean; full unit tier 1373 pass (incl. 9 new `deployment`
cases covering the `/v2/` parsing + a joinBase/routeFromPath round-trip);
`lint:deps` acyclic; `npm run build` clean; and a browser snapshot of /catalog
confirmed the manifest still loads (tiles + language counts render) — i.e. the
conversion is a true no-op at base `/`.
