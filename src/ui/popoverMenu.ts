// Shared popover-menu building blocks.
//
// Promoted out of `toolbar.ts` (Import/Export dropdowns) so the viewport overlay
// bar can reuse the same labelled-section / divider look, plus a self-contained
// `createPopoverGroup` flyout used to collapse the bar's many buttons into a few
// labelled groups (Inspect / Tools). One source of truth for menu chrome.

/** Small uppercase section label inside a menu (e.g. "From file", "3D model"). */
export function createMenuSectionHeader(text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'px-3 pt-1 pb-0.5 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold';
  el.textContent = text;
  return el;
}

/** Thin horizontal rule between menu sections. */
export function createMenuDivider(): HTMLElement {
  const el = document.createElement('div');
  el.className = 'my-1 border-t border-zinc-700';
  return el;
}

// Pill styling for the group buttons — matches the existing viewport bar pills so
// the groups read as part of the same control strip.
const GROUP_BTN_BASE =
  'flex items-center gap-1 px-3 py-2 md:px-2 md:py-1 rounded text-sm md:text-xs backdrop-blur transition-colors border';
const GROUP_BTN_CLOSED = `${GROUP_BTN_BASE} bg-zinc-800/80 text-zinc-400 border-zinc-600/50 [@media(hover:hover)]:hover:text-zinc-200 [@media(hover:hover)]:hover:bg-zinc-700/80`;
const GROUP_BTN_OPEN = `${GROUP_BTN_BASE} bg-zinc-700/90 text-zinc-100 border-zinc-500/60`;

// All live groups, so opening one closes its siblings (a single popover at a time).
const liveGroups: PopoverGroup[] = [];

export interface PopoverGroup {
  /** Relative-positioned flex item — append this to the bar. */
  wrapper: HTMLElement;
  /** The clickable group button. */
  button: HTMLButtonElement;
  /** Content container — append menu items / sections here. */
  menu: HTMLElement;
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
}

export interface PopoverGroupOptions {
  /** Stable id base; the wrapper gets `${id}-group`, the menu gets `${id}-menu`. */
  id: string;
  /** Button label (a ▾ caret is appended automatically). */
  label: string;
  /** Button tooltip / aria-label. */
  title: string;
}

/**
 * A labelled flyout group: a pill button that toggles a popover panel beneath it.
 * Handles single-open coordination, click-outside, and Escape. Append `wrapper`
 * to the bar and your items to `menu`.
 */
export function createPopoverGroup(opts: PopoverGroupOptions): PopoverGroup {
  const wrapper = document.createElement('div');
  wrapper.className = 'relative';
  wrapper.id = `${opts.id}-group`;

  const button = document.createElement('button');
  button.id = `${opts.id}-group-btn`;
  button.className = GROUP_BTN_CLOSED;
  button.title = opts.title;
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  // Label text + a caret. Label comes from a fixed in-source set, never user input.
  button.innerHTML = `<span>${opts.label}</span><span class="text-[9px] leading-none opacity-70" aria-hidden="true">▾</span>`;
  wrapper.appendChild(button);

  const menu = document.createElement('div');
  menu.id = `${opts.id}-menu`;
  menu.className =
    'absolute right-0 top-full mt-1 hidden z-20 bg-zinc-800 border border-zinc-600 rounded shadow-lg p-1 flex flex-col gap-1 min-w-[9rem] max-w-[80vw] max-h-[70vh] overflow-y-auto';
  wrapper.appendChild(menu);

  const isOpen = () => !menu.classList.contains('hidden');

  const close = () => {
    menu.classList.add('hidden');
    button.className = GROUP_BTN_CLOSED;
    button.setAttribute('aria-expanded', 'false');
  };

  const open = () => {
    // Single popover at a time — close every sibling first.
    for (const g of liveGroups) if (g.menu !== menu) g.close();
    menu.classList.remove('hidden');
    button.className = GROUP_BTN_OPEN;
    button.setAttribute('aria-expanded', 'true');
  };

  button.addEventListener('click', (e) => {
    e.stopPropagation();
    isOpen() ? close() : open();
  });

  // The menu is sticky: clicking an item inside it (a toggle, a tool) runs that
  // item's own handler but does NOT dismiss the menu, so users can flip several
  // toggles or switch tools in a row without re-opening it. It closes only via
  // the group button, opening a sibling popover, click-outside, or Escape.

  // Click-outside and Escape close the menu. Singleton bar — listeners persist
  // for the life of the page, matching the Import/Export dropdown pattern.
  document.addEventListener('click', (e) => {
    if (isOpen() && !wrapper.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen()) close();
  });

  const group: PopoverGroup = { wrapper, button, menu, open, close, isOpen };
  liveGroups.push(group);
  return group;
}

/**
 * The mount point for an injected viewport tool button: the Tools popover's menu
 * if present, else the given container (graceful fallback before the group exists
 * or in any non-grouped layout). Tool modules append their button here while
 * still hosting their floating panel off `controlsContainer.parentElement`.
 */
export function viewportToolsMount(controlsContainer: HTMLElement): HTMLElement {
  return controlsContainer.querySelector<HTMLElement>('#viewport-tools-menu') ?? controlsContainer;
}
