---
date: "2026-10-25T14:15:00Z"
task: "feat: size AI context for local OpenAI-compatible endpoints and prune stale tool payloads"
pr: 1125
areas: [providers, ai-panel, tooling]
cost: low
---

## Liked / Worked
- `npx vite-node <script>` importing `src/ai/tools.ts` + `systemPrompt.ts` measured the real
  per-request payload (prompt chars, tool-schema chars per tier) in seconds. Those numbers
  drove every design call: description-trimming alone only got 61k → 20k tokens, so tiers had
  to subset tools.
- `tests/unit/appConfigApi.test.ts` failed loudly when the new Advanced-settings fields were
  missing from `APP_CONFIG_FIELD_BOUNDS`, a drift I'd otherwise have shipped.
- `lint:deps` caught a cycle created by a *type-only* import (tools → settings → customContext → tools).

## Lacked
- Nothing documents how big the fixed AI payload is (system prompt + tool schemas). The
  context meter silently ignores the ~60k tokens of tool schemas (filed #1126). (cost: ~2 turns to measure)

## Learned
- madge counts `import type` edges, so a pure-logic leaf that needs a tools.ts type should use a
  structural interface (as `customContext.ts` does) rather than `import type { ToolDefinition }`.
- Adding a ChatToggles field touches 5 sites in `settings.ts` (defaults, clone, preset, setToggles,
  load). Nesting new provider-specific knobs in one object keeps that to one line each.

## Longed for
- `npm run ai:payload [--provider custom --tier slim]`: print the per-request token budget
  (prompt, tools by size, top-10 heaviest tool schemas). It would make tool-schema bloat
  visible in review, and could be a CI budget check that fails when a tool description grows past N.
