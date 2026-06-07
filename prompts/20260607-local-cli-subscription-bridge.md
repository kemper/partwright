---
session: "local-cli-endpoint-wrapper"
timestamp: "2026-06-07T15:35:00Z"
---

## Human

Let people who pay for a Claude Max (or Codex) subscription use the app's AI by
running the CLI agent locally and connecting to it as if it were an
OpenAI-compatible endpoint on localhost. Are there existing frameworks/tools
that do this? Ideally a button in the site that rapidly instructs the user how
to run whatever component is needed. Focus on Claude Code for now. After
discussion: don't build/publish a bridge — prefer pointing users at an existing
tool installable via `brew` (with an `npx`/`winget`-style path for Windows).
Proceed with the plan and open a PR.

## Assistant

## Key decisions

**Reuse the existing Custom (OpenAI-compatible) provider; add onboarding only.**
The app's `custom` provider already speaks `/v1/chat/completions` to any base
URL with optional bearer auth, SSE streaming, a "Test connection"
(`validateConnection` → `GET /models`) and a "Fetch models" button, and the CSP
already whitelists `http://localhost:*`. So no new provider, transport, or
settings were introduced — the only gap was discoverability. The whole feature
is a guided card that fills the existing Base URL field.

**Recommend CLIProxyAPI as the off-the-shelf bridge.** It is the only surveyed
wrapper that clears the two bars a *browser* client needs and is also broadly
distributed: it emits **wildcard CORS** (most IDE-oriented wrappers don't, since
Cursor/Continue are same-origin native apps and never need it), supports
**OpenAI function/tool calling** (which Partwright's geometry tools depend on),
installs via `brew install cliproxyapi` / `winget install LuisPater.CLIProxyAPI`,
runs as a localhost service on :8317, and covers Claude **and** Codex/Gemini via
`--claude-login` / `--codex-login`. The decisive CORS/tool-calling facts were
verified via web research, not memory.

**New component `src/ui/preact/cliBridgeSetup.tsx`** rendered at the top of the
Custom tab (`settingsModal.tsx` `CustomTab`). It is OS-aware (`navigator`
sniff with a manual pill override), shows copy-to-clipboard install + login
commands, and a one-click "Use this endpoint (localhost:8317)" that sets the
Base URL signal and calls the tab's existing `testConnection()`. Kept it as a
sibling file rather than inflating the 900-line `settingsModal.tsx`, and reused
the `Section`/`Pill`/`PrimaryButton` primitives + the existing `navigator.
clipboard.writeText` copy pattern from `aboutModal.tsx`.

**Security + ToS framing in-UI, not just code.** Wildcard CORS + no auth means
any site visited while the bridge runs could spend the user's subscription, so
the card recommends setting an `api-key` in CLIProxyAPI's config and pasting it
into the existing optional "API key" field (closes the hole with zero new code),
and notes that subscription use outside the official client is community
territory — "confirm it's allowed under your plan."

**Verification.** Manual browser screenshot of the card (posted in chat) plus a
golden-path e2e (`tests/ai-cli-bridge-setup.spec.ts`) that opens AI Settings on
the Custom tab, asserts the card + steps render, and that "Use this endpoint"
fills the Base URL with `http://localhost:8317/v1`. The spec dismisses the
first-run tour via `localStorage 'partwright-tour-completed'` (the established
pattern) because the tour backdrop intercepts clicks.
