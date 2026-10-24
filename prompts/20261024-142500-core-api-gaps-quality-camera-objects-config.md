---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T14:25:00Z"
tools: [subagent, git-worktree, playwright]
sequence: 1
---

## Human

I definitely want core operations available to the agents. (Tracking issue
#1085 "AI can drive Partwright", PR3: close the core API gaps from the parity
audit — mesh quality, camera, object merge/reorder, app config, diagnostic log,
edges toggle — each with a help() row, docs and an AI tool where sensible.)

## Assistant

## Key decisions

**Thin API wrappers over the code the UI already runs.** `simplifyModel` calls
the Quality panel's own `simplifyHandlers` (open → apply/enhance/byTolerance/
byEdgeLength → save) and copies the panel's request math (the size knob's
`amount`) and enhance guards, so a scripted simplify bakes and saves exactly
like Apply. The UI-only bits (the heavy-enhance confirm) become a returned
warning; the hard cap stays a refusal. `mergeObjects` uses a new
`mergeObjectsCore` that the rail's Merge flow now also calls after its modal —
one merge path, not two. `createCombinedPart` returns an error string instead of
toasting so both callers can report it their own way.

**Merge needs no confirmation.** `'new'` keeps the originals and `'replace'`
moves them to the Recover-deleted bin (`restoreObject` undoes it), so the AI tool
is SAVE_GATED only. The modes keep the UI's names (`'new' | 'replace'`) rather
than the `'into'` floated in the plan, so the API, modal and docs agree.

**App config validation is mirrored, then drift-tested.** The Advanced Settings
modal declares min/max inline in JSX, so a generated table
(`src/config/appConfigBounds.ts`) carries them and a unit test re-parses the
modal and fails on any mismatch. Only keys with a settings field are settable —
UI parity, not a back door to internal knobs. The AI tool writes a short
allow-list of result-affecting keys (never the `ai` section) and asks the user
to confirm, since the change persists across sessions; the confirm dialog now
names the setting.

**Diagnostic log redaction is pure and unit-tested.** `src/diagnostics/logQuery.ts`
redacts credential URL params, auth/API-key headers and JSON fields, and known
key formats before entries leave the app. The default limit is a new config
knob (`ui.diagnosticLogApiLimit`) with a settings field.

**Camera convention matches getViewState.** `setCamera` is the inverse of
`getCameraState` (az 0 = front/−Y), implemented in the viewport as
`setCameraOrbit`; `frameObjectPart` reuses the rail's part/piece key resolution
(extracted into shared helpers so highlight and frame can't drift) and frames
from the current view direction. Both AI tools sit in a new `UI_GATED` set
(always on outside plan mode, not model-changing); PR4 introduces the same set
name, noted in a comment for the merge.

**Curvature quality awaits its own re-run.** `setCurvatureQuality` commits
silently through the panel module (so an open panel won't revert it on close)
and then awaits `runCodeSync`, so the result carries the new triangle count
instead of racing the listener's RAF re-run.

**Parity test window.** The API object outgrew the 400 KB scan window in
`apiParity.test.ts`, so the scan now reads to the `help(` member with no fixed
window.
