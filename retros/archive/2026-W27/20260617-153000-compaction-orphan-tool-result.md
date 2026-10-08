# Retro — repair orphaned tool_results stranded by compaction (PR #721)

## Liked
- The bug had a clean, single root cause once framed as a *direction*: the whole
  repair stack (provider sanitizers + `repairToolHistory` + the repair button gate)
  only handled orphaned tool_**use**, never the mirror orphaned tool_**result**.
  Naming the symmetry turned a vague "400 after compact" into a precise, testable gap.
- `tests/ai-providers.spec.ts` already had the exact pattern (stub `window.fetch`,
  capture the request body, assert the wire payload) for the tool_use direction —
  cloning it for the tool_result direction gave real-browser proof across Anthropic /
  OpenAI Responses / OpenAI Chat in three short tests.

## Lacked
- No way to reproduce the actual provider 400 headlessly (needs a real key + a
  corrupted persisted history), so verification leaned on the wire-format assertions
  rather than an end-to-end "compact → next turn sends" flow. The 400 itself is only
  provable against a live provider.
- The repair invariant lives in FIVE places (3 provider sanitizers + the shared
  `repairToolHistory` + compaction's own head-walk). Each handled the tool_use
  direction independently, so the tool_result gap had to be closed in all of them.
  A single canonical bidirectional `repairToolHistory` that every builder routes
  through (gemini + local already do) would shrink that surface.

## Learned
- Compaction's `isOrphanToolResultHead` only guards the *head* of the kept window;
  it silently assumes normal message ordering makes interior orphans impossible.
  That holds for clean histories but not for ones already nicked by an earlier
  partial repair / aborted turn / cross-tab edit — exactly when compaction runs.
- The repair-button gate (`hasOrphanedToolCalls`) and the actual repair were the
  same function, so a detection gap and a fix gap were one bug: the button never
  appeared *because* the repair couldn't see the orphan. Worth checking, when a
  "recovery doesn't fire" report comes in, whether detection and remedy share a path.

## Longed for
- A persisted-history invariant assertion (dev-only) that flags any tool_result whose
  tool_use_id isn't present, fired on load/after every structural edit (compact,
  rewind), so this class of corruption is caught at write time instead of as a
  provider 400 on the next send.
