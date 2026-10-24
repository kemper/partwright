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
import {
  type CharacterSpec,
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
  LOCK_HAIR_STYLES,
  BUILDS, SEXES, FACE_SHAPES, LID_STYLES, NOSE_TYPES, LIP_SHAPES, BROW_SHAPES,
  HAIR_LENGTHS, LOCK_SHAPES, HAIR_CROWNS, SLEEVES, PANTS_RISES, PRINT_FONTS,
  PRINT_DEFAULT, isPrintableText,
} from '../figure/characterSpec';

/** The slice of the console API the panel drives. */
export interface CharacterCreatorApi {
  /** Generate figure code from a spec, run it (and, when `save`, commit a
   *  version). Returns the generated code plus the run/save result. */
  buildCharacter(spec: CharacterSpec, opts?: { save?: boolean }): Promise<{ code: string; error?: string; version?: unknown }>;
  /** Current editor code (to restore the spec when re-opening). */
  getCode(): string;
}

let openClose: (() => void) | null = null;

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

const CUP_OPTS: [string, string][] = [['', 'Same as both'], ['sides', 'On the side'], ['under', 'Cradled under']];

// Friendly option label maps for the enums that read poorly raw.
const HAIR_STYLES: [string, string][] = [
  ['bald', 'Bald'], ['short', 'Short'], ['long', 'Long'], ['bob', 'Bob'], ['bun', 'Bun'],
  ['bangs', 'Bangs'], ['ponytail', 'Ponytail'], ['afro', 'Afro'], ['braids', 'Braids'],
  ['spiked', 'Spiked'], ['locs', 'Locs'], ['cornrows', 'Cornrows'], ['boxBraids', 'Box braids'],
  ['mop', 'Mop (shaggy locks)'], ['anime', 'Anime (ribbon locks)'], ['shag', 'Shag (layered mop)'],
  ['captured', 'Captured (Tsubasa)'],
];
const STYLES: [Proportions, string][] = [['realistic', 'Realistic'], ['chibi', 'Chibi'], ['funko', 'Funko']];
const round3 = (v: number): number => Math.round(v * 1000) / 1000;
const EXPRESSIONS: [string, string][] = [
  ['bigSmile', 'Big smile'], ['smile', 'Smile'], ['slightSmile', 'Slight smile'],
  ['neutral', 'Neutral'], ['slightFrown', 'Slight frown'], ['frown', 'Frown'], ['deepFrown', 'Deep frown'],
];

