---
date: "2026-10-28T02:35:00Z"
task: "feat: split an object into pieces or parts when exporting"
pr: 1176
areas: [ui, export, agents, tooling]
cost: medium
---

## Liked / Worked
- Reusing the import side's pure helpers (`computeMeshPieces`,
  `summarizeObjectParts`) and exporting one `layoutBambuPlates` for both the
  builder and the picker's preview kept the preview honest with no duplicate
  packer.
- A background `work-reviewer` pass while I pushed the draft caught two real
  blockers (label map vs displayed mesh; Whole changing the single-object file
  shape) that every test I'd written passed straight through.

## Lacked / Didn't work
- `currentLabelMap` indexes `currentLabelMesh`, not `currentMeshData`; it's
  documented at its declaration but easy to miss from a new call site, and no
  type separates them.
- After merging `origin/main`, the local dev server failed on a new
  dependency (`ses`) until `npm ci`: every e2e test failed in
  `waitForEditorReady` with nothing pointing at stale node_modules.

## Learned
- Routing an existing direct export through a new modal changes the file
  even when the user changes nothing (multi-part builders zip and recentre).
  Keep a direct fallback for the "no change" choice.

## Longed for
- A typed `LabeledMesh { mesh, labels }` pair returned by one accessor, so a
  label map can't be paired with the wrong mesh.
- A post-merge hook (or a check in `playwright.config.ts`'s webServer) that
  notices `package-lock.json` changed since the last `npm ci` and says so,
  instead of a Vite import error buried in the WebServer log.
