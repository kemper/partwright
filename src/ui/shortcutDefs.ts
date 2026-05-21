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
function combo(...tokens: string[]): string {
  return tokens.join(IS_MAC ? ' ' : ' + ');
}

interface ShortcutDoc {
  /** Human-readable key combo for the current OS, e.g. "⌘ Z" or "Ctrl + Z". */
  keys: string;
  /** What the shortcut does, including how it routes by focus/active tool. */
  description: string;
}

/** The shortcuts this feature owns (undo / redo / save), formatted for the
 *  current OS. The help page renders these; the handler implements them. */
export function getShortcutDocs(): ShortcutDoc[] {
  return [
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
  ];
}
