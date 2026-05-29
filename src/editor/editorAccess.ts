// Composes the editor's single read-only flag from multiple independent
// reasons. The color-region lock (editorLock.ts), multi-tab viewer mode
// (viewerMode.ts), and the shared-link preview (main.ts, reason 'shared') each
// want the editor read-only for their own reason; routing them all through here
// means none stomps another — the editor is read-only if ANY reason is active,
// regardless of the order the modules run in.
//
// Known reasons: 'colorLock', 'viewer', 'shared', 'voxelPaint'.

import { setReadOnly } from './codeEditor';

const activeReasons = new Set<string>();

export function setReadOnlyReason(reason: string, on: boolean): void {
  if (on) activeReasons.add(reason);
  else activeReasons.delete(reason);
  setReadOnly(activeReasons.size > 0);
}
