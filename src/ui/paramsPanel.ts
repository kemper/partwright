// The Customizer panel — a viewport overlay that renders the parameter schema a
// model declares via `api.params({...})` as live widgets (sliders, toggles,
// dropdowns, color/text inputs). Editing a widget calls back into main.ts,
// which re-runs the model with the new override and persists it on the version.
//
// Self-contained and DOM-only: it receives a normalized, serializable schema
// (see src/geometry/params.ts) plus the current resolved values, and never
// touches the engine or storage directly.

import type { ParamSpec, ParamValue, ParamValues } from '../geometry/params';
import { openViewportPanel, closeViewportPanel } from './viewportPanelRegistry';
import { attachViewportPanelDrag, setInitialPanelPosition } from './viewportPanelDrag';

export interface ParamsPanelOptions {
  /** Fired when a single widget changes — main.ts updates the override, re-runs,
   *  and persists. */
  onChange: (key: string, value: ParamValue) => void;
  /** Fired when "Reset" is clicked — main.ts clears all overrides and re-runs. */
  onReset: () => void;
  /** Fired whenever the panel's visibility changes — when the active model
   *  declares (or drops) parameters, and when the user opens/closes the panel.
   *  Lets an external toggle button (the viewport "Customize" pill) mirror the
   *  panel's state and show a parameter count. */
  onVisibilityChange?: (state: { hasParams: boolean; open: boolean; count: number }) => void;
}

export interface ParamsPanelController {
  element: HTMLElement;
  /** Re-render for a new schema (or update values in place if the schema is
   *  unchanged). Pass `undefined`/empty to hide the panel. */
  update(schema: ParamSpec[] | undefined, values: ParamValues): void;
  /** Show the panel (no-op when the active model declares no parameters). */
  open(): void;
  /** Hide the panel without dropping the schema — reopen via {@link open}. */
  close(): void;
  /** Flip open ↔ closed (no-op when there are no parameters). */
  toggle(): void;
  /** Whether the panel is currently visible. */
  isOpen(): boolean;
  /** Whether the active model declares any parameters. */
  hasParams(): boolean;
}

const OVERLAY_BTN = 'px-2 py-0.5 rounded text-xs bg-zinc-800/80 backdrop-blur text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/80 transition-colors border border-zinc-600/50';

function schemaSignature(schema: ParamSpec[]): string {
  // Cheap identity for "do we need to rebuild the DOM?": rebuilding on every run
  // would steal focus mid-type. Keys + types + option lists are enough — value
  // changes flow through updateValues without a rebuild.
  return JSON.stringify(schema.map(s => [s.key, s.type, s.min, s.max, s.step, s.options?.map(o => o.value), s.maxLength]));
}

