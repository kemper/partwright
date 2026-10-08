---
date: 2026-06-20
author: claude (opus-4-8)
task: Assisted publish to Printables/MakerWorld/Thingiverse/Thangs (PR #790)
---

## Liked
- Researching the platforms' API reality BEFORE designing was the highest-leverage move: it turned "build auto-publish" into "build assisted-publish" and saved committing to an impossible (backend-needing, ToS-violating) path. Web search up front beat assuming.
- The export pipeline's existing `*Data` / `build*` separation + `downloadBlob` made the no-backend flow fall out cleanly — file bytes, cover render, and clipboard were all already client-side.
- Callback-injection for the modal (buildFile/buildCover/download passed in) kept `publishModal.ts` decoupled from `main.ts`'s mesh closures and the pure `publishTargets.ts` node-testable.

## Lacked
- No `gh` CLI in this remote env and MCP-only GitHub means a Monitor bash poll can't watch CI — so there's no clean automated "wake me on CI success." Had to fall back to a bare `sleep; echo` self-check-in. A first-class "re-poll this PR via MCP in N minutes" affordance would close the gap.
- Upload URLs for each platform are best-guess (no API to confirm an upload entry point); I couldn't verify them headlessly. They're easy to fix but ship unverified.

## Learned
- `src/main.ts` has literal NUL-byte zones — but `grep -an` worked fine for the symbols I needed; the binary-detection trap only bites on the cache-key template regions. Targeted line-offset reads sidestep it entirely.
- Strict-mode `getByRole('button', {name})` collides when a pill label is a substring of the primary button ("Printables" vs "Download & open Printables") — use `exact: true` for short labels.

## Longed for
- A capability registry both the command palette and `window.partwright` derive from, so UI↔API parity is structural instead of a same-PR discipline. Adding the command-palette entry, the API method, the help() row, and two docs by hand for one feature is exactly the drift surface CLAUDE.md warns about.
