// Parts rail — an IDE-style list of the active session's parts. Supports
// create, select, inline rename, delete, multi-select bulk delete/merge,
// grouping (a threaded view with collapsible group headers), and pointer-based
// drag-to-reorder. Renders into the rail container created by layout.ts and
// re-renders on every session-state change.

import { getState, onStateChange, type SessionState, type Part, type Version, type PartLayoutEntry } from '../storage/sessionManager';
import { getLatestVersion } from '../storage/db';
import { buildPartTree, groupNames, type PartTreeNode } from './partTree';
import { confirmDialog, promptDialog } from './dialogs';
import { openPartsOverview } from './partsOverview';
import { registerCommands } from './commandPalette';

export interface PartListCallbacks {
  /** Switch the active part (loads its latest version into the editor). */
  onSelectPart: (id: string) => void | Promise<void>;
  /** Create a new part in the active session. */
  onCreatePart: () => void | Promise<void>;
  onRenamePart: (id: string, name: string) => void | Promise<void>;
  onDeletePart: (id: string) => void | Promise<void>;
  /** Delete several parts at once (multi-select bulk delete). */
  onDeleteParts: (ids: string[]) => void | Promise<void>;
  /** Combine the multi-selected parts into one (multi-select merge). */
  onMergeParts: (ids: string[]) => void | Promise<void>;
  /** Assign (string) or clear (null) the group of one or more parts. */
  onSetPartGroup: (ids: string[], group: string | null) => void | Promise<void>;
  /** Persist a new part layout (order + per-part group reassignment). */
  onReorderParts: (layout: PartLayoutEntry[]) => void | Promise<void>;
  /** Collapse the rail (handled by layout). */
  onToggleCollapse: () => void;
}

let railEl: HTMLElement | null = null;
let cb: PartListCallbacks;
// True while a row is being dragged; suppresses re-render so the drag isn't
// yanked out from under the pointer by a state-change event.
let dragging = false;
// Set when a state change arrives mid-drag (suppressed); flushed on drag end so
// the rail never shows stale parts after an async update lands during a drag.
let pendingRender = false;
// partId -> the object URL of its latest thumbnail and the version it came from.
// Lets re-renders reuse an already-built preview (no flicker, no extra DB read)
// and rebuild the URL only when the underlying version actually changes. The URL
// is owned here: revoked when replaced (applyThumb) or pruned (pruneThumbCache).
const thumbCache = new Map<string, { versionId: string; url: string }>();
// Ids of parts checked for a bulk action. Pruned on every render so it never
// references a part that was deleted or belongs to another session.
const selected = new Set<string>();
// Anchor row id for shift-click range selection.
let lastClickedId: string | null = null;
// Names of groups the user has collapsed. Purely a per-session view preference
// (not persisted), so it's cleared when the active session changes.
const collapsedGroups = new Set<string>();
let lastSessionId: string | null = null;

export function createPartList(container: HTMLElement, callbacks: PartListCallbacks): void {
  railEl = container;
  cb = callbacks;
  registerCommands([
    {
      id: 'parts.overview',
      title: 'Show all parts (overview)',
      hint: 'Parts',
      keywords: 'grid contact sheet preview thumbnails every part',
      enabled: () => getState().parts.length > 0,
      run: () => { openPartsOverview((id) => cb.onSelectPart(id)); },
    },
  ]);
  render(getState());
  onStateChange((state) => {
    if (dragging) { pendingRender = true; return; }
    render(state);
  });
}

