---
session: "01QnZGNLCXKvn86WwN1Bxf6x"
timestamp: "2026-10-27T17:45:00Z"
model: claude-sonnet-5-5
---

## Human

Make the engine sandbox default to on in code and open a PR. Then clarified: not opaque mode, use the separate origin mode.

## Assistant

Default is now `origin` whenever the build configures `VITE_SANDBOX_ORIGIN` (production). Builds without it (dev, forks, unconfigured previews) keep `off`, because origin mode fails closed without a configured origin and would break the app. `VITE_ENGINE_SANDBOX` still overrides. The Playwright dev servers pin `VITE_ENGINE_SANDBOX=off` so the broad e2e suite is unchanged; the sandbox specs choose their mode explicitly. Updated docs, legal copy and unit tests.
