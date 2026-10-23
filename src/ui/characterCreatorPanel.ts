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
  HAIR_LENGTHS, LOCK_SHAPES, HAIR_CROWNS, SLEEVES, PANTS_RISES,
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
  const sel = el('select', 'bg-zinc-900 border border-zinc-600 rounded px-1.5 py-0.5 text-[12px] text-zinc-100 min-w-[7.5rem]');
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
    inputClass: 'w-12 bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-[11px] text-right tabular-nums text-zinc-200',
  });
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
    className: 'w-8 h-6 shrink-0 rounded border border-zinc-600 hover:border-white/70 cursor-pointer transition-colors',
    onPick: (hex) => onChange(hex),
  });
  return labelledRow(label, swatch.el);
}

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
  const input = el('input', 'accent-blue-500 w-4 h-4');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
  return labelledRow(label, input);
}

// Friendly option label maps for the enums that read poorly raw.
const HAIR_STYLES: [string, string][] = [
  ['bald', 'Bald'], ['short', 'Short'], ['long', 'Long'], ['bob', 'Bob'], ['bun', 'Bun'],
  ['bangs', 'Bangs'], ['ponytail', 'Ponytail'], ['afro', 'Afro'], ['braids', 'Braids'],
  ['spiked', 'Spiked'], ['locs', 'Locs'], ['cornrows', 'Cornrows'], ['boxBraids', 'Box braids'],
  ['mop', 'Mop (shaggy locks)'], ['anime', 'Anime (ribbon locks)'], ['shag', 'Shag (layered mop)'],
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
    const fire = async () => {
      if (closed) return;
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
    const b = el('button', BUTTON_SMALL_SECONDARY);
    b.textContent = p.label;
    b.addEventListener('click', () => { spec = p.patch(); rebuild(); preview({ immediate: true }); });
    presetWrap.appendChild(b);
  }
  body.append(sectionTitle('Start from a preset'), presetWrap);

  // The controls live in a container we can wholesale-rebuild when a preset
  // replaces the entire spec (simpler than threading setters to every widget).
  const controls = el('div', 'flex flex-col gap-1.5');
  body.appendChild(controls);

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
    controls.append(toggleRow('Show mouth', spec.face.mouth, v => onEdit(s => { s.face.mouth = v; })));

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
      }
      controls.append(sliderRow('Fringe', spec.hair.fringe, 0, 1.5, 0.05, v => onEdit(s => { s.hair.fringe = v; })));
      controls.append(sliderRow('Seed', spec.hair.seed, 1, 50, 1, v => onEdit(s => { s.hair.seed = v; }), { min: -1e6, max: 1e6 }));
    }

    // --- CLOTHING ---
    controls.append(sectionTitle('Clothing'));
    controls.append(toggleRow('Top', spec.clothing.top.on, v => onEdit(s => { s.clothing.top.on = v; })));
    controls.append(selectRow('Sleeve', spec.clothing.top.sleeve, SLEEVES, v => onEdit(s => { s.clothing.top.sleeve = v as CharacterSpec['clothing']['top']['sleeve']; })));
    controls.append(selectRow('Top length', spec.clothing.top.length, [['shirt', 'Shirt'], ['dress', 'Dress']], v => onEdit(s => { s.clothing.top.length = v as CharacterSpec['clothing']['top']['length']; })));
    controls.append(toggleRow('Pants', spec.clothing.pants.on, v => onEdit(s => { s.clothing.pants.on = v; })));
    controls.append(selectRow('Pants length', spec.clothing.pants.length, [['full', 'Full'], ['briefs', 'Briefs']], v => onEdit(s => { s.clothing.pants.length = v as CharacterSpec['clothing']['pants']['length']; })));
    controls.append(selectRow('Pants rise', spec.clothing.pants.rise, PANTS_RISES, v => onEdit(s => { s.clothing.pants.rise = v as CharacterSpec['clothing']['pants']['rise']; })));
    controls.append(toggleRow('Footwear', spec.clothing.feet.on, v => onEdit(s => { s.clothing.feet.on = v; })));
    controls.append(selectRow('Footwear kind', spec.clothing.feet.kind, [['shoes', 'Shoes'], ['boots', 'Boots']], v => onEdit(s => { s.clothing.feet.kind = v as CharacterSpec['clothing']['feet']['kind']; })));
    controls.append(toggleRow('Stand / base', spec.base, v => onEdit(s => { s.base = v; })));

    // --- COLOURS ---
    controls.append(sectionTitle('Colours'));
    const colorKeys: [keyof CharacterSpec['colors'], string][] = [
      ['skin', 'Skin'], ['hair', 'Hair'], ['eyes', 'Eye white'], ['iris', 'Iris'], ['pupil', 'Pupil'],
      ['lips', 'Lips'], ['brows', 'Brows'], ['top', 'Top'], ['pants', 'Pants'], ['feet', 'Footwear'], ['base', 'Base'],
    ];
    for (const [key, label] of colorKeys) {
      controls.append(colorRow(label, spec.colors[key], v => onEdit(s => { s.colors[key] = v; })));
    }
  }

  rebuild();

  // --- Footer: Save ---
  const saveBtn = el('button', BUTTON_PRIMARY);
  saveBtn.textContent = 'Save to session';
  saveBtn.addEventListener('click', async () => {
    if (!(await confirmClobber())) return;
    saveBtn.disabled = true;
    const prev = saveBtn.textContent;
    saveBtn.textContent = 'Saving…';
    const r = await api.buildCharacter(spec, { save: true });
    saveBtn.disabled = false;
    saveBtn.textContent = prev;
    if (r.error) showToast(r.error, { variant: 'warn', source: 'character' });
    else showToast('Character saved as a new version', { variant: 'success', source: 'character' });
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