function render(state: SessionState): void {
  if (!railEl) return;

  // Reset per-session view state (collapse + selection) when the session
  // changes, so one session's collapsed groups can't hide another's parts.
  const sid = state.session?.id ?? null;
  if (sid !== lastSessionId) {
    lastSessionId = sid;
    collapsedGroups.clear();
    clearSelection();
  }

  // Drop any selection that no longer maps to a live part (deleted, or the
  // session was switched/closed) so the action bar can't act on stale ids.
  if (state.session) {
    const live = new Set(state.parts.map(p => p.id));
    for (const id of [...selected]) if (!live.has(id)) selected.delete(id);
    if (lastClickedId && !live.has(lastClickedId)) lastClickedId = null;
    // Forget collapse state for groups that no longer exist.
    const liveGroups = new Set(groupNames(state.parts));
    for (const g of [...collapsedGroups]) if (!liveGroups.has(g)) collapsedGroups.delete(g);
  } else {
    clearSelection();
  }

  // Preserve the list's scroll position across the full rebuild below. The
  // scrollable `#parts-list` div is recreated from scratch on every render
  // (e.g. on each save, which calls notify() → render), so without this the
  // list jumps back to the top whenever a re-render fires while scrolled down.
  const prevScrollTop = railEl.querySelector('#parts-list')?.scrollTop ?? 0;

  railEl.innerHTML = '';

  // Header: title + collapse + add.
  const header = document.createElement('div');
  header.className = 'flex items-center gap-1 px-2 py-1.5 border-b border-zinc-700/70 shrink-0';

  const title = document.createElement('span');
  title.className = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-500 flex-1 truncate';
  title.textContent = 'Parts';
  header.appendChild(title);

  const overviewBtn = iconBtn('▦', 'Overview of all parts');
  overviewBtn.id = 'btn-parts-overview';
  overviewBtn.disabled = !state.session;
  if (!state.session) overviewBtn.classList.add('opacity-30', 'cursor-default');
  overviewBtn.addEventListener('click', () => {
    if (state.session) openPartsOverview((id) => cb.onSelectPart(id));
  });
  header.appendChild(overviewBtn);

  const addBtn = iconBtn('＋', 'Add a new part');
  addBtn.id = 'btn-add-part';
  addBtn.disabled = !state.session;
  if (!state.session) addBtn.classList.add('opacity-30', 'cursor-default');
  addBtn.addEventListener('click', () => { if (state.session) void cb.onCreatePart(); });
  header.appendChild(addBtn);

  // Collapsing the rail to reclaim horizontal width is a desktop affordance; on
  // mobile the parts list is a full-width pane reached via the pane toggle, so
  // hide the collapse button there (it would otherwise leave the pane empty).
  const collapseBtn = iconBtn('«', 'Hide parts panel'); // «
  collapseBtn.classList.remove('flex');
  collapseBtn.classList.add('hidden', 'md:flex');
  collapseBtn.addEventListener('click', () => cb.onToggleCollapse());
  header.appendChild(collapseBtn);

  railEl.appendChild(header);

  // Body: the scrollable list of parts.
  const list = document.createElement('div');
  list.id = 'parts-list';
  list.className = 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-1';
  railEl.appendChild(list);

  if (!state.session) {
    pruneThumbCache(new Set());
    const empty = document.createElement('div');
    empty.className = 'px-3 py-2 text-[11px] text-zinc-600 italic';
    empty.textContent = 'No session';
    list.appendChild(empty);
    return;
  }

  pruneThumbCache(new Set(state.parts.map((p) => p.id)));

  const tree = buildPartTree(state.parts);
  for (const node of tree) {
    if (node.kind === 'part') {
      list.appendChild(buildRow(node.part, node.part.id === state.currentPart?.id, state.parts.length, list, state.currentVersion, false));
    } else {
      list.appendChild(buildGroupNode(node, state, list));
    }
  }

  // Bulk-action footer — only present while one or more parts are checked.
  if (selected.size > 0) {
    railEl.appendChild(buildActionBar(state));
  }

  // Restore the pre-rebuild scroll position now that the rows exist (clamped by
  // the browser to the new scrollHeight). Keeps Cmd+S from scrolling the list
  // to the top when the user had scrolled down through a long part list.
  if (prevScrollTop > 0) list.scrollTop = prevScrollTop;
}

/** A group container: a collapsible header row plus (when expanded) an indented
 *  body holding the group's member part rows. The container carries
 *  `data-group` so the drag path can tell which group a drop lands in. */
