// "Split into printable pieces" — the UI twin of partwright.splitIntoPieces.
// Lists the current object's parts with a seam mode each, a clearance, and
// Preview / Save / Undo split. Every button calls the same window.partwright
// method an agent uses (UI ↔ API parity). Opened from the command palette and
// the viewport Tools menu.

import { createModalShell } from './modalShell';
import { registerCommands } from './commandPalette';
import { showToast } from './toast';
import { BUTTON_PRIMARY, BUTTON_SECONDARY, BUTTON_CANCEL } from './styleConstants';

interface SplitApi {
  splitIntoPieces(opts?: Record<string, unknown>): Promise<Record<string, unknown>>;
  listObjectParts(): Record<string, unknown>;
}

const SEAM_MODES: Array<{ value: string; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'flat', label: 'Flat' },
  { value: 'medial', label: 'Follow contact' },
  { value: 'plug', label: 'Plug (insert)' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

/** Open the split modal for the current object. */
export function openSplitPiecesModal(api: SplitApi): void {
  const info = api.listObjectParts() as { parts?: Array<{ name: string; triangleCount: number }>; error?: string };
  const parts = (info.parts ?? []).filter(p => p.triangleCount > 0);
  const shell = createModalShell({ title: 'Split into printable pieces', maxWidth: 'lg', scrollable: true });
  shell.body.classList.add('gap-3', 'text-sm', 'text-zinc-300');

  if (info.error || parts.length < 2) {
    shell.body.appendChild(el('p', 'text-zinc-400',
      info.error ?? 'This needs at least two parts. For an imported mesh, detect and accept its parts first (Detect parts…), then split along them.'));
    const close = el('button', BUTTON_CANCEL, 'Close');
    close.addEventListener('click', () => shell.close());
    shell.footer.appendChild(close);
    return;
  }

  shell.body.appendChild(el('p', 'text-xs text-zinc-400 leading-snug',
    'Each part becomes its own solid, cut along its boundary. Flat suits necks and legs, Follow contact suits an arm fused along the body, and Plug makes a straight-walled insert for eyes or buttons. The largest part keeps whatever is left.'));

  const largest = parts.reduce((a, b) => (b.triangleCount > a.triangleCount ? b : a)).name;
  const table = el('div', 'flex flex-col gap-1');
  const selects = new Map<string, HTMLSelectElement>();
  for (const p of parts) {
    const row = el('label', 'flex items-center gap-2');
    row.appendChild(el('span', 'flex-1 min-w-0 truncate', p.name));
    if (p.name === largest) {
      row.appendChild(el('span', 'text-xs text-zinc-500 italic', 'keeps the rest'));
    } else {
      const sel = el('select', 'bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs min-h-[44px] md:min-h-0');
      sel.dataset.splitSeam = p.name;
      for (const m of SEAM_MODES) {
        const o = el('option', '', m.label);
        o.value = m.value;
        sel.appendChild(o);
      }
      selects.set(p.name, sel);
      row.appendChild(sel);
    }
    table.appendChild(row);
  }
  shell.body.appendChild(table);

  const clearRow = el('label', 'flex items-center gap-2 text-xs');
  clearRow.appendChild(el('span', 'flex-1', 'Clearance (gap between mating faces; 0 = glue fit)'));
  const clearance = el('input', 'w-20 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs min-h-[44px] md:min-h-0');
  clearance.type = 'number';
  clearance.min = '0';
  clearance.step = '0.05';
  clearance.value = '0';
  clearance.id = 'split-clearance';
  clearRow.appendChild(clearance);
  shell.body.appendChild(clearRow);

  const status = el('div', 'text-xs text-zinc-400 leading-snug whitespace-pre-line');
  status.id = 'split-status';
  shell.body.appendChild(status);

  const opts = (): Record<string, unknown> => {
    const seams: Record<string, string> = {};
    for (const [name, sel] of selects) if (sel.value !== 'auto') seams[name] = sel.value;
    const c = Number(clearance.value);
    return { keep: largest, ...(Object.keys(seams).length ? { seams } : {}), ...(c > 0 ? { clearance: c } : {}) };
  };
  const buttons: HTMLButtonElement[] = [];
  const run = async (extra: Record<string, unknown>, busy: string) => {
    buttons.forEach(b => { b.disabled = true; });
    status.textContent = busy;
    try {
      const r = await api.splitIntoPieces({ ...opts(), ...extra, render: false });
      if ('error' in r) {
        status.textContent = String(r.error);
        showToast(String(r.error), { variant: 'warn', source: 'parts' });
        return;
      }
      if (r.removed) { status.textContent = 'Split removed.'; return; }
      const pieces = (r.pieces as Array<{ name: string; mode: string }> | undefined) ?? [];
      const warnings = (r.warnings as string[] | undefined) ?? [];
      const saving = extra.preview === false;
      const saveProblem = saving && !r.saved
        ? String(r.saveWarning ?? r.saveSkipped ?? 'the version was not saved')
        : null;
      status.textContent = [
        `${pieces.length} pieces: ${pieces.map(p => `${p.name} (${p.mode})`).join(', ')}`,
        ...warnings.map(w => `⚠ ${w}`),
        saving
          ? (saveProblem ? `⚠ Cut, but not saved: ${saveProblem}` : 'Saved. Export → 3MF with Split: Parts gives one object per piece.')
          : 'Preview: the pieces are pulled apart and nothing was saved.',
      ].join('\n');
      if (saveProblem) showToast(`Split ran but was not saved: ${saveProblem}`, { variant: 'warn', source: 'parts' });
      else if (saving) showToast('Split into pieces and saved', { variant: 'success', source: 'parts' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      status.textContent = `Split failed: ${msg}`;
      showToast(`Split failed: ${msg}`, { variant: 'warn', source: 'parts' });
    } finally {
      buttons.forEach(b => { b.disabled = false; });
    }
  };
  const mk = (cls: string, text: string, onClick: () => void, id: string) => {
    const b = el('button', cls, text);
    b.id = id;
    b.addEventListener('click', onClick);
    buttons.push(b);
    return b;
  };
  shell.footer.append(
    mk(BUTTON_CANCEL, 'Undo split', () => { void run({ remove: true }, 'Removing the split…'); }, 'split-remove'),
    mk(BUTTON_SECONDARY, 'Preview', () => { void run({ preview: true }, 'Cutting (preview)…'); }, 'split-preview'),
    mk(BUTTON_PRIMARY, 'Split & save', () => { void run({ preview: false }, 'Cutting and saving…'); }, 'split-save'),
  );
}

/** Register the palette command and the Tools-menu button. */
export function initSplitPiecesUI(api: SplitApi): void {
  registerCommands([
    {
      id: 'split-into-pieces',
      title: 'Split into printable pieces…',
      hint: 'Tools',
      keywords: 'split cut pieces print parts separate insert plug socket seam figure',
      run: () => openSplitPiecesModal(api),
    },
  ]);
  const mount = () => {
    if (document.getElementById('split-pieces-viewport-toggle')) return true;
    const styleRef = document.getElementById('convert-code-viewport-toggle') ?? document.getElementById('resize-viewport-toggle');
    const host = document.getElementById('viewport-tools-menu') ?? styleRef?.parentElement;
    if (!host || !styleRef) return false;
    const btn = el('button', styleRef.className.split(' ').filter(c => c !== 'hidden').join(' '));
    btn.id = 'split-pieces-viewport-toggle';
    btn.textContent = '✂ Split';
    btn.title = 'Split the model into separate printable pieces along its parts';
    btn.addEventListener('click', () => openSplitPiecesModal(api));
    host.appendChild(btn);
    return true;
  };
  let tries = 0;
  const timer = setInterval(() => { if (mount() || ++tries > 20) clearInterval(timer); }, 250);
}
