// Character Creator — a no-code GUI over the SDF figure system. Sliders,
// dropdowns and colour swatches edit a CharacterSpec; the panel generates
// self-contained `api.sdf.figure` code (characterCodegen.ts), previews it live,
// and commits it as a saved version. The generated code embeds the spec as a
// header comment, so re-opening the panel restores every control.
//
// Follows the shared viewport tool-panel conventions (createToolPanelShell) and
// the command-palette + Tools-menu registration pattern used by the Surface and
// Paint panels.

import { createToolPanelShell } from './toolPanel';
import { createColorSwatch } from './colorPickerModal';
import { registerCommands } from './commandPalette';
import { BUTTON_PRIMARY, BUTTON_SMALL_SECONDARY } from './styleConstants';
import { showToast } from './toast';
import { confirmDialog } from './dialogs';
import { getConfig } from '../config/appConfig';
import { createSliderEntry } from './sliderEntry';
import { registerTool, openTool, createToolNote, type ToolOpenContext, type ToolOpenResult } from './toolRegistry';
import { assetPath } from '../deployment';
import {
  type CharacterSpec,
  type CustomControlId,
  type Proportions,
  DEFAULT_SPEC,
  cloneSpec,
  decodeSpecComment,
  applyStyle,
  resolvedHeadScale,
  STYLE_DEFAULTS,
  CHARACTER_PRESETS,
  POSE_PRESETS,
  POSE_PRESET_LABELS,
  PROPORTIONS,
  PRINT_FONTS,
  PRINT_DEFAULT, isPrintableText, normalizeSpec, validateSpec,
} from '../figure/characterSpec';
import {
  type PanelControl,
  panelLayout,
  layoutKey,
  applyControl,
  controlValue,
  enumOptions,
  getAt,
  setAt,
  humanize,
} from '../figure/characterPanelLayout';
import { randomSpec, seededRandom } from '../figure/characterRandom';

/** The slice of the console API the panel drives. */
export interface CharacterCreatorApi {
  /** Generate figure code from a spec, run it (and, when `save`, commit a
   *  version). Returns the generated code plus the run/save result. */
  buildCharacter(spec: CharacterSpec, opts?: { save?: boolean }): Promise<{ code: string; error?: string; version?: unknown }>;
  /** Current editor code (to restore the spec when re-opening). */
  getCode(): string;
}

let openClose: (() => void) | null = null;
let currentSpec: (() => CharacterSpec) | null = null;

interface CharacterOpenOpts {
  /** A Character Creator spec (same shape as `buildCharacter`, partial specs
   *  merge onto the default) to show in the controls — UNBUILT: the editor is
   *  untouched until the user edits, presses Preview, or saves. */
  spec?: unknown;
  note?: string;
  source?: ToolOpenContext['source'];
}

// ---- small DOM helpers (vanilla, matching paramsPanel's idiom) -------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = ''): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function sectionTitle(text: string): HTMLElement {
  const h = el('div', 'text-[11px] uppercase tracking-wide text-zinc-400 font-semibold mt-1 mb-0.5');
  h.textContent = text;
  return h;
}

function labelledRow(label: string, control: HTMLElement): HTMLElement {
  const row = el('label', 'flex items-center justify-between gap-2');
  const name = el('span', 'text-[12px] text-zinc-300 shrink-0');
  name.textContent = label;
  row.append(name, control);
  return row;
}

