// Part Detection panel (#1025) — split an imported mesh into named parts.
//
// A docked, non-modal tool panel (the user clicks the model to place seeds
// while it is open). Every control calls the same controller the
// window.partwright / AI methods use, so the two surfaces can't drift. The
// detector dropdown and its parameter controls are generated from the
// registry's ParamSpecs: registering a detector adds it here automatically.

import { pickFace } from '../color/facePicker';
import { getConfig } from '../config/appConfig';
import { addPointerSuppressor } from '../renderer/viewport';
import type { PartDetectionApi } from '../segmentation/partDetection';
import type { ParamSpec } from '../segmentation/types';
import { createColorSwatch } from './colorPickerModal';
import { registerCommands } from './commandPalette';
import { BUTTON_CANCEL, BUTTON_PRIMARY, BUTTON_SMALL_SECONDARY } from './styleConstants';
import { showToast } from './toast';
import { createToolPanelShell } from './toolPanel';

let closeOpen: (() => void) | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const INPUT = 'bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[12px] text-zinc-200';
const SECTION = 'text-[11px] uppercase tracking-wide text-zinc-400 font-semibold mt-1';

type Draft = Exclude<ReturnType<PartDetectionApi['getPartDraft']>, { draft: null }>;

function isDraft(x: unknown): x is Draft {
  return !!x && typeof x === 'object' && Array.isArray((x as Draft).parts);
}

