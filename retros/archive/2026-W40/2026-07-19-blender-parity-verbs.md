# 4-Ls — Blender-parity mesh-shaping verbs (PR #925)

**Task:** port Blender Tier 1+2 capabilities (scatter, deforms, round, smoothWeld, sculpt, materials, checker pattern, animation exports) + 5 showcase catalog entries, one session.

## Liked
- The "everything is one declarative code line" product filter made scoping fast: 6 of 8 features fit the Worker sandbox with zero schema changes and zero main.ts risk. Deciding the *integration architecture* before writing any feature paid for itself several times.
- `model:preview` as the inner loop: every new geometry op was functionally verified (stats + PNG) within minutes of being written; the corduroy-terracing defect in smoothWeld was caught by *looking* at the render, exactly as CLAUDE.md's visual-verification doctrine predicts.
- Parallel model-sculpt subagents for the 5 showcase models — the render-iterate loops (up to 65 tool calls each) stayed out of the main context entirely and all five came back print-valid.

## Lacked
- A canonical "restart-the-dev-server-then-bake" helper: the bake failed twice on dead/stale dev servers ("API never appeared"), and freshly baked catalog thumbnails need a SECOND dev-server restart to serve in dev (filed #926). `pkill -f vite` also self-matches the invoking shell's cmdline — cost two confusing exit-144s.
- `api.text` didn't work headlessly (font preload missing in previewModel + Node fetch + opentype interop) — fixed in this PR, but it means text-bearing models were previously unverifiable in the fast loop.

## Learned
- Occupancy-grid signed fields have half-voxel "corduroy" that trilinear sampling can't hide; one separable binomial blur pass removes it with negligible radius error. (sdfModifier.ts's comments warned about exactly this — reading the neighboring subsystem's comments first would have saved one iteration.)
- Metals in the studio viewport need per-material `envMapIntensity` boosts (presets keep env low for the matte default), and any env-less context (SwiftShader CI, Light off) renders metalness-1 surfaces black — clamp metalness as fallback. Screenshot verification in the sandbox browser is what surfaced both.
- `json.dump` with non-matching indent/ensure_ascii on a shared manifest turns a 5-entry addition into a 1300-line diff — match the file's canonical serialization before writing (work-reviewer caught it).

## Longed for
- A one-shot `npm run bake -- <example.js> "<Name>" [tags]` that owns the dev-server lifecycle (start if needed, wait, bake, update both manifests in canonical format, regenerate the dev thumb). The manual 4-step dance (bake, two manifest edits by hand, restart for thumbs) is where all this session's friction lived.
- Per-feature "which angle would hide the defect" hints in model:preview output — the mug thumbnail shipped with cropped text until a pinned-camera re-bake; a warning when a labeled 'lettering' region faces away from the default camera would have caught it pre-bake.
