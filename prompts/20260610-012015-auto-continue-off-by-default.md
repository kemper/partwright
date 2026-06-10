---
session: "practical-galileo-nqsbea"
timestamp: "2026-06-10T01:20:15Z"
model: claude-opus-4-8
---

## Human

We should discontinue auto-continue by default. If the model asks a
clarifying question, auto-continue just doesn't wait for an answer and
keeps modeling. That could be useful for somebody, but generally it's a
surprise people wouldn't like — so disable that button by default.

## Assistant

## Key decisions

**Scope of the default flip**: `ChatToggles.autoResume` was on by default
because the effective app default spreads `DEFAULT_TOGGLES_BY_PRESET.standard`,
which had `autoResume: true`. Flipped the `standard` preset to `false` so a
fresh context (and the default preset) no longer auto-continues. Left the
`full` preset at `true`: it's the explicit max-autonomy opt-in, which keeps
the feature reachable for the "could be useful for somebody" case the user
flagged, without making it the surprising default. `minimal` was already
`false`. The pill itself is untouched — it's still there to opt in.

**Existing users preserved**: `loadSettings → mergeWithDefaults` keeps a
user's explicitly-saved `autoResume`, so anyone who already turned it on (or
off) is unaffected; only fresh contexts pick up the new default.

**Docs/tests kept in sync**: updated the JSDoc on `autoResume`, the pill
tooltip in `aiPanel.ts`, the help-page copy, and `docs/ai-internals.md` to
say "off by default (on only in the full preset)". Flipped the e2e default
assertion in `ai-autoresume.spec.ts` (now asserts OFF by default and that an
*enable* persists across reload). Left the dated `whatsNew.ts` changelog
entry as-is — it's a point-in-time record of the launch state.
