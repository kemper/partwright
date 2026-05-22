// Read-only "viewer" mode for the non-leader tab.
//
// When the same session is open in two tabs, one is the leader/writer (see
// sessionLock.ts); the other dims behind a full-screen overlay that blocks all
// input. The model/code stay visible (the scrim is translucent and the dimmed
// content keeps live-updating via tabSync), but nothing can be touched. "Take
// control" reloads this tab as the leader (?takeover=1) so it comes up with the
// latest state from IndexedDB; the previous leader gets a storage event, drops
// to read-only, and stops any AI run.
//
// A full-screen overlay can't let a stray control slip through, but as a
// correctness backstop the editor is also held read-only (keyboard bypasses the
// pointer scrim) and saveCurrentVersion() bails for a viewer.

import { onOwnershipChange } from '../storage/sessionLock';
import { onStateChange } from '../storage/sessionManager';
import { setReadOnlyReason } from '../editor/editorAccess';

let viewer = false;
let overlay: HTMLElement | null = null;

/** True when this tab is a read-only viewer (another tab is the leader).
 *  Mutating actions (save, etc.) should bail when this returns true. */
export function isReadOnlyViewer(): boolean {
  return viewer;
}

function applyAccess(): void {
  // Keyboard bypasses the pointer scrim, so hold the editor read-only too. This
  // composes with the color-region lock via editorAccess (read-only if either
  // reason is active), so neither can clear the other's read-only state.
  setReadOnlyReason('viewer', viewer);
  renderOverlay();
}

/** Wire viewer mode. Call once after the editor UI is built. */
export function initViewerMode(): void {
  onOwnershipChange(({ sessionId, owned }) => {
    // No real session = no contention = always writable.
    viewer = !!sessionId && !owned;
    applyAccess();
  });
  // Re-assert read-only after any session/version state change (e.g. a cross-tab
  // reload that re-ran the color-lock sync) so a viewer never silently regains edit.
  onStateChange(() => applyAccess());
}

function renderOverlay(): void {
  if (!viewer) {
    overlay?.remove();
    overlay = null;
    return;
  }
  if (overlay) return;

  overlay = document.createElement('div');
  overlay.id = 'session-viewer-overlay';
  // Full-screen translucent scrim: on top of everything (incl. the AI drawer),
  // pointer-events on by default so it intercepts all clicks/taps underneath.
  overlay.className =
    'fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-[1px]';

  const card = document.createElement('div');
  card.className = 'mx-4 max-w-sm rounded-xl border border-blue-600/60 bg-zinc-900/95 p-5 text-center shadow-2xl';

  const title = document.createElement('div');
  title.className = 'text-sm font-semibold text-zinc-100 mb-1';
  title.textContent = 'Open in another tab';

  const msg = document.createElement('p');
  msg.className = 'text-xs text-zinc-400 mb-4 leading-relaxed';
  msg.textContent =
    "This session is being edited in another tab, so it's read-only here. Take control to edit in this tab — the other tab will go read-only and any AI run there will stop.";

  const takeBtn = document.createElement('button');
  takeBtn.type = 'button';
  takeBtn.className = 'px-4 py-2 rounded bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium';
  takeBtn.textContent = 'Take control';
  takeBtn.addEventListener('click', takeControl);

  card.append(title, msg, takeBtn);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
}

/** Reload as the leader. The reload pulls the latest state from IndexedDB, and
 *  ?takeover=1 makes this tab claim leadership outright on load (main.ts), which
 *  bumps the previous leader to read-only via the storage event. */
function takeControl(): void {
  const url = new URL(window.location.href);
  url.searchParams.set('takeover', '1');
  window.location.assign(url.toString());
}
