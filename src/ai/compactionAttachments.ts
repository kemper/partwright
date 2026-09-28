// Compaction summarizes older turns into text and deletes them, which used to
// throw away images the USER attached (a reference photo became a
// "<image: …>" placeholder). This pure helper picks those images out of the
// dropped turns so the panel can carry them forward in a message of their
// own. Tool-result renders are deliberately excluded — the agent can always
// re-render the model; the user's reference can't be recreated.

import type { ChatBlock, ChatMessage } from './types';

/** Label on the carried-over message, so the model (and the transcript)
 *  knows what the images are. */
export const CARRIED_ATTACHMENTS_NOTE =
  '[Reference images attached earlier in this conversation, kept when older turns were compacted.]';

/** The images the user attached in `dropped` messages (including images an
 *  earlier compaction already carried), newest `max` kept, duplicates
 *  removed. */
export function carriedAttachments(dropped: ChatMessage[], max: number): Extract<ChatBlock, { type: 'image' }>[] {
  if (max <= 0) return [];
  const images: Extract<ChatBlock, { type: 'image' }>[] = [];
  for (const m of dropped) {
    if (m.role !== 'user') continue;
    for (const b of m.blocks) if (b.type === 'image') images.push(b);
  }
  // Keep the LAST occurrence of each image (by bytes), then the newest `max`.
  const seen = new Set<string>();
  const unique: typeof images = [];
  for (let i = images.length - 1; i >= 0; i--) {
    const key = images[i].source.data;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.unshift(images[i]);
  }
  return unique.slice(-max);
}
