// Command palette — a searchable list of every primary action, opened with
// ⌘K / Ctrl+K. Actions register themselves at startup; the palette stays
// decoupled from what they do. This makes the app's capabilities discoverable
// without memorizing the toolbar layout or a wall of hotkeys.

export interface Command {
  /** Stable unique id (also dedupes re-registration). */
  id: string;
  /** Primary label shown in the list and matched first. */
  title: string;
  /** Dim secondary text (e.g. a category) shown after the title. */
  hint?: string;
  /** Extra search terms not present in the title/hint. */
  keywords?: string;
  /** Pre-formatted shortcut label, e.g. "⌘ S", shown right-aligned. */
  shortcut?: string;
  /** When it returns false the command is hidden (context-unavailable). */
  enabled?: () => boolean;
  /** Perform the action. The palette closes before this runs. */
  run: () => void;
}

const registry = new Map<string, Command>();

/** Register (or replace, by id) palette commands. */
export function registerCommands(cmds: Command[]): void {
  for (const c of cmds) registry.set(c.id, c);
}

/** All registered commands, in registration order. */
export function getCommands(): Command[] {
  return [...registry.values()];
}

// --- Palette UI ---

let overlayEl: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let listEl: HTMLElement | null = null;
let restoreFocusEl: HTMLElement | null = null;
let filtered: Command[] = [];
let selected = 0;

export function isCommandPaletteOpen(): boolean {
  return overlayEl !== null;
}

/** Tokenized, case-insensitive substring match: every whitespace-separated
 *  token in the query must appear somewhere in the command's searchable text. */
function commandMatches(cmd: Command, query: string): boolean {
  const hay = `${cmd.title} ${cmd.hint ?? ''} ${cmd.keywords ?? ''}`.toLowerCase();
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every(tok => hay.includes(tok));
}

function availableCommands(): Command[] {
  return getCommands().filter(c => !c.enabled || c.enabled());
}

function render(): void {
  if (!listEl || !inputEl) return;
  const query = inputEl.value.trim();
  filtered = availableCommands().filter(c => commandMatches(c, query));
  if (selected >= filtered.length) selected = Math.max(0, filtered.length - 1);

  listEl.replaceChildren();

  if (filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'px-3 py-6 text-center text-sm text-zinc-500';
    empty.textContent = 'No matching commands';
    listEl.appendChild(empty);
    inputEl.removeAttribute('aria-activedescendant');
    return;
  }

  filtered.forEach((cmd, i) => {
    const row = document.createElement('div');
    row.id = `cmd-palette-opt-${i}`;
    row.setAttribute('role', 'option');
    const isSel = i === selected;
    row.setAttribute('aria-selected', isSel ? 'true' : 'false');
    row.className =
      'flex items-center justify-between gap-3 px-3 py-2 rounded cursor-pointer ' +
      (isSel ? 'bg-emerald-600/20 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-700/60');

    const left = document.createElement('div');
    left.className = 'flex items-baseline gap-2 min-w-0';
    const title = document.createElement('span');
    title.className = 'truncate';
    title.textContent = cmd.title;
    left.appendChild(title);
    if (cmd.hint) {
      const hint = document.createElement('span');
      hint.className = 'text-xs text-zinc-500 truncate';
      hint.textContent = cmd.hint;
      left.appendChild(hint);
    }
    row.appendChild(left);

    if (cmd.shortcut) {
      const kbd = document.createElement('kbd');
      kbd.className = 'shrink-0 text-xs text-zinc-400 bg-zinc-900/70 border border-zinc-700 rounded px-1.5 py-0.5';
      kbd.textContent = cmd.shortcut;
      row.appendChild(kbd);
    }

    row.addEventListener('mousemove', () => {
      if (selected !== i) { selected = i; render(); }
    });
    row.addEventListener('click', () => runSelected(cmd));

    listEl!.appendChild(row);
  });

  inputEl.setAttribute('aria-activedescendant', `cmd-palette-opt-${selected}`);
  const selRow = listEl.children[selected] as HTMLElement | undefined;
  selRow?.scrollIntoView({ block: 'nearest' });
}

function runSelected(cmd: Command | undefined): void {
  if (!cmd) return;
  // Close without restoring focus — the command may open a modal or move
  // focus itself, and yanking focus back to the trigger would fight that.
  closeCommandPalette({ restoreFocus: false });
  cmd.run();
}

export function openCommandPalette(): void {
  if (overlayEl) { inputEl?.focus(); return; }
  restoreFocusEl = (document.activeElement as HTMLElement | null) ?? null;
  selected = 0;

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/50 z-[60] flex items-start justify-center pt-[12vh] px-4';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Command palette');

  const panel = document.createElement('div');
  panel.className = 'w-full max-w-lg bg-zinc-800 rounded-xl shadow-2xl border border-zinc-700 flex flex-col overflow-hidden';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Type a command…';
  input.setAttribute('aria-label', 'Search commands');
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', 'cmd-palette-list');
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.className = 'w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 px-4 py-3 border-b border-zinc-700 outline-none';

  const list = document.createElement('div');
  list.id = 'cmd-palette-list';
  list.setAttribute('role', 'listbox');
  list.className = 'max-h-[50vh] overflow-y-auto p-1.5 flex flex-col gap-0.5';

  panel.appendChild(input);
  panel.appendChild(list);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  overlayEl = overlay;
  inputEl = input;
  listEl = list;

  input.addEventListener('input', () => { selected = 0; render(); });
  input.addEventListener('keydown', onInputKeydown);
  overlay.addEventListener('mousedown', e => { if (e.target === overlay) closeCommandPalette(); });

  render();
  input.focus();
}

function onInputKeydown(e: KeyboardEvent): void {
  const n = filtered.length;
  if (e.key === 'Escape') {
    e.preventDefault();
    e.stopPropagation();
    closeCommandPalette();
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (n > 0) { selected = (selected + 1) % n; render(); }
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (n > 0) { selected = (selected - 1 + n) % n; render(); }
  } else if (e.key === 'Enter') {
    e.preventDefault();
    runSelected(filtered[selected]);
  }
}

export function closeCommandPalette(opts: { restoreFocus?: boolean } = {}): void {
  if (!overlayEl) return;
  overlayEl.remove();
  overlayEl = null;
  inputEl = null;
  listEl = null;
  filtered = [];
  if (opts.restoreFocus !== false) restoreFocusEl?.focus?.();
  restoreFocusEl = null;
}