function buildGroupNode(node: PartTreeNode & { kind: 'group' }, state: SessionState, list: HTMLElement): HTMLElement {
  const collapsed = collapsedGroups.has(node.name);
  const containsCurrent = node.parts.some(p => p.id === state.currentPart?.id);

  const wrap = document.createElement('div');
  wrap.dataset.group = node.name;
  wrap.className = 'mb-0.5';

  // --- Header ---
  const head = document.createElement('div');
  head.dataset.groupHeader = node.name;
  head.className = 'group/gh flex items-center gap-1 px-1.5 py-1.5 mx-1 rounded cursor-pointer select-none text-zinc-300 [@media(hover:hover)]:hover:bg-zinc-700/40';

  const chevron = document.createElement('span');
  chevron.className = 'shrink-0 w-4 text-center text-[10px] text-zinc-500 leading-none';
  chevron.textContent = collapsed ? '▸' : '▾';
  head.appendChild(chevron);

  const folder = document.createElement('span');
  folder.className = 'shrink-0 text-xs leading-none';
  folder.textContent = collapsed ? '📁' : '📂';
  head.appendChild(folder);

  const gname = document.createElement('span');
  gname.className = 'flex-1 min-w-0 truncate text-[11px] font-semibold uppercase tracking-wide';
  gname.textContent = node.name;
  gname.title = `${node.name} — ${node.parts.length} part${node.parts.length === 1 ? '' : 's'}`;
  head.appendChild(gname);

  // Active-part dot so a collapsed group still signals it holds the open part.
  if (containsCurrent && collapsed) {
    const dot = document.createElement('span');
    dot.className = 'shrink-0 w-1.5 h-1.5 rounded-full bg-blue-500';
    dot.title = 'The active part is in this group';
    head.appendChild(dot);
  }

  const count = document.createElement('span');
  count.className = 'shrink-0 text-[10px] text-zinc-500 tabular-nums px-1';
  count.textContent = String(node.parts.length);
  head.appendChild(count);

  // Ungroup the whole group (removes the group from every member).
  const ungroupBtn = iconBtn('⊘', 'Ungroup — remove this group');
  ungroupBtn.className += ' [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/gh:opacity-100 focus:opacity-100';
  ungroupBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    void cb.onSetPartGroup(node.parts.map(p => p.id), null);
  });
  head.appendChild(ungroupBtn);

  head.addEventListener('click', () => {
    if (collapsed) collapsedGroups.delete(node.name);
    else collapsedGroups.add(node.name);
    render(getState());
  });
  // Rename the group (retitles every member's `group`).
  gname.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    void renameGroup(node);
  });

  wrap.appendChild(head);

  // --- Body (member rows) ---
  if (!collapsed) {
    const body = document.createElement('div');
    body.dataset.groupBody = node.name;
    body.className = 'border-l border-zinc-700/60 ml-2.5';
    for (const part of node.parts) {
      body.appendChild(buildRow(part, part.id === state.currentPart?.id, state.parts.length, list, state.currentVersion, true));
    }
    wrap.appendChild(body);
  }

  return wrap;
}

async function renameGroup(node: PartTreeNode & { kind: 'group' }): Promise<void> {
  const next = await promptDialog('Rename group', { title: 'Rename group', initialValue: node.name, confirmLabel: 'Rename' });
  const trimmed = next?.trim();
  if (!trimmed || trimmed === node.name) return;
  if (collapsedGroups.delete(node.name)) collapsedGroups.add(trimmed);
  void cb.onSetPartGroup(node.parts.map(p => p.id), trimmed);
}

