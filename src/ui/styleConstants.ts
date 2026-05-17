// Shared Tailwind class fragments and z-index values used across modals,
// overlays, and panels. Keep these as the single source of truth — when
// theming changes (e.g. button color, modal padding), update once here
// rather than chasing copies through the UI tree.

/** Z-index layers. Higher values render on top.
 *  - Side panels (AI drawer) sit below modals so that opening a modal
 *    from inside the panel doesn't get hidden underneath it. */
export const Z_PANEL = 40;
export const Z_MODAL = 50;

/** Standard modal overlay (dim only, no blur). */
export const OVERLAY_CENTERED = 'fixed inset-0 bg-black/60 flex items-center justify-center z-50';

/** Modal overlay with backdrop blur — used by the import/export confirm dialogs. */
export const OVERLAY_CENTERED_BLURRED = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center';

/** Standard primary action button (blue, white text). */
export const BUTTON_PRIMARY = 'px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors';

/** Standard cancel / secondary action button (transparent, zinc text). */
export const BUTTON_CANCEL = 'px-4 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors';

/** Smaller secondary button used in toolbars / inline rows. */
export const BUTTON_SMALL_SECONDARY = 'px-2 py-1 rounded text-[11px] text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700';