export function openPartDetectionPanel(ctl: PartDetectionApi): void {
  if (closeOpen) return;
  const info = ctl.listPartDetectors();
  const seeds: { label: string; point: [number, number, number] }[] = [];
  let stopPick: (() => void) | null = null;

  const shell = createToolPanelShell({
    title: 'Detect parts',
    width: 'w-[22rem]',
    onClose: () => {
      stopPick?.();
      unsubscribe();
      closeOpen = null;
    },
  });
  closeOpen = shell.close;
  const { body, footer } = shell;

  const intro = el('div', 'text-[12px] text-zinc-400 leading-snug',
    'Split an imported mesh into named parts (hair, face, shirt…) so paint can follow them. Nothing is saved until you Accept.');
  body.appendChild(intro);

  // --- Detector + params ----------------------------------------------------
  body.appendChild(el('div', SECTION, 'Method'));
  const algoSelect = el('select', `${INPUT} w-full`);
  algoSelect.setAttribute('aria-label', 'Detection method');
  for (const d of info.detectors) {
    const o = el('option', '', d.name);
    o.value = d.id;
    algoSelect.appendChild(o);
  }
  algoSelect.value = info.detectors.find((d) => d.id === 'crease-watershed') ? 'crease-watershed' : info.detectors[0].id;
  const algoHint = el('div', 'text-[11px] text-zinc-500 leading-snug');
  const paramBox = el('div', 'flex flex-col gap-1.5');
  body.append(algoSelect, algoHint, paramBox);

  const paramInputs = new Map<string, () => unknown>();
  const smoothInput = el('input', `${INPUT} w-20`);
  smoothInput.type = 'number';
  smoothInput.min = '0';
  smoothInput.step = 'any';
  smoothInput.placeholder = 'none';

  function paramRow(label: string, hint: string, control: HTMLElement): HTMLElement {
    const row = el('label', 'flex items-center justify-between gap-2');
    row.title = hint;
    row.append(el('span', 'text-[12px] text-zinc-300', label), control);
    return row;
  }

  function buildParams(): void {
    const d = info.detectors.find((x) => x.id === algoSelect.value)!;
    algoHint.textContent = `${d.description} Best for: ${d.bestFor}`;
    paramBox.replaceChildren();
    paramInputs.clear();
    d.params.forEach((p: ParamSpec) => {
      let control: HTMLElement;
      if (p.type === 'enum') {
        const s = el('select', INPUT);
        for (const opt of p.options ?? []) { const o = el('option', '', opt); o.value = opt; s.appendChild(o); }
        s.value = String(p.default);
        control = s;
        paramInputs.set(p.key, () => s.value);
      } else if (p.type === 'boolean') {
        const c = el('input');
        c.type = 'checkbox';
        c.checked = Boolean(p.default);
        control = c;
        paramInputs.set(p.key, () => c.checked);
      } else {
        const n = el('input', `${INPUT} w-20`);
        n.type = 'number';
        n.value = String(p.default);
        if (p.min !== undefined) n.min = String(p.min);
        if (p.max !== undefined) n.max = String(p.max);
        n.step = p.step !== undefined ? String(p.step) : p.type === 'integer' ? '1' : 'any';
        control = n;
        paramInputs.set(p.key, () => Number(n.value));
      }
      paramBox.appendChild(paramRow(p.label, p.hint, control));
    });
    paramBox.appendChild(paramRow('Surface smoothing', 'World-unit radius used to denoise normals before measuring grooves. Blank = none (default); try ~3× the edge length on very noisy scans.', smoothInput));
    seedSection.classList.toggle('hidden', d.seeds === 'none');
  }

  // --- Seeds ----------------------------------------------------------------
  const seedSection = el('div', 'flex flex-col gap-1.5');
  seedSection.appendChild(el('div', SECTION, 'Seeds'));
  seedSection.appendChild(el('div', 'text-[11px] text-zinc-500 leading-snug',
    'Type a part name, then click the model to drop seeds for it. Add a seed or two per part; boundaries settle on the grooves between them.'));
  const seedRow = el('div', 'flex items-center gap-1.5');
  const labelInput = el('input', `${INPUT} flex-1 min-w-0`);
  labelInput.placeholder = 'part name, e.g. hair';
  labelInput.setAttribute('aria-label', 'Seed part name');
  labelInput.value = 'hair';
  const pickBtn = el('button', BUTTON_SMALL_SECONDARY, 'Place seeds');
  seedRow.append(labelInput, pickBtn);
  const seedList = el('div', 'flex flex-col gap-0.5 max-h-28 overflow-y-auto');
  const clearSeedsBtn = el('button', `${BUTTON_SMALL_SECONDARY} self-start`, 'Clear seeds');
  seedSection.append(seedRow, seedList, clearSeedsBtn);
  body.appendChild(seedSection);

  function renderSeeds(): void {
    seedList.replaceChildren();
    seeds.forEach((s, i) => {
      const row = el('div', 'flex items-center gap-1 text-[11px] text-zinc-300');
      row.append(el('span', 'flex-1 truncate', `${s.label} · (${s.point.map((v) => v.toFixed(1)).join(', ')})`));
      const x = el('button', 'text-zinc-500 hover:text-zinc-200 px-1', '✕');
      x.title = 'Remove seed';
      x.addEventListener('click', () => { seeds.splice(i, 1); renderSeeds(); });
      row.appendChild(x);
      seedList.appendChild(row);
    });
  }

  function endPick(): void {
    stopPick?.();
    stopPick = null;
    document.body.style.cursor = '';
    pickBtn.textContent = 'Place seeds';
  }

  pickBtn.addEventListener('click', () => {
    if (stopPick) { endPick(); return; }
    document.body.style.cursor = 'crosshair';
    pickBtn.textContent = 'Done placing';
    const unhook = addPointerSuppressor((evt: PointerEvent) => {
      if (evt.type !== 'pointerdown') return false;
      const hit = pickFace(evt as MouseEvent);
      if (!hit) return true;
      const label = labelInput.value.trim();
      if (!label) { showToast('Type a part name first', { variant: 'warn', source: 'parts' }); return true; }
      seeds.push({ label, point: hit.point });
      renderSeeds();
      return true;
    });
    stopPick = unhook;
  });
  clearSeedsBtn.addEventListener('click', () => { seeds.length = 0; renderSeeds(); });

  // --- Detect / status --------------------------------------------------------
  const actionRow = el('div', 'flex items-center gap-2');
  const detectBtn = el('button', BUTTON_PRIMARY, 'Detect');
  const cancelBtn = el('button', `${BUTTON_CANCEL} hidden`, 'Cancel');
  const status = el('div', 'text-[11px] text-zinc-400 flex-1 truncate');
  status.setAttribute('aria-live', 'polite');
  actionRow.append(detectBtn, cancelBtn, status);
  body.appendChild(actionRow);

  detectBtn.addEventListener('click', async () => {
    const params: Record<string, unknown> = {};
    for (const [k, get] of paramInputs) params[k] = get();
    const opts: Record<string, unknown> = { algorithm: algoSelect.value, params };
    if (smoothInput.value.trim() !== '') opts.featureOptions = { normalSmoothRadius: Number(smoothInput.value) };
    const d = info.detectors.find((x) => x.id === algoSelect.value)!;
    if (d.seeds !== 'none') opts.seeds = seeds.map((s) => ({ label: s.label, point: s.point }));
    endPick();
    const r = await ctl.detectParts(opts);
    if ('error' in r) showToast(String(r.error), { variant: 'warn', source: 'parts' });
  });
  cancelBtn.addEventListener('click', () => ctl.cancel());

  // --- Draft: parts list + clean-up -------------------------------------------
  const draftBox = el('div', 'flex flex-col gap-1.5');
  body.appendChild(draftBox);

  async function edit(ops: Record<string, unknown>[]): Promise<void> {
    const r = await ctl.editParts({ ops });
    if ('error' in r) showToast(String(r.error), { variant: 'warn', source: 'parts' });
  }

  function renderDraft(): void {
    const d = ctl.getPartDraft();
    draftBox.replaceChildren();
    acceptBtn.disabled = !isDraft(d);
    discardBtn.disabled = !isDraft(d);
    if (!isDraft(d)) return;
    const q = d.quality;
    draftBox.appendChild(el('div', SECTION, `Parts (${d.parts.length})`));
    draftBox.appendChild(el('div', 'text-[11px] text-zinc-500',
      `Boundary groove ${q.boundaryCreaseMean.toFixed(1)}° · islands ${q.islandCount} · unassigned ${(d.unassigned.areaFrac * 100).toFixed(1)}%`));
    const list = el('div', 'flex flex-col gap-1 max-h-56 overflow-y-auto pr-1');
    const selected = new Set<number>();
    for (const p of d.parts) {
      const row = el('div', 'flex items-center gap-1.5');
      const check = el('input');
      check.type = 'checkbox';
      check.title = 'Select for merge';
      check.addEventListener('change', () => { if (check.checked) selected.add(p.id); else selected.delete(p.id); });
      const sw = createColorSwatch({
        initialHex: p.displayColor,
        title: `Colour for ${p.name}`,
        className: 'w-5 h-5 rounded border border-zinc-600 shrink-0',
        onPick: (hex) => { void edit([{ op: 'setColor', id: p.id, color: hex }]); },
      });
      const num = el('span', 'text-[11px] text-zinc-500 w-5 text-right shrink-0', String(p.id));
      const name = el('input', `${INPUT} flex-1 min-w-0`);
      name.value = p.name;
      name.setAttribute('aria-label', `Name of part ${p.id}`);
      name.addEventListener('change', () => {
        const v = name.value.trim();
        if (v && v !== p.name) void edit([{ op: 'rename', id: p.id, name: v }]);
      });
      const pct = el('span', 'text-[10px] text-zinc-500 w-10 text-right shrink-0', `${(p.areaFrac * 100).toFixed(1)}%`);
      pct.title = `${p.triCount} triangles${p.regions > 1 ? `, ${p.regions} separate regions` : ''}`;
      const del = el('button', 'text-zinc-500 hover:text-zinc-200 px-1 shrink-0', '✕');
      del.title = 'Remove part (its triangles become unassigned)';
      del.addEventListener('click', () => { void edit([{ op: 'delete', id: p.id }]); });
      row.append(check, sw.el, num, name, pct, del);
      list.appendChild(row);
    }
    draftBox.appendChild(list);

    const tools = el('div', 'flex flex-wrap gap-1.5');
    const mergeBtn = el('button', BUTTON_SMALL_SECONDARY, 'Merge selected');
    mergeBtn.addEventListener('click', () => {
      if (selected.size < 2) { showToast('Tick two or more parts to merge', { variant: 'neutral', source: 'parts' }); return; }
      void edit([{ op: 'merge', ids: [...selected] }]);
    });
    const absorbBtn = el('button', BUTTON_SMALL_SECONDARY, 'Absorb specks');
    const minFrac = getConfig().segmentation.absorbMinAreaFrac;
    absorbBtn.title = `Fold islands smaller than ${+(minFrac * 100).toFixed(2)}% of the surface into their neighbours`;
    absorbBtn.addEventListener('click', () => { void edit([{ op: 'absorbSmall', minAreaFrac: getConfig().segmentation.absorbMinAreaFrac }]); });
    const smoothBtn = el('button', BUTTON_SMALL_SECONDARY, 'Smooth edges');
    smoothBtn.title = 'Shave single-triangle stair-steps off part boundaries';
    smoothBtn.addEventListener('click', () => { void edit([{ op: 'smoothBoundaries', iterations: getConfig().segmentation.smoothBoundaryIterations }]); });
    const undoBtn = el('button', BUTTON_SMALL_SECONDARY, 'Undo');
    undoBtn.disabled = !d.canUndo;
    undoBtn.addEventListener('click', () => { void edit([{ op: 'undo' }]); });
    tools.append(mergeBtn, absorbBtn, smoothBtn, undoBtn);
    draftBox.appendChild(tools);

    const overlayRow = el('label', 'flex items-center gap-1.5 text-[12px] text-zinc-300');
    const overlay = el('input');
    overlay.type = 'checkbox';
    overlay.checked = true;
    overlay.addEventListener('change', () => ctl.setPartsOverlay(overlay.checked));
    overlayRow.append(overlay, el('span', '', 'Show parts overlay'));
    draftBox.appendChild(overlayRow);
  }

  // --- Footer ------------------------------------------------------------------
  const discardBtn = el('button', BUTTON_CANCEL, 'Discard');
  const acceptBtn = el('button', BUTTON_PRIMARY, 'Accept parts');
  acceptBtn.title = 'Save the parts on the import as labels (paint by part, colours become model colours)';
  discardBtn.addEventListener('click', () => { void ctl.discardParts(); });
  acceptBtn.addEventListener('click', async () => {
    acceptBtn.disabled = true;
    const r = await ctl.acceptParts();
    if ('error' in r) {
      showToast(String(r.error), { variant: 'warn', source: 'parts' });
      acceptBtn.disabled = false;
      return;
    }
    showToast(`Saved ${(r as { parts: unknown[] }).parts.length} parts as labels`, { variant: 'success', source: 'parts' });
    if ('note' in r && typeof r.note === 'string') showToast(r.note, { variant: 'neutral', source: 'parts' });
  });
  footer.append(discardBtn, acceptBtn);

  const unsubscribe = ctl.subscribe((ev) => {
    if (ev === 'draft') renderDraft();
    const b = ctl.isBusy();
    detectBtn.disabled = !!b;
    cancelBtn.classList.toggle('hidden', !b);
    status.textContent = b ? `${b.message} ${Math.round(b.fraction * 100)}%` : '';
  });

  algoSelect.addEventListener('change', buildParams);
  buildParams();
  renderSeeds();
  renderDraft();
}

