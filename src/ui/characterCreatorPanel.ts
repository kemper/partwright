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
import { assetPath } from '../deployment';
import {
  type CharacterSpec,
  DEFAULT_SPEC,
  cloneSpec,
  decodeSpecComment,
  CHARACTER_PRESETS,
  POSE_PRESETS,
  randomSpec,
  POSE_PRESET_LABELS,
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

function toggleRow(label: string, value: boolean, onChange: (v: boolean) => void): HTMLElement {
  const input = el('input', 'accent-blue-500 w-4 h-4');
  input.type = 'checkbox';
  input.checked = value;
  input.addEventListener('change', () => onChange(input.checked));
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

// Friendly option label maps for the enums that read poorly raw.
const HAIR_STYLES: [string, string][] = [
  ['bald', 'Bald'], ['short', 'Short'], ['long', 'Long'], ['bob', 'Bob'], ['bun', 'Bun'],
  ['bangs', 'Bangs'], ['ponytail', 'Ponytail'], ['afro', 'Afro'], ['braids', 'Braids'],
  ['spiked', 'Spiked'], ['locs', 'Locs'], ['cornrows', 'Cornrows'], ['boxBraids', 'Box braids'],
];
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

  // --- Start from a preset (scrollable pick-list) or roll a random one ---
  // Each card shows a baked thumbnail (public/character-presets/<id>.webp, see
  // scripts/bake-character-presets.mjs) with the preset's palette as a fallback
  // strip, so the list is scannable even before/without the image.
  const presetHeader = el('div', 'flex items-center justify-between gap-2 mt-1');
  const presetTitle = sectionTitle('Start from a preset');
  presetTitle.classList.remove('mt-1');
  const randomBtn = el('button', BUTTON_SMALL_SECONDARY);
  randomBtn.textContent = '🎲 Random';
  randomBtn.title = 'Build a brand-new random character (click again for another)';
  randomBtn.addEventListener('click', () => {
    // Keep the stand toggle — it's a print-setup choice, not part of "who".
    const keepBase = spec.base;
    spec = randomSpec();
    spec.base = keepBase;
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
    const card = el('button', 'w-full h-full flex flex-col items-stretch text-left rounded border border-zinc-700 bg-zinc-800/60 hover:bg-zinc-700/70 overflow-hidden transition-colors');
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

  function rebuild(): void {
    controls.replaceChildren();

    // --- BODY ---
    controls.append(sectionTitle('Body'));
    controls.append(sliderRow('Height', spec.body.height, 24, 90, 1, v => onEdit(s => { s.body.height = v; }), { min: 1, max: Infinity }));
    controls.append(sliderRow('Heads tall', spec.body.headsTall, 2.5, 9, 0.5, v => onEdit(s => { s.body.headsTall = v; }), { min: 2, max: 12 }));
    controls.append(selectRow('Build', spec.body.build, ['slim', 'average', 'stocky'], v => onEdit(s => { s.body.build = v as CharacterSpec['body']['build']; })));
    controls.append(selectRow('Sex', spec.body.sex, ['neutral', 'male', 'female'], v => onEdit(s => { s.body.sex = v as CharacterSpec['body']['sex']; })));
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
    jointSlider('Arms out', () => spec.pose.armL.raiseSide, n => { spec.pose.armL.raiseSide = n; spec.pose.armR.raiseSide = n; }, -30, 170);
    jointSlider('Arm bend', () => spec.pose.armL.bend, n => { spec.pose.armL.bend = n; spec.pose.armR.bend = n; }, 0, 150);
    jointSlider('Legs apart', () => spec.pose.legL.raiseSide, n => { spec.pose.legL.raiseSide = n; spec.pose.legR.raiseSide = n; }, -10, 60);
    jointSlider('Head turn', () => spec.pose.head.yaw, n => { spec.pose.head.yaw = n; }, -60, 60);
    jointSlider('Head tilt', () => spec.pose.head.roll, n => { spec.pose.head.roll = n; }, -30, 30);
    jointSlider('Lean', () => spec.pose.spine.lean, n => { spec.pose.spine.lean = n; }, -25, 25);

    // --- FACE ---
    controls.append(sectionTitle('Face'));
    controls.append(selectRow('Shape', spec.face.shape, ['oval', 'round', 'square', 'long', 'heart', 'diamond'], v => onEdit(s => { s.face.shape = v as CharacterSpec['face']['shape']; })));
    controls.append(selectRow('Eyelids', spec.face.lids, ['none', 'upper', 'hooded', 'half', 'closed', 'almond', 'tapered'], v => onEdit(s => { s.face.lids = v as CharacterSpec['face']['lids']; })));
    controls.append(selectRow('Gaze', spec.face.gaze, ['center', 'middle', 'left', 'right', 'up', 'down'], v => onEdit(s => { s.face.gaze = v as CharacterSpec['face']['gaze']; })));
    controls.append(selectRow('Nose', spec.face.nose, ['straight', 'button', 'snub', 'roman', 'aquiline', 'broad', 'pointed', 'bulbous'], v => onEdit(s => { s.face.nose = v as CharacterSpec['face']['nose']; })));
    controls.append(selectRow('Mouth', spec.face.expression, EXPRESSIONS, v => onEdit(s => { s.face.expression = v as CharacterSpec['face']['expression']; })));
    controls.append(selectRow('Lips', spec.face.lipShape, ['natural', 'full', 'thin', 'wide', 'rosebud', 'flat'], v => onEdit(s => { s.face.lipShape = v as CharacterSpec['face']['lipShape']; })));
    controls.append(selectRow('Brows', spec.face.brows, ['natural', 'thin', 'bushy', 'arched', 'flat', 'angled', 'rounded', 'straight'], v => onEdit(s => { s.face.brows = v as CharacterSpec['face']['brows']; })));
    controls.append(selectRow('Ears', spec.face.ears, ['detailed', 'round', 'pointed'], v => onEdit(s => { s.face.ears = v as CharacterSpec['face']['ears']; })));

    // --- HAIR ---
    controls.append(sectionTitle('Hair'));
    controls.append(selectRow('Style', spec.hair.style, HAIR_STYLES, v => onEdit(s => { s.hair.style = v as CharacterSpec['hair']['style']; })));
    controls.append(selectRow('Length', spec.hair.length, ['short', 'mid', 'long'], v => onEdit(s => { s.hair.length = v as CharacterSpec['hair']['length']; })));
    controls.append(sliderRow('Volume', spec.hair.volume, 0.3, 4, 0.1, v => onEdit(s => { s.hair.volume = v; })));

    // --- CLOTHING ---
    controls.append(sectionTitle('Clothing'));
    controls.append(toggleRow('Top', spec.clothing.top.on, v => onEdit(s => { s.clothing.top.on = v; })));
    controls.append(selectRow('Sleeve', spec.clothing.top.sleeve, ['none', 'short', 'long'], v => onEdit(s => { s.clothing.top.sleeve = v as CharacterSpec['clothing']['top']['sleeve']; })));
    controls.append(selectRow('Top length', spec.clothing.top.length, [['shirt', 'Shirt'], ['dress', 'Dress']], v => onEdit(s => { s.clothing.top.length = v as CharacterSpec['clothing']['top']['length']; })));
    controls.append(toggleRow('Pants', spec.clothing.pants.on, v => onEdit(s => { s.clothing.pants.on = v; })));
    controls.append(selectRow('Pants length', spec.clothing.pants.length, [['full', 'Full'], ['briefs', 'Briefs']], v => onEdit(s => { s.clothing.pants.length = v as CharacterSpec['clothing']['pants']['length']; })));
    controls.append(selectRow('Pants rise', spec.clothing.pants.rise, ['low', 'mid', 'high'], v => onEdit(s => { s.clothing.pants.rise = v as CharacterSpec['clothing']['pants']['rise']; })));
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