function selectRow(
  label: string,
  value: string,
  options: readonly (string | [string, string])[],
  onChange: (v: string) => void,
): HTMLElement {
  const sel = el('select', `bg-zinc-900 border border-zinc-600 rounded px-1.5 py-0.5 text-[12px] text-zinc-100 min-w-[7.5rem] ${TOUCH}`);
  for (const opt of options) {
    const [val, text] = Array.isArray(opt) ? opt : [opt, opt];
    const o = el('option');
    o.value = val;
    o.textContent = text;
    if (val === value) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return labelledRow(label, sel);
}

function sliderRow(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (v: number) => void,
  /** Typed-value bounds when they differ from the slider's range — e.g. a
   *  height the slider caps for convenience but the figure builder accepts
   *  past it. Defaults to [min, max]. */
  hard: { min?: number; max?: number } = {},
): HTMLElement {
  // Fire on release / Enter ('change') not every tick — an SDF rebuild per
  // pixel of drag would starve the renderer; the box still tracks live.
  const entry = createSliderEntry({
    label, min, max, step, value,
    hardMin: hard.min, hardMax: hard.max,
    dragCommit: 'change',
    onChange,
    // w-14 fits a signed two-decimal value ("-0.35") without clipping.
    inputClass: `w-14 bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-[11px] text-right tabular-nums text-zinc-200 ${TOUCH}`,
  });
  entry.range.classList.add('min-h-[44px]', 'md:min-h-0');
  const wrap = el('div', 'flex items-center gap-2 min-w-[8.5rem]');
  wrap.append(entry.range, entry.input);
  return labelledRow(label, wrap);
}

function colorRow(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  // Shared palette modal (filament swatches + recent colours), not the native
  // OS picker — matches the paint/voxel/relief colour fields.
  const swatch = createColorSwatch({
    initialHex: value,
    title: label,
    className: 'w-11 h-11 md:w-8 md:h-6 shrink-0 rounded border border-zinc-600 [@media(hover:hover)]:hover:border-white/70 cursor-pointer transition-colors',
    onPick: (hex) => onChange(hex),
  });
  return labelledRow(label, swatch.el);
}

/** Grow a control to a 44 px touch target on the stacked mobile layout only. */
const TOUCH = 'min-h-[44px] md:min-h-0';

/** Active segment of a segmented control (matches the Part Detection tool row). */
const SEG_ON = 'px-2 py-1 rounded text-[11px] text-blue-200 bg-blue-500/30 border border-blue-500/50';

/** A row of mutually-exclusive buttons (aria-pressed). Segments grow to a 44 px
 *  touch target on the stacked mobile layout and stay compact on desktop. */
function segmentedRow(
  label: string,
  value: string,
  options: readonly [string, string][],
  onPick: (v: string) => void,
): HTMLElement {
  const group = el('div', 'flex gap-1 flex-1 justify-end');
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);
  for (const [val, text] of options) {
    const b = el('button', `${val === value ? SEG_ON : BUTTON_SMALL_SECONDARY} flex-1 min-h-[44px] md:min-h-0`);
    b.type = 'button';
    b.textContent = text;
    b.setAttribute('aria-pressed', String(val === value));
    b.addEventListener('click', () => { if (val !== value) onPick(val); });
    group.appendChild(b);
  }
  const row = el('div', 'flex items-center justify-between gap-2');
  const name = el('span', 'text-[12px] text-zinc-300 shrink-0');
  name.textContent = label;
  row.append(name, group);
  return row;
}

function toggleRow(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = el('input', 'accent-blue-500 w-5 h-5 md:w-4 md:h-4');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  const row = labelledRow(label, input);
  row.classList.add('min-h-[44px]', 'md:min-h-0', 'cursor-pointer');   // the whole row is the hit area
  return row;
}

/** A short text field committed on change. `accept` vets the trimmed value;
 *  a rejected value reverts the box and explains why with a toast. */
function textRow(
  label: string,
  value: string,
  maxLength: number,
  accept: (v: string) => string | null,
  onChange: (v: string) => void,
): HTMLElement {
  const input = el('input', `bg-zinc-900 border border-zinc-600 rounded px-1.5 py-0.5 text-[12px] text-zinc-100 w-[7.5rem] ${TOUCH}`);
  input.type = 'text';
  input.value = value;
  input.maxLength = maxLength;
  input.setAttribute('aria-label', label);
  input.addEventListener('change', () => {
    const v = input.value.trim();
    const problem = accept(v);
    if (problem) {
      input.value = value;
      showToast(problem, { variant: 'warn', source: 'character' });
      return;
    }
    onChange(v);
  });
  return labelledRow(label, input);
}

/** Thumbnail stand-in when a preset's baked image is missing: a tiny
 *  head-over-body silhouette in the preset's own skin/hair/top/pants colours. */
function fallbackFigure(spec: CharacterSpec): HTMLElement {
  const wrap = el('div', 'flex flex-col items-center gap-px');
  wrap.setAttribute('aria-hidden', 'true');
  const head = el('span', 'w-5 h-5 rounded-full border-t-4');
  head.style.background = spec.colors.skin;
  head.style.borderTopColor = spec.hair.style === 'bald' ? spec.colors.skin : spec.colors.hair;
  const torso = el('span', 'w-7 h-6 rounded-t-md');
  torso.style.background = spec.clothing.top.on ? spec.colors.top : spec.colors.skin;
  const legs = el('span', 'w-5 h-5');
  legs.style.background = spec.clothing.pants.on ? spec.colors.pants : spec.colors.skin;
  wrap.append(head, torso, legs);
  return wrap;
}

