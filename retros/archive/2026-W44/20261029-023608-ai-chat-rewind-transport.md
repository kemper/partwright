---
date: "2026-10-29T02:36:08Z"
task: "feat: step-by-step rewind controls for the AI chat"
pr: 1202
areas: [ai-panel, testing, agents]
cost: low
---
## Liked / Worked
- Seeding `aiChats` rows straight into IndexedDB (pattern from
  tests/ai-tool-history-repair.spec.ts) made a network-free e2e for chat
  history UI trivial — no provider stub needed.
- Pulling the cut/step math into a pure module (src/ai/rewind.ts) let the
  hairy invariant (tool_use/tool_result adjacency across cut+restore) be
  pinned in vitest in ~1s.
- The work-reviewer subagent caught a real data-loss bug (rewound slice
  cleared by an unrelated same-session reload) that my own tests missed.

## Learned
- `setActiveSession` in aiPanel.ts skips its reload only while
  `state.history.length > 0`, and main.ts calls it on every session state
  change (saveVersion, loadVersion, rename…). Any in-memory chat-panel state
  reset in `loadHistoryForCurrentSession` therefore gets wiped whenever the
  transcript happens to be empty. Not documented near either function.
- Queued mid-run follow-ups are merged into the tool-result carrier
  (blocks + toolResults on one user message) — anything that slices history
  at "user messages" must treat that shape specially.

## Longed for
- A tiny e2e helper (`tests/helpers/chatSeed.ts`) exporting
  `seedChat(page, sid, rows)` / `readChat(page, sid)` — at least three specs
  now hand-roll the same IndexedDB open/put/getAll boilerplate.
