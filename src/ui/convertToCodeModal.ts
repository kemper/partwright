// Convert-to-code panel — the GUI for the deterministic mesh→code
// reconstruction (`partwright.convertToCode`). A right-aligned, draggable
// viewport panel (same chrome as the Resize tool) with a quality preset and
// the resolution thresholds the API accepts: section step, levelSet edge
// length, and contour tolerance, each placeholdered with the value the
// preset would auto-derive for the current model. Convert closes the panel
// and hands off to the API, whose inline "Rendering… Xs" + Cancel and
// metrics toast carry the rest of the feedback.

import { registerCommands } from './commandPalette';
import { getConfig } from '../config/appConfig';
import { openViewportPanel, closeViewportPanel } from './viewportPanelRegistry';
import { setInitialPanelPosition, attachViewportPanelDrag } from './viewportPanelDrag';
import { TOOL_PANEL_CLASS, TOOL_PANEL_HEADER, TOOL_PANEL_TITLE, TOOL_PANEL_CLOSE } from './toolPanel';
import { deriveOptions } from '../reconstruct/sectionCode';

type Quality = 'draft' | 'standard' | 'fine';

type ConvertResult = { error?: string } | Record<string, unknown>;

type BBox = { x?: number[]; y?: number[]; z?: number[]; min?: number[]; max?: number[] } | null;

export interface ConvertToCodeApi {
  convertToCode(opts?: {
    quality?: Quality;
    step?: number;
    edge?: number;
    dpTol?: number;
    samples?: number;
  }): Promise<ConvertResult>;
  getGeometryData(): { boundingBox?: BBox } | Record<string, unknown>;
  getActiveLanguage(): string;
}

/** Measured per-cell cost of the levelSet build (JS-callback dominated). */
const SECONDS_PER_CELL = 3.9e-6;
const QUALITY_FACTOR: Record<Quality, number> = { draft: 0.25, standard: 1, fine: 4 };

let openPanel: HTMLDivElement | null = null;
let currentClose: (() => void) | null = null;

const registryEntry = { close(): void { currentClose?.(); } };

function onEscape(e: KeyboardEvent): void {
  if (e.key !== 'Escape') return;
  if (document.querySelector('[role="dialog"]')) return;
  currentClose?.();
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
}

function getBbox(api: ConvertToCodeApi): { min: [number, number, number]; max: [number, number, number] } | null {
  try {
    const gd = api.getGeometryData() as { boundingBox?: BBox };
    const bb = gd?.boundingBox;
    if (!bb) return null;
    if (bb.x && bb.y && bb.z) {
      return { min: [bb.x[0], bb.y[0], bb.z[0]], max: [bb.x[1], bb.y[1], bb.z[1]] };
    }
    if (bb.min && bb.max) {
      return { min: [bb.min[0], bb.min[1], bb.min[2]], max: [bb.max[0], bb.max[1], bb.max[2]] };
    }
  } catch { /* fall through */ }
  return null;
}

function getViewportContainer(): HTMLElement {
  return (document.getElementById('clip-controls')?.offsetParent as HTMLElement | null) ?? document.body;
}

function fmtSeconds(s: number): string {
  if (s < 90) return `~${Math.max(1, Math.round(s))} s`;
  return `~${(s / 60).toFixed(1)} min`;
}

function fmtNum(v: number): string {
  return String(Number(v.toPrecision(3)));
}

export interface ConvertToCodeModalOpts {
  /** Context line shown above the description (e.g. the just-imported file). */
  context?: string;
  /** Cancel-button label override ("Keep mesh only" on the import ask). */
  cancelLabel?: string;
}

