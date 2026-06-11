# Refresh models catalog (weekly)

You keep `src/ai/generated/modelsCatalog.json` current with models.dev. A
scheduled trigger wakes you ~weekly to regenerate the snapshot, validate it, and
open a PR into `main` — the same job the old `Refresh models catalog` GitHub
Action did, moved here because **GitHub Actions is not permitted to open PRs**
with the default `GITHUB_TOKEN` (the `createPullRequest` policy). You open the PR
through the GitHub integration under the human's identity, which has no such
restriction — and, as a bonus, that PR actually triggers `pr-checks` (an
Actions-bot PR does not).

`main` is protected, so the snapshot reaches it through a PR, never a direct
push. Once the PR merges, the normal **main → staging gate** promotes it.

## Steps

### 1. Install deps and regenerate the snapshot
A fresh container has no `node_modules`:

```bash
npm ci
npm run refresh-models      # node scripts/refreshModelsSnapshot.mjs
```

The script soft-fails (exit 0, snapshot preserved) if models.dev and the GitHub
fallback are both unreachable — so a clean tree after this step can mean either
"already current" or "upstream was down." Either way, there's nothing to ship.

### 2. Stop early if nothing changed
```bash
git diff --quiet src/ai/generated/modelsCatalog.json
```

If it exits 0 (no diff), the snapshot is already current. Post a one-line
"models catalog already up to date — nothing to open a PR for" and **stop** —
do not open an empty PR.

### 3. Validate before opening the PR
The refreshed JSON is bundled and type-checked, so prove it builds and the unit
tier is green before shipping it:

```bash
npm run build        # tsc type-check + vite build
npm run test:unit
```

If either fails, **do not open a PR** — the upstream catalog likely drifted in a
way `src/ai/catalog.ts` doesn't expect. Stop and report the failure (with the
error) so a human can look; don't try to hand-patch the generated snapshot.

### 4. Push the snapshot and open/update the PR — via the GitHub integration
Do **not** `git commit` / `git push` locally for this — push the single changed
file straight to a bot-owned branch through the GitHub MCP tools, under the
human's identity. This is what dodges both the Actions PR policy and the local
prompt-log commit guard.

- **Branch:** `chore/refresh-models-catalog` (long-lived scratch branch — reuse
  it; create it from `main` if it doesn't exist).
- **File:** commit the regenerated `src/ai/generated/modelsCatalog.json` to that
  branch (`create_or_update_file`, message `chore: refresh models catalog
  snapshot`). Updating the file on an existing open PR's branch updates the PR
  in place — no new PR needed.
- **PR:** if no open PR has `chore/refresh-models-catalog` as its head into
  `main`, open one (`create_pull_request`, `draft: true`, base `main`):
  - **Title:** `chore: refresh models catalog snapshot`
  - **Body:** "Automated weekly refresh of `src/ai/generated/modelsCatalog.json`
    from models.dev. Build + unit validated before opening. Merging triggers the
    main → staging gate to promote it."
  - **Label:** `ignore-for-release`
  - If a PR is already open, the file push above already updated it — just say so
    and stop.

### 5. Stop — the human reviews and merges
`pr-checks` runs on the PR (it was opened under a human identity, so it fires).
You don't need to babysit it unless asked; the refresh is a routine, low-risk
content bump. The main → staging gate promotes the snapshot once the PR merges.

## Reminders
- The PR carries **only** the regenerated snapshot — nothing else. If `git
  status` shows other dirty files after the refresh, something's wrong; don't
  sweep them into the PR.
- Never push the snapshot directly to `main` — it's protected and the previous
  attempt to do so failed with GH006. The PR is the only sanctioned path.
- This is content, not code: don't "improve" the JSON by hand. The script is the
  single source of truth for its shape; if the shape looks wrong, fix the script
  in a separate change.
