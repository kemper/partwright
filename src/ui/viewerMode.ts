// Read-only "viewer" mode for the non-owner tab.
//
// When the same session is open in two tabs, one holds the Web Lock and is the
// writer (see sessionLock.ts); the other becomes a read-only viewer. This module
// reflects that across the whole editor surface — editor read-only, paint / run /
// save / simplify disabled — and shows a viewport-level banner (visible on
// mobile, where the AI drawer is usually closed) with a "Take over" button.
//
// Editor read-only and the Run buttons are also driven by the color-region lock
// (editorLock.ts); this composes with it (read-only if EITHER applies) and never
// re-enables a color-locked editor when ownership is regained.

import { onOwnershipChange, requestTakeover } from '../storage/sessionLock';
import { onStateChange } from '../storage/sessionManager';
import { setReadOnly } from '../editor/codeEditor';
import { isLocked as isColorLocked } from '../color/editorLock';
import { forceDeactivate as deactivatePaint, isPaintOpen } from '../color/paintUI';

let viewer = false;
let banner: HTMLElement | null = null;

/** True when this tab is a read-only viewer (another tab holds the write lock).
 *  Mutating actions (save, etc.) should bail when this returns true. */
export function isReadOnlyViewer(): boolean {
  return viewer;
}

/** Tools that only make sense for the writer — disabled entirely for a viewer. */
const MUTATING_BUTTON_IDS = ['btn-save-version', 'paint-toggle', 'simplify-toggle'];
/** Run buttons are ALSO disabled by the color-region lock, so they compose. */
const RUN_BUTTON_IDS = ['btn-run', 'btn-auto-run'];

function setButtonDisabled(id: string, disabled: boolean): void {
  const el = document.getElementById(id) as HTMLButtonElement | null;
  if (!el) return;
  el.disabled = disabled;
  el.classList.toggle('opacity-40', disabled);
  el.classList.toggle('pointer-events-none', disabled);
}

/** (Re)apply the current access state to the editor + controls. Idempotent and
 *  cheap, so it's safe to call on every ownership/session-state change. */
function applyAccess(): void {
  const colorLocked = isColorLocked();
  setReadOnly(viewer || colorLocked);
  for (const id of MUTATING_BUTTON_IDS) setButtonDisabled(id, viewer);
  for (const id of RUN_BUTTON_IDS) setButtonDisabled(id, viewer || colorLocked);
  if (viewer && isPaintOpen()) deactivatePaint();
  renderBanner();
}

/** Wire viewer mode. Call once after the editor UI (toolbar + layout + editor)
 *  is built. */
export function initViewerMode(): void {
  onOwnershipChange(({ sessionId, owned }) => {
    // No real session = no contention = always writable.
    viewer = !!sessionId && !owned;
    applyAccess();
  });
  // Re-assert after any session/version state change (e.g. a cross-tab reload
  // that re-ran the color-lock sync) so a viewer never silently regains edit.
  onStateChange(() => applyAccess());
}

function renderBanner(): void {
  if (!viewer) {
    banner?.remove();
    banner = null;
    return;
  }
  if (banner) return;
  banner = document.createElement('div');
  banner.id = 'session-viewer-banner';
  banner.className =
    'fixed bottom-0 inset-x-0 z-30 flex items-center justify-center gap-3 px-4 py-2 bg-blue-900/90 border-t border-blue-600 text-sm text-blue-100 backdrop-blur';
  const msg = document.createElement('span');
  msg.textContent = 'This session is open in another tab — read-only here.';
  const takeover = document.createElement('button');
  takeover.type = 'button';
  takeover.className = 'shrink-0 px-3 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium';
  takeover.textContent = 'Take over';
  takeover.addEventListener('click', () => requestTakeover());
  banner.append(msg, takeover);
  document.body.appendChild(banner);
}
