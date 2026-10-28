// Canonical keyboard-shortcut definitions — shared by the global handler
// (src/ui/keyboardShortcuts.ts) and the in-app help page (src/ui/help.ts) so
// the documented keys can never drift from the keys that actually fire.
//
// This module is intentionally dependency-free (no app imports) so the help
// page can render the list without pulling in the paint/annotation runtime.

/** True when running on macOS / iPadOS / iOS, where the primary modifier is ⌘. */
export const IS_MAC = detectMac();

function detectMac(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform || '') ||
    /Mac OS X/i.test(navigator.userAgent || '')
  );
}

/** Display label for the platform's primary modifier key. */
export const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl'; // ⌘ / Ctrl
/** Display label for the Shift key. */
export const SHIFT_LABEL = IS_MAC ? '⇧' : 'Shift'; // ⇧ / Shift
/** Display label for the Alt/Option key. */
export const ALT_LABEL = IS_MAC ? '⌥' : 'Alt'; // ⌥ / Alt

/** Join modifier/key tokens the way the host OS conventionally renders them
 *  (macOS stacks glyphs with no separator, others use " + "). */
export function combo(...tokens: string[]): string {
  return tokens.join(IS_MAC ? ' ' : ' + ');
}

interface ShortcutDoc {
  /** Human-readable key combo for the current OS, e.g. "⌘ Z" or "Ctrl + Z". */
  keys: string;
  /** What the shortcut does, including how it routes by focus/active tool. */
  description: string;
}

/** The shortcuts this feature owns, formatted for the current OS. The help
 *  page and the in-app `?` cheat sheet render these; the handlers implement
 *  them. */
export function getShortcutDocs(): ShortcutDoc[] {
  return [
    {
      keys: combo(MOD_LABEL, 'K'),
      description: 'Open the command palette — search and run any action by name.',
    },
    {
      keys: '?',
      description: 'Open this keyboard-shortcuts cheat sheet (when not typing in a field).',
    },
    {
      keys: combo(MOD_LABEL, 'Z'),
      description:
        'Undo the last paint region or annotation stroke, depending on which tool is active. When the code editor is focused it uses its own built-in undo.',
    },
    {
      keys: IS_MAC
        ? combo(SHIFT_LABEL, MOD_LABEL, 'Z')
        : `${combo(MOD_LABEL, SHIFT_LABEL, 'Z')} or ${combo(MOD_LABEL, 'Y')}`,
      description: 'Redo the last undone paint region or annotation stroke.',
    },
    {
      keys: combo(MOD_LABEL, 'S'),
      description:
        'Save the current code, geometry, paint regions, and annotations as a new version in the active session.',
    },
    {
      keys: combo(SHIFT_LABEL, ALT_LABEL, 'F'),
      description: 'Reformat the code in the editor.',
    },
    {
      keys: `${combo(MOD_LABEL, 'F')} / ${combo(MOD_LABEL, ALT_LABEL, 'F')}`,
      description: 'Open the code editor’s Find / Find-and-Replace panel (replace jumps straight to the replace field).',
    },
    {
      keys: `${combo(SHIFT_LABEL, 'click')} / ${combo(SHIFT_LABEL, 'drag')}`,
      description: 'In the viewport: add a part to (or take it out of) the selection / box-select every part the box touches. Right- or middle-drag still pans.',
    },
    {
      keys: `${combo(SHIFT_LABEL, 'click')} / ${combo(MOD_LABEL, 'click')}`,
      description: 'In the object list’s parts: select a range of parts / add or remove one part.',
    },
    {
      keys: `${combo(MOD_LABEL, 'A')} · Esc · Delete · H · ${combo(SHIFT_LABEL, 'H')}`,
      description: 'With the viewport or object list focused: select every part, clear the selection, delete the selected parts, hide them, show every hidden part.',
    },
    {
      keys: 'V / P / B',
      description: 'Detect parts panel: switch between the Select, Pin and Fix tools.',
    },
    {
      keys: '1–9, 0',
      description: 'Detect parts panel: pick a label chip (hair, face, …), then click that part on the model.',
    },
    {
      keys: 'M · R · Enter',
      description:
        'Detect parts panel: M merges the selected parts; R renames the part under the cursor (with one part selected, just type its name — names starting with V, P, B, S, H, M or R go through R, since those letters stay shortcuts); Enter accepts the parts. S solos the selection, hold H to hide pins, Esc clears the selection.',
    },
  ];
}
