---
session: "local-cli-endpoint-wrapper"
timestamp: "2026-06-07T17:00:00Z"
---

## Human

(CI follow-up.) e2e shard 1 failed on PR #474.

## Assistant

## Key decisions

**Disambiguated pre-existing selectors broken by the new footer button.** Adding
the footer's "Done & enable <provider>" button made three `ai-providers.spec.ts`
assertions hit a Playwright strict-mode violation: `button:has-text("Enable
OpenAI")` is a case-insensitive *substring* match, so it now also matched "Done
& enable OpenAI". Fixed by switching those locators (and the Custom / Local /
Anthropic equivalents) to exact role queries — `getByRole('button', { name:
'Enable OpenAI', exact: true })` — which target only the EnableRow button. No
product code changed; the new affordance is legitimate, the selectors just
needed to be specific. Verified by re-running the full `ai-providers` spec (33
passed) locally.
