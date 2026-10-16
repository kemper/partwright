---
session: "bv8h6w"
timestamp: "2026-10-16T15:40:18Z"
---

## Human

When I drag a screenshot into the AI chat image upload I get a prompt asking me
if I want to import the image as a tile relief or voxel. If I click cancel I
still see the screenshot attached to the AI chat. Seems like the general import
should launch in that case but investigate and make the best fix possible.
Create a PR and attach visual proof.

## Assistant

## Key decisions

**Root cause: event bubbling, not the chooser.** The AI panel's `drop` listener
attached the image, then the same event bubbled to main.ts's document-level
drag-and-drop import, which classified the PNG as an importable image and opened
the relief/voxel chooser. Cancel only aborted the second (unwanted) handler — the
attachment had already happened. So the chat drop should never reach the general
import at all; the general import should only run for drops nobody else claimed.

**Fixed it at the document handler with a `defaultPrevented` convention rather
than `stopPropagation` in the panel.** The relief import modal and the
image-paint preview have their own drop zones with the identical bubbling bug;
honouring `e.defaultPrevented` in the one document listener fixes all three,
and future nested drop zones just need to call preventDefault() synchronously
(they all already did).

**The panel now claims only drops that carry an image.** Previously it
preventDefault()'d every drop and showed "Skipped non-image" for an STL/JSON,
while the bubbling general import quietly did the real work. To keep that
working under the new convention, non-image drops stay unclaimed and fall
through. Because the panel no longer unconditionally prevents default, the
document handler now always swallows file drops (an unhandled drop navigates
the tab to the file, losing the editor) and toasts for unsupported types
instead of silently ignoring them.

**Test** `tests/ai-image-drop.spec.ts` synthesizes an OS-style DataTransfer drop:
image on chat → attached, no chooser (verified failing on the unfixed code);
image on viewport → chooser still opens (general path intact).