export function openConvertToCodeModal(api: ConvertToCodeApi, modalOpts?: ConvertToCodeModalOpts): void {
  if (openPanel) { openPanel.remove(); openPanel = null; currentClose = null; }

  const bbox = getBbox(api);
  const container = getViewportContainer();

  let quality: Quality = 'standard';

  const panel = el('div', `${TOOL_PANEL_CLASS} text-zinc-100 w-[min(94vw,360px)] max-h-[calc(100%-3.5rem)] select-none`);

  const header = el('div', TOOL_PANEL_HEADER);
  header.append(el('h2', TOOL_PANEL_TITLE, 'Convert model to code'));
  const closeBtn = el('button', TOOL_PANEL_CLOSE, '×');
  closeBtn.setAttribute('aria-label', 'Close convert-to-code panel');
  header.append(closeBtn);
  panel.append(header);
  attachViewportPanelDrag(header, panel);

  const body = el('div', 'p-4 overflow-y-auto flex-1');
  panel.append(body);

  if (modalOpts?.context) {
    body.append(el('p', 'text-xs text-zinc-200 mb-2', modalOpts.context));
  }
  body.append(
    el(
      'p',
      'text-xs text-zinc-400 mb-3',
      'Rebuilds the model as smooth, editable code measured from its own cross-sections — no dependency on the import. Saves a new version and reports how faithful the remake is.',
    ),
  );

  // ---- Quality preset ----
  const qualityRow = el('div', 'mb-3');
  qualityRow.append(el('div', 'text-xs text-zinc-400 mb-1', 'Quality'));
  const tabs = el('div', 'flex gap-1');
  const ACTIVE_TAB = 'flex-1 px-2 py-1.5 rounded text-xs bg-blue-600 text-white';
  const IDLE_TAB = 'flex-1 px-2 py-1.5 rounded text-xs bg-zinc-800 text-zinc-300 hover:bg-zinc-700';
  const tabBtns = new Map<Quality, HTMLButtonElement>();
  for (const q of ['draft', 'standard', 'fine'] as Quality[]) {
    const b = el('button', IDLE_TAB, q[0].toUpperCase() + q.slice(1));
    b.addEventListener('click', () => { quality = q; sync(); });
    tabBtns.set(q, b);
    tabs.append(b);
  }
  qualityRow.append(tabs);
  const estimate = el('div', 'text-[11px] text-zinc-500 mt-1.5');
  qualityRow.append(estimate);
  body.append(qualityRow);

  // ---- Advanced thresholds ----
  const adv = el('details', 'mb-3');
  adv.append(el('summary', 'text-xs text-zinc-400 cursor-pointer select-none', 'Advanced thresholds'));
  const advBody = el('div', 'mt-2 space-y-2');
  adv.append(advBody);
  body.append(adv);

  const fields: Array<{ key: 'step' | 'edge' | 'dpTol' | 'samples'; input: HTMLInputElement }> = [];
  const addField = (key: 'step' | 'edge' | 'dpTol' | 'samples', label: string, hint: string) => {
    const row = el('div');
    const lab = el('label', 'block text-[11px] text-zinc-400');
    lab.textContent = label;
    const input = el('input', 'mt-0.5 w-full px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-xs text-zinc-100');
    input.type = 'number';
    input.min = '0';
    input.step = 'any';
    input.dataset.convertField = key;
    row.append(lab, input, el('div', 'text-[10px] text-zinc-600', hint));
    advBody.append(row);
    fields.push({ key, input });
  };
  addField('step', 'Section step (world units)', 'Z-slice pitch — smaller = more measured sections.');
  addField('edge', 'Surface resolution (edge length)', 'levelSet grid edge — smaller = smoother + slower. Dominates build time.');
  addField('dpTol', 'Contour tolerance', 'Simplification of each section outline — smaller keeps more silhouette detail.');
  addField('samples', 'Faithfulness-report samples', 'Surface samples per mesh for the chamfer/hausdorff report.');

  const note = el('div', 'text-[11px] text-zinc-500');
  body.append(note);

  // ---- Actions — pinned footer, outside the scrollable body so the buttons
  // stay reachable when the Advanced section overflows a short viewport ----
  const actions = el('div', 'flex items-center gap-2 p-4 pt-2 border-t border-zinc-700/60');
  const convertBtn = el(
    'button',
    'px-4 py-1.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
    'Convert',
  );
  const cancelBtn = el('button', 'px-4 py-1.5 rounded-lg text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700 transition-colors', modalOpts?.cancelLabel ?? 'Cancel');
  actions.append(convertBtn, cancelBtn);
  panel.append(actions);

  const manifoldSession = api.getActiveLanguage() === 'manifold-js';
  if (!manifoldSession) {
    convertBtn.disabled = true;
    note.textContent = 'Convert to code works in manifold-js (JS) sessions — the generated code is manifold-js.';
  }

  function readOverride(key: 'step' | 'edge' | 'dpTol' | 'samples'): number | undefined {
    const f = fields.find((x) => x.key === key);
    const v = f?.input.value.trim();
    if (!v) return undefined;
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }

  /** Refresh preset highlight, derived placeholders, and the time estimate. */
  function sync(): void {
    for (const [q, b] of tabBtns) b.className = q === quality ? ACTIVE_TAB : IDLE_TAB;
    const cfg = getConfig().import;
    const budget = Math.round(cfg.reconstructCellBudget * QUALITY_FACTOR[quality]);
    const samplesField = fields.find((f) => f.key === 'samples');
    if (samplesField) samplesField.input.placeholder = String(cfg.reconstructEvalSamples);
    let cells = budget;
    if (bbox) {
      const derived = deriveOptions(bbox, budget, {
        step: readOverride('step'),
        edge: readOverride('edge'),
        dpTol: readOverride('dpTol'),
      });
      for (const f of fields) {
        if (f.key === 'samples') continue;
        f.input.placeholder = fmtNum(derived[f.key]);
      }
      const dx = bbox.max[0] - bbox.min[0], dy = bbox.max[1] - bbox.min[1], dz = bbox.max[2] - bbox.min[2];
      cells = Math.round((dx * dy * dz) / derived.edge ** 3);
    }
    estimate.textContent = `≈ ${(cells / 1e6).toFixed(1)}M levelSet samples — build ${fmtSeconds(cells * SECONDS_PER_CELL)}`;
  }
  for (const f of fields) f.input.addEventListener('input', sync);
  sync();

  convertBtn.addEventListener('click', () => {
    const opts = {
      quality,
      step: readOverride('step'),
      edge: readOverride('edge'),
      dpTol: readOverride('dpTol'),
      samples: readOverride('samples'),
    };
    close();
    // The API owns all further feedback: inline "Rendering… Xs" + Cancel while
    // it works, a metrics toast (or error toast via the returned {error}) after.
    void api.convertToCode(opts);
  });

  function close(): void {
    panel.remove();
    document.removeEventListener('keydown', onEscape);
    if (openPanel === panel) { openPanel = null; currentClose = null; }
    closeViewportPanel(registryEntry);
  }
  currentClose = close;
  closeBtn.addEventListener('click', close);
  cancelBtn.addEventListener('click', close);
  document.addEventListener('keydown', onEscape);

  container.appendChild(panel);
  setInitialPanelPosition(panel);
  panel.style.maxHeight = `calc(100vh - ${Math.max(0, panel.getBoundingClientRect().top)}px - 12px)`;
  openViewportPanel(registryEntry);
  openPanel = panel;
}

