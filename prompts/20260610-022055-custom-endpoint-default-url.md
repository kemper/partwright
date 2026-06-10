---
session: "upbeat-carson-e6lhoy"
timestamp: "2026-06-10T02:20:55Z"
model: claude-opus-4-8
---

## Human

Since the local model instructions are for the CLI API proxy, let's default the
local (Custom OpenAI-compatible) endpoint to `http://localhost:8317/v1` so the
user doesn't have to enter it.

## Assistant

## Key decisions

**Single source of truth for the default URL.** The Custom provider's onboarding
card (`cliBridgeSetup.tsx`) already hardcoded `http://localhost:8317/v1` as
CLIProxyAPI's default endpoint for its "Use this endpoint" button. Promoted that
to an exported `DEFAULT_CUSTOM_BASE_URL` in `src/ai/settings.ts` (the ai-layer
config home; ui imports down into ai, never the reverse, so no cycle) and made
`cliBridgeSetup.tsx` import it — so the pre-filled field and the button can't
drift.

**Pre-fill, two ways, for new and existing users.** Set
`DEFAULT_TOGGLES.customBaseUrl` to the constant so brand-new users get it in
stored toggles. For existing users (whose saved blob already holds `''`, which
`mergeWithDefaults`' `??` leaves untouched), the Custom tab's Base URL input now
seeds from `settings.toggles.customBaseUrl || DEFAULT_CUSTOM_BASE_URL`; the
modal's existing `pendingFlush` persists it on close. Deliberately did NOT
migrate stored `''` → default, to avoid overwriting a URL a user intentionally
cleared.

**Scoped `aiConnectionMode` to the custom provider.** This was the one global
side effect: it returned `'cloud'` whenever `customBaseUrl` was non-empty,
regardless of the active provider. With the URL now shipping pre-filled, that
would have made every fresh user (default provider `anthropic`, no key) falsely
report "connected", suppressing the auto-open-settings flow and lighting the
toolbar chip. Added `provider === 'custom' &&` to the check so a non-empty URL
only counts as connected when the user actually selected the custom provider —
which is also the more honest signal. All other `customBaseUrl` reads were
already gated on `provider === 'custom'` and/or a non-empty `customModel`, so no
regression there (e.g. the cross-provider review modal still won't offer Custom
until a model is set).

**Tests.** Updated the two e2e specs that asserted the old empty-start behavior:
`ai-cli-bridge-setup.spec.ts` now expects the Base URL pre-filled and
"Save & activate" enabled out of the box (clicking "Use this endpoint" is
idempotent); `ai-providers.spec.ts`'s gate test now verifies the URL ships
pre-filled and ready, then clears it to confirm the gate still flips to disabled
and back. Verified via build, unit tier (981 pass), the two affected e2e specs,
and an eyes-on screenshot of the pre-filled Custom tab.
