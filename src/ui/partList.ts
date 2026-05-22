// Parts rail — an IDE-style list of the active session's parts. Supports
// create, select, inline rename, delete, and pointer-based drag-to-reorder.
// Renders into the rail container created by layout.ts and re-renders on every
// session-state change.

import { getState, onStateChange, type SessionState, type Part } from '../storage/sessionManager';

export interface PartListCallbacks {
  /** Switch the active part (loads its latest version into the editor). */
  onSelectPart: (id: string) => void | Promise<void>;
  /** Create a new part in the active session. */
  onCreatePart: () => void | Promise<void>;
  onRenamePart: (id: string, name: string) => void | Promise<void>;
  onDeletePart: (id: string) => void | Promise<void>;
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
    const empty = document.createElement('div');
    empty.className = 'px-3 py-2 text-[11px] text-zinc-600 italic';
    empty.textContent = 'No session';
    list.appendChild(empty);
    return;
  }

  for (const part of state.parts) {
    list.appendChild(buildRow(part, part.id === state.currentPart?.id, state.parts.length, list));
  }
}

function buildRow(part: Part, isCurrent: boolean, partCount: number, list: HTMLElement): HTMLElement {
  const row = document.createElement('div');
  row.dataset.partId = part.id;
  row.setAttribute('role', 'button');
  if (isCurrent) row.setAttribute('aria-current', 'true');
  row.className = [
    'group flex items-center gap-1 px-1.5 py-2.5 mx-1 rounded cursor-pointer select-none',
    isCurrent
      ? 'bg-blue-500/15 text-zinc-100 border-l-2 border-blue-500'
      : 'text-zinc-400 [@media(hover:hover)]:hover:bg-zinc-700/40 border-l-2 border-transparent',
  ].join(' ');

  // Drag handle (pointer-based reorder — works for mouse, touch, and pen).
  // Always visible (not hover-gated) so it's discoverable on touch.
  const grip = document.createElement('span');
  grip.className = 'shrink-0 text-zinc-500 [@media(hover:hover)]:group-hover:text-zinc-300 text-sm leading-none cursor-grab touch-none px-1 py-1';
  grip.textContent = '⠿'; // ⠿ drag grip
  grip.title = 'Drag to reorder';
  grip.setAttribute('aria-label', 'Drag to reorder');
  attachDragHandlers(grip, row, list);
  row.appendChild(grip);

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
