// Parts rail — an IDE-style list of the active session's parts. Supports
// create, select, inline rename, delete, multi-select bulk delete, and
// pointer-based drag-to-reorder. Renders into the rail container created by
// layout.ts and re-renders on every session-state change.

import { getState, onStateChange, type SessionState, type Part, type Version } from '../storage/sessionManager';
import { getLatestVersion } from '../storage/db';

export interface PartListCallbacks {
  /** Switch the active part (loads its latest version into the editor). */
  onSelectPart: (id: string) => void | Promise<void>;
  /** Create a new part in the active session. */
  onCreatePart: () => void | Promise<void>;
  onRenamePart: (id: string, name: string) => void | Promise<void>;
  onDeletePart: (id: string) => void | Promise<void>;
  /** Delete several parts at once (multi-select bulk delete). */
  onDeleteParts: (ids: string[]) => void | Promise<void>;
  /** Persist a new part order (array of part ids, first = top). */
  onReorderParts: (orderedIds: string[]) => void | Promise<void>;
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

export function createPartList(container: HTMLElement, callbacks: PartListCallbacks): void {
  railEl = container;
  cb = callbacks;
  render(getState());
  onStateChange((state) => {
    if (dragging) { pendingRender = true; return; }
    render(state);
  });
}

function render(state: SessionState): void {
  if (!railEl) return;

  // Drop any selection that no longer maps to a live part (deleted, or the
  // session was switched/closed) so the action bar can't act on stale ids.
  if (state.session) {
    const live = new Set(state.parts.map(p => p.id));
    for (const id of [...selected]) if (!live.has(id)) selected.delete(id);
    if (lastClickedId && !live.has(lastClickedId)) lastClickedId = null;
  } else {
    clearSelection();
  }

  railEl.innerHTML = '';

  // Header: title + collapse + add.
  const header = document.createElement('div');
  header.className = 'flex items-center gap-1 px-2 py-1.5 border-b border-zinc-700/70 shrink-0';

  const title = document.createElement('span');
  title.className = 'text-[11px] font-semibold uppercase tracking-wide text-zinc-500 flex-1 truncate';
  title.textContent = 'Parts';
  header.appendChild(title);

  const addBtn = iconBtn('＋', 'Add a new part');
  addBtn.id = 'btn-add-part';
  addBtn.disabled = !state.session;
  if (!state.session) addBtn.classList.add('opacity-30', 'cursor-default');
  addBtn.addEventListener('click', () => { if (state.session) void cb.onCreatePart(); });
  header.appendChild(addBtn);

  const collapseBtn = iconBtn('«', 'Hide parts panel'); // «
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
  for (const part of state.parts) {
    list.appendChild(
      buildRow(
        part,
        part.id === state.currentPart?.id,
        state.parts.length,
        list,
        state.currentVersion,
      ),
    );
  }

  // Bulk-action footer — only present while one or more parts are checked.
  if (selected.size > 0) {
    railEl.appendChild(buildActionBar(state));
  }
}

function buildRow(part: Part, isCurrent: boolean, partCount: number, list: HTMLElement, currentVersion: Version | null): HTMLElement {
  const isSelected = selected.has(part.id);
  const row = document.createElement('div');
  row.dataset.partId = part.id;
  row.setAttribute('role', 'button');
  if (isCurrent) row.setAttribute('aria-current', 'true');
  row.className = [
    'group flex items-center gap-1 px-1.5 py-2.5 mx-1 rounded cursor-pointer select-none',
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
  grip.className = 'shrink-0 text-zinc-500 [@media(hover:hover)]:group-hover:text-zinc-300 text-sm leading-none cursor-grab touch-none px-1 py-1';
  grip.textContent = '⠿'; // ⠿ drag grip
  grip.title = 'Drag to reorder';
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
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      if (confirm(`Delete part "${part.name}" and all of its versions? This cannot be undone.`)) {
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

/** Footer bar shown while parts are checked: count, clear, and bulk delete. */
function buildActionBar(state: SessionState): HTMLElement {
  const bar = document.createElement('div');
  bar.id = 'parts-bulk-actions';
  bar.className = 'shrink-0 flex items-center gap-1.5 px-2 py-1.5 border-t border-zinc-700/70 bg-zinc-800/70';

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
  delBtn.addEventListener('click', () => {
    if (delBtn.disabled) return;
    const ids = [...selected];
    if (ids.length === 0) return;
    const msg = ids.length === 1
      ? 'Delete this part and all of its versions? This cannot be undone.'
      : `Delete ${ids.length} parts and all of their versions? This cannot be undone.`;
    if (!confirm(msg)) return;
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

// === Pointer-based drag-to-reorder ===

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
    indicator.className = 'h-0.5 mx-2 my-0.5 bg-blue-500 rounded pointer-events-none';
  });

  grip.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer || !indicator) return;
    const beforeRow = rowAfterY(list, row, e.clientY);
    if (beforeRow) list.insertBefore(indicator, beforeRow);
    else list.appendChild(indicator);
  });

  const finish = (e: PointerEvent) => {
    if (e.pointerId !== activePointer) return;
    const draggedId = row.dataset.partId!;
    // Build the new order from the indicator's position among the rows.
    let order: string[] = [];
    if (indicator && indicator.parentElement === list) {
      for (const child of Array.from(list.children)) {
        if (child === indicator) { order.push(draggedId); continue; }
        const id = (child as HTMLElement).dataset.partId;
        if (id && id !== draggedId) order.push(id);
      }
      if (!order.includes(draggedId)) order.push(draggedId);
    }
    try { grip.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    cleanup();
    const current = getState().parts.map(p => p.id);
    if (order.length === current.length && order.some((id, i) => id !== current[i])) {
      void cb.onReorderParts(order);
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
 *  dragged item should be inserted before), or null to append at the end. */
function rowAfterY(list: HTMLElement, dragged: HTMLElement, y: number): HTMLElement | null {
  for (const child of Array.from(list.children)) {
    if (!(child instanceof HTMLElement) || !child.dataset.partId || child === dragged) continue;
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
