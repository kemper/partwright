---
session: "u0cvuk"
timestamp: "2026-06-11T02:02:14Z"
model: claude-opus-4-8
---

## Human

(Follow-up on the slow-voxel-rotation investigation.) "I think the bug may only
happen on mobile with touch screen drag effects."

## Assistant

## Key decisions

**The mobile/touch clue pointed to `touch-action`, a different root cause than
the frame-rate damping fix.** OrbitControls sets `domElement.style.touchAction =
'none'` exactly once (on connect) and relies on it staying — that's what stops
the browser from claiming a touch drag for scroll/pinch. Voxel Studio's
`attachPointerHandler` overrides it with `'none'` (fine), but
`detachPointerHandler` reset it to `''` on teardown instead of restoring it. So
once you've used the studio, the canvas loses `touch-action: none`, and on a
touch device the browser reclaims part of every subsequent orbit swipe — the
model "turns far less." A mouse ignores `touch-action`, which is exactly why it's
touch-only and why it was invisible in my earlier desktop measurements.

**Fix:** capture the canvas's prior `cursor` / `touch-action` on attach and
restore them on detach (instead of blanking to `''`), so OrbitControls' `'none'`
survives a studio open/close. Verified in-browser: `touch-action` reads `'none'`
before → during → after the studio, where before this change it was cleared to
`''` afterwards. Added a permanent regression assertion to
`tests/voxel-studio-camera.spec.ts`.

This is the actual fix for the reported mobile symptom; the frame-rate-independent
damping change from the first commit stays as a complementary robustness
improvement (it helps the low-frame-rate "coast feels slow" case on any device,
and is a no-op at 60 fps).
