---
session: "brave-hawking"
timestamp: "2026-06-04T15:15:33Z"
model: claude-opus-4-8
tools: [explore-subagent, playwright]
---

## Human

Reported a bug from a session with the in-app AI. Two issues:

1. After saving a new version and refreshing the page, the editor showed
   stale draft code instead of the just-saved version. The user expected
   that clicking Save (or saving via the API) clears the draft history so a
   refresh loads the saved version — but the draft "survived and got used on
   refresh." (The in-app AI had earlier claimed the Save button is "disabled
   whenever the active model has an error" — that explanation turned out to be
   a hallucination; no such logic exists.)

2. The user wants Save to work even when the code has a validation error, but
   to show a warning toast that the saved version contains errors.

## Assistant

## Key decisions

**Root cause of the refresh bug (issue 1).** Drafts are autosaved per
`(session, part, language)` and restored on load by `restoreDraftIfNewer`,
which restores the draft whenever it differs from the loaded version's code.
Nothing ever deleted the draft after a version was saved. The failure mode:
when a *non-editor* path commits a new version — e.g. the AI tools load fixed
code via a programmatic `setValue` (which doesn't trigger the input-driven
autosave) and then call `saveVersion` — the IndexedDB draft still holds the
OLD code. On reload, draft ≠ saved version, so the stale draft shadows the
fresh save. Confirmed this is the exact mechanism via an explore subagent.

**Fix: clear the draft inside `saveVersion`, not at the call sites.** Every
save path (UI button, ⌘S, `window.partwright.saveVersion`, `runAndSave`,
`forkVersion`, AI tools) funnels through `saveVersion` in `sessionManager.ts`,
so deleting the now-superseded draft there fixes all of them at once. Added a
single-key `deleteDraft(sessionId, language, partId)` to `db.ts` (the existing
`deletePartDrafts` deletes *all* languages for a part, which would discard
unsaved work in a language the user merely switched away from — too broad).
Delete only the active-language draft, keyed by `version.language ??
getActiveLanguage()` so it matches the key the autosave/restore path uses.
Best-effort with try/catch: the version is already committed, so a draft-delete
failure must not fail the save. Captured `sessionId`/`partId` before the
`currentState` reassignment because that reassignment resets TS null-narrowing.

**Issue 2: saving is already allowed with errors — the missing piece was the
warning.** There was never any error-gating on Save (the AI's claim was
wrong); a broken model already saves with `geometryData.status === 'error'`.
So the only real change needed was feedback. Kept the toast in the UI layer
(`sessionBar.ts` button handler + `saveVersionWithToast` for ⌘S/command
palette) rather than in `saveVersion` — `sessionManager.ts` is storage-layer
and has no UI imports; routing toasts through it would break that layering.
Added three outcomes so a Save click is never a silent no-op: neutral "No
changes to save" when `saveVersion` returns null (the dedup case, which
previously looked like a dead button and is the likely real cause of the
user's "I can't click Save"), amber warn when the saved model has errors, and
green success otherwise.

**What I skipped.** Did not add an error-status warning to every internal
`saveVersion` caller (import/merge/relief flows) — those are not the
user-driven "Save" surfaces the request was about, and they have their own
established toasts.

**Verification.** Added an e2e regression test in `autosave.spec.ts` that
autosaves a stale draft, commits a different version via the API, reloads, and
asserts the editor shows the saved code (not the stale draft). Confirmed it
genuinely fails when the `deleteDraft` line is removed. Manually exercised the
warning toast in a real browser (scratch spec + screenshot) and posted it.
Build + unit (598) + the autosave e2e all green.
