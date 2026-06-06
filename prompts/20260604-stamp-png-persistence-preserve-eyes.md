---
date: 2026-06-04
branch: claude/friendly-lamport-Bdf5m
pr: 368
files_changed:
  - src/color/imagePaint.ts
  - src/color/imagePaintUI.ts
---

## Human

The smiley's eyes are being removed along with the background when stamping, but the keychain/relief import of the same image preserves the eyes. I want the stamp to remove the background the same way the keychain does.

## Assistant

Root cause: stamp image persistence encoded the saved image as JPEG (`imageDataToDataUrl` → `toDataURL('image/jpeg')`). JPEG has no alpha channel, so a transparent-background smiley was flattened to an opaque BLACK background when saved to localStorage. After a page refresh, `restorePersistedImage` loaded that JPEG (opaque, black backdrop). `buildAlphaMaskFloodFill` found no transparency and fell through to `detectBackgroundMask`, which removes the dominant border colour — now black — taking the black eyes and smile with it.

The keychain/relief import never goes through this persistence path, so it always sees the original transparent PNG and its alpha-based mask preserves the enclosed eyes.

Fix: encode the persisted image as PNG instead of JPEG so the alpha channel survives the round-trip. Background removal fundamentally depends on transparency to separate foreground from background; JPEG cannot represent it. Dropped the now-meaningless `quality` parameter from `imageDataToDataUrl` (it only applied to JPEG; PNG is lossless). Verified with a browser round-trip test: a transparent-bg smiley's corner stays alpha=0 and its black eyes stay opaque after encode→decode, where JPEG previously produced an opaque black corner.
