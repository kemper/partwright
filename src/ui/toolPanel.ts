// Shared standard for the viewport "Tools" panels (Paint, Image, Voxel,
// Annotate, Quality, Surface, Resize, Palette). Before this, each tool hand-
// rolled its own shell — different backgrounds (zinc-800/95 vs zinc-900),
// borders, z-indices, header markup, close glyphs (× vs ✕), and hit areas — so
// the panels looked and behaved subtly differently. These constants + helpers
// are the single source of truth for that chrome; every tool uses them so the
// panels read as one consistent family.

import { attachViewportPanelDrag, setInitialPanelPosition } from './viewportPanelDrag';
import { openViewportPanel, closeViewportPanel, type ViewportPanel } from './viewportPanelRegistry';

/** Root shell of a docked viewport tool panel — grey, bordered, drop-shadowed,
 *  above the model (z-20) but below centered dialogs. Does NOT include `hidden`:
 *  singleton panels that toggle visibility prepend it themselves. */
export const TOOL_PANEL_CLASS =
  'absolute z-20 flex flex-col overflow-hidden bg-zinc-800/95 backdrop-blur border border-zinc-600/60 rounded-lg shadow-xl';

/** Drag-handle header bar (title + close ×). Pass to attachViewportPanelDrag. */
export const TOOL_PANEL_HEADER =
  'shrink-0 flex items-center justify-between gap-2 px-2.5 py-2 border-b border-zinc-700/70';

/** Panel title text. */
export const TOOL_PANEL_TITLE = 'text-[11px] text-zinc-300 font-medium';

/** Close (×) button — 28px square hit area, consistent across all panels. */
export const TOOL_PANEL_CLOSE =
  'shrink-0 -mr-1 w-7 h-7 flex items-center justify-center rounded text-base leading-none text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700/60 transition-colors';

/** The Tools-menu toggle button in its idle state. */
export const TOOL_TOGGLE_IDLE =
  'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';

/** The Tools-menu toggle button while its panel is open — one shared blue
 *  accent across every tool (was blue/pink/emerald per-tool before). */
export const TOOL_TOGGLE_ACTIVE =
  'px-2 py-1 rounded text-xs bg-blue-500/30 backdrop-blur text-blue-300 border border-blue-500/50 transition-colors';

/** Build the standard drag-handle header: a title plus a × close button.
 *  The close button is excluded from drag initiation by attachViewportPanelDrag
 *  (it skips clicks landing on a <button>). */
export function createToolPanelHeader(title: string, onClose: () => void): HTMLElement {
  const header = document.createElement('div');
  header.className = TOOL_PANEL_HEADER;
  const titleEl = document.createElement('div');
  titleEl.className = TOOL_PANEL_TITLE;
  titleEl.textContent = title;
  header.appendChild(titleEl);
  const closeBtn = document.createElement('button');
  closeBtn.className = TOOL_PANEL_CLOSE;
  closeBtn.textContent = '×'; // × (multiplication sign) — one glyph everywhere
  closeBtn.title = 'Close';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.addEventListener('click', onClose);
  header.appendChild(closeBtn);
  return header;
}

export interface ToolPanelShell {
  /** The panel root (already mounted and positioned). */
  panel: HTMLElement;
  /** Scrollable body — append your rows here. */
  body: HTMLElement;
  /** Right-aligned footer row with a top divider — append action buttons. */
  footer: HTMLElement;
  /** Tear down: remove the panel, drop listeners, release the registry slot.
   *  Safe to call multiple times. */
  close: () => void;
}

/**
 * A fully wired docked tool panel — the panel equivalent of `createModalShell`,
 * for tools that want the modal's `{ body, footer, close }` ergonomics but the
 * standard look and behaviour of the other viewport tools: grey shell, draggable
 * header, Escape-to-close, single-open mutual exclusion via the viewport panel
 * registry, and docking beneath the toolbar (or the open Tools menu).
 */
export function createToolPanelShell(opts: {
  title: string;
  /** Full Tailwind width class(es), e.g. `'w-[22rem]'`. Defaults to `w-80`. */
  width?: string;
  onClose?: () => void;
}): ToolPanelShell {
  const host = document.getElementById('clip-controls')?.parentElement ?? document.body;

  const panel = document.createElement('div');
  panel.className = `${TOOL_PANEL_CLASS} ${opts.width ?? 'w-80'} max-w-[calc(100vw-1rem)] max-h-[calc(100%-3.5rem)] select-none`;
  // A non-modal dialog: it doesn't trap focus or block the page behind it.
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-label', opts.title);

  let closed = false;
  const entry: ViewportPanel = { close: () => doClose() };
  const onEsc = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // Defer to any open *modal* dialog (e.g. the photo-colour picker layered on
    // top) so Escape dismisses that first, not the panel underneath it.
    if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
    doClose();
  };

  function doClose(): void {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onEsc);
    drag.destroy();
    closeViewportPanel(entry);
    panel.remove();
    opts.onClose?.();
  }

  const header = createToolPanelHeader(opts.title, doClose);
  panel.appendChild(header);

  const body = document.createElement('div');
  body.className = 'flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3 text-sm text-zinc-200';
  panel.appendChild(body);

  const footer = document.createElement('div');
  footer.className = 'shrink-0 px-4 py-3 border-t border-zinc-700/70 flex items-center justify-end gap-2';
  panel.appendChild(footer);

  host.appendChild(panel);
  const drag = attachViewportPanelDrag(header, panel);
  setInitialPanelPosition(panel);
  document.addEventListener('keydown', onEsc);
  openViewportPanel(entry); // close any other open tool panel

  return { panel, body, footer, close: doClose };
}
