// Global keyboard shortcuts: undo / redo / save.
//
// Routing is focus- and tool-aware:
//   • Save (mod+S) fires everywhere — even inside the code editor or a text
//     field — so it can always snapshot a version (and suppress the browser's
//     "save page" dialog).
//   • Undo/redo (mod+Z, mod+⇧Z / Ctrl+Y) are skipped whenever a text input or
//     the CodeMirror editor (a contentEditable) is focused, leaving their
//     native undo/redo intact. Otherwise they route to the active tool: paint
//     regions when painting, annotation strokes when annotating.
//
// The store mutators (removeLastRegion, redoLastStroke, …) fan out through the
// regions/annotations change listeners, which re-render the mesh and refresh
// the on-screen Undo/Redo buttons — so the keyboard path needs no extra wiring.

import { IS_MAC } from './shortcutDefs';
import { openCommandPalette, isCommandPaletteOpen } from './commandPalette';
import { openShortcutsOverlay } from './shortcutsOverlay';
import {
  removeLastRegion,
  redoLastRegion,
  undoClear,
  canUndoClear,
} from '../color/regions';
import { isActive as isPaintActive } from '../color/paintMode';
import { isPaintOpen } from '../color/paintUI';
import { removeLastStroke, redoLastStroke } from '../annotations/annotations';
import { isActive as isSelectActive } from '../annotations/selectMode';
import { isAnnotateOpen } from '../annotations/annotateUI';

export interface ShortcutHandlers {
  /** Persist the current code/geometry/paint/annotations as a new version. */
  onSave: () => void;
}

function isEditableTarget(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return (
    !!t &&
    (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
  );
}

function paintContextActive(): boolean {
  return isPaintActive() || isPaintOpen();
}

function annotateContextActive(): boolean {
  return isAnnotateOpen() || isSelectActive();
}

/** Returns true when an undo was actually performed (so the caller can
 *  preventDefault only when we handled it). */
function routeUndo(): boolean {
  if (paintContextActive()) {
    // A Clear is the most recent paint action when its snapshot is live;
    // restore it before falling back to popping the last region.
    if (canUndoClear()) {
      undoClear();
      return true;
    }
    return removeLastRegion() !== null;
  }
  if (annotateContextActive()) {
    return removeLastStroke() !== null;
  }
  return false;
}

function routeRedo(): boolean {
  if (paintContextActive()) {
    return redoLastRegion() !== null;
  }
  if (annotateContextActive()) {
    return redoLastStroke() !== null;
  }
  return false;
}

export function installKeyboardShortcuts(handlers: ShortcutHandlers): void {
  document.addEventListener('keydown', (e) => {
    // While the palette is open it owns the keyboard (its own Escape/arrows/
    // Enter handler runs); don't let app shortcuts fire underneath it.
    if (isCommandPaletteOpen()) return;

    const mod = IS_MAC ? e.metaKey : e.ctrlKey;

    // Command palette — ⌘K / Ctrl+K, global regardless of focus.
    if (mod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openCommandPalette();
      return;
    }

    // Shortcuts cheat sheet — `?`, but only outside text fields / the editor
    // so typing a literal "?" still works.
    if (!mod && !e.altKey && e.key === '?' && !isEditableTarget(e.target)) {
      e.preventDefault();
      openShortcutsOverlay();
      return;
    }

    if (!mod || e.altKey) return; // ignore AltGr (Ctrl+Alt) and unrelated combos
    const key = e.key.toLowerCase();

    // Save — global, regardless of focus.
    if (key === 's' && !e.shiftKey) {
      e.preventDefault();
      handlers.onSave();
      return;
    }

    // Undo/redo defer to native handling inside text fields / the code editor.
    if (isEditableTarget(e.target)) return;

    if (key === 'z' && !e.shiftKey) {
      if (routeUndo()) e.preventDefault();
      return;
    }
    // Redo: ⇧+mod+Z everywhere, plus Ctrl+Y on non-mac platforms.
    if ((key === 'z' && e.shiftKey) || (key === 'y' && !IS_MAC)) {
      if (routeRedo()) e.preventDefault();
    }
  });
}