export function createParamsPanel(opts: ParamsPanelOptions): ParamsPanelController {
  const root = document.createElement('div');
  root.id = 'params-panel';
  // Bottom-left of the viewport — clear of the status pill (top-left), the
  // clip/tool bar (top-right) and the Z slider (right). pointer-events-auto so
  // widgets work; the panel itself is small so it doesn't block orbit much.
  root.className = 'hidden absolute z-10 w-60 max-w-[calc(100%-1rem)] flex flex-col rounded-lg bg-zinc-900/85 backdrop-blur border border-zinc-700 shadow-lg text-zinc-200 pointer-events-auto';

  // Header: a "Customize" title, a Reset button, and a close (×) button. Closing
  // hides the whole panel; the viewport "Customize" toggle pill reopens it (see
  // onVisibilityChange), so the close → reopen loop is always discoverable.
  // The header also doubles as a drag handle (see below) — `cursor-move` hints
  // that, and `touch-none` stops the browser claiming the gesture for scroll
  // before pointer-capture kicks in.
  const header = document.createElement('div');
  header.className = 'flex items-center gap-2 px-2.5 py-2 border-b border-zinc-700/70 select-none cursor-move touch-none';

  const title = document.createElement('span');
  title.className = 'text-xs font-medium text-zinc-300 flex-1 truncate';
  title.textContent = 'Customize';

  const resetBtn = document.createElement('button');
  resetBtn.className = OVERLAY_BTN;
  resetBtn.textContent = 'Reset';
  resetBtn.title = 'Reset all parameters to their defaults';
  resetBtn.addEventListener('click', () => opts.onReset());

  const closeBtn = document.createElement('button');
  closeBtn.className = 'text-zinc-400 hover:text-zinc-200 text-base leading-none w-5 h-5 flex items-center justify-center shrink-0 rounded hover:bg-zinc-700/60 transition-colors';
  closeBtn.textContent = '×';
  closeBtn.title = 'Close parameters (reopen with the Customize button)';
  closeBtn.setAttribute('aria-label', 'Close parameters');

  header.appendChild(title);
  header.appendChild(resetBtn);
  header.appendChild(closeBtn);
  root.appendChild(header);

  // Scrollable body holding the widgets.
  const body = document.createElement('div');
  body.className = 'flex flex-col gap-2.5 px-2.5 py-2 overflow-y-auto max-h-[min(60vh,22rem)]';
  root.appendChild(body);

  let currentSig = '';
  // Number of parameters the active model declares; 0 means none (panel + toggle
  // both hidden). `userClosed` records an explicit close so re-runs of the *same*
  // model don't re-pop the panel; a schema change clears it so a different
  // model's knobs surface on their own.
  let paramCount = 0;
  let userClosed = false;
  // Per-key updater so we can refresh widget values without a DOM rebuild.
  const valueSetters = new Map<string, (v: ParamValue) => void>();

  function notify(): void {
    opts.onVisibilityChange?.({ hasParams: paramCount > 0, open: isOpen(), count: paramCount });
  }

  // clampIntoView is wired up after attachViewportPanelDrag; applyVisibility
  // calls it via a stable reference so the closure captures it correctly.
  let clampIntoViewRef: (() => void) | null = null;
  let escapeListenerActive = false;

  function applyVisibility(): void {
    const wasOpen = !root.classList.contains('hidden');
    const willOpen = isOpen();
    root.classList.toggle('hidden', !willOpen);
    if (willOpen && !wasOpen) {
      setInitialPanelPosition(root);
      openViewportPanel(registryEntry);
      if (!escapeListenerActive) {
        document.addEventListener('keydown', onParamsEscape);
        escapeListenerActive = true;
      }
      requestAnimationFrame(() => { clampIntoViewRef?.(); });
    } else if (!willOpen && wasOpen) {
      closeViewportPanel(registryEntry);
      document.removeEventListener('keydown', onParamsEscape);
      escapeListenerActive = false;
    }
    notify();
  }

  function isOpen(): boolean {
    return paramCount > 0 && !userClosed;
  }

  function rebuild(schema: ParamSpec[]): void {
    body.replaceChildren();
    valueSetters.clear();
    for (const spec of schema) {
      const { row, setValue } = buildWidget(spec, opts.onChange);
      valueSetters.set(spec.key, setValue);
      body.appendChild(row);
    }
  }

  function updateValues(values: ParamValues): void {
    for (const [key, set] of valueSetters) {
      if (key in values) set(values[key]);
    }
  }

  function update(schema: ParamSpec[] | undefined, values: ParamValues): void {
    if (!schema || schema.length === 0) {
      currentSig = '';
      paramCount = 0;
      userClosed = false;
      valueSetters.clear();
      body.replaceChildren();
      applyVisibility();
      return;
    }
    const sig = schemaSignature(schema);
    if (sig !== currentSig) {
      currentSig = sig;
      rebuild(schema);
      // A new or changed parameter set re-opens the panel so its knobs are seen.
      userClosed = false;
    }
    paramCount = schema.length;
    updateValues(values);
    title.textContent = schema.length === 1 ? 'Customize (1)' : `Customize (${schema.length})`;
    applyVisibility();
  }

  const registryEntry = { close(): void { userClosed = true; applyVisibility(); } };

  function onParamsEscape(e: KeyboardEvent): void {
    if (e.key !== 'Escape') return;
    if (document.querySelector('[role="dialog"]')) return;
    userClosed = true;
    applyVisibility();
  }

  closeBtn.addEventListener('click', () => { userClosed = true; applyVisibility(); });

  const { clampIntoView } = attachViewportPanelDrag(header, root);
  clampIntoViewRef = clampIntoView;

  return {
    element: root,
    update,
    open() {
      if (paramCount > 0) {
        userClosed = false;
        applyVisibility();
      }
    },
    close() { userClosed = true; applyVisibility(); },
    toggle() { if (paramCount > 0) { userClosed = !userClosed; applyVisibility(); } },
    isOpen,
    hasParams() { return paramCount > 0; },
  };
}

/** Build one labeled widget row. Returns the row plus a setter that pushes a
 *  resolved value back into the control (used to reflect Reset / persisted
 *  state without a rebuild). */