function buildRow(part: Part, isCurrent: boolean, partCount: number, list: HTMLElement, currentVersion: Version | null, inGroup: boolean): HTMLElement {
  const isSelected = selected.has(part.id);
  const row = document.createElement('div');
  row.dataset.partId = part.id;
  row.setAttribute('role', 'button');
  if (isCurrent) row.setAttribute('aria-current', 'true');
  row.className = [
    'group flex items-center gap-1 px-1.5 py-2.5 rounded cursor-pointer select-none',
    // Grouped rows sit inside an indented, border-left body, so they hug the
    // left; top-level rows get the standard side margin.
    inGroup ? 'ml-1 mr-1' : 'mx-1',
    isCurrent
      ? 'bg-blue-500/15 text-zinc-100 border-l-2 border-blue-500'
      : isSelected
        ? 'bg-blue-500/10 text-zinc-200 border-l-2 border-blue-500/40'
        : 'text-zinc-400 [@media(hover:hover)]:hover:bg-zinc-700/40 border-l-2 border-transparent',
  ].join(' ');

  // Selection checkbox (multi-select bulk delete). Only offered when more than
  // one part exists — a session must always keep at least one. Subtle until
  // hover on pointer devices, but always shown on touch and whenever a
  // selection is already in progress (so it can't silently hide checked rows).
  if (partCount > 1) {
    const anySelected = selected.size > 0;
    const cbWrap = document.createElement('span');
    cbWrap.className = 'shrink-0 flex items-center justify-center px-1 py-1 cursor-pointer';
    if (!anySelected) {
      cbWrap.className += ' [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus-within:opacity-100';
    }
    const cbx = document.createElement('input');
    cbx.type = 'checkbox';
    cbx.checked = isSelected;
    cbx.className = 'w-3.5 h-3.5 accent-blue-500 cursor-pointer';
    cbx.setAttribute('aria-label', `Select part ${part.name}`);
    const onToggle = (e: Event) => {
      e.stopPropagation();
      toggleSelection(part.id, (e as MouseEvent).shiftKey);
    };
    cbx.addEventListener('click', onToggle);
    cbWrap.addEventListener('click', (e) => {
      if (e.target !== cbx) onToggle(e); // let padding around the box toggle too
    });
    cbWrap.appendChild(cbx);
    row.appendChild(cbWrap);
  }

  // Drag handle (pointer-based reorder — works for mouse, touch, and pen).
  // Always visible (not hover-gated) so it's discoverable on touch.
  const grip = document.createElement('span');
  // ≥44×44px hit area on mobile (fingertip-friendly) that collapses to the
  // subtle padded glyph on pointer-capable desktop (md+). The visible ⠿ stays
  // small; the transparent box around it is what grows the touch target.
  grip.className = 'shrink-0 inline-flex items-center justify-center text-zinc-500 [@media(hover:hover)]:group-hover:text-zinc-300 text-sm leading-none cursor-grab touch-none min-w-[44px] min-h-[44px] md:min-w-0 md:min-h-0 md:px-1 md:py-1';
  grip.textContent = '⠿'; // ⠿ drag grip
  grip.title = 'Drag to reorder or to move between groups';
  grip.setAttribute('aria-label', 'Drag to reorder');
  attachDragHandlers(grip, row, list);
  row.appendChild(grip);

  // Small geometry preview of the part, next to its name.
  row.appendChild(buildThumb(part, isCurrent, currentVersion));

  const name = document.createElement('span');
  name.className = 'flex-1 min-w-0 truncate text-xs';
  name.textContent = part.name;
  name.title = part.name;
  row.appendChild(name);

  // Select on click (ignored when this is already the current part).
  row.addEventListener('click', () => {
    if (!isCurrent) void cb.onSelectPart(part.id);
  });

  // Inline rename on double-click.
  name.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    beginRename(name, part);
  });

  // Delete (only when more than one part remains).
  if (partCount > 1) {
    const del = iconBtn('✕', 'Delete this part'); // ✕
    // Visible by default so it's reachable on touch (no hover); only fade-until-
    // hover on hover-capable devices.
    del.className += ' [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 focus:opacity-100';
    del.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (await confirmDialog(`Delete part "${part.name}" and all of its versions? This cannot be undone.`, { title: 'Delete part', confirmLabel: 'Delete', danger: true })) {
        void cb.onDeletePart(part.id);
      }
    });
    row.appendChild(del);
  }

  return row;
}

/** A small fixed-size preview slot for a part's latest geometry. */
function buildThumb(part: Part, isCurrent: boolean, currentVersion: Version | null): HTMLElement {
  const box = document.createElement('span');
  box.dataset.thumb = '';
  box.className = 'shrink-0 w-6 h-6 rounded bg-zinc-900 overflow-hidden flex items-center justify-center';

  // Show whatever we already have cached straight away so an unrelated re-render
  // (part switch, rename, reorder) doesn't flash the preview off and back on.
  const cached = thumbCache.get(part.id);
  if (cached) box.appendChild(makeThumbImg(cached.url));

  if (isCurrent) {
    // The current part's latest version is already in memory and stays fresh as
    // the user saves — no DB read needed.
    applyThumb(part.id, currentVersion, box);
  } else if (!cached) {
    // A non-current part's thumbnail can't change until it becomes current, so
    // fetch it once and rely on the cache from then on.
    void getLatestVersion(part.id).then((v) => applyThumb(part.id, v, box));
  }
  return box;
}

/** Point the preview box at `version`'s thumbnail, (re)building the object URL
 *  only when the version changed since we last cached one for this part. */
