// Pointer panel — the user-facing review surface for AI-planning pointers.
// Lists every pointer in the session with a live tolerance slider, mode
// dropdown, hide/delete buttons, and an "Approve all" gesture. When a
// pointer's slider is being dragged the panel asks pointerOverlay to draw
// a phantom flood-fill so the user sees exactly what would be painted.
//
// Mirrors the shared tool-panel conventions: createToolPanelShell, the
// styleConstants buttons, showToast for feedback. No new chrome.

import { createToolPanelShell, type ToolPanelShell } from './toolPanel';
import { BUTTON_PRIMARY, BUTTON_SMALL_SECONDARY } from './styleConstants';
import { showToast } from './toast';
import { registerCommands } from './commandPalette';
import {
  getPointers,
  onPointersChange,
  updatePointer,
  removePointer,
  clearPointers,
  setHidden,
  type PointerAnnotation,
  type PointerPaintHint,
  type PointerPaintHintKind,
} from '../annotations/pointers';
import {
  setPointerPreview,
  clearPointerPreview,
  getActivePreview,
} from '../annotations/pointerOverlay';

/** Hooks the panel calls into the API layer for commit-paint actions and
 *  for the "approve all" gesture. Decouples the panel from the giant
 *  partwrightAPI surface so the dependency stays one-way. */
export interface PointerPanelApi {
  /** Commit a pointer's proposed paint via the existing paint pipeline.
   *  Implemented in main.ts atop `findConnectedFromSeed` / `findCoplanarRegion`
   *  / paintColorFlood; flips the pointer's status to 'painted'. */
  commitPaintFromPointer(id: string, opts?: { color?: [number, number, number] }): Promise<{ regionId?: number; error?: string }>;
}

let panel: ToolPanelShell | null = null;
let unsubscribe: (() => void) | null = null;
let api: PointerPanelApi | null = null;

export function initPointerPanelUI(apiHooks: PointerPanelApi): void {
  api = apiHooks;
  registerCommands([
    {
      id: 'pointers.toggle',
      title: 'Pointers: open panel',
      keywords: 'pointer label anchor leader callout ai plan',
      run: openPointerPanel,
    },
    {
      id: 'pointers.clear-proposed',
      title: 'Pointers: clear proposed',
      keywords: 'pointer clear plan',
      run: () => {
        const n = clearPointers({ status: 'proposed' });
        showToast(n > 0 ? `Cleared ${n} proposed pointer(s)` : 'No proposed pointers to clear', { variant: n > 0 ? 'success' : 'neutral' });
      },
    },
  ]);
}

export function openPointerPanel(): void {
  if (panel) return;
  panel = createToolPanelShell({
    title: 'AI Pointers',
    width: 'w-[24rem]',
    onClose: () => {
      if (unsubscribe) { unsubscribe(); unsubscribe = null; }
      clearPointerPreview();
      panel = null;
    },
  });
  rebuild();
  unsubscribe = onPointersChange(rebuild);
}

export function closePointerPanel(): void {
  panel?.close();
}

function rebuild(): void {
  if (!panel) return;
  const body = panel.body;
  const footer = panel.footer;
  body.innerHTML = '';
  footer.innerHTML = '';

  const pts = getPointers();
  if (pts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'text-[12px] text-zinc-400 px-3 py-6 leading-relaxed';
    empty.innerHTML = `<p class="mb-2">No pointers yet.</p>
<p class="text-zinc-500">The AI agent drops <strong>labelled pointers</strong> at surface points it believes correspond to a feature (an iris, a foot, a button). You review/correct them here, then it commits the paint against the agreed anchors.</p>
<p class="mt-2 text-zinc-500">From the console: <code class="text-zinc-300">partwright.dropPointer({label:'iris', point:[0,0,5], normal:[0,0,1]})</code>.</p>`;
    body.appendChild(empty);
    return;
  }

  // Group: proposed / approved / painted
  const groups: Array<{ status: 'proposed' | 'approved' | 'painted'; title: string; items: PointerAnnotation[] }> = [
    { status: 'proposed', title: 'Proposed', items: pts.filter(p => p.status === 'proposed') },
    { status: 'approved', title: 'Approved', items: pts.filter(p => p.status === 'approved') },
    { status: 'painted', title: 'Painted', items: pts.filter(p => p.status === 'painted') },
  ];

  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-3 p-3';
  for (const g of groups) {
    if (g.items.length === 0) continue;
    const hdr = document.createElement('div');
    hdr.className = 'text-[10px] uppercase tracking-wider text-zinc-400 font-semibold flex items-center justify-between';
    hdr.innerHTML = `<span>${g.title} <span class="text-zinc-500">· ${g.items.length}</span></span>`;
    const allBtn = document.createElement('button');
    allBtn.className = BUTTON_SMALL_SECONDARY;
    allBtn.textContent = g.status === 'proposed' ? 'Approve all' : 'Clear';
    allBtn.addEventListener('click', async () => {
      if (g.status === 'proposed') {
        for (const p of g.items) updatePointer(p.id, { status: 'approved' });
        showToast(`Approved ${g.items.length} pointer(s)`, { variant: 'success' });
      } else {
        const n = clearPointers({ status: g.status });
        showToast(`Cleared ${n} ${g.status} pointer(s)`, { variant: 'neutral' });
      }
    });
    hdr.appendChild(allBtn);
    wrap.appendChild(hdr);

    for (const p of g.items) wrap.appendChild(buildPointerRow(p));
  }

  body.appendChild(wrap);

  // Footer: bulk actions
  const clearAllBtn = document.createElement('button');
  clearAllBtn.className = BUTTON_SMALL_SECONDARY;
  clearAllBtn.textContent = 'Clear all';
  clearAllBtn.addEventListener('click', () => {
    const n = clearPointers();
    showToast(`Cleared ${n} pointer(s)`, { variant: 'neutral' });
  });
  footer.appendChild(clearAllBtn);
}

