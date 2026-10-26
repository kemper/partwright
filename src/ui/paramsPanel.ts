// The Customizer panel — a viewport overlay that renders the parameter schema a
// model declares via `api.params({...})` as live widgets (sliders, toggles,
// dropdowns, color/text inputs). Editing a widget calls back into main.ts,
// which re-runs the model with the new override and persists it on the version.
//
// Self-contained and DOM-only: it receives a normalized, serializable schema
// (see src/geometry/params.ts) plus the current resolved values, and never
// touches the engine or storage directly.

import type { ParamSpec, ParamValue, ParamValues } from '../geometry/params';
import { openViewportPanel, closeViewportPanel, getActiveViewportPanel } from './viewportPanelRegistry';
import { attachViewportPanelDrag, setInitialPanelPosition } from './viewportPanelDrag';
import { createColorSwatch } from './colorPickerModal';
import { createSliderEntry, formatEntry } from './sliderEntry';
import { setToolNote, type ToolOpenContext } from './toolRegistry';

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
  /** Fired when a new/changed parameter schema auto-opens the panel (i.e. a
   *  parameterizable model is opened for the first time). Lets the host also
   *  reveal the Tools dropdown the Customize button lives in, so the tool list
   *  sits just above the freshly-docked panel. Not fired on manual re-opens. */
  onAutoReveal?: () => void;
}

export interface ParamsPanelController {
  element: HTMLElement;
  /** Re-render for a new schema (or update values in place if the schema is
   *  unchanged). Pass `undefined`/empty to hide the panel. `silentReveal` opens
   *  the panel without hiding the AI panel (used for the post-AI-turn flush). */
  update(schema: ParamSpec[] | undefined, values: ParamValues, opts?: { silentReveal?: boolean }): void;
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
  /** Show (or clear, with null) a "Suggested by AI: …" line above the widgets
   *  — openTool('tool-customize'). Cleared when the panel closes. */
  setNote(note: string | null | undefined, source?: ToolOpenContext['source']): void;
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
  root.className = 'hidden fixed z-10 w-60 max-w-[calc(100%-1rem)] flex flex-col rounded-lg bg-zinc-900/85 backdrop-blur border border-zinc-700 shadow-lg text-zinc-200 pointer-events-auto';

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

  // AI note slot (openTool prefill) — outside `body`, which rebuilds on a schema change.
  const noteHost = document.createElement('div');
  noteHost.className = 'px-2.5 pt-2 empty:hidden';
  root.appendChild(noteHost);

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

  function applyVisibility(silent = false): void {
    const wasOpen = !root.classList.contains('hidden');
    const willOpen = isOpen();
    root.classList.toggle('hidden', !willOpen);
    if (willOpen && !wasOpen) {
      setInitialPanelPosition(root);
      openViewportPanel(registryEntry, { silent });
      if (!escapeListenerActive) {
        document.addEventListener('keydown', onParamsEscape);
        escapeListenerActive = true;
      }
      requestAnimationFrame(() => { clampIntoViewRef?.(); });
    } else if (!willOpen && wasOpen) {
      noteHost.replaceChildren();
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

  function update(
    schema: ParamSpec[] | undefined,
    values: ParamValues,
    { silentReveal = false }: { silentReveal?: boolean } = {},
  ): void {
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
    const schemaChanged = sig !== currentSig;
    if (schemaChanged) {
      currentSig = sig;
      rebuild(schema);
      // A new or changed parameter set normally re-opens the panel so its knobs
      // are seen (e.g. first opening a parameterizable model). But if the user
      // already has a DIFFERENT viewport tool menu open — typically because they
      // switched parts while using Surface/Paint/Resize/etc. — keep that menu as
      // the current one and stay closed, rather than auto-popping over it. The
      // user can still open Customize from its toolbar pill.
      const other = getActiveViewportPanel();
      userClosed = other !== null && other !== registryEntry;
    }
    paramCount = schema.length;
    updateValues(values);
    title.textContent = schema.length === 1 ? 'Customize (1)' : `Customize (${schema.length})`;
    // Reveal the Tools dropdown *before* positioning the panel, so applyVisibility
    // docks the panel beneath the now-open menu rather than the bare toolbar.
    if (schemaChanged && isOpen()) opts.onAutoReveal?.();
    // `silentReveal` (the host's post-AI-turn flush) opens the panel without
    // pulling the AI panel out of the way — the model just finished, so the user
    // sees both at once. A normal/user-initiated reveal hides the AI panel.
    applyVisibility(silentReveal);
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
    setNote(note, source) {
      setToolNote(noteHost, note, source);
      noteHost.querySelector('[data-tool-note]')?.classList.remove('mb-2');
    },
  };
}

/** Build one labeled widget row. Returns the row plus a setter that pushes a
 *  resolved value back into the control (used to reflect Reset / persisted
 *  state without a rebuild). Exported so the Assembly view's shared-parameter
 *  panel renders identical widgets. */
export function buildWidget(spec: ParamSpec, onChange: (key: string, value: ParamValue) => void): { row: HTMLElement; setValue: (v: ParamValue) => void } {
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

    // The field is intentionally *unconstrained* (no hard bounds) so the user
    // can type — and spinner-step — a value beyond the author's declared range;
    // min/max only size the slider. A value outside it grows the slider's
    // bounds so the thumb tracks the true value instead of pinning at an edge.
    const entry = createSliderEntry({
      min, max, step, value: typeof spec.default === 'number' ? spec.default : min,
      hardMin: -Infinity, hardMax: Infinity, integer: isInt,
      format: v => formatEntry(v),
      overflow: 'grow',
      dragCommit: 'change',
      onChange: v => onChange(spec.key, v),
      rangeClass: 'w-full accent-blue-400 cursor-pointer',
      // Narrow, mono, right-aligned — reads like the old readout but is editable.
      inputClass: 'w-16 text-[11px] font-mono tabular-nums text-right text-zinc-200 bg-zinc-800 border border-zinc-600 rounded px-1 py-0.5 focus:border-blue-400 focus:outline-none',
    });
    labelRow.appendChild(entry.input);
    row.appendChild(labelRow);
    row.appendChild(entry.range);

    setValue = (v) => entry.set(typeof v === 'number' ? v : Number(v));
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
    const sw = createColorSwatch({
      initialHex: '#000000',
      title: 'Pick a colour',
      modalTitle: spec.label ?? 'Pick a colour',
      className: 'w-full h-7 rounded border border-zinc-600 cursor-pointer',
      onPick: (hex) => onChange(spec.key, hex),
    });
    row.appendChild(sw.el);
    setValue = (v) => { sw.setHex(String(v)); };
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
