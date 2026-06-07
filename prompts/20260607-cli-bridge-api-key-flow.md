---
session: "local-cli-endpoint-wrapper"
timestamp: "2026-06-07T16:50:00Z"
---

## Human

(Follow-up after trying the bridge.) CLIProxyAPI failed to start — localhost:8317
showed "Example API key detected … replace template values in
cliproxyapi.conf, then restart." Requests:
- Tell users to open localhost:8317 to see/fix errors or confirm it's working.
- Generate a random API key in the frontend; give a `sed` one-liner that
  replaces the `your-api-key-N` block with it, then a restart command (and the
  closest equivalent for other OSes).
- In the API key field, add a button to use that generated key (warn to only
  use it if they ran the command with it). Don't mask the key as a password.
- Next to the Done button add "Done and also enable the selected provider" so
  users aren't confused that edits don't auto-enable. Rename Done → "Close".

## Assistant

## Key decisions

**API key is now a required setup step, not a nicety.** CLIProxyAPI refuses to
start while its config holds the template `your-api-key-N` values, so the card
gained a step 2 "Set an API key (required)" between install and login. It
surfaces a `localhost:8317` status link in step 1 ("confirm it's running, or see
errors to fix") since that's where the failure shows.

**Browser-generated key, matched end to end.** `generateApiKey()` (crypto-
random, `pw-` + 48 hex, no shell metacharacters) is generated once per modal
open in `CustomTab` and threaded into both (a) the bridge card's setup command
and (b) the "Use the bridge key" button in the API-key field — so the value the
proxy is configured with and the value Partwright sends are guaranteed to match.
The macOS one-liner is a runnable `sed -i '' … "$(brew --prefix)/etc/
cliproxyapi.conf" && brew services restart cliproxyapi`; Linux gets a `sed`
template with a path placeholder; Windows falls back to a manual instruction
(its config path/tooling varies too much to script honestly).

**API-key field is plain text now**, with a note that it's shown unmasked so the
user can match it against the bridge config. The "Use the bridge key" button
only fills the field (doesn't auto-save) so the user can eyeball it before
saving.

**Footer: "Close" + "Done & enable <provider>".** Renamed "Done" → "Close"
(more accurate) and added a primary "Done & enable <provider>" that switches the
active provider to the currently-viewed tab and closes — fixing the confusion
that editing fields doesn't enable the provider. Readiness is shared with the
top EnableRow via a new `useProviderReady(tab)` hook (extracted from EnableRow's
old inline logic) so the two enable affordances can't disagree. Updated
`smoke.spec.ts` which anchored on the AI Settings "Done" string.

**Verification.** Build + unit (718) + deadcode/deps gates green; extended
`tests/ai-cli-bridge-setup.spec.ts` to assert the required-key step, the
disabled→enabled footer button, the text-typed key field, and that "Use the
bridge key" fills a `pw-…` key; re-ran smoke (17 passed). Screenshots of both
the auto-detected and macOS variants posted in chat.
