---
date: 2026-06-08
title: Update GitHub repo references after mainifold → partwright rename
prefix: docs
---

## Human

Renamed the GitHub repo from `kemper/mainifold` to `kemper/partwright`. Asked
whether the old name redirects (it does, gracefully) and whether a new
Cloudflare Pages application is needed (it is not — the Pages project binds to
the repo by internal ID, keeps its `mainifold` name, and its `*.pages.dev`
URLs are unchanged). Then asked for a PR updating all docs/references to the old
repo name.

## Assistant

Key decision was **scoping** the rename. The string "mainifold" plays five
distinct roles in this repo, and only one is the GitHub repo path:

1. **GitHub repo path** `kemper/mainifold` — the only thing the rename affects.
   Updated to `kemper/partwright`.
2. **Cloudflare `*.mainifold.pages.dev` URLs** — tied to the Cloudflare Pages
   *project* name, NOT the GitHub repo. The project keeps its name after a repo
   rename, so these URLs stay valid. Left untouched.
3. **`window.mainifold` legacy JS API alias** — deliberate back-compat alias for
   `window.partwright`. Renaming it would break older agent prompts/tools. Left
   untouched.
4. **`data.mainifold` import-schema brand field** — back-compat for loading old
   exported sessions. Left untouched.
5. **Legacy IndexedDB name `mainifold`** (`db.ts` migration) — back-compat for
   pre-rebrand local data. Left untouched.

So the diff only touches category 1: the hardcoded repo-slug fallbacks in
`src/buildInfo.ts` and `vite.config.ts` (production gets the real value from
`GITHUB_REPOSITORY`/git remote, now `kemper/partwright`), their unit-test
expectations, the landing-page footer GitHub link, and the Homebrew formula
tarball URL. Historical `prompts/*.md` logs were left as-is (immutable record).

Verified with `npm run test:unit` (800 pass) and `npm run build` (tsc + vite
clean). No browser screenshot — the only UI-visible change is a footer link
href, no visual difference.