function applyThumb(partId: string, version: Version | null, box: HTMLElement): void {
  if (!version || !version.thumbnail) return; // no saved geometry yet
  const cached = thumbCache.get(partId);
  if (cached && cached.versionId === version.id) {
    paintThumb(partId, cached.url, box); // already cached — just ensure it's shown
    return;
  }
  if (cached) URL.revokeObjectURL(cached.url);
  const url = URL.createObjectURL(version.thumbnail);
  thumbCache.set(partId, { versionId: version.id, url });
  paintThumb(partId, url, box);
}

/** Draw `url` into the part's preview slot. Prefers the row that's currently in
 *  the DOM (looked up by part id) so an async paint can't land on a stale box
 *  left behind by an intervening re-render; falls back to `box` when the row
 *  isn't mounted yet (the synchronous current-part path). */
function paintThumb(partId: string, url: string, box: HTMLElement): void {
  const live = railEl?.querySelector<HTMLElement>(`[data-part-id="${CSS.escape(partId)}"] [data-thumb]`);
  const target = live ?? box;
  const existing = target.querySelector('img');
  if (existing && existing.src === url) return; // already showing this image
  target.textContent = '';
  target.appendChild(makeThumbImg(url));
}

function makeThumbImg(url: string): HTMLImageElement {
  const img = document.createElement('img');
  img.src = url;
  img.alt = '';
  img.className = 'w-full h-full object-contain';
  return img;
}

/** Drop (and revoke) cached preview URLs for parts that no longer exist. */
function pruneThumbCache(validIds: Set<string>): void {
  for (const [partId, entry] of thumbCache) {
    if (!validIds.has(partId)) {
      URL.revokeObjectURL(entry.url);
      thumbCache.delete(partId);
    }
  }
}

// === Multi-select bulk actions ===

/** Toggle one part's checkbox, or — with shift held — select the inclusive
 *  range between the last-clicked anchor and this row, then re-render. */
function toggleSelection(id: string, shift: boolean): void {
  const parts = getState().parts;
  const a = lastClickedId ? parts.findIndex(p => p.id === lastClickedId) : -1;
  const b = parts.findIndex(p => p.id === id);
  if (shift && a >= 0 && b >= 0 && a !== b) {
    const [lo, hi] = a < b ? [a, b] : [b, a];
    for (let i = lo; i <= hi; i++) selected.add(parts[i].id);
  } else if (selected.has(id)) {
    selected.delete(id);
  } else {
    selected.add(id);
  }
  lastClickedId = id;
  render(getState());
}

function clearSelection(): void {
  selected.clear();
  lastClickedId = null;
}

