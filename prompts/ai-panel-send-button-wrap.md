---
date: 2026-11-18
branch: claude/peaceful-lovelace-ennngb
files_changed:
  - src/ui/aiPanel.ts
---

## Human

Using the app with the window full-screen, the AI panel's Send button is off
the screen (screenshot showed Show AI / 📎 / 🎤 / rewind transport / Stop, with
Send cut off past the panel edge while a turn was running).

## Assistant

## Key decisions

**Root cause**: the input button row was a single non-wrapping flex line whose
children are all `shrink-0`. Mid-turn the Stop button appears next to the
rewind transport, and the row's natural width exceeds the default 420 px panel
— measured on main, Send's right edge landed 16 px past a 1280 px viewport.

**Fix**: make the row `flex-wrap` and move transport + Stop + Send into one
right-aligned (`ml-auto`) cluster. When space runs out the whole cluster drops
to its own line, so Send is never pushed outside the panel and the
Stop/Send pair is never split. Chose wrapping over shrinking/hiding labels so
no control disappears and nothing changes at wider panel widths.
