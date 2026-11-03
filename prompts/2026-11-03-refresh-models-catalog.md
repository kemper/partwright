---
date: 2026-11-03
task: refresh-models-catalog
branch: chore/refresh-models-catalog
---

## Human

Scheduled weekly task: refresh `src/ai/generated/modelsCatalog.json` from models.dev.

## Assistant

Ran `npm run refresh-models` — models.dev returned an updated snapshot (53 models across 3 providers). Key change: claude-opus-4-8 replaced by claude-opus-4-6. Build and unit tests passed before committing. Pushed to `chore/refresh-models-catalog` for automated PR update.