function buildWidget(spec: ParamSpec, onChange: (key: string, value: ParamValue) => void): { row: HTMLElement; setValue: (v: ParamValue) => void } {
  const row = document.createElement('div');
  row.className = 'flex flex-col gap-1';

  const labelRow = document.createElement('div');
  labelRow.className = 'flex items-baseline justify-between gap-2';
  const label = document.createElement('label');
  label.className = 'text-[11px] text-zinc-400 truncate';
  label.textContent = spec.unit ? `${spec.label} (${spec.unit})` : spec.label;
  if (spec.help) label.title = spec.help;
  labelRow.appendChild(label);

  let setValue: (v: ParamValue) => void;

  if (spec.type === 'number' || spec.type === 'int') {
    // Numeric editor sits next to the label: an *editable* number field paired
    // with a range slider. The slider gives quick coarse control; the field
    // lets you type an exact value (e.g. 47.5) — and, when the spec sets no
    // `max`, type a value beyond the slider's synthesized range (params.ts only
    // clamps to limits the author actually declared). We fire onChange on
    // 'change' (slider pointer-release / field blur-or-Enter), not per slider
    // tick, but keep the field in sync live on slider 'input'.
    const isInt = spec.type === 'int';
    const min = spec.min ?? 0;
    const max = spec.max ?? (typeof spec.default === 'number' ? Math.max(spec.default * 2, spec.default + 10) : 100);
    const step = spec.step ?? (isInt ? 1 : (max - min) / 100 || 1);

    const numInput = document.createElement('input');
    numInput.type = 'number';
    // Narrow, mono, right-aligned — reads like the old readout but is editable.
    numInput.className = 'w-16 text-[11px] font-mono tabular-nums text-right text-zinc-200 bg-zinc-800 border border-zinc-600 rounded px-1 py-0.5 focus:border-blue-400 focus:outline-none';
    // Only constrain the field by limits the author declared, so an undeclared
    // bound doesn't silently clamp a typed value (the slider keeps its own
    // synthesized range for the thumb).
    if (spec.min !== undefined) numInput.min = String(spec.min);
    if (spec.max !== undefined) numInput.max = String(spec.max);
    numInput.step = String(step);
    labelRow.appendChild(numInput);
    row.appendChild(labelRow);

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'w-full accent-blue-400 cursor-pointer';
    slider.min = String(min);
    slider.max = String(max);
    slider.step = String(step);
    slider.addEventListener('input', () => { numInput.value = slider.value; });
    slider.addEventListener('change', () => {
      const n = isInt ? Math.round(Number(slider.value)) : Number(slider.value);
      numInput.value = String(n);
      onChange(spec.key, n);
    });
    row.appendChild(slider);

    const commitField = () => {
      const raw = Number(numInput.value);
      if (numInput.value.trim() === '' || !Number.isFinite(raw)) {
        // Empty / unparseable — revert the field to the slider's value, no run.
        numInput.value = slider.value;
        return;
      }
      const n = isInt ? Math.round(raw) : raw;
      // Reflect the typed value on the slider thumb (the browser clamps it into
      // the slider's range; the field keeps the true value). The post-run
      // sync via setValue will reconcile both to params.ts's coerced result.
      slider.value = String(n);
      if (isInt) numInput.value = String(n);
      onChange(spec.key, n);
    };
    numInput.addEventListener('change', commitField);
    // Enter commits without leaving the field (change already fires on blur).
    numInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); numInput.blur(); } });

    setValue = (v) => {
      const n = typeof v === 'number' ? v : Number(v);
      slider.value = String(n);
      numInput.value = String(n);
    };
  } else if (spec.type === 'boolean') {
    const wrap = document.createElement('div');
    wrap.className = 'flex items-center';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'accent-blue-400 cursor-pointer w-4 h-4';
    cb.addEventListener('change', () => onChange(spec.key, cb.checked));
    labelRow.appendChild(wrap);
    wrap.appendChild(cb);
    // Put the checkbox on the right of the label row for a compact layout.
    row.appendChild(labelRow);
    setValue = (v) => { cb.checked = v === true; };
  } else if (spec.type === 'select') {
    row.appendChild(labelRow);
    const sel = document.createElement('select');
    sel.className = 'w-full text-xs bg-zinc-800 border border-zinc-600 rounded px-1.5 py-1 text-zinc-200 cursor-pointer';
    for (const opt of spec.options ?? []) {
      const o = document.createElement('option');
      o.value = opt.value;
      o.textContent = opt.label;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => onChange(spec.key, sel.value));
    row.appendChild(sel);
    setValue = (v) => { sel.value = String(v); };
  } else if (spec.type === 'color') {
    row.appendChild(labelRow);
    const color = document.createElement('input');
    color.type = 'color';
    color.className = 'w-full h-7 bg-zinc-800 border border-zinc-600 rounded cursor-pointer';
    color.addEventListener('change', () => onChange(spec.key, color.value));
    row.appendChild(color);
    setValue = (v) => { color.value = String(v); };
  } else {
    // text
    row.appendChild(labelRow);
    const text = document.createElement('input');
    text.type = 'text';
    text.className = 'w-full text-xs bg-zinc-800 border border-zinc-600 rounded px-1.5 py-1 text-zinc-200';
    if (spec.maxLength !== undefined) text.maxLength = spec.maxLength;
    text.addEventListener('change', () => onChange(spec.key, text.value));
    row.appendChild(text);
    setValue = (v) => { text.value = String(v); };
  }

  return { row, setValue };
}