function buildPointerRow(p: PointerAnnotation): HTMLElement {
  const row = document.createElement('div');
  row.className = 'border border-zinc-700/70 rounded-md bg-zinc-900/40 p-2 flex flex-col gap-1.5';
  if (p.stale || p.orphaned) row.classList.add('ring-1', 'ring-amber-500/40');

  // Top row: label + hide/delete
  const top = document.createElement('div');
  top.className = 'flex items-center gap-2';
  const dot = document.createElement('span');
  dot.className = 'w-2.5 h-2.5 rounded-full shrink-0';
  dot.style.background = p.proposedColor
    ? `rgb(${Math.round(p.proposedColor[0] * 255)},${Math.round(p.proposedColor[1] * 255)},${Math.round(p.proposedColor[2] * 255)})`
    : statusColor(p);
  top.appendChild(dot);

  const labelInput = document.createElement('input');
  labelInput.type = 'text';
  labelInput.value = p.label;
  labelInput.className = 'flex-1 bg-transparent text-[13px] text-zinc-100 outline-none border-b border-transparent focus:border-zinc-500';
  labelInput.addEventListener('change', () => {
    updatePointer(p.id, { label: labelInput.value.trim() || '(unnamed)' });
  });
  top.appendChild(labelInput);

  const hideBtn = document.createElement('button');
  hideBtn.className = 'w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-700 text-[12px]';
  hideBtn.textContent = p.hidden ? '◌' : '●';
  hideBtn.title = p.hidden ? 'Show' : 'Hide';
  hideBtn.addEventListener('click', () => setHidden([p.id], !p.hidden));
  top.appendChild(hideBtn);

  const delBtn = document.createElement('button');
  delBtn.className = 'w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-red-300 hover:bg-zinc-700 text-[14px]';
  delBtn.textContent = '×';
  delBtn.title = 'Delete pointer';
  delBtn.addEventListener('click', () => removePointer(p.id));
  top.appendChild(delBtn);
  row.appendChild(top);

  if (p.stale || p.orphaned) {
    const flag = document.createElement('div');
    flag.className = 'text-[11px] text-amber-300';
    flag.textContent = `${p.orphaned ? 'orphaned' : 'stale'}${p.staleReason ? ` — ${p.staleReason}` : ''}`;
    row.appendChild(flag);
  }

  // Paint hint controls (only when a hint is set)
  if (p.paintHint) {
    row.appendChild(buildHintControls(p, p.paintHint));
  } else {
    const addHint = document.createElement('button');
    addHint.className = BUTTON_SMALL_SECONDARY;
    addHint.textContent = '+ Add bucket-paint';
    addHint.addEventListener('click', () => {
      updatePointer(p.id, { paintHint: { kind: 'connected', maxDeviationDeg: 30 } });
    });
    row.appendChild(addHint);
  }

  // Footer row: status + Commit
  const actions = document.createElement('div');
  actions.className = 'flex items-center justify-between gap-2';
  const status = document.createElement('span');
  status.className = 'text-[11px] text-zinc-500';
  status.textContent = `${p.status}${p.regionId ? ` · region #${p.regionId}` : ''}`;
  actions.appendChild(status);

  const commit = document.createElement('button');
  commit.className = BUTTON_PRIMARY + ' text-[12px] py-1';
  commit.textContent = p.status === 'painted' ? 'Repaint' : 'Paint';
  commit.disabled = p.orphaned || !p.paintHint;
  if (commit.disabled) commit.classList.add('opacity-50', 'cursor-not-allowed');
  commit.addEventListener('click', async () => {
    if (!api) return;
    const res = await api.commitPaintFromPointer(p.id);
    if (res?.error) {
      showToast(`Paint failed: ${res.error}`, { variant: 'warn' });
    } else {
      showToast(`Painted "${p.label}"`, { variant: 'success' });
    }
  });
  actions.appendChild(commit);
  row.appendChild(actions);

  return row;
}

