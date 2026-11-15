// Command palette — a searchable list of every primary action, opened with
// ⌘K / Ctrl+K or the toolbar's "Search tools…" button. Actions register
// themselves at startup; the palette stays decoupled from what they do. This
// makes the app's capabilities discoverable without memorizing the toolbar
// layout or a wall of hotkeys.
//
// With an empty query it doubles as a browsable menu (recently used, then every
// action grouped by category). Typing ranks results with the forgiving matcher
// in ./commandSearch (partial words and typos match). When a fallback is set
// (main.ts wires "Ask the AI"), a query that matches nothing is offered to it.

import { rankCommands, groupForBrowse, pushRecent } from './commandSearch';
import { getConfig } from '../config/appConfig';

export interface Command {
  /** Stable unique id (also dedupes re-registration). */
  id: string;
  /** Primary label shown in the list and matched first. */
  title: string;
  /** Dim secondary text (e.g. a category) shown after the title. */
  hint?: string;
  /** One-line explanation shown under the title — what the action does. */
  description?: string;
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
function getCommands(): Command[] {
  return [...registry.values()];
}

/** Every registered command with its current enabled state — the run-only half
 *  of `partwright.listUiCommands()`. */
export function listCommands(): { id: string; title: string; hint?: string; enabled: boolean }[] {
  return getCommands().map(c => {
    let enabled = true;
    try { enabled = !c.enabled || c.enabled(); } catch { enabled = false; }
    return { id: c.id, title: c.title, hint: c.hint, enabled };
  });
}

/**
 * Run a registered command by id, honoring its `enabled` gate. Returns false
 * when the id is unknown or the command is currently disabled (so callers can
 * fall back). Lets non-palette UI (e.g. the hints ticker) reuse the same
 * actions the palette exposes without duplicating their wiring.
 */
export function runCommandById(id: string): boolean {
  const cmd = registry.get(id);
  if (!cmd || (cmd.enabled && !cmd.enabled())) return false;
  cmd.run();
  return true;
}

// --- Recently used ---

const RECENT_KEY = 'partwright-command-palette-recent';

function readRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch { return []; }
}

function rememberRecent(id: string): void {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(pushRecent(readRecent(), id, getConfig().ui.commandPaletteRecentMax))); } catch { /* storage unavailable */ }
}

// --- Fallback ("Ask the AI") ---

export interface PaletteFallback {
  /** Row label for a query, e.g. `Ask the AI: "make it taller"`. */
  label: (query: string) => string;
  run: (query: string) => void;
}

let fallback: PaletteFallback | null = null;

/** Set the action offered when a non-empty query matches no command. */
export function setCommandPaletteFallback(fb: PaletteFallback | null): void {
  fallback = fb;
}

// --- Palette UI ---

type Entry = { kind: 'cmd'; cmd: Command } | { kind: 'fallback'; query: string };

let overlayEl: HTMLElement | null = null;
let inputEl: HTMLInputElement | null = null;
let listEl: HTMLElement | null = null;
let restoreFocusEl: HTMLElement | null = null;
let entries: Entry[] = [];
let selected = 0;

export function isCommandPaletteOpen(): boolean {
  return overlayEl !== null;
}

function availableCommands(): Command[] {
  return getCommands().filter(c => {
    try { return !c.enabled || c.enabled(); } catch { return false; }
  });
}

/** A labelled `role="group"` inside the listbox (a listbox may own only
 *  options and groups, so a bare heading div would be dropped by screen
 *  readers). The visible heading is aria-hidden; the group carries the label. */
function sectionGroup(label: string): HTMLElement {
  const group = document.createElement('div');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  group.className = 'flex flex-col gap-0.5';
  const h = document.createElement('div');
  h.setAttribute('aria-hidden', 'true');
  h.className = 'px-3 pt-2 pb-0.5 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold';
  h.textContent = label;
  group.appendChild(h);
  return group;
}

/** `showHint`: false in the browse view, where the section heading already
 *  names the category. */
function optionRow(entry: Entry, i: number, showHint = true): HTMLElement {
  const row = document.createElement('div');
  row.id = `cmd-palette-opt-${i}`;
  row.setAttribute('role', 'option');
  const isSel = i === selected;
  row.setAttribute('aria-selected', isSel ? 'true' : 'false');
  row.className =
    'flex items-center justify-between gap-3 px-3 py-1.5 rounded cursor-pointer ' +
    (isSel ? 'bg-emerald-600/20 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-700/60');

  const left = document.createElement('div');
  left.className = 'flex flex-col min-w-0';
  const top = document.createElement('div');
  top.className = 'flex items-baseline gap-2 min-w-0';
  const title = document.createElement('span');
  title.className = 'truncate';
  top.appendChild(title);
  left.appendChild(top);
  row.appendChild(left);

  if (entry.kind === 'fallback') {
    row.dataset.fallback = 'true';
    title.className = 'truncate text-indigo-200';
    title.textContent = fallback ? fallback.label(entry.query) : entry.query;
  } else {
    const cmd = entry.cmd;
    title.textContent = cmd.title;
    if (cmd.hint && showHint) {
      const hint = document.createElement('span');
      hint.className = 'text-xs text-zinc-500 truncate';
      hint.textContent = cmd.hint;
      top.appendChild(hint);
    }
    if (cmd.description) {
      const desc = document.createElement('span');
      desc.className = 'text-[11px] leading-snug text-zinc-500 truncate';
      desc.textContent = cmd.description;
      left.appendChild(desc);
    }
    if (cmd.shortcut) {
      const kbd = document.createElement('kbd');
      kbd.className = 'shrink-0 text-xs text-zinc-400 bg-zinc-900/70 border border-zinc-700 rounded px-1.5 py-0.5';
      kbd.textContent = cmd.shortcut;
      row.appendChild(kbd);
    }
  }

  row.addEventListener('mousemove', () => {
    if (selected !== i) { selected = i; render(); }
  });
  row.addEventListener('click', () => runEntry(entry));
  return row;
}

