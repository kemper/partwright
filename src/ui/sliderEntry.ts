// Shared range slider + number box ("slider entry").
//
// The app's convention for a numeric setting: the slider covers the common
// range for quick dragging, and an editable number box beside it accepts an
// exact value — including one past the slider's range, up to the setting's
// real (hard) limit. A typed out-of-range value either pins the thumb at the
// slider's end (`overflow: 'pin'`) or widens the slider to include it
// (`overflow: 'grow'`).
//
// `bindSliderEntry` wires an existing range + number input pair (callers own
// the layout — label rows, units, readouts); `createSliderEntry` also creates
// the two inputs with the default classes. The pure helpers (`clampEntry`,
// `formatEntry`, `stepDecimals`) are shared with the Preact slider in
// imageVoxelImportModal.tsx and covered by tests/unit/sliderEntry.test.ts.

/** Default classes for the number box — narrow, right-aligned, tabular. */
export const SLIDER_ENTRY_INPUT = 'w-16 px-1 py-0.5 text-[11px] bg-zinc-900/70 border border-zinc-600/60 rounded text-zinc-200 text-right tabular-nums focus:outline-none focus:border-blue-500';
/** Default classes for the range slider (sized to share a row with the box). */
export const SLIDER_ENTRY_RANGE = 'flex-1 min-w-0 accent-blue-500 cursor-pointer';

export interface EntryBounds {
  /** Smallest accepted typed value (default: the slider min). */
  hardMin?: number;
  /** Largest accepted typed value (default: the slider max). Pass
   *  `Infinity` for an open-ended quantity. */
  hardMax?: number;
  /** Round to whole numbers. */
  integer?: boolean;
}

/** Clamp a value to [hardMin, hardMax] (either may be ±Infinity) and round
 *  it when `integer`. */
export function clampEntry(raw: number, b: EntryBounds): number {
  const v = Math.max(b.hardMin ?? -Infinity, Math.min(b.hardMax ?? Infinity, raw));
  return b.integer ? Math.round(v) : v;
}

/** Decimal places needed to show every digit of `step` (0 for whole steps). */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || Number.isInteger(step)) return 0;
  return String(Number(step.toPrecision(6))).split('.')[1]?.length ?? 0;
}

/** Format a value for the number box: fixed to `decimals` places with
 *  trailing zeros dropped, or — with no `decimals` — precision-safe so float
 *  noise (0.30000000000000004) never shows but typed digits are kept. */
export function formatEntry(v: number, decimals?: number): string {
  return decimals === undefined
    ? String(Number(v.toPrecision(12)))
    : String(Number(v.toFixed(decimals)));
}

/** Default tooltip for the number box: says how far past the slider a typed
 *  value may go. */
export function entryTitle(sliderMax: number, hardMax: number): string {
  if (hardMax <= sliderMax) return 'Type an exact value';
  return Number.isFinite(hardMax)
    ? `Type a value up to ${formatEntry(hardMax)} to go past the slider`
    : 'Type any value to go past the slider';
}

export interface SliderEntryOptions extends EntryBounds {
  /** Slider (thumb) range — the common range. */
  min: number;
  max: number;
  step: number;
  value: number;
  /** Formats slider-driven / programmatic values for the box. A committed
   *  typed value is shown precision-safe instead, so it is never truncated.
   *  Default: `formatEntry` to the step's decimals. */
  format?: (v: number) => string;
  /** 'pin' (default) keeps the slider's range and pins the thumb at its end
   *  for an out-of-range value; 'grow' widens the slider to include it. */
  overflow?: 'pin' | 'grow';
  /** When dragging fires `onChange`: 'input' (live, default) or 'change'
   *  (on release — for settings that trigger a heavy rebuild). */
  dragCommit?: 'input' | 'change';
  /** Also fire `onChange` on each valid keystroke in the box. Default false:
   *  the box commits on Enter / blur, so a half-typed value isn't clamped. */
  liveTyping?: boolean;
  /** Fired with the new (clamped) value on a user edit — never by `set()`. */
  onChange: (v: number) => void;
}

