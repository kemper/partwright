---
session: "01U8g7w9"
timestamp: "2026-10-27T06:15:00Z"
sequence: 9
---

## Human

add the photo fit to the in-app AI

## Assistant

## Key decisions

**A console method first, then a thin chat tool over it.**
`partwright.fitHuman(options)` is the twin of `npm run human:fit`, so external
agents get it too. The chat tool `fitHumanToPhoto` calls it with `save: true`
and drops the generated code from the result, the same as `buildCharacter`.
It is SAVE_GATED, since it commits a version, so it disappears when the user
pauses commits.

**Same scoring and search as the CLI, shared rather than copied.** The
re-aligned silhouette IoU moved into `fitSilhouetteIoU` in `humanFit.ts`; the
CLI now calls it too. Candidates are built with `executeCodeAsync` in the
sandboxed engine Worker, bound to the session's trust domain (a session switch
stops the fit), and never touch the viewport. Only the winner is run and saved.

**Budget is an app-config knob** (`import.humanFitBudget`, default 80, with an
Advanced Settings field) per the no-hardcoded-tuning rule. At ~0.5–1 s a build,
80 builds stays well inside the 5-minute tool-call timeout.