/** A collapsible group (native <details>) for the less-used knobs, so the panel
 *  stays short. `open` holds the ids the user expanded — it survives the
 *  wholesale control rebuilds. */
function collapsible(id: string, title: string, open: Set<string>): { wrap: HTMLElement; body: HTMLElement } {
  const wrap = el('details', 'rounded border border-zinc-700/70 bg-zinc-900/40');
  wrap.dataset.section = id;
  if (open.has(id)) wrap.open = true;
  const summary = el('summary', `cursor-pointer select-none px-2 py-1 text-[11px] uppercase tracking-wide text-zinc-400 font-semibold [@media(hover:hover)]:hover:text-zinc-200 flex items-center ${TOUCH}`);
  // `display: flex` drops the native disclosure marker, so draw our own chevron.
  const chevron = el('span', 'mr-1.5 text-zinc-500');
  chevron.setAttribute('aria-hidden', 'true');
  const label = el('span');
  label.textContent = title;
  summary.append(chevron, label);
  const body = el('div', 'flex flex-col gap-1.5 px-2 pb-2 pt-1');
  wrap.append(summary, body);
  const sync = () => { chevron.textContent = wrap.open ? '▾' : '▸'; };
  sync();
  wrap.addEventListener('toggle', () => { if (wrap.open) open.add(id); else open.delete(id); sync(); });
  return { wrap, body };
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export function openCharacterCreatorPanel(api: CharacterCreatorApi, openOpts?: CharacterOpenOpts): ToolOpenResult {
  // Validate a handed-in spec before touching any open panel.
  let initialSpec: CharacterSpec | null = null;
  if (openOpts?.spec !== undefined) {
    if (!openOpts.spec || typeof openOpts.spec !== 'object' || Array.isArray(openOpts.spec)) {
      return { error: 'spec must be a Character Creator spec object (see /ai/figure.md)' };
    }
    const normalized = normalizeSpec(openOpts.spec);
    const problems = validateSpec(normalized);
    if (problems.length > 0) return { error: `spec: ${problems.join('; ')}` };
    initialSpec = normalized;
  }
  if (openClose) { openClose(); openClose = null; }

  // Live-preview debounce state — declared before the shell so onClose can
  // cancel a pending rebuild. Without this, closing the panel within the
  // debounce window still fires the queued build, overwriting the editor and
  // re-rendering a character after the user dismissed the panel.
  let timer: number | undefined;
  let closed = false;
  // While Save runs, previews hold off (a preview build would cancel the
  // save's build); an edit made meanwhile queues one preview for after it.
  let saving = false;
  let previewAfterSave = false;

  const shell = createToolPanelShell({
    title: 'Character Creator',
    width: 'w-[20rem]',
    onClose: () => { closed = true; window.clearTimeout(timer); if (openClose === shell.close) { openClose = null; currentSpec = null; } },
  });
  openClose = shell.close;

  // Restore the spec from the current code if it was made here; otherwise start
  // from the default (and remember whether it's safe to auto-preview on open).
  // A handed-in spec (AI / API) wins, shown unbuilt.
  const existing = decodeSpecComment(api.getCode());
  let spec: CharacterSpec = initialSpec ?? (existing ? existing : cloneSpec(DEFAULT_SPEC));
  currentSpec = () => spec;
  const currentCodeEmpty = api.getCode().trim() === '';

  // Generating overwrites the editor buffer. When the panel opens over
  // unrelated hand-written code (not a character, not empty), confirm once
  // before the first destructive build so a stray slider can't silently wipe it.
  let needsConfirm = !existing && !currentCodeEmpty;
  const confirmClobber = async (): Promise<boolean> => {
    if (!needsConfirm) return true;
    const ok = await confirmDialog(
      'Replace the current model in the editor with a generated character? Your unsaved code will be overwritten.',
      { title: 'Start a character', confirmLabel: 'Replace' },
    );
    if (ok) needsConfirm = false;
    return ok;
  };

  // Live preview. Slider drags debounce (one rebuild on settle); discrete jumps
  // like a preset switch fire immediately (`immediate`). Either way buildCharacter
  // cancels any in-flight render first, so changes never stack in the worker. The
  // engine shows its own "Rendering…" status.
  const preview = (opts?: { immediate?: boolean }): void => {
    window.clearTimeout(timer);
    if (saving) { previewAfterSave = true; return; }
    const fire = async () => {
      if (closed) return;
      if (saving) { previewAfterSave = true; return; }
      if (!(await confirmClobber())) return;
      if (closed) return; // panel was dismissed while the confirm dialog was open
      void api.buildCharacter(spec, { save: false });
    };
    if (opts?.immediate) { void fire(); return; }
    timer = window.setTimeout(fire, getConfig().ui.characterPreviewDebounceMs);
  };

  /** The layout the controls were last rendered from: an edit that changes it
   *  (a control appears or disappears) re-renders the panel. */
  let shownKey = '';
  // A change handler that mutates the spec then re-previews. An edit moves the
  // spec off whichever preset it started from, so drop the card highlight
  // (markActive is defined with the preset list below).
  const onEdit = (mutate: (s: CharacterSpec) => void, opts?: { immediate?: boolean }): void => {
    mutate(spec);
    markActive(null);
    if (layoutKey(spec) !== shownKey) rebuild();
    preview(opts);
  };
  /** An edit that rewrites many values at once (style, pose preset): re-render
   *  every control and preview straight away. */
  const replaceAll = (mutate: (s: CharacterSpec) => void): void => {
    mutate(spec);
    markActive(null);
    rebuild();
    preview({ immediate: true });
  };

  const body = shell.body;
  if (openOpts?.note) body.appendChild(createToolNote(openOpts.note, openOpts.source));

  // --- Start from a preset (scrollable pick-list) or roll a random one ---
  // Each card shows a baked thumbnail (public/character-presets/<id>.webp, see
  // scripts/bake-character-presets.mjs) with the preset's palette as a fallback
  // strip, so the list is scannable even before/without the image.
  const presetHeader = el('div', 'flex items-center justify-between gap-2 mt-1');
  const presetTitle = sectionTitle('Start from a preset');
  presetTitle.classList.remove('mt-1');
  const randomBtn = el('button', `${BUTTON_SMALL_SECONDARY} ${TOUCH}`);
  randomBtn.textContent = '🎲 Random';
  const RANDOM_TITLE = 'Build a brand-new random character (click again for another)';
  randomBtn.title = RANDOM_TITLE;
  randomBtn.addEventListener('click', () => {
    // Keep the stand + placement — print-setup choices, not part of "who".
    const { base: keepBase, place: keepPlace } = spec;
    // Seeded so a roll you like can be re-created with
    // partwright.randomCharacter({ seed }) — the seed shows on hover.
    const seed = Math.floor(Math.random() * 2 ** 31);
    spec = randomSpec(seededRandom(seed));
    spec.base = keepBase;
    spec.place = keepPlace;
    randomBtn.title = `${RANDOM_TITLE} — last roll: seed ${seed}`;
    markActive(null);
    rebuild();
    preview({ immediate: true });
  });
  presetHeader.append(presetTitle, randomBtn);

  const presetList = el('div', 'grid grid-cols-2 gap-1.5 max-h-[15rem] shrink-0 overflow-y-auto pr-0.5');
  presetList.setAttribute('role', 'list');
  presetList.setAttribute('aria-label', 'Character presets');
  const cards = new Map<string, HTMLButtonElement>();
  const markActive = (id: string | null): void => {
    for (const [cid, card] of cards) {
      const on = cid === id;
      card.classList.toggle('border-blue-500', on);
      card.classList.toggle('border-zinc-700', !on);
      card.setAttribute('aria-pressed', String(on));
    }
  };
  for (const p of CHARACTER_PRESETS) {
    const preset = p.patch();
    const item = el('div');
    item.setAttribute('role', 'listitem');
    const card = el('button', 'w-full h-full flex flex-col items-stretch text-left rounded border border-zinc-700 bg-zinc-800/60 [@media(hover:hover)]:hover:bg-zinc-700/70 overflow-hidden transition-colors');
    card.setAttribute('aria-label', p.label);
    card.setAttribute('aria-pressed', 'false');
    card.title = `${p.label} — ${p.description}`;

    // Light tile = the bake's own render background (scripts/bake-character-presets.mjs).
    const thumbWrap = el('div', 'relative h-20 bg-[#f4f4f6] flex items-center justify-center');
    const strip = el('div', 'absolute inset-x-0 bottom-0 h-1.5 flex');
    for (const hex of [preset.colors.skin, preset.colors.hair, preset.colors.top, preset.colors.pants]) {
      const seg = el('span', 'flex-1');
      seg.style.background = hex;
      strip.appendChild(seg);
    }
    const img = el('img', 'h-full w-full object-contain');
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = assetPath(`/character-presets/${p.id}.webp`);
    img.addEventListener('error', () => { img.remove(); thumbWrap.prepend(fallbackFigure(preset)); });
    thumbWrap.append(img, strip);

    const text = el('div', 'px-1.5 py-1');
    const name = el('div', 'text-[12px] text-zinc-100 font-medium leading-tight truncate');
    name.textContent = p.label;
    const desc = el('div', 'text-[10px] text-zinc-400 leading-tight line-clamp-2');
    desc.textContent = p.description;
    text.append(name, desc);

    card.append(thumbWrap, text);
    card.addEventListener('click', () => { spec = p.patch(); markActive(p.id); rebuild(); preview({ immediate: true }); });
    cards.set(p.id, card);
    item.appendChild(card);
    presetList.appendChild(item);
  }
  body.append(presetHeader, presetList);

  // The controls live in a container we can wholesale-rebuild when a preset
  // replaces the entire spec (simpler than threading setters to every widget).
  const controls = el('div', 'flex flex-col gap-1.5');
  body.appendChild(controls);
  /** Collapsible sections the user has expanded (kept across rebuilds). */
  const openSections = new Set<string>();

  // The controls are generated from SPEC_FIELDS (characterPanelLayout.ts):
  // each field's `ui` metadata picks its section, control, range and
  // visibility. Only the controls below are hand-written.

  /** The generic control for a field: select / segmented / slider / toggle / swatch. */
  function controlRow(ctl: PanelControl): HTMLElement {
    const label = ctl.ui.label;
    const set = (v: unknown, immediate = false) => onEdit(s => applyControl(s, ctl, v), { immediate });
    const value = controlValue(spec, ctl);
    switch (ctl.kind) {
      case 'enum':
        if (ctl.ui.control === 'segmented') return segmentedRow(label, String(value), enumOptions(ctl), v => set(v, true));
        return selectRow(label, value === null ? '' : String(value), enumOptions(ctl), v => set(ctl.nullable && v === '' ? null : v));
      case 'num': {
        const [min, max, step] = ctl.ui.slider ?? [ctl.hardMin, ctl.hardMax, 0.01];
        return sliderRow(label, Number(value), min, max, step, v => set(v), { min: ctl.hardMin, max: ctl.hardMax });
      }
      case 'bool':
        return toggleRow(label, value === true, v => set(v));
      case 'color':
        return colorRow(label, String(value), v => set(v));
      default:
        throw new Error(`Character Creator: ${ctl.path} (${ctl.kind}) has no generic control — give it ui.custom`);
    }
  }

  /** Sets a reset group's nullable fields back to null (their style / fallback
   *  default); disabled while they already are. */
  function resetButton(r: NonNullable<PanelControl['resetAfter']>): HTMLElement {
    const atDefault = r.paths.every(p => getAt(spec, p) === null);
    const btn = el('button', `${BUTTON_SMALL_SECONDARY} self-end ${TOUCH}`);
    btn.type = 'button';
    btn.textContent = r.label;
    btn.disabled = atDefault;
    if (atDefault) btn.classList.add('opacity-50', 'cursor-not-allowed');
    btn.addEventListener('click', () => replaceAll(s => { for (const p of r.paths) setAt(s, p, null); }));
    return btn;
  }

  /** The print list editor: a card per print, plus add / remove. */
  function printEditor(): HTMLElement[] {
    const out: HTMLElement[] = [];
    spec.clothing.top.print.forEach((item, i) => {
      const card = el('div', 'flex flex-col gap-1.5 border-t border-zinc-700/60 pt-1.5');
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', `Print ${i + 1}`);
      const edit = (m: (p: typeof item) => void) => onEdit(s => { m(s.clothing.top.print[i]); });
      card.append(textRow('Text', item.text, 12,
        v => (isPrintableText(v) ? null : 'Print text: letters, numbers, punctuation, symbols or spaces only (and not blank).'),
        v => edit(p => { p.text = v; })));
      card.append(segmentedRow('Where', item.where, [['chest', 'Chest'], ['back', 'Back']], v => replaceAll(s => { s.clothing.top.print[i].where = v as typeof item.where; })));
      card.append(sliderRow('Size', item.size, 0.1, 2.5, 0.05, v => edit(p => { p.size = v; })));
      card.append(sliderRow('Sideways', item.x, -1.5, 1.5, 0.05, v => edit(p => { p.x = v; })));
      card.append(sliderRow('Up / down', item.z, -2, 2, 0.05, v => edit(p => { p.z = v; })));
      card.append(selectRow('Font', item.font, PRINT_FONTS.map(f => [f, humanize(f)] as [string, string]), v => edit(p => { p.font = v as typeof item.font; })));
      card.append(colorRow('Colour', item.color, v => edit(p => { p.color = v; })));
      const remove = el('button', `${BUTTON_SMALL_SECONDARY} self-end ${TOUCH}`);
      remove.type = 'button';
      remove.textContent = 'Remove print';
      remove.addEventListener('click', () => replaceAll(s => { s.clothing.top.print.splice(i, 1); }));
      card.append(remove);
      out.push(card);
    });
    if (!spec.clothing.top.on) {
      const note = el('div', 'text-[11px] text-zinc-500');
      note.textContent = 'Prints need a top — turn Top on above.';
      out.push(note);
    }
    if (spec.clothing.top.print.length < 6) {
      const add = el('button', `${BUTTON_SMALL_SECONDARY} self-start ${TOUCH}`);
      add.type = 'button';
      add.textContent = '+ Add print';
      add.addEventListener('click', () => {
        openSections.add('print');
        replaceAll(s => {
          const first = s.clothing.top.print.length === 0;
          s.clothing.top.print.push({ ...PRINT_DEFAULT, ...(first ? {} : { where: 'back' as const, size: 1 }) });
        });
      });
      out.push(add);
    }
    return out;
  }

  /** Hand-written controls, keyed by the `ui.custom` id their field names.
   *  A Record over CustomControlId, so a new id can't ship without one. */
  const CUSTOM: Record<CustomControlId, (ctl: PanelControl) => HTMLElement | HTMLElement[]> = {
    // Switching style applies the style's head / body / face defaults.
    proportions: ctl => segmentedRow(ctl.ui.label, spec.body.proportions, PROPORTIONS.map(p => [p, humanize(p)] as [string, string]),
      v => replaceAll(s => applyStyle(s, v as Proportions))),
    // A multiplier on the CURRENT head scale (keeps a custom width/depth/height
    // ratio); 1× of the style default clears it to null.
    headSize: ctl => {
      const styleHs = STYLE_DEFAULTS[spec.body.proportions].headScale;
      const curHs = resolvedHeadScale(spec);
      return sliderRow(ctl.ui.label, round3(curHs.z / styleHs.z), 0.5, 1.6, 0.05, v => onEdit(s => {
        const now = resolvedHeadScale(s);
        const k = (v * styleHs.z) / now.z;
        const next = { x: round3(now.x * k), y: round3(now.y * k), z: round3(now.z * k) };
        const isStyleDefault = next.x === styleHs.x && next.y === styleHs.y && next.z === styleHs.z;
        s.body.headScale = isStyleDefault ? null : next;
      }), { min: 0.2, max: 4 });
    },
    // A named pose replaces every joint (the sliders then fine-tune it).
    posePreset: ctl => selectRow(ctl.ui.label, spec.pose.preset,
      Object.keys(POSE_PRESETS).map(k => [k, POSE_PRESET_LABELS[k] ?? humanize(k)] as [string, string]),
      v => replaceAll(s => { s.pose = POSE_PRESETS[v](); })),
    printList: () => printEditor(),
  };

  function rebuild(): void {
    controls.replaceChildren();
    for (const sec of panelLayout(spec)) {
      let host: HTMLElement = controls;
      if (sec.collapsible) {
        const c = collapsible(sec.id, sec.title, openSections);
        controls.append(c.wrap);
        host = c.body;
      } else {
        controls.append(sectionTitle(sec.title));
      }
      for (const ctl of sec.controls) {
        const made = ctl.ui.custom ? CUSTOM[ctl.ui.custom](ctl) : controlRow(ctl);
        host.append(...(Array.isArray(made) ? made : [made]));
        if (ctl.resetAfter) host.append(resetButton(ctl.resetAfter));
      }
    }
    shownKey = layoutKey(spec);
  }

  rebuild();

  // --- Footer: Save ---
  const saveBtn = el('button', BUTTON_PRIMARY);
  saveBtn.textContent = 'Save to session';
  saveBtn.addEventListener('click', async () => {
    if (saving) return;
    // Hold previews off from here on — including while the confirm dialog is
    // open — and drop a pending debounced one: it would fire mid-save and
    // cancel the save's build, leaving the stale preview mesh behind.
    saving = true;
    window.clearTimeout(timer);
    const prev = saveBtn.textContent;
    try {
      if (!(await confirmClobber())) return;
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving…';
      const r = await api.buildCharacter(spec, { save: true });
      if (r.error) showToast(r.error, { variant: 'warn', source: 'character' });
      else showToast('Character saved as a new version', { variant: 'success', source: 'character' });
    } finally {
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = prev;
      // An edit made during the save isn't in the saved version — show it now.
      if (previewAfterSave && !closed) { previewAfterSave = false; preview({ immediate: true }); }
    }
  });
  // A handed-in spec opens unbuilt: offer an explicit Preview beside Save.
  if (initialSpec) {
    const previewBtn = el('button', BUTTON_SMALL_SECONDARY);
    previewBtn.textContent = 'Preview';
    previewBtn.title = 'Build this character in the viewport (does not save)';
    previewBtn.addEventListener('click', () => preview({ immediate: true }));
    shell.footer.appendChild(previewBtn);
  }
  shell.footer.appendChild(saveBtn);

  // Auto-preview on open only when it can't clobber unsaved work: an existing
  // character (already on screen — just refresh) or an empty editor. Never for
  // a handed-in spec — the user decides when to build it.
  if (!initialSpec && (existing || currentCodeEmpty)) preview();
  return { applied: initialSpec ? { spec: cloneSpec(initialSpec) } : {}, ignored: [] };
}

/** Wire the Character Creator into the command palette and the Tools menu. */
export function initCharacterCreatorUI(api: CharacterCreatorApi): void {
  registerTool({
    id: 'character-creator',
    title: 'Character Creator',
    hint: 'Figure',
    prefillSchema: {
      spec: { type: 'object', description: 'Character Creator spec (same shape as buildCharacter; partial specs merge onto the default). Shown unbuilt.' },
    },
    open: (prefill, ctx) => openCharacterCreatorPanel(api, { spec: prefill?.spec, note: ctx.note, source: ctx.source }),
    getState: () => (currentSpec ? { spec: cloneSpec(currentSpec()) } : null),
    isOpen: () => openClose !== null,
    close: () => openClose?.(),
  });
  registerCommands([
    {
      id: 'character-creator',
      title: 'Character Creator',
      hint: 'Figure',
      keywords: 'character creator figure person human body pose face hair clothing avatar mannequin doll people sdf',
      run: () => { void openTool('character-creator'); },
    },
  ]);

  const mount = () => {
    if (document.getElementById('character-viewport-toggle')) return;
    const styleRef = document.getElementById('paint-toggle');
    const host = document.getElementById('viewport-tools-menu') ?? styleRef?.parentElement;
    if (!host) return;
    const btnCls = (styleRef?.className ?? '').split(' ').filter(c => c !== 'hidden').join(' ') || BUTTON_SMALL_SECONDARY;
    const btn = el('button', btnCls);
    btn.id = 'character-viewport-toggle';
    btn.textContent = '🧍 Character';
    btn.title = 'Create a posed, painted human figure with no code';
    btn.addEventListener('click', () => openCharacterCreatorPanel(api));
    host.appendChild(btn);
  };
  let tries = 0;
  const timer = setInterval(() => {
    mount();
    if (document.getElementById('character-viewport-toggle') || ++tries > 20) clearInterval(timer);
  }, 250);
  mount();
}