const BTN_BASE =
  'px-2 py-1 rounded text-xs bg-zinc-800/80 backdrop-blur border border-zinc-700 text-zinc-200 hover:bg-zinc-700';

/** Register the palette command and mount the Tools-popover pill. */
export function initConvertToCodeUI(api: ConvertToCodeApi): void {
  registerCommands([
    {
      id: 'convert-to-code',
      title: 'Convert model to code (reconstruct)',
      hint: 'Tools',
      keywords: 'reconstruct reverse engineer mesh stl import smooth remake parametric convert code',
      run: () => openConvertToCodeModal(api),
    },
  ]);

  const mount = () => {
    if (document.getElementById('convert-code-viewport-toggle')) return;
    // Land inside the Tools popover next to Resize, matching its pill styling.
    const styleRef = document.getElementById('resize-viewport-toggle')
      ?? document.getElementById('surface-viewport-toggle')
      ?? document.getElementById('paint-toggle');
    const host = document.getElementById('viewport-tools-menu') ?? styleRef?.parentElement;
    if (!host) return;
    const btnCls = (styleRef?.className ?? '').split(' ').filter(c => c !== 'hidden').join(' ') || BTN_BASE;
    const btn = el('button', btnCls);
    btn.id = 'convert-code-viewport-toggle';
    btn.textContent = '⟲ To code';
    btn.title = 'Rebuild the model (e.g. an STL import) as smooth, editable code';
    btn.addEventListener('click', () => openConvertToCodeModal(api));
    host.appendChild(btn);
  };
  let tries = 0;
  const timer = setInterval(() => {
    mount();
    if (document.getElementById('convert-code-viewport-toggle') || ++tries > 20) clearInterval(timer);
  }, 250);
  mount();
}