export function openCharacterCreatorPanel(api: CharacterCreatorApi): void {
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
    onClose: () => { closed = true; window.clearTimeout(timer); },
  });
  openClose = shell.close;

  // Restore the spec from the current code if it was made here; otherwise start
  // from the default (and remember whether it's safe to auto-preview on open).
  const existing = decodeSpecComment(api.getCode());
  let spec: CharacterSpec = existing ? existing : cloneSpec(DEFAULT_SPEC);
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

  // A change handler that mutates the spec then re-previews.
  const onEdit = (mutate: (s: CharacterSpec) => void): void => { mutate(spec); preview(); };

  const body = shell.body;

  // --- Quick presets ---
  const presetWrap = el('div', 'flex flex-wrap gap-1');
  presetWrap.setAttribute('role', 'group');
  presetWrap.setAttribute('aria-label', 'Character presets');
  for (const p of CHARACTER_PRESETS) {
    const b = el('button', `${BUTTON_SMALL_SECONDARY} ${TOUCH}`);
    b.textContent = p.label;
    b.addEventListener('click', () => { spec = p.patch(); rebuild(); preview({ immediate: true }); });
    presetWrap.appendChild(b);
  }
  body.append(sectionTitle('Start from a preset'), presetWrap);

  // The controls live in a container we can wholesale-rebuild when a preset
  // replaces the entire spec (simpler than threading setters to every widget).
  const controls = el('div', 'flex flex-col gap-1.5');
  body.appendChild(controls);
  /** Collapsible sections the user has expanded (kept across rebuilds). */
  const openSections = new Set<string>();

  function rebuild(): void {
    controls.replaceChildren();

    // --- STYLE --- switching applies the style's head/body/face defaults.
    controls.append(sectionTitle('Style'));
    controls.append(segmentedRow('Proportions', spec.body.proportions, STYLES, v => {
      applyStyle(spec, v as Proportions);
      rebuild();
      preview({ immediate: true });
    }));
    // Head size: a multiplier on the CURRENT head scale (keeps a custom
    // width/depth/height ratio); 1× of the style default clears it to null.
    const styleHs = STYLE_DEFAULTS[spec.body.proportions].headScale;
    const curHs = resolvedHeadScale(spec);
    controls.append(sliderRow('Head size', round3(curHs.z / styleHs.z), 0.5, 1.6, 0.05, v => onEdit(s => {
      const now = resolvedHeadScale(s);
      const k = (v * styleHs.z) / now.z;
      const next = { x: round3(now.x * k), y: round3(now.y * k), z: round3(now.z * k) };
      const isStyleDefault = next.x === styleHs.x && next.y === styleHs.y && next.z === styleHs.z;
      s.body.headScale = isStyleDefault ? null : next;
    }), { min: 0.2, max: 4 }));

    // --- BODY ---
    controls.append(sectionTitle('Body'));
    controls.append(sliderRow('Height', spec.body.height, 24, 90, 1, v => onEdit(s => { s.body.height = v; }), { min: 1, max: Infinity }));
    controls.append(sliderRow('Heads tall', spec.body.headsTall, 2.5, 9, 0.5, v => onEdit(s => { s.body.headsTall = v; }), { min: 2, max: 12 }));
    controls.append(selectRow('Build', spec.body.build, BUILDS, v => onEdit(s => { s.body.build = v as CharacterSpec['body']['build']; })));
    controls.append(selectRow('Sex', spec.body.sex, SEXES, v => onEdit(s => { s.body.sex = v as CharacterSpec['body']['sex']; })));
    controls.append(sliderRow('Age', spec.body.age, 1, 90, 1, v => onEdit(s => { s.body.age = v; })));
    controls.append(sliderRow('Weight', spec.body.weight, 0, 1, 0.05, v => onEdit(s => { s.body.weight = v; })));
    controls.append(sliderRow('Muscle', spec.body.muscle, 0, 1, 0.05, v => onEdit(s => { s.body.muscle = v; })));
    controls.append(sliderRow('Bust', spec.body.bust, 0, 2, 0.05, v => onEdit(s => { s.body.bust = v; })));
    controls.append(sliderRow('Belly', spec.body.belly, 0, 2, 0.05, v => onEdit(s => { s.body.belly = v; })));

    // --- POSE ---
    controls.append(sectionTitle('Pose'));
    const posePresetOpts = Object.keys(POSE_PRESETS).map(k => [k, POSE_PRESET_LABELS[k] ?? k] as [string, string]);
    controls.append(selectRow('Preset', spec.pose.preset, posePresetOpts, v => {
      spec.pose = POSE_PRESETS[v]();
      rebuild();
      preview({ immediate: true });
    }));
    const jointSlider = (label: string, get: () => number, set: (n: number) => void, min: number, max: number) =>
      controls.append(sliderRow(label, get(), min, max, 1, v => onEdit(() => set(v))));
    const holding = spec.pose.hold.kind === 'ball';
    // A held ball solves both arms, so the arm sliders only show without one.
    if (!holding) {
      jointSlider('Arms out', () => spec.pose.armL.raiseSide, n => { spec.pose.armL.raiseSide = n; spec.pose.armR.raiseSide = n; }, -30, 170);
      jointSlider('Arm bend', () => spec.pose.armL.bend, n => { spec.pose.armL.bend = n; spec.pose.armR.bend = n; }, 0, 150);
    }
    jointSlider('Legs apart', () => spec.pose.legL.raiseSide, n => { spec.pose.legL.raiseSide = n; spec.pose.legR.raiseSide = n; }, -10, 60);
    jointSlider('Head turn', () => spec.pose.head.yaw, n => { spec.pose.head.yaw = n; }, -60, 60);
    jointSlider('Head tilt', () => spec.pose.head.roll, n => { spec.pose.head.roll = n; }, -30, 30);
    jointSlider('Lean', () => spec.pose.spine.lean, n => { spec.pose.spine.lean = n; }, -25, 25);
    controls.append(segmentedRow('Holding', spec.pose.hold.kind, [['none', 'Nothing'], ['ball', 'Ball']], v => {
      spec.pose.hold.kind = v as CharacterSpec['pose']['hold']['kind'];
      // Size a fresh ball to the figure (≈ a tenth of its height).
      if (v === 'ball' && spec.pose.hold.radius === DEFAULT_SPEC.pose.hold.radius) {
        spec.pose.hold.radius = Math.max(1, Math.round(spec.body.height * 0.1 * 2) / 2);
      }
      rebuild();
      preview({ immediate: true });
    }));
    if (holding) {
      controls.append(sliderRow('Ball size', spec.pose.hold.radius, 2, 30, 0.5, v => onEdit(s => { s.pose.hold.radius = v; }), { min: 0.1, max: Infinity }));
      controls.append(selectRow('Hands', spec.pose.hold.cup, [['sides', 'On the sides'], ['under', 'Cradled under']], v => onEdit(s => { s.pose.hold.cup = v as CharacterSpec['pose']['hold']['cup']; })));
      controls.append(selectRow('Left hand', spec.pose.hold.cupL ?? '', CUP_OPTS, v => onEdit(s => { s.pose.hold.cupL = (v || null) as CharacterSpec['pose']['hold']['cupL']; })));
      controls.append(selectRow('Right hand', spec.pose.hold.cupR ?? '', CUP_OPTS, v => onEdit(s => { s.pose.hold.cupR = (v || null) as CharacterSpec['pose']['hold']['cupR']; })));
      controls.append(sliderRow('Hand size', spec.pose.hold.handScale, 0.5, 2.5, 0.05, v => onEdit(s => { s.pose.hold.handScale = v; })));
      controls.append(colorRow('Ball', spec.colors.ball, v => onEdit(s => { s.colors.ball = v; })));
      controls.append(colorRow('Ball panels', spec.pose.hold.color, v => onEdit(s => { s.pose.hold.color = v; })));
    }

    // --- FACE ---
    controls.append(sectionTitle('Face'));
    controls.append(selectRow('Shape', spec.face.shape, FACE_SHAPES, v => onEdit(s => { s.face.shape = v as CharacterSpec['face']['shape']; })));
    controls.append(selectRow('Eyelids', spec.face.lids, LID_STYLES, v => onEdit(s => { s.face.lids = v as CharacterSpec['face']['lids']; })));
    controls.append(selectRow('Gaze', spec.face.gaze, ['center', 'middle', 'left', 'right', 'up', 'down'], v => onEdit(s => { s.face.gaze = v as CharacterSpec['face']['gaze']; })));
    controls.append(selectRow('Nose', spec.face.nose, NOSE_TYPES, v => onEdit(s => { s.face.nose = v as CharacterSpec['face']['nose']; })));
    controls.append(selectRow('Mouth', spec.face.expression, EXPRESSIONS, v => onEdit(s => { s.face.expression = v as CharacterSpec['face']['expression']; })));
    controls.append(selectRow('Lips', spec.face.lipShape, LIP_SHAPES, v => onEdit(s => { s.face.lipShape = v as CharacterSpec['face']['lipShape']; })));
    controls.append(selectRow('Brows', spec.face.brows, BROW_SHAPES, v => onEdit(s => { s.face.brows = v as CharacterSpec['face']['brows']; })));
    controls.append(selectRow('Ears', spec.face.ears, ['detailed', 'round', 'pointed'], v => onEdit(s => { s.face.ears = v as CharacterSpec['face']['ears']; })));
    controls.append(sliderRow('Eye size', spec.face.eyeSize, 0.5, 3, 0.05, v => onEdit(s => { s.face.eyeSize = v; })));
    // Eye layout: a null field shows (and means) the style default.
    const styleLayout = STYLE_DEFAULTS[spec.body.proportions].faceLayout;
    controls.append(sliderRow('Eye spacing', spec.face.layout.eyeSpread ?? styleLayout.eyeSpread, 0.5, 2, 0.05, v => onEdit(s => { s.face.layout.eyeSpread = v; })));
    controls.append(sliderRow('Eye height', spec.face.layout.eyeHeight ?? styleLayout.eyeHeight, -0.6, 0.6, 0.01, v => onEdit(s => { s.face.layout.eyeHeight = v; })));
    // Back to the style's own eye layout (null fields = the style default).
    const layoutIsDefault = spec.face.layout.eyeSpread === null && spec.face.layout.eyeHeight === null;
    const resetEyes = el('button', `${BUTTON_SMALL_SECONDARY} self-end ${TOUCH}`);
    resetEyes.type = 'button';
    resetEyes.textContent = 'Reset eye layout';
    resetEyes.title = 'Put the eye spacing and height back to this style\'s default';
    resetEyes.disabled = layoutIsDefault;
    if (layoutIsDefault) resetEyes.classList.add('opacity-50', 'cursor-not-allowed');
    resetEyes.addEventListener('click', () => {
      spec.face.layout = { eyeSpread: null, eyeHeight: null };
      rebuild();
      preview({ immediate: true });
    });
    controls.append(resetEyes);
    controls.append(toggleRow('Show mouth', spec.face.mouth, v => onEdit(s => { s.face.mouth = v; })));

    // Face + body details (vinyl-toy knobs), collapsed by default.
    const det = collapsible('details', 'Face & body details', openSections);
    controls.append(det.wrap);
    const bead = spec.face.eyeStyle === 'bead';
    det.body.append(segmentedRow('Eye style', spec.face.eyeStyle, [['iris', 'Iris'], ['bead', 'Bead']], v => {
      spec.face.eyeStyle = v as CharacterSpec['face']['eyeStyle'];
      rebuild();   // show/hide the bead knobs
      preview({ immediate: true });
    }));
    if (bead) {
      det.body.append(sliderRow('Bead shape', spec.face.eyeAspect, 0.5, 2, 0.02, v => onEdit(s => { s.face.eyeAspect = v; })));
      det.body.append(sliderRow('Glint', spec.face.highlight, 0, 3, 0.1, v => onEdit(s => { s.face.highlight = v; })));
    }
    det.body.append(sliderRow('Brow weight', spec.face.browThickness, 0.1, 5, 0.1, v => onEdit(s => { s.face.browThickness = v; })));
    det.body.append(sliderRow('Brow width', spec.face.browWidth, 0.3, 2, 0.05, v => onEdit(s => { s.face.browWidth = v; })));
    det.body.append(sliderRow('Jaw', spec.face.jaw, 0.5, 1.6, 0.05, v => onEdit(s => { s.face.jaw = v; })));
    det.body.append(sliderRow('Chin', spec.face.chin, 0.5, 1.6, 0.05, v => onEdit(s => { s.face.chin = v; })));
    det.body.append(sliderRow('Cheeks', spec.face.cheek, 0.3, 1.8, 0.05, v => onEdit(s => { s.face.cheek = v; })));
    det.body.append(sliderRow('Head sink', spec.body.headSink, 0, 1.5, 0.02, v => onEdit(s => { s.body.headSink = v; })));
    det.body.append(toggleRow('Mitten hands', spec.body.mittens, v => onEdit(s => { s.body.mittens = v; })));

    // --- HAIR ---
    controls.append(sectionTitle('Hair'));
    controls.append(selectRow('Style', spec.hair.style, HAIR_STYLES, v => {
      spec.hair.style = v as CharacterSpec['hair']['style'];
      rebuild();   // show/hide the lock knobs for the new style
      preview();
    }));
    controls.append(selectRow('Length', spec.hair.length, HAIR_LENGTHS, v => onEdit(s => { s.hair.length = v as CharacterSpec['hair']['length']; })));
    controls.append(sliderRow('Volume', spec.hair.volume, 0.3, 4, 0.1, v => onEdit(s => { s.hair.volume = v; })));
    // Lock knobs — only for the lock styles that read them (mop / anime / shag).
    if (LOCK_HAIR_STYLES.includes(spec.hair.style)) {
      if (spec.hair.style === 'anime') {
        controls.append(selectRow('Lock shape', spec.hair.lockShape, LOCK_SHAPES.map(s => [s, s === 'ribbon' ? 'Flat ribbon' : 'Round tube'] as [string, string]), v => onEdit(s => { s.hair.lockShape = v as CharacterSpec['hair']['lockShape']; })));
        controls.append(sliderRow('Lock width', spec.hair.chunk, 0.4, 2.5, 0.05, v => onEdit(s => { s.hair.chunk = v; })));
        controls.append(sliderRow('Spike', spec.hair.spike, 0, 3, 0.05, v => onEdit(s => { s.hair.spike = v; })));
        controls.append(sliderRow('Swoop', spec.hair.swoop, -1, 3, 0.05, v => onEdit(s => { s.hair.swoop = v; })));
      }
      if (spec.hair.style === 'shag') {
        controls.append(selectRow('Crown', spec.hair.crown, HAIR_CROWNS.map(c => [c, c === 'spiky' ? 'Spiky' : 'Tousled'] as [string, string]), v => onEdit(s => { s.hair.crown = v as CharacterSpec['hair']['crown']; })));
        controls.append(sliderRow('Spike', spec.hair.spike, 0, 3, 0.05, v => onEdit(s => { s.hair.spike = v; })));
        controls.append(sliderRow('Layers', spec.hair.layers, 1, 3, 1, v => onEdit(s => { s.hair.layers = v; })));
        controls.append(sliderRow('Raggedness', spec.hair.raggedness, 0, 2, 0.05, v => onEdit(s => { s.hair.raggedness = v; })));
        controls.append(sliderRow('Flare', spec.hair.flare, 0, 3, 0.05, v => onEdit(s => { s.hair.flare = v; })));
        controls.append(sliderRow('Lock width', spec.hair.chunk, 0.4, 2.5, 0.05, v => onEdit(s => { s.hair.chunk = v; })));
        controls.append(sliderRow('Crown size', spec.hair.crownSize, 0.3, 2.5, 0.05, v => onEdit(s => { s.hair.crownSize = v; })));
        controls.append(sliderRow('Back width', spec.hair.backWidth, 0.3, 1.6, 0.05, v => onEdit(s => { s.hair.backWidth = v; })));
        controls.append(sliderRow('Tip width', spec.hair.tipWidth, 0, 0.8, 0.05, v => onEdit(s => { s.hair.tipWidth = v; })));
        controls.append(toggleRow('Notched fringe', spec.hair.notched, v => onEdit(s => { s.hair.notched = v; })));
      }
      controls.append(sliderRow('Fringe', spec.hair.fringe, 0, 1.5, 0.05, v => onEdit(s => { s.hair.fringe = v; })));
      controls.append(sliderRow('Seed', spec.hair.seed, 1, 50, 1, v => onEdit(s => { s.hair.seed = v; }), { min: -1e6, max: 1e6 }));
    }
    // Captured hair: the replay knobs (the captured fringe floor is 0.3).
    if (spec.hair.style === 'captured') {
      controls.append(sliderRow('Spikiness', spec.hair.spikiness, 0, 3, 0.05, v => onEdit(s => { s.hair.spikiness = v; })));
      controls.append(sliderRow('Smooth', spec.hair.smooth, 0, 1, 0.05, v => onEdit(s => { s.hair.smooth = v; })));
      controls.append(sliderRow('Fringe', spec.hair.capturedFringe, 0.3, 2, 0.05, v => onEdit(s => { s.hair.capturedFringe = v; })));
      controls.append(sliderRow('Tilt', spec.hair.tilt, -40, 40, 1, v => onEdit(s => { s.hair.tilt = v; })));
      controls.append(sliderRow('Face window', spec.hair.windowScale, 0.5, 2, 0.05, v => onEdit(s => { s.hair.windowScale = v; })));
      controls.append(toggleRow('Mirror', spec.hair.mirror, v => onEdit(s => { s.hair.mirror = v; })));
    }

    // --- CLOTHING ---
    controls.append(sectionTitle('Clothing'));
    controls.append(toggleRow('Top', spec.clothing.top.on, v => onEdit(s => { s.clothing.top.on = v; })));
    controls.append(selectRow('Sleeve', spec.clothing.top.sleeve, SLEEVES, v => onEdit(s => { s.clothing.top.sleeve = v as CharacterSpec['clothing']['top']['sleeve']; })));
    controls.append(selectRow('Top length', spec.clothing.top.length, [['shirt', 'Shirt'], ['dress', 'Dress']], v => onEdit(s => { s.clothing.top.length = v as CharacterSpec['clothing']['top']['length']; })));
    controls.append(toggleRow('Pants', spec.clothing.pants.on, v => onEdit(s => { s.clothing.pants.on = v; })));
    controls.append(selectRow('Pants length', spec.clothing.pants.length, [['full', 'Full'], ['shorts', 'Shorts (knee)'], ['briefs', 'Briefs']], v => {
      spec.clothing.pants.length = v as CharacterSpec['clothing']['pants']['length'];
      rebuild();   // show/hide the hem slider
      preview();
    }));
    if (spec.clothing.pants.length === 'shorts') {
      controls.append(sliderRow('Shorts hem', spec.clothing.pants.hem, 0.2, 1.2, 0.02, v => onEdit(s => { s.clothing.pants.hem = v; })));
    }
    controls.append(selectRow('Pants rise', spec.clothing.pants.rise, PANTS_RISES, v => onEdit(s => { s.clothing.pants.rise = v as CharacterSpec['clothing']['pants']['rise']; })));
    controls.append(toggleRow('Footwear', spec.clothing.feet.on, v => onEdit(s => { s.clothing.feet.on = v; })));
    controls.append(selectRow('Footwear kind', spec.clothing.feet.kind, [['shoes', 'Shoes'], ['boots', 'Boots']], v => onEdit(s => { s.clothing.feet.kind = v as CharacterSpec['clothing']['feet']['kind']; })));
    controls.append(toggleRow('Stand / base', spec.base, v => onEdit(s => { s.base = v; })));

    // Kit details: trim, socks, toy shoes — collapsed by default.
    const kit = collapsible('kit', 'Kit details', openSections);
    controls.append(kit.wrap);
    const k = kit.body;
    k.append(toggleRow('Collar trim', spec.clothing.top.trim.collar, v => onEdit(s => { s.clothing.top.trim.collar = v; })));
    k.append(toggleRow('Cuff trim', spec.clothing.top.trim.cuffs, v => onEdit(s => { s.clothing.top.trim.cuffs = v; })));
    k.append(toggleRow('Socks', spec.clothing.socks.on, v => { spec.clothing.socks.on = v; rebuild(); preview(); }));
    if (spec.clothing.socks.on) {
      k.append(sliderRow('Sock height', spec.clothing.socks.height, 0.2, 1.4, 0.02, v => onEdit(s => { s.clothing.socks.height = v; })));
      k.append(sliderRow('Sock stripes', spec.clothing.socks.stripes, 0, 12, 1, v => onEdit(s => { s.clothing.socks.stripes = v; })));
      k.append(sliderRow('Stripe span', spec.clothing.socks.stripeSpan, 0.05, 1.4, 0.01, v => onEdit(s => { s.clothing.socks.stripeSpan = v; })));
    }
    const toy = spec.clothing.feet.kind === 'shoes' && spec.clothing.feet.style === 'toy';
    if (spec.clothing.feet.kind === 'shoes') {
      k.append(segmentedRow('Shoe style', spec.clothing.feet.style, [['fitted', 'Fitted'], ['toy', 'Toy']], v => {
        spec.clothing.feet.style = v as CharacterSpec['clothing']['feet']['style'];
        rebuild();   // show/hide the toy-only knobs
        preview({ immediate: true });
      }));
    }
    k.append(sliderRow('Shoe size', spec.clothing.feet.size, 0.5, 2, 0.05, v => onEdit(s => { s.clothing.feet.size = v; })));
    if (toy) {
      k.append(sliderRow('Shoe height', spec.clothing.feet.height, 0.4, 2.5, 0.05, v => onEdit(s => { s.clothing.feet.height = v; })));
      k.append(sliderRow('Cleats', spec.clothing.feet.cleats, 0, 12, 1, v => onEdit(s => { s.clothing.feet.cleats = v; })));
    }

    // Print: lettering / numbers on the top (F.emboss), collapsed by default.
    const pr = collapsible('print', `Print${spec.clothing.top.print.length ? ` (${spec.clothing.top.print.length})` : ''}`, openSections);
    controls.append(pr.wrap);
    spec.clothing.top.print.forEach((item, i) => {
      const card = el('div', 'flex flex-col gap-1.5 border-t border-zinc-700/60 pt-1.5');
      card.setAttribute('role', 'group');
      card.setAttribute('aria-label', `Print ${i + 1}`);
      const edit = (m: (p: typeof item) => void) => onEdit(s => { m(s.clothing.top.print[i]); });
      card.append(textRow('Text', item.text, 12,
        v => (isPrintableText(v) ? null : 'Print text: letters, numbers, punctuation, symbols or spaces only (and not blank).'),
        v => edit(p => { p.text = v; })));
      card.append(segmentedRow('Where', item.where, [['chest', 'Chest'], ['back', 'Back']], v => { spec.clothing.top.print[i].where = v as typeof item.where; rebuild(); preview(); }));
      card.append(sliderRow('Size', item.size, 0.1, 2.5, 0.05, v => edit(p => { p.size = v; })));
      card.append(sliderRow('Sideways', item.x, -1.5, 1.5, 0.05, v => edit(p => { p.x = v; })));
      card.append(sliderRow('Up / down', item.z, -2, 2, 0.05, v => edit(p => { p.z = v; })));
      card.append(selectRow('Font', item.font, PRINT_FONTS, v => edit(p => { p.font = v as typeof item.font; })));
      card.append(colorRow('Colour', item.color, v => edit(p => { p.color = v; })));
      const remove = el('button', `${BUTTON_SMALL_SECONDARY} self-end ${TOUCH}`);
      remove.type = 'button';
      remove.textContent = 'Remove print';
      remove.addEventListener('click', () => { spec.clothing.top.print.splice(i, 1); rebuild(); preview({ immediate: true }); });
      card.append(remove);
      pr.body.append(card);
    });
    if (!spec.clothing.top.on) {
      const note = el('div', 'text-[11px] text-zinc-500');
      note.textContent = 'Prints need a top — turn Top on above.';
      pr.body.append(note);
    }
    if (spec.clothing.top.print.length < 6) {
      const add = el('button', `${BUTTON_SMALL_SECONDARY} self-start ${TOUCH}`);
      add.type = 'button';
      add.textContent = '+ Add print';
      add.addEventListener('click', () => {
        const first = spec.clothing.top.print.length === 0;
        spec.clothing.top.print.push({ ...PRINT_DEFAULT, ...(first ? {} : { where: 'back' as const, size: 1 }) });
        openSections.add('print');
        rebuild();
        preview({ immediate: true });
      });
      pr.body.append(add);
    }

    // --- COLOURS ---
    controls.append(sectionTitle('Colours'));
    const colorKeys: [keyof CharacterSpec['colors'], string][] = [
      ['skin', 'Skin'], ['hair', 'Hair'], ['eyes', 'Eye white'], ['iris', 'Iris'], ['pupil', 'Pupil'],
      ['lips', 'Lips'], ['brows', 'Brows'], ['top', 'Top'], ['pants', 'Pants'], ['feet', 'Footwear'], ['base', 'Base'],
      ['trim', 'Trim'], ['socks', 'Socks'], ['sockStripe', 'Sock stripes'], ['eyeHighlight', 'Eye glint'],
    ];
    for (const [key, label] of colorKeys) {
      controls.append(colorRow(label, spec.colors[key] ?? spec.colors.feet, v => onEdit(s => { s.colors[key] = v; })));
    }
    // Sole: null = the footwear colour until picked; the button returns to that.
    controls.append(colorRow('Sole', spec.colors.sole ?? spec.colors.feet, v => onEdit(s => { s.colors.sole = v; })));
    if (spec.colors.sole !== null) {
      const sameAsShoes = el('button', `${BUTTON_SMALL_SECONDARY} self-end ${TOUCH}`);
      sameAsShoes.type = 'button';
      sameAsShoes.textContent = 'Sole: same as footwear';
      sameAsShoes.addEventListener('click', () => { spec.colors.sole = null; rebuild(); preview({ immediate: true }); });
      controls.append(sameAsShoes);
    }
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
  shell.footer.appendChild(saveBtn);

  // Auto-preview on open only when it can't clobber unsaved work: an existing
  // character (already on screen — just refresh) or an empty editor.
  if (existing || currentCodeEmpty) preview();
}

/** Wire the Character Creator into the command palette and the Tools menu. */
export function initCharacterCreatorUI(api: CharacterCreatorApi): void {
  registerCommands([
    {
      id: 'character-creator',
      title: 'Character Creator',
      hint: 'Figure',
      keywords: 'character creator figure person human body pose face hair clothing avatar mannequin doll people sdf',
      run: () => openCharacterCreatorPanel(api),
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
