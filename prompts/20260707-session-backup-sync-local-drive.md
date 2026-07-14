---
session: "session-storage-local-drive"
timestamp: "2026-07-07T14:00:00Z"
model: claude-opus-4-8
sequence: 1
---

## Human

Add two related storage features: (1) let the user pick a local file/directory
where all changes to their sessions are automatically saved, so they have a copy
outside the browser; (2) a pure client-side Google Drive OAuth flow where files
can also be stored and read from a Drive directory. Minimize the Drive
permissions requested (don't scare people / avoid touching the wrong things) —
ideally always create a `partwright` subfolder and limit access to just that
folder rather than the whole Drive. Investigate, report back; then (chosen after
the report) build both together, wiring the Google client id in later, and open
a PR if confident.

## Assistant

## Key decisions

**Two-target one-way backup + explicit restore, not bidirectional sync.** A live
two-way sync would need merge/conflict resolution across tabs/devices — a large
correctness surface for little gain here. Scope: the ACTIVE session is written to
every connected target on each change (debounced); `backupAllSessions()` pushes a
full snapshot on demand / first connect; restore is an explicit pick-a-file
import. This satisfies "changes automatically saved" + "read from" without the
conflict machinery.

**Session schema untouched — synced files reuse `exportSession()`.** The synced
artifact is the existing full-fidelity `.partwright.json`, so none of the
7-location session-migration checklist applies. The only persistence change is a
new IndexedDB store `syncTargets` (db.ts v8→v9) holding connection state: the
File System Access directory handle (structured-clone-able), and the Drive
folder id + session→file-id map. Access tokens are NEVER persisted.

**Hook point = the `onStateChange` chokepoint.** `notify()` in sessionManager
fires after every session/version/part mutation; `syncManager` subscribes there,
debounces (`config.sync.debounceMs`), serializes via `exportSession`, and writes.

**Google Drive: `drive.file` scope, redirect OAuth — deliberately NOT the
popup.** `drive.file` gives per-file access to only app-created files in a
visible `partwright` folder; it's non-sensitive, so no Google verification and no
"unverified app" warning (directly serves the "don't scare people" goal).
`drive.appdata` was rejected because that folder is hidden from the Drive UI —
the user wanted a directory they can see.

The pivotal call was auth transport. The GIS popup token flow needs
`Cross-Origin-Opener-Policy` relaxed from `same-origin`, but this app
HARD-REQUIRES cross-origin isolation for its WASM engine (SharedArrayBuffer) —
`ensureEngineStarted` shows "WASM unavailable (not cross-origin isolated)" with
no single-threaded fallback. `restrict-properties` keeps isolation on Chromium
but risks silently dropping it (→ breaking the whole editor) on any browser that
doesn't honor the value (Firefox/Safari currently get isolation via
`same-origin`). Rather than gamble the entire app on a header flip I can't verify
cross-browser, I used a full-page **implicit redirect** flow: no popup → no
opener relationship → COOP/COEP and the CSP stay untouched, works on every
browser, no GIS library, no backend. Cost: token lives ~1h in memory and a
redirect is needed to (re)connect. The popup+`restrict-properties` optimization
is noted as a future option to verify on a real Cloudflare preview.

**Client id via `VITE_GOOGLE_CLIENT_ID` build env.** Unset → Drive reports
"not configured" and the UI greys it; local-folder sync and the rest of the app
are unaffected. Lets the feature ship before the Google Cloud console setup.

**UI↔API parity closed in-PR:** toolbar Export → "Backup & sync…" modal
(`syncModal.ts` on the shared `modalShell`), `window.partwright` methods
(`openSyncSettings`/`syncStatus`/`connectDrive`/`disconnectSync`/
`backupAllSessions`/`listSyncBackups`/`restoreFromSync`), help() table entries,
and `public/ai/file-io.md` docs. Config debounce/skew added to `appConfig.sync`
+ the advanced-settings modal (no hardcoded tunables).

Verified: typecheck, 1744 unit tests, no circular deps, production build,
2 new e2e specs, and a browser screenshot of the modal (Local folder connectable
in Chromium; Drive correctly "not configured").