/** Footer bar shown while parts are checked: count, clear, group, merge, delete. */
function buildActionBar(state: SessionState): HTMLElement {
  const bar = document.createElement('div');
  bar.id = 'parts-bulk-actions';
  bar.className = 'shrink-0 flex flex-wrap items-center gap-1.5 px-2 py-1.5 border-t border-zinc-700/70 bg-zinc-800/70';

  const count = document.createElement('span');
  count.className = 'flex-1 min-w-0 truncate text-[11px] text-zinc-300';
  count.textContent = `${selected.size} selected`;
  bar.appendChild(count);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'shrink-0 px-2 h-7 rounded text-[11px] text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 transition-colors';
  clearBtn.textContent = 'Clear';
  clearBtn.title = 'Clear selection';
  clearBtn.addEventListener('click', () => { clearSelection(); render(getState()); });
  bar.appendChild(clearBtn);

  // Group the selection into a (new or existing) named group.
  const selectedParts = state.parts.filter(p => selected.has(p.id));
  const groupBtn = document.createElement('button');
  groupBtn.id = 'btn-group-parts';
  groupBtn.className = 'shrink-0 px-2 h-7 rounded text-[11px] font-medium text-zinc-100 bg-zinc-600/70 hover:bg-zinc-600 transition-colors';
  groupBtn.textContent = 'Group…';
  groupBtn.title = 'Put the selected parts into a group';
  groupBtn.addEventListener('click', async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    // Prefill with the common group when the whole selection already shares one.
    const groups = new Set(selectedParts.map(p => p.group?.trim() ?? ''));
    const prefill = groups.size === 1 ? [...groups][0] : '';
    const name = await promptDialog('Group name', { title: 'Group parts', initialValue: prefill, confirmLabel: 'Group', placeholder: 'e.g. Armor' });
    const trimmed = name?.trim();
    if (!trimmed) return;
    clearSelection();
    render(getState());
    void cb.onSetPartGroup(ids, trimmed);
  });
  bar.appendChild(groupBtn);

  // Ungroup — offered only when at least one selected part is in a group.
  if (selectedParts.some(p => p.group?.trim())) {
    const ungroupBtn = document.createElement('button');
    ungroupBtn.id = 'btn-ungroup-parts';
    ungroupBtn.className = 'shrink-0 px-2 h-7 rounded text-[11px] text-zinc-300 hover:text-zinc-100 hover:bg-zinc-700 transition-colors';
    ungroupBtn.textContent = 'Ungroup';
    ungroupBtn.title = 'Remove the selected parts from their group';
    ungroupBtn.addEventListener('click', () => {
      const ids = [...selected];
      if (ids.length === 0) return;
      clearSelection();
      render(getState());
      void cb.onSetPartGroup(ids, null);
    });
    bar.appendChild(ungroupBtn);
  }

  // Merge needs at least two parts to combine into one.
  if (selected.size >= 2) {
    const mergeBtn = document.createElement('button');
    mergeBtn.id = 'btn-merge-parts';
    mergeBtn.className = 'shrink-0 px-2 h-7 rounded text-[11px] font-medium text-white bg-blue-600/80 hover:bg-blue-600 transition-colors';
    mergeBtn.textContent = `Merge ${selected.size}`;
    mergeBtn.title = 'Combine the selected parts into one';
    mergeBtn.addEventListener('click', () => {
      const ids = [...selected];
      if (ids.length < 2) return;
      clearSelection();
      render(getState()); // hide the bar; the merge flow re-renders on commit
      void cb.onMergeParts(ids);
    });
    bar.appendChild(mergeBtn);
  }

  // A session must always keep at least one part, so a select-all delete is
  // refused (mirrors the single-row delete, which hides when only one remains).
  const wouldEmptySession = selected.size >= state.parts.length;
  const delBtn = document.createElement('button');
  delBtn.id = 'btn-delete-parts';
  delBtn.className = 'shrink-0 px-2 h-7 rounded text-[11px] font-medium text-white transition-colors '
    + (wouldEmptySession ? 'bg-red-600/40 opacity-60 cursor-default' : 'bg-red-600/80 hover:bg-red-600');
  delBtn.textContent = `Delete ${selected.size}`;
  if (wouldEmptySession) {
    delBtn.disabled = true;
    delBtn.title = 'At least one part must remain — deselect one to delete.';
  } else {
    delBtn.title = 'Delete the selected parts and all their versions';
  }
  delBtn.addEventListener('click', async () => {
    if (delBtn.disabled) return;
    const ids = [...selected];
    if (ids.length === 0) return;
    const msg = ids.length === 1
      ? 'Delete this part and all of its versions? This cannot be undone.'
      : `Delete ${ids.length} parts and all of their versions? This cannot be undone.`;
    if (!(await confirmDialog(msg, { title: 'Delete parts', confirmLabel: 'Delete', danger: true }))) return;
    clearSelection();
    render(getState()); // hide the bar immediately; the delete re-renders on commit
    void cb.onDeleteParts(ids);
  });
  bar.appendChild(delBtn);

  return bar;
}

function beginRename(name: HTMLElement, part: Part): void {
  const input = document.createElement('input');
  input.type = 'text';
  input.value = part.name;
  input.className = 'flex-1 min-w-0 bg-zinc-700 text-zinc-100 text-xs px-1 py-0.5 rounded border border-blue-500 outline-none';
  name.replaceWith(input);
  input.focus();
  input.select();
  let done = false;
  const commit = (save: boolean) => {
    if (done) return;
    done = true;
    const next = input.value.trim();
    if (save && next && next !== part.name) {
      void cb.onRenamePart(part.id, next);
    } else {
      render(getState()); // restore the row
    }
  };
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('blur', () => commit(true));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(true); }
    if (e.key === 'Escape') { e.preventDefault(); commit(false); }
  });
}

// === Pointer-based drag-to-reorder (and drag-between-groups) ===