/** Wire Part Detection into the command palette and the viewport Tools menu. */
export function initPartDetectionUI(ctl: PartDetectionApi): void {
  registerCommands([
    {
      id: 'detect-parts',
      title: 'Detect parts…',
      hint: 'Paint',
      keywords: 'detect parts segment segmentation split regions imported stl figure hair face label colorize auto paint',
      run: () => openPartDetectionPanel(ctl),
    },
  ]);

  const mount = () => {
    if (document.getElementById('parts-viewport-toggle')) return;
    const styleRef = document.getElementById('paint-toggle');
    const host = document.getElementById('viewport-tools-menu') ?? styleRef?.parentElement;
    if (!host) return;
    const btnCls = (styleRef?.className ?? '').split(' ').filter((c) => c !== 'hidden').join(' ') || BUTTON_SMALL_SECONDARY;
    const btn = el('button', btnCls, '🧩 Parts');
    btn.id = 'parts-viewport-toggle';
    btn.title = 'Detect the parts of an imported mesh (hair, face, shirt…)';
    btn.addEventListener('click', () => openPartDetectionPanel(ctl));
    host.appendChild(btn);
  };
  let tries = 0;
  const timer = setInterval(() => {
    mount();
    if (document.getElementById('parts-viewport-toggle') || ++tries > 20) clearInterval(timer);
  }, 250);
  mount();
}
