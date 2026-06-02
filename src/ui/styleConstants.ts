// Shared Tailwind class fragments used across modals, overlays, and dialogs.
// Keep these as the single source of truth — when theming changes (e.g. button
// color), update once here rather than chasing copies through the UI tree.

/** Overlay for the stackable confirm/prompt dialogs ({@link ./dialogs}) —
 *  sits above modals (z-70). */
export const OVERLAY_DIALOG = 'fixed inset-0 bg-black/60 flex items-center justify-center z-[70] p-4';

/** Standard primary action button (blue, white text). */
export const BUTTON_PRIMARY = 'px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors';

/** Destructive primary action button (red, white text) — deletes, clears. */
export const BUTTON_DANGER = 'px-4 py-1.5 rounded-lg text-sm font-medium bg-red-600 text-white hover:bg-red-500 transition-colors';

/** Standard cancel / secondary action button (transparent, zinc text). */
export const BUTTON_CANCEL = 'px-4 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors';

/** Smaller secondary button used in toolbars / inline rows. */
export const BUTTON_SMALL_SECONDARY = 'px-2 py-1 rounded text-[11px] text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700';
