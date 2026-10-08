---
date: 2026-09-27
branch: claude/quirky-goldberg-b3xl2h
files_changed:
  - src/ai/openai.ts
  - src/ai/custom.ts
  - src/ai/chatLoop.ts
  - src/ui/aiPanel.ts
  - tests/ai-providers.spec.ts
---

## Human

AI sessions over CLIProxyAPI time out. After upgrading it via Homebrew it
stalls on every thinking step, whatever the model. Is CLIProxyAPI broken, or
do I need to use it differently? Investigate, and open a PR if confident in a fix.

## Assistant

Read CLIProxyAPI's current source. It isn't broken. The newest models think by
default: Claude Opus/Sonnet 5 use adaptive thinking with the display
*omitted*, and Codex models always reason. We send no reasoning fields, so the
upstream thinks with its reasoning hidden. The Chat Completions stream then
carries no bytes until the first answer token. Keep-alives are off by default
too. Our 60 s stall watchdog read that silence as a dead stream, aborted it and
retried, every turn. A second gap: even when reasoning *did* stream as
`delta.reasoning_content`, `consumeChatStream` threw it away, so it never
counted as a watchdog beat.

Fix, in two parts:
- **Parse `reasoning_content` / `reasoning` deltas** into `onThinking`. That
  feeds the watchdog and fills the existing thinking box. It is safe on every
  server, because OpenAI proper never sends these fields. It also helps
  llama.cpp/vLLM/DeepSeek reasoning models.
- **Ask for visible reasoning** with `include_reasoning: true` when the
  Thinking toggle isn't Off. We chose it over `reasoning_effort` because it is
  a visibility flag, not a depth request: unknown-field servers ignore it
  (llama.cpp, Ollama, LM Studio) and vLLM already defaults it on. Ollama maps
  `reasoning_effort` to `think` and errors on non-thinking models, which
  confirms the module's earlier rule against sending depth fields. CLIProxyAPI
  maps the flag to Claude `thinking.display: summarized` and Codex
  `reasoning.summary: auto`. When Thinking is Off, nothing new is sent.

We did not treat SSE `: keep-alive` comments as watchdog beats. Keep-alives
are off by default in CLIProxyAPI, and the Codex bootstrap hold withholds
them anyway, so the change would need user config and still not cover every
path. Verified in the browser against a fake slow CLIProxyAPI (8.4 s of
reasoning, 5 s watchdog). It completes on one request after the fix and never
answers before it.