function render(): void {
  if (!listEl || !inputEl) return;
  const query = inputEl.value.trim();
  const available = availableCommands();
  listEl.replaceChildren();
  entries = [];

  if (query === '') {
    for (const section of groupForBrowse(available, readRecent().slice(0, getConfig().ui.commandPaletteRecentMax))) {
      const group = sectionGroup(section.label);
      for (const cmd of section.items) {
        const entry: Entry = { kind: 'cmd', cmd };
        group.appendChild(optionRow(entry, entries.length, false));
        entries.push(entry);
      }
      listEl.appendChild(group);
    }
  } else {
    const ranked = rankCommands(available, query);
    if (ranked.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'px-3 py-4 text-center text-sm text-zinc-500';
      empty.textContent = 'No matching commands';
      listEl.appendChild(empty);
    }
    for (const cmd of ranked) {
      const entry: Entry = { kind: 'cmd', cmd };
      listEl.appendChild(optionRow(entry, entries.length));
      entries.push(entry);
    }
    // Only on a miss: an always-present row echoing the query would compete
    // with real results (and with anything that finds rows by their text).
    if (fallback && ranked.length === 0) {
      const entry: Entry = { kind: 'fallback', query };
      listEl.appendChild(optionRow(entry, entries.length));
      entries.push(entry);
    }
  }

  if (selected >= entries.length) selected = Math.max(0, entries.length - 1);
  // Rows were built before the clamp; re-sync aria-selected/highlight cheaply.
  listEl.querySelectorAll<HTMLElement>('[role="option"]').forEach((row, i) => {
    const isSel = i === selected;
    if ((row.getAttribute('aria-selected') === 'true') !== isSel) {
      row.setAttribute('aria-selected', String(isSel));
      row.classList.toggle('bg-emerald-600/20', isSel);
      row.classList.toggle('text-zinc-100', isSel);
    }
  });

  if (entries.length === 0) {
    inputEl.removeAttribute('aria-activedescendant');
    return;
  }
  inputEl.setAttribute('aria-activedescendant', `cmd-palette-opt-${selected}`);
  document.getElementById(`cmd-palette-opt-${selected}`)?.scrollIntoView({ block: 'nearest' });
}

function runEntry(entry: Entry | undefined): void {
  if (!entry) return;
  // Close without restoring focus — the command may open a modal or move
  // focus itself, and yanking focus back to the trigger would fight that.
  closeCommandPalette({ restoreFocus: false });
  if (entry.kind === 'fallback') {
    fallback?.run(entry.query);
    return;
  }
  rememberRecent(entry.cmd.id);
  entry.cmd.run();
}

export function openCommandPalette(): void {
  if (overlayEl) { inputEl?.focus(); return; }
  restoreFocusEl = (document.activeElement as HTMLElement | null) ?? null;
  selected = 0;

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/50 z-[60] flex items-start justify-center pt-[10vh] px-4';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Command palette');

  const panel = document.createElement('div');
  panel.className = 'w-full max-w-lg bg-zinc-800 rounded-xl shadow-2xl border border-zinc-700 flex flex-col overflow-hidden';

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Search tools and actions…';
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
  list.className = 'max-h-[60vh] overflow-y-auto p-1.5 flex flex-col gap-0.5';

  // Keyboard legend — hidden on touch-only devices, where it means nothing.
  const footer = document.createElement('div');
  footer.className = 'hidden [@media(hover:hover)]:flex items-center gap-3 px-3 py-1.5 border-t border-zinc-700 text-[10px] text-zinc-500';
  footer.innerHTML = '<span><kbd class="font-sans">↑↓</kbd> navigate</span><span><kbd class="font-sans">↵</kbd> run</span><span><kbd class="font-sans">esc</kbd> close</span>';

  panel.appendChild(input);
  panel.appendChild(list);
  panel.appendChild(footer);
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
  const n = entries.length;
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
    runEntry(entries[selected]);
  }
}

function closeCommandPalette(opts: { restoreFocus?: boolean } = {}): void {
  if (!overlayEl) return;
  overlayEl.remove();
  overlayEl = null;
  inputEl = null;
  listEl = null;
  entries = [];
  if (opts.restoreFocus !== false) restoreFocusEl?.focus?.();
  restoreFocusEl = null;
}