function buildHintControls(p: PointerAnnotation, hint: PointerPaintHint): HTMLElement {
  const box = document.createElement('div');
  box.className = 'flex flex-col gap-1';

  // Mode select
  const modeRow = document.createElement('div');
  modeRow.className = 'flex items-center gap-2 text-[11px] text-zinc-400';
  const modeLabel = document.createElement('span');
  modeLabel.textContent = 'Mode';
  modeLabel.className = 'shrink-0';
  modeRow.appendChild(modeLabel);
  const sel = document.createElement('select');
  sel.className = 'bg-zinc-900 border border-zinc-700 rounded px-1 py-0.5 text-[11px] text-zinc-100';
  const opts: Array<[PointerPaintHintKind, string]> = [
    ['connected', 'Connected (seed-relative angle)'],
    ['coplanar', 'Coplanar (adjacent angle)'],
    ['colorFlood', 'Color flood (magic wand)'],
  ];
  for (const [v, t] of opts) {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    if (v === hint.kind) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    const v = sel.value as PointerPaintHintKind;
    const next: PointerPaintHint =
      v === 'connected' ? { kind: 'connected', maxDeviationDeg: 30 } :
      v === 'coplanar' ? { kind: 'coplanar', normalToleranceDeg: 5 } :
      { kind: 'colorFlood', colorTolerance: 0.05 };
    updatePointer(p.id, { paintHint: next });
  });
  modeRow.appendChild(sel);
  box.appendChild(modeRow);

  // Tolerance slider — semantics depend on the hint kind
  const sliderRow = document.createElement('div');
  sliderRow.className = 'flex items-center gap-2 text-[11px] text-zinc-400';
  const sLabel = document.createElement('span');
  sLabel.textContent = hint.kind === 'colorFlood' ? 'Color tol' : 'Angle';
  sLabel.className = 'w-12 shrink-0';
  sliderRow.appendChild(sLabel);

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'flex-1 accent-blue-400';
  const value = document.createElement('span');
  value.className = 'w-14 text-right text-zinc-300 tabular-nums';

  if (hint.kind === 'connected') {
    slider.min = '1'; slider.max = '90'; slider.step = '1';
    slider.value = String(hint.maxDeviationDeg);
    value.textContent = `${hint.maxDeviationDeg}°`;
  } else if (hint.kind === 'coplanar') {
    slider.min = '0.1'; slider.max = '20'; slider.step = '0.1';
    slider.value = String(hint.normalToleranceDeg);
    value.textContent = `${hint.normalToleranceDeg.toFixed(1)}°`;
  } else {
    slider.min = '0'; slider.max = '0.5'; slider.step = '0.01';
    slider.value = String(hint.colorTolerance);
    value.textContent = hint.colorTolerance.toFixed(2);
  }

  // Live preview while dragging. Debounced via rAF so we don't reflood for
  // every pixel of slider travel.
  let pendingFrame = 0;
  const onInput = () => {
    const v = parseFloat(slider.value);
    let next: PointerPaintHint;
    if (hint.kind === 'connected') { next = { kind: 'connected', maxDeviationDeg: v }; value.textContent = `${Math.round(v)}°`; }
    else if (hint.kind === 'coplanar') { next = { kind: 'coplanar', normalToleranceDeg: v }; value.textContent = `${v.toFixed(1)}°`; }
    else { next = { kind: 'colorFlood', colorTolerance: v }; value.textContent = v.toFixed(2); }
    if (pendingFrame) cancelAnimationFrame(pendingFrame);
    pendingFrame = requestAnimationFrame(() => {
      pendingFrame = 0;
      updatePointer(p.id, { paintHint: next });
      setPointerPreview(p.id, next);
    });
  };
  slider.addEventListener('input', onInput);
  slider.addEventListener('change', () => {
    // Final commit also clears the preview after a brief delay so the user
    // sees the result of their final value before the overlay drops.
    setTimeout(() => {
      if (getActivePreview()?.pointerId === p.id) clearPointerPreview();
    }, 600);
  });
  sliderRow.appendChild(slider);
  sliderRow.appendChild(value);
  box.appendChild(sliderRow);
  return box;
}

function statusColor(p: PointerAnnotation): string {
  if (p.orphaned) return '#999999';
  if (p.stale) return '#ffb020';
  if (p.status === 'painted') return '#6b7280';
  if (p.status === 'approved') return '#10b981';
  return '#60a5fa';
}
