---
date: 2026-06-20
branch: claude/changelog-v1-release
files_changed:
  - src/content/data/whatsNew.ts
  - src/content/data/help.ts
---

## Human

After cutting the v1.0.0 release, the user asked for a PR that updates the
public-facing changelog and any other documentation that was missed while the
recent work was being done.

## Assistant

The changelog (`src/content/data/whatsNew.ts`, a hand-curated weekly log) stopped
at "June 12 – 13, 2026" — but a full week of user-visible work had merged to
`main` since then. Enumerated it from the `feat:`/`fix:` commit subjects on
`origin/main` since June 14 and clustered the user-facing themes into a new
"June 14 – 20, 2026" week entry, headlined "Partwright 1.0":

- **Releases** — first tagged 1.0 release (version in the About dialog, semver
  going forward); pinned version URLs (`/v1/…` frozen mounts, versionless root,
  `/current/` alias).
- **Export & printing** — export every part at once; multi-plate Bambu/Orca 3MF
  with filament colours; lift the 3-filament cap (every distinct + hand-painted
  color to its own filament); export warns on unsaved/never-saved parts and
  surfaces printability issues.
- **Figures** — 20+ full-body catalog figures + ear busts; richer noses, lip /
  eyebrow / elf-ear refinements; belly + maternity bodies; flush areolae;
  progressive coarse→fine render.
- **Garments & footwear** — conforming/draping apron/bib/tabard/cape panels and
  skirt coverage; footwear derived from the bare foot via SDF offset, flat sole
  for plantarflexed feet.
- **Editor, paint & AI** — cancel a deep-link render; smoother painting (no
  needless re-subdivision, edge-smoothing tip); AI can target parts by
  name/id/index; 500k triangle budget.

Doc gap also fixed: the help page's export section listed the formats but never
mentioned the new **multi-part / multi-plate / multi-filament** export. Added a
"Multi-part & multi-color export" paragraph to `help.ts` covering all-parts
export, plate layout, the lifted color cap, and the unsaved/printability warning.

Checked `public/llms.txt` — it's intentionally concise and already links
`/whats-new` and `/ai.md`, so no change needed there.

Per the deployment pipeline, changelog/help edits must flow through `main`
(a `docs:` PR), never onto the release branch — so this is a fresh branch off
`origin/main`. Verified: `npm run typecheck` clean; screenshotted `/whats-new`
to confirm the new entry renders.