export interface SliderEntry {
  range: HTMLInputElement;
  input: HTMLInputElement;
  /** Current value (clamped to the hard bounds). */
  get(): number;
  /** Push a value in without firing `onChange` (e.g. reflecting state or a
   *  Reset). It always rewrites the box — a programmatic value is authoritative,
   *  even if the box still has focus. */
  set(v: number): void;
  /** Change the slider and/or hard bounds (e.g. a model-derived range). */
  setBounds(b: Partial<Pick<SliderEntryOptions, 'min' | 'max' | 'step' | 'hardMin' | 'hardMax'>>): void;
}

/** Wire an existing range + number input pair. */
export function bindSliderEntry(range: HTMLInputElement, input: HTMLInputElement, opts: SliderEntryOptions): SliderEntry {
  let { min, max, step } = opts;
  let hardMin = opts.hardMin ?? min;
  let hardMax = opts.hardMax ?? max;
  const integer = opts.integer ?? false;
  const format = opts.format ?? ((v: number) => formatEntry(v, integer ? 0 : stepDecimals(step)));
  const clamp = (n: number) => clampEntry(n, { hardMin, hardMax, integer });
  let value = clamp(opts.value);

  const applyAttrs = () => {
    range.step = String(step);
    // The spinner arrows step like the slider; a typed off-step value is still
    // accepted (number inputs only flag it, they don't reject it).
    input.step = String(step);
    if (Number.isFinite(hardMin)) input.min = String(hardMin); else input.removeAttribute('min');
    if (Number.isFinite(hardMax)) input.max = String(hardMax); else input.removeAttribute('max');
  };
  const placeThumb = (v: number) => {
    if (opts.overflow === 'grow') {
      range.min = String(Math.min(min, v));
      range.max = String(Math.max(max, v));
    } else {
      range.min = String(min);
      range.max = String(max);
    }
    range.value = String(v);   // the browser pins an out-of-range value
  };
  applyAttrs();
  placeThumb(value);
  input.value = format(value);

  const fromRange = () => { value = clamp(range.valueAsNumber); input.value = format(value); };
  range.addEventListener('input', () => {
    fromRange();
    if (opts.dragCommit !== 'change') opts.onChange(value);
  });
  if (opts.dragCommit === 'change') {
    range.addEventListener('change', () => { fromRange(); opts.onChange(value); });
  }
  if (opts.liveTyping) {
    input.addEventListener('input', () => {
      const raw = input.valueAsNumber;
      if (Number.isNaN(raw)) return;           // mid-edit empty box — don't snap yet
      value = clamp(raw);
      placeThumb(value);
      opts.onChange(value);
    });
  }
  input.addEventListener('change', () => {
    const raw = input.valueAsNumber;
    if (Number.isNaN(raw)) { input.value = format(value); return; }
    value = clamp(raw);
    input.value = formatEntry(value);
    placeThumb(value);
    opts.onChange(value);
  });
  // Enter commits and leaves the box (blur fires `change` if it hasn't yet).
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); input.blur(); } });

  return {
    range,
    input,
    get: () => value,
    set: (v: number) => {
      value = clamp(v);
      placeThumb(value);
      input.value = format(value);
    },
    setBounds: (b) => {
      if (b.min !== undefined) min = b.min;
      if (b.max !== undefined) max = b.max;
      if (b.step !== undefined) step = b.step;
      if (b.hardMin !== undefined) hardMin = b.hardMin;
      if (b.hardMax !== undefined) hardMax = b.hardMax;
      applyAttrs();
      value = clamp(value);
      placeThumb(value);
      input.value = format(value);
    },
  };
}

/** Create a range + number input pair (default classes, shared aria-label
 *  and tooltip) and wire them. The caller places `range` and `input`. */
export function createSliderEntry(opts: SliderEntryOptions & {
  label?: string;
  title?: string;
  rangeClass?: string;
  inputClass?: string;
}): SliderEntry {
  const range = document.createElement('input');
  range.type = 'range';
  range.className = opts.rangeClass ?? SLIDER_ENTRY_RANGE;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = opts.inputClass ?? SLIDER_ENTRY_INPUT;
  if (opts.label) {
    range.setAttribute('aria-label', opts.label);
    input.setAttribute('aria-label', opts.label);
  }
  input.title = opts.title ?? entryTitle(opts.max, opts.hardMax ?? opts.max);
  return bindSliderEntry(range, input, opts);
}
