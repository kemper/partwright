---
session: "01qnzgnp"
timestamp: "2026-10-30T00:05:00Z"
sequence: 3
---

## Human

Looks good. The annotate menu should start in select mode, which is basically
the same as before Annotate was opened: a select/cursor button selected
initially and leftmost. Don't enable the Lock mode. Selecting a colour jumps to
pen mode. Esc exits pen mode back to select. During pen or text the view should
be locked and not move, without needing the actual Lock mode. Fix, update the
PR, then merge it.

## Assistant

## Key decisions

**Select is Annotate's resting state and no longer locks the orbit.** Instead
of the user Lock, select claims a pointerdown only when it lands on an
annotation, via the viewport's capture-phase pointer suppressor (the same hook
paint uses), so empty-space drags orbit exactly as without Annotate.

**A separate draw lock for pen/text.** New `setDrawLock` in viewport.ts freezes
rotate, pan *and* zoom (the frame being marked up must not move — Snapshot
captures the camera at save time) without touching the user Lock, so the
toolbar's Lock pill never lights up. Text takes the lock after deactivating
pen, whose deactivate releases the same flag.

**Esc steps back a level.** Pen/Text → Select; Select (nothing selected) →
close. main.ts's global "Esc closes open tools" handler now defers while pen or
text is active, otherwise it closed the panel before Annotate could step back.
Keys typed into fields (label input, view title) are left to the field.

**Colour pick from Select → Pen**; in Text the colour applies to the next label
and the mode stays.
