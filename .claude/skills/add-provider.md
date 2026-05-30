# Add Hosted Provider

Full checklist for wiring a new cloud AI provider into the in-app chat. Run when adding a provider beyond the existing Anthropic/OpenAI/Gemini/Local set.

See `docs/ai-internals.md` for per-provider wire-format details (thinking levels, routing) to use as reference when implementing `streamTurn`.

## Steps

1. Add the id to `Provider` in `src/ai/types.ts` and a `<name>Model` field to `ChatToggles` (+ default in `settings.ts`).
2. Add a sibling case to `activeModel(toggles)` in `src/ai/types.ts`.
3. Create `src/ai/<name>.ts` exporting `streamTurn`, `summarize`, `validateKey`, `resetClient` — same shape as `anthropic.ts`.
4. **Wire pricing.** Add the provider's models.dev id to `CATALOG_PROVIDER_ID` in `src/ai/catalog.ts` so `getPricing()` resolves real rates from the build-time snapshot. For specific models the snapshot doesn't carry, add explicit entries to `KNOWN_MODEL_PRICING` in `src/ai/cost.ts`; everything else falls back to `FALLBACK_PRICING`.
5. Add a `<name>_MODEL_OPTIONS` array + `set<Name>Model` setter in `src/ai/settings.ts`.
6. Add dispatch + compaction branches in `chatLoop.ts` / `compaction.ts`.
7. Add a `buildHostedProviderSection(<name>, …)` call in `aiSettingsModal.ts`, a `PROVIDER_UI` entry in `aiKeyModal.ts`, and a `hostedConfig` entry in `aiPanel.ts`'s `renderModelPicker()`.

After implementing, run `npm run test:unit` (provider request-shape tests) and the AI chat e2e spec: `npx playwright test --grep "AI chat"`.
