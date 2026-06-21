---
date: 2026-06-19
branch: claude/versioned-deploy-build-fold
files_changed:
  - package.json
  - CLAUDE.md
---

## Human

Production incident during the versioned-deploy cutover go-live: after merging
#688 to main and pointing the Cloudflare build command at `npm run build:deploy`,
Cloudflare builds failed (`Missing script: "build:deploy"`) on every branch that
predated the merge; and once reverted to `npm run build`, `/v1/editor` 404s
(while `/current/editor` correctly redirects) — i.e. the new `_redirects` is live
but `dist/v1/` wasn't built.

## Assistant

Root cause: the dual build lived in a **separate `build:deploy` script**, but the
Cloudflare build command is **project-wide**. So:
- Setting the command to `build:deploy` broke every branch lacking the script
  (all open PRs predating the merge) — and `main` itself until #688 landed.
- Reverting to `npm run build` un-broke builds but emitted only the versionless
  root (no `dist/v1/`), so `/v1/editor` → `/v1/*` redirect → missing
  `/v1/index.html` → 404. (`/current/editor` working confirmed the new
  `_redirects` was deployed — it's a missing-artifact problem, not a routing bug.)

Fix: **fold the dual build into the default `npm run build`** so the Cloudflare
command never needs changing and no branch can break:
- `build` = `tsc && vite build && DEPLOY_BASE=/v1/ vite build --outDir dist/v1 --emptyOutDir`.
- `build:deploy` kept as a back-compat alias (`npm run build`) so a command still
  set to `build:deploy` also works.
- A branch that predates this runs *its own* single `build` (versionless) → its
  Cloudflare preview passes; `main`/staging/prod run the new dual `build` → ship
  `/v1/`. Trade-off: ~25 s added to every `npm run build` (CI included) — accepted
  given the split caused a production-build outage.

Verified locally: `npm run build` now emits `dist/index.html` (→ `/assets/…`,
versionless) **and** `dist/v1/index.html` (→ `/v1/assets/…`, pinned), with the
`/v1/*` + `/current/` `_redirects`. Updated the CLAUDE.md deployment section
(the command is the default `npm run build` again; documented the history).

Go-live after merge: with the Cloudflare command on the default `npm run build`,
the next staging/prod build produces `/v1/` automatically — verify `/v1/editor`
serves the pinned build (`/v1/assets/…`) on staging, then promote.
