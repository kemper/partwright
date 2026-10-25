---
session: "2e5a769d"
timestamp: "2026-10-24T15:26:39Z"
tools: [playwright, vitest]
---

## Human

For the CLIProxyAPI setup: let me set an API key in settings instead of always being given one; give a command that appends a new key instead of replacing the current one; never make the user replace the key once the connection works; be smarter about telling them to run `cliproxyapi --claude-login` when the Custom endpoint loses its auth; fix the bad UX of pasting the key into the "API key (optional)" field below Test Connection / Fetch Models. Support non-local CLIProxyAPI and non-CLIProxyAPI OpenAI endpoints via a long-lived list of saved endpoints + API key + default model (+ whatever else makes sense). Local CLIProxyAPI setup should read top to bottom. Open a PR with visual proof.

## Assistant

## Key decisions

**Saved endpoints as the durable library, toggles as the applied copy.** New `aiEndpoints` IndexedDB store (DB v11) holds name, kind, base URL, API key, default model, last model list, reasoning opt-in, bridge config path and last-connected time. The chat Worker still reads base URL/model from ChatToggles, so selecting an endpoint copies onto toggles and mirrors its key into the legacy `aiKeys` 'custom' row. Every place that read the custom key now calls `resolveCustomApiKey(baseUrl)`, which matches the saved endpoint by URL. That keeps the key right even when a session restores toggles that point at a different endpoint. No toggles field was added: the URL match avoids drift with session-restored toggles.

**Durability.** The store is separate from localStorage settings, so presets, settings resets and session switches can't touch it. Saves request persistent storage, and a Back up / Restore JSON file covers moving browsers or clearing site data. The upgrade path seeds one endpoint from the existing URL/key/model inside a single readwrite transaction, so two tabs can't both seed and a working connection carries over unchanged.

**Append, never replace.** The old sed one-liner replaced every `pw-` key and so broke other browsers. The new command is an awk script that appends the key to `api-keys`, drops only the `your-api-key-N` placeholders, matches the list's indentation, handles `[]` and a missing section, and is a no-op if the key is already there. A companion command lists the keys the bridge accepts, so a second browser can reuse one. Unit tests run both scripts against sample configs. A bridge endpoint's key is generated once, at creation, and never regenerated; "New key" is explicit and asks for confirmation. The key field is editable, so users can paste their own.

**Login-loss detection.** `classifyBridgeError` separates the bridge's own "Invalid/Missing API key" from lost subscription auth: auth_not_found/auth_unavailable, "unknown provider for model", upstream OAuth expiry, invalid_grant, and so on. The Custom provider appends a login hint with the right flag for the model family (--claude-login / --codex-login / --login). The hint is stated with confidence for :8317 or bridge-specific messages and hedged for other URLs. These errors are now non-transient, so chat no longer retries the 500s three times. Connect also checks the model list: an empty list, or one missing the chosen model's family, means the login is missing, and the status shows the command.

**UX.** The bridge editor's steps are the form itself, in order: install, key (field + append command), login, base URL + Connect (which tests and fetches in one go), then model. The key comes before Connect, and a paste saves at once. The long append script shows as a one-line summary; Copy copies the whole script and a toggle reveals it. Generic endpoints use the same editor without the bridge steps and are auto-named after their host.

**Not added:** no `window.partwright` API for endpoints. AI-provider settings and keys have no console API today, and exposing stored keys to page scripts would be a step backwards.

**Review round (work-reviewer findings, all fixed).**
- The active endpoint is now resolved with the mirrored legacy key as the tie-break. Two entries at one URL (e.g. a second bridge entry) can no longer hijack the key being sent.
- Connect writes its results to the endpoint it started on, by id, even if the user switched rows mid-request.
- A plain Save no longer re-applies an untouched endpoint over the session's model.
- Deleting the in-use endpoint clears the mirrored key.
- Restoring a backup re-opens the editor from the stored rows, so a stale draft can't write itself back.
- The awk script strips CRLF and accepts a header comment. It exits 3, leaving the file untouched, on a non-empty flow list rather than appending a duplicate section.
- The command keeps a `.pw-bak` copy and restarts the bridge only after a successful write.
- Only the exact Homebrew default path is double-quoted; anything else is single-quoted, which closes the injection path through a restored config path. macOS ignores a stored config path.
- Backup download now asks for confirmation, since the file holds plaintext keys.
