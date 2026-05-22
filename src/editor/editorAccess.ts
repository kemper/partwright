// Composes the editor's single read-only flag from multiple independent
// reasons. The color-region lock (editorLock.ts) and multi-tab viewer mode
// (viewerMode.ts) each want the editor read-only for their own reason; routing
// both through here means neither stomps the other — the editor is read-only if
// ANY reason is active, regardless of the order the two modules run in.

import { setReadOnly } from './codeEditor';

const activeReasons = new Set<string>();

export function setReadOnlyReason(reason: string, on: boolean): void {
  if (on) activeReasons.add(reason);
  else activeReasons.delete(reason);
  setReadOnly(activeReasons.size > 0);
}
