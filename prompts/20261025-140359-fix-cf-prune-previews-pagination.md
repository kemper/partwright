---
session: "01RMsGJYKfht"
timestamp: "2026-10-25T14:03:59Z"
---

## Human

Run `npm run cf:prune-previews -- --older-than 1` (the Cloudflare API key is in the environment). Then: fix the script.

## Assistant

## Key decisions

**Root cause**: with no `--project`, the script lists every Pages project with `per_page=25`, and the Cloudflare projects-list endpoint rejects that with `400 8000024: Invalid list options`. Probing showed the projects endpoint accepts `per_page` up to 10. The deployments endpoint accepts 25.

**Fix**: `listAll` now takes the page size as an argument. The projects list asks for 10; deployments stay at 25, so the larger page keeps the request count down on accounts with thousands of previews (about 1,900 per project here).

**Verified**: a dry run with no `--project` now lists all three projects and selects 2,455 preview deployments older than one day. Nothing was deleted, because `--yes` was not passed.
