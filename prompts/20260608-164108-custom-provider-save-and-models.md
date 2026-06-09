---
session: "QRjAG"
timestamp: "2026-06-08T16:41:08Z"
model: claude-opus-4-8
---

## Human

When configuring the local/custom provider via the AI settings menu, I pasted
the API key, clicked "Fetch models", picked a model id, clicked "Use this
endpoint", then Close — but I never clicked "Save key" next to the API key
field, so the key was silently dropped. That's confusing.

Two asks:

1. Add footer buttons next to "Close": a "Save" that saves any pending changes,
   and a "Save and activate" that saves, activates whatever provider is being
   viewed, and closes — so people don't have to scroll back up to the inline
   enable affordance. Make it consistent across all providers. (Noted the cloud
   providers — Anthropic/OpenAI/Gemini — already have a "Done & enable" footer
   button; it's really just the custom/local tab that was missing the parity.)
2. When I fetch the model list via "Fetch models", make those models available
   in the model-selection dropdown in the AI panel, the way they are for the
   other providers.

## Assistant

## Key decisions

**Root cause of the dropped key.** The Custom tab's API key lived only in a
component-local `keyVal` signal and was persisted to IndexedDB *only* by its
own "Save key" button. The shared modal footer ("Done & enable") could activate
the provider but had no access to that local state, so closing — or even
enabling — never flushed a typed-but-unsaved key. Base URL and model id already
persist on the input's `onChange` (blur), so the key was the real gap.

**Footer flush via a module-level registry, not lifted state.** Rather than
hoist the Custom tab's `keyVal`/`url`/`model` signals up into the parent (which
would touch the mount seam and every tab), the mounted tab registers a
`pendingFlush` callback in a `useEffect` (cleared on unmount/tab-switch — only
one tab is mounted at a time). The footer's new `commit(activate)` and
EnableRow's Enable both `await runPendingFlush()` before acting. Only the Custom
tab registers one today; cloud/local tabs persist immediately, so their flush is
a no-op and "Save" there is effectively Save+close. This keeps the change
contained to the modal and avoids a wider refactor.

**Footer shape: Close / Save / Save & activate.** Replaced the single
conditional "Done & enable {label}" with: always-present `Close` (cancel) and
`Save` (flush + close, no provider switch), plus `Save & activate {label}`
(flush + setProvider + close) shown only when the viewed tab isn't already
active and gated on the same `useProviderReady` readiness as before. Renamed the
primary from "Done & enable" to "Save & activate" per the request; updated the
one e2e test (`ai-cli-bridge-setup.spec.ts`) that anchored the old string. Left
the in-body EnableRow "Enable {label}" buttons untouched (separate affordance,
still anchored by tests) but routed them through the same flush so the
lost-key bug can't recur via that path either.

**Persisting the fetched model list.** Added `customModels: string[]` to
`ChatToggles` (per-tab, alongside `customModel`/`customBaseUrl`, so it stays out
of cross-tab bleed and serializes with the rest of toggles). It's a *derived
cache*, so `setCustomModels` deliberately does NOT flip `preset` to 'custom' the
way the user-facing setters do. `fetchModels` writes the ids on success; the
Custom tab also seeds its in-modal pills from this on open so reopening shows the
last list without a re-fetch. Threaded the field through the usual choke points:
`DEFAULT_TOGGLES`, `cloneToggles`, `applyPreset`, `setToggles`,
`mergeWithDefaults` (filtered to strings for back-compat with old localStorage
blobs), and the preset `Omit`.

**DeepPartial fix.** `setToggles` takes a `DeepPartial<ChatToggles>`, whose
mapped type would recurse into the new `string[]` and produce a sparse
array-like not assignable back to `string[]`. Taught `DeepPartial` to pass
arrays through wholesale (`T[K] extends ReadonlyArray<unknown>`), which is the
correct behavior generally and only affects this one array-valued field.

**AI panel dropdown.** For the custom provider, the panel header rendered a chip
that just opened settings. Now, once `customModels` is non-empty, it renders a
real `<select>` (mirroring the cloud providers' picker) populated from the
fetched ids, with the current model appended as "… (custom)" if hand-typed and a
disabled "Select a model…" placeholder when none is chosen. Before any fetch it
falls back to the original chip; the ⚙ header button always remains the path to
reconfigure the endpoint. No new `window.partwright` method needed — this only
surfaces the already-settable `customModel`; fetching is a UI-only config action
that needs the live endpoint.
