---
date: 2026-07-05
branch: claude/partwright-production-release-u271mg
files_changed:
  - package.json
  - src/content/data/whatsNew.ts
  - src/content/data/help.ts
---

## Human

Make a new production release of Partwright: the release-notes / doc-update PR
and the staging → production release PR.

## Assistant

Same two-step shape as 1.2 and 1.3: docs + version bump go in via `main` so
the pipeline's pure-promotion invariant holds — the `staging` → `production`
PR must carry zero content beyond `main`. The promotion PR tracks the
`staging` branch head, so it picks up this docs commit automatically once the
gate fast-forwards staging.

What's in this release (47 commits on `origin/main` past `v1.3.0`; staging is
already at main's head). Filtering to user-facing changes — the eval-harness
cases, vision-judge fixes, retro notes, and internal refactors (F.layers /
F.parts churn that was superseded within the same release window) stay out of
the public changelog:

- **Figure accessory system**: attachment frames (neck/waist/shoulders/back/
  forearms) + placement verbs (ring, strap, hangFrom, onFace), garment parts
  that conform to the right body part (belts no longer bleed onto arms),
  per-side limb conform surfaces, flush F.band belts, draping necklaces.
- **F.grasp + `holds:`**: one-line side-correct grasping with the grip point
  in the finger cup, plus `graspProbe` pre-bake QC.
- **Catalog**: Knight, Scholar, Noble Lady, Lumberjack showcase figures;
  21 defective/superfluous figures removed.
- **Grid plane on by default** (viewport).
- **AI plan mode gets read-only tools** — plans grounded in session state;
  mutations still gated on approval.

Scope decisions:

- **Version → 1.4.0 (minor).** All backward-compatible `feat:`/`fix:` work —
  existing sessions and exports still load — so a minor bump per CLAUDE.md's
  semver rules. The bump rides this `main`-bound PR so `release-tag.yml` tags
  `v1.4.0` on promotion.
- **Changelog** (`whatsNew.ts`) — new "July 5, 2026 — Partwright 1.4" entry
  (Releases / Figures / Catalog / AI assistant / Studio groups) above the
  unchanged 1.3 entry.
- **Help** — two surgical edits where shipped behavior changed what the page
  says: the viewport Grid bullet now notes it's on by default, and the AI
  section gains a "Plan first (📋)" blurb (the toggle existed but was
  undocumented, and this release changed what it does — read-only inspection
  during planning). The figure accessory API is agent-facing surface already
  documented in `public/ai/figure.md`; its user-visible product is the new
  catalog figures, which the changelog covers.
- **No `llms.txt` change** — it doesn't enumerate figure-API verbs; agents
  reach them through the `figure` subdoc.