function attachDragHandlers(grip: HTMLElement, row: HTMLElement, list: HTMLElement): void {
  let indicator: HTMLElement | null = null;
  let activePointer: number | null = null;

  const cleanup = () => {
    activePointer = null;
    dragging = false;
    row.classList.remove('opacity-40');
    indicator?.remove();
    indicator = null;
    // Apply any state change that arrived (and was suppressed) mid-drag.
    if (pendingRender) {
      pendingRender = false;
      render(getState());
    }
  };

  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    e.stopPropagation();
    // Commit drag state only once capture succeeds — otherwise a thrown
    // setPointerCapture (e.g. detached node) would wedge `dragging` true and
    // freeze all future rail re-renders.
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      return;
    }
    activePointer = e.pointerId;
    dragging = true;
    row.classList.add('opacity-40');
    indicator = document.createElement('div');
    indicator.dataset.dropIndicator = '';
    indicator.className = 'h-0.5 mx-2 my-0.5 bg-blue-500 rounded pointer-events-none';
  });

  grip.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer || !indicator) return;
    const beforeRow = rowAfterY(list, row, e.clientY);
    // Insert the indicator into the SAME container as the row it precedes, so a
    // drop into a group's indented body reads back as that group.
    if (beforeRow && beforeRow.parentElement) beforeRow.parentElement.insertBefore(indicator, beforeRow);
    else list.appendChild(indicator);
  });

  const finish = (e: PointerEvent) => {
    if (e.pointerId !== activePointer) return;
    const draggedId = row.dataset.partId!;
    let layout: PartLayoutEntry[] = [];
    let newGroup: string | null = null;
    if (indicator && list.contains(indicator)) {
      // The group the indicator sits inside (its member body carries data-group);
      // null when it's at the top level (ungrouped).
      const groupWrap = indicator.closest('[data-group]') as HTMLElement | null;
      newGroup = groupWrap?.dataset.group ?? null;
      // Walk rows + indicator in document order; the dragged part takes the
      // indicator's slot and its (possibly new) group. Everyone else keeps their
      // group untouched (bare id).
      const seq = list.querySelectorAll<HTMLElement>('[data-part-id], [data-drop-indicator]');
      let placed = false;
      for (const el of Array.from(seq)) {
        if (el === indicator) { layout.push({ id: draggedId, group: newGroup }); placed = true; continue; }
        const id = el.dataset.partId;
        if (id && id !== draggedId) layout.push(id);
      }
      if (!placed) layout.push({ id: draggedId, group: newGroup });
    }
    try { grip.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    cleanup();

    const current = getState().parts;
    const currentIds = current.map(p => p.id);
    const newIds = layout.map(le => (typeof le === 'string' ? le : le.id));
    const draggedPart = current.find(p => p.id === draggedId);
    const oldGroup = draggedPart?.group?.trim() ?? null;
    const orderChanged = newIds.length === currentIds.length && newIds.some((id, i) => id !== currentIds[i]);
    const groupChanged = (newGroup?.trim() ?? null) !== oldGroup;
    if (layout.length === currentIds.length && (orderChanged || groupChanged)) {
      void cb.onReorderParts(layout);
    } else {
      render(getState()); // no change — restore opacity/order cleanly
    }
  };

  grip.addEventListener('pointerup', finish);
  grip.addEventListener('pointercancel', (e) => {
    if (e.pointerId !== activePointer) return;
    try { grip.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    cleanup();
    render(getState());
  });
}

/** The first part-row whose vertical midpoint is below `y` (i.e. the row the
 *  dragged item should be inserted before), or null to append at the end.
 *  Walks every mounted part row (across groups), not just the list's direct
 *  children, so nested (grouped) rows are valid drop targets too. */
function rowAfterY(list: HTMLElement, dragged: HTMLElement, y: number): HTMLElement | null {
  const rows = list.querySelectorAll<HTMLElement>('[data-part-id]');
  for (const child of Array.from(rows)) {
    if (child === dragged) continue;
    const rect = child.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) return child;
  }
  return null;
}

function iconBtn(glyph: string, title: string): HTMLButtonElement {
  const b = document.createElement('button');
  // 28px hit target — a pragmatic balance between the dense rail and touch use;
  // the full-width row remains the primary (large) select target.
  b.className = 'shrink-0 w-7 h-7 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 text-sm leading-none transition-colors';
  b.textContent = glyph;
  b.title = title;
  b.setAttribute('aria-label', title);
  return b;
}
