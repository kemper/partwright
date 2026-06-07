---
date: 2026-06-07
branch: claude/voice-mic-icon-larger
files_changed:
  - src/ui/aiPanel.ts
---

## Human

The merged voice-input microphone icon should be larger / more noticeable.
Make a new PR with that change.

## Assistant

Follow-up to the merged voice-input feature (#471). The mic button originally
shared the `text-[11px]` glyph size of the neighbouring Show AI / 📎 buttons,
which made it blend in.

To make it stand out:

- Bumped the glyph from `text-[11px]` to `text-lg` (with `leading-none` so the
  larger emoji doesn't inflate the row height) and nudged horizontal padding to
  `px-2.5`.
- Gave the idle state a blue accent — `text-blue-300` with a
  `border-blue-500/40` border that brightens to `border-blue-500` on hover — so
  it reads as the distinct "voice" affordance rather than another grey utility
  button. The active (listening) state keeps its red `animate-pulse` treatment,
  just at the new larger size.

Verified in the browser with a throwaway screenshot spec (mic visibly larger and
blue-accented next to the other buttons) and re-ran the existing
`ai-voice-input` e2e spec to confirm the wiring still passes.
