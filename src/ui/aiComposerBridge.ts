// Leaf bridge that lets feature layers (e.g. Annotate's "Attach to AI") stage
// an image + text in the AI chat input without importing the AI panel. The
// panel registers the handler at init; callers get `false` when the panel
// isn't built yet.

import type { ImageSource } from '../ai/types';

type AttachHandler = (image: ImageSource, text: string) => void;

let handler: AttachHandler | null = null;

export function registerAiComposerAttach(fn: AttachHandler): void {
  handler = fn;
}

/** Open the AI panel and stage `image` as a pending attachment, appending
 *  `text` to the input — nothing is sent. Returns false when no AI panel. */
export function attachToAiComposer(image: ImageSource, text: string): boolean {
  if (!handler) return false;
  handler(image, text);
  return true;
}
