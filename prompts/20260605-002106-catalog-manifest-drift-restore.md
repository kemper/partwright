---
session: "q7csA"
timestamp: "2026-06-05T00:21:00Z"
model: claude-opus-4-8
tools: [git, playwright]
---

## Human

I don't see the latest catalog items in production after a production deploy.
The changelog looks right but I'm not convinced that everything is up to date.
Can you check? — then: ok, create a PR.

## Assistant

## Key decisions

**Diagnosis: not a deploy problem — a clobbered manifest.** Production's tree is
byte-for-byte identical to `main` and `staging` (zero `git diff`), so the
promotion was clean and a re-deploy would change nothing. The `/catalog` page is
manifest-driven (`src/ui/catalog.ts` fetches `public/catalog/manifest.json`), and
two model files shipped on every branch *without* manifest entries, so they never
rendered: `snowman.partwright.json` and `steampunk_rocket.partwright.json`.

**Root cause is the documented release-branch drift pattern.** The original commit
`dcc149b` ("add Steampunk Rocket and Snowman to catalog") added both the files and
their manifest entries, but it was committed **directly onto the production/release
branch** — it's reachable only from `origin/production`, never `main`/`staging`. The
two model *files* reached `main` independently via PR #282 (`34c138a`) but the
manifest entries never did. A pickaxe (`git log -S`) confirms `main`'s manifest has
*never* contained either id. Later, `b9b639b` rewrote the manifest from the
main-side base and every promotion fast-forwarded production past `dcc149b`, so the
entries are now absent everywhere.

**Fix on `main`, not the release branch.** Restoring the two entries onto a release
branch would repeat the exact mistake that caused the drift. I re-added them to
`public/catalog/manifest.json` on a feature branch into `main` (the superset), using
the original entry blocks recovered from `dcc149b` (`language: manifold-js`, matching
the files which carry no explicit language). The gate will advance `staging`, then a
normal promotion carries them to production.

**Verification.** `npm run build` + 649 unit tests pass; a throwaway Playwright spec
loaded `/catalog` and confirmed both cards now render (with thumbnails). Cross-check
script proved all 86 entries resolve to files and zero orphan files remain.
