// Preferences modal — accessible from the toolbar gear. Lets the user
// adjust modeling quality (segment count), the default mesh color for
// unpainted geometry, and the auto-render debounce delay. Defaults to
// the most-pleasing-on-modern-hardware values; users on slower
// machines can dial things down.

import { createModalShell } from './modalShell';
import {
  loadPreferences,
  savePreferences,
  QUALITY_OPTIONS,
  QUALITY_SEGMENTS,
  MESH_COLOR_OPTIONS,
  RENDER_DELAY_OPTIONS,
  LIFETIME_SPEND_OPTIONS,
  LIFETIME_SPEND_CAP_USD,
  AI_PAINT_DEFAULT_OPTIONS,
  type QualityLevel,
  type MeshColorId,
  type RenderDelay,
  type LifetimeSpendCap,
  type AiPaintDefault,
} from '../preferences';
import { getKey, putKey } from '../ai/db';
import { formatUsd } from '../ai/cost';

export function showPreferencesModal(): void {
  const shell = createModalShell({ title: 'Preferences', scrollable: true });
  shell.body.classList.remove('gap-3');
  shell.body.classList.add('gap-5');

  let current = loadPreferences();

  // ---------- Modeling quality ----------
  shell.body.appendChild(
    section(
      'Modeling Quality',
      'Number of segments used to approximate circles, spheres, cylinders, and other curved primitives. Scripts can still override per-primitive (segments arg) or by calling setCircularSegments() / $fn.',
    ),
  );

  const qualityNote = document.createElement('p');
  qualityNote.className = 'text-xs text-zinc-500 leading-snug';
  const refreshQualityNote = () => {
    qualityNote.textContent = `Currently using ${QUALITY_SEGMENTS[current.quality]} segments per full circle.`;
  };
  refreshQualityNote();

  shell.body.appendChild(
    radioGroup({
      name: 'quality',
      ariaLabel: 'Modeling quality preset',
      options: QUALITY_OPTIONS,
      defaultId: 'highest',
      currentId: current.quality,
      onChange: (id) => {
        current = { ...current, quality: id as QualityLevel };
        savePreferences(current);
        refreshQualityNote();
      },
    }),
  );
  shell.body.appendChild(qualityNote);

  // ---------- Default mesh color ----------
  shell.body.appendChild(
    section(
      'Default Mesh Color',
      'Applied to any unpainted geometry in the interactive viewport. Paint regions, when set, take priority.',
    ),
  );
  shell.body.appendChild(
    swatchGroup({
      currentId: current.meshColor,
      defaultId: 'blue',
      onChange: (id) => {
        current = { ...current, meshColor: id };
        savePreferences(current);
      },
    }),
  );

  // ---------- Auto-render delay ----------
  shell.body.appendChild(
    section(
      'Auto-render Delay',
      'How long the editor waits after the last keystroke before re-running your code. Longer delays avoid mid-typing stutters on heavy models.',
    ),
  );
  shell.body.appendChild(
    radioGroup({
      name: 'renderDelay',
      ariaLabel: 'Auto-render delay',
      options: RENDER_DELAY_OPTIONS,
      defaultId: 'normal',
      currentId: current.renderDelay,
      onChange: (id) => {
        current = { ...current, renderDelay: id as RenderDelay };
        savePreferences(current);
      },
    }),
  );

  // ---------- AI: lifetime spend cap ----------
  shell.body.appendChild(
    section(
      'AI Lifetime Spend Cap',
      'Hard ceiling on total Anthropic API spend tracked across all sessions on this browser. Once reached, AI requests fail until you raise the cap or reset the usage counter.',
    ),
  );

  const spendStatus = document.createElement('div');
  spendStatus.className = 'text-xs text-zinc-400 flex items-center justify-between gap-3';
  const renderSpendStatus = async () => {
    const key = await getKey('anthropic');
    const spent = key?.totalCostUsd ?? 0;
    const cap = LIFETIME_SPEND_CAP_USD[current.lifetimeSpendCap];
    const capLabel = Number.isFinite(cap) ? formatUsd(cap) : '∞';
    spendStatus.innerHTML = '';
    const text = document.createElement('span');
    text.textContent = `Tracked spend: ${formatUsd(spent)} of ${capLabel}`;
    spendStatus.appendChild(text);
    if (spent > 0) {
      const resetBtn = document.createElement('button');
      resetBtn.className = 'px-2 py-0.5 rounded text-[11px] text-zinc-300 bg-zinc-700 hover:bg-zinc-600';
      resetBtn.textContent = 'Reset counter';
      resetBtn.title = 'Zero the tracked lifetime AI spend without disconnecting your API key';
      resetBtn.addEventListener('click', async () => {
        if (!confirm('Reset the tracked AI spend counter to $0? Your API key stays connected.')) return;
        const k = await getKey('anthropic');
        if (!k) return;
        await putKey({ ...k, totalInputTokens: 0, totalOutputTokens: 0, totalCostUsd: 0 });
        await renderSpendStatus();
      });
      spendStatus.appendChild(resetBtn);
    }
  };
  void renderSpendStatus();
  shell.body.appendChild(spendStatus);

  shell.body.appendChild(
    radioGroup({
      name: 'lifetimeSpendCap',
      ariaLabel: 'Lifetime AI spend cap',
      options: LIFETIME_SPEND_OPTIONS,
      defaultId: 'unlimited',
      currentId: current.lifetimeSpendCap,
      onChange: (id) => {
        current = { ...current, lifetimeSpendCap: id as LifetimeSpendCap };
        savePreferences(current);
        void renderSpendStatus();
      },
    }),
  );

  // ---------- AI: paint enabled by default ----------
  shell.body.appendChild(
    section(
      'AI Paint by Default',
      'Whether the model can paint faces straight out of the box. Painted regions lock the editor — keeping this off makes the AI safer for code-only iteration. You can still flip the Paint pill on a per-session basis.',
    ),
  );
  shell.body.appendChild(
    radioGroup({
      name: 'aiPaintDefault',
      ariaLabel: 'AI paint by default',
      options: AI_PAINT_DEFAULT_OPTIONS,
      defaultId: 'off',
      currentId: current.aiPaintDefault,
      onChange: (id) => {
        current = { ...current, aiPaintDefault: id as AiPaintDefault };
        savePreferences(current);
      },
    }),
  );

  const doneBtn = document.createElement('button');
  doneBtn.className = 'px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white';
  doneBtn.textContent = 'Done';
  doneBtn.addEventListener('click', () => shell.close());
  shell.footer.appendChild(doneBtn);
}

// ---------- helpers ----------

function section(title: string, hint: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'flex flex-col gap-1';
  const h = document.createElement('div');
  h.className = 'text-[11px] uppercase tracking-wider text-zinc-400 font-semibold';
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 'text-xs text-zinc-500 leading-snug';
  p.textContent = hint;
  wrap.appendChild(h);
  wrap.appendChild(p);
  return wrap;
}

interface RadioGroupOptions<T extends string> {
  name: string;
  ariaLabel: string;
  options: { id: T; label: string; hint: string }[];
  defaultId: T;
  currentId: T;
  onChange: (id: T) => void;
}

function radioGroup<T extends string>(opts: RadioGroupOptions<T>): HTMLElement {
  const group = document.createElement('div');
  group.className = 'flex flex-col gap-2';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', opts.ariaLabel);

  for (const opt of opts.options) {
    const row = document.createElement('label');
    row.className =
      'flex items-start gap-3 px-3 py-2 rounded border border-zinc-700 hover:border-zinc-500 cursor-pointer transition-colors';

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = opts.name;
    radio.value = opt.id;
    radio.checked = opt.id === opts.currentId;
    radio.className = 'mt-1 accent-blue-500';

    const text = document.createElement('div');
    text.className = 'flex flex-col gap-0.5 flex-1';

    const labelRow = document.createElement('div');
    labelRow.className = 'flex items-center gap-2';

    const label = document.createElement('span');
    label.className = 'text-sm font-medium text-zinc-100';
    label.textContent = opt.label;
    labelRow.appendChild(label);

    if (opt.id === opts.defaultId) {
      labelRow.appendChild(defaultBadge());
    }

    const hint = document.createElement('span');
    hint.className = 'text-xs text-zinc-400';
    hint.textContent = opt.hint;

    text.appendChild(labelRow);
    text.appendChild(hint);
    row.appendChild(radio);
    row.appendChild(text);
    group.appendChild(row);

    radio.addEventListener('change', () => {
      if (radio.checked) opts.onChange(opt.id);
    });
  }
  return group;
}

interface SwatchGroupOptions {
  currentId: MeshColorId;
  defaultId: MeshColorId;
  onChange: (id: MeshColorId) => void;
}

function swatchGroup(opts: SwatchGroupOptions): HTMLElement {
  const group = document.createElement('div');
  group.className = 'flex flex-wrap gap-2';
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', 'Default mesh color');

  const syncSelectionRings = () => {
    group.querySelectorAll<HTMLLabelElement>('label').forEach((el) => {
      const r = el.querySelector('input') as HTMLInputElement | null;
      if (!r) return;
      el.classList.toggle('border-blue-400', r.checked);
      el.classList.toggle('border-zinc-700', !r.checked);
    });
  };

  for (const opt of MESH_COLOR_OPTIONS) {
    const row = document.createElement('label');
    row.className =
      'relative flex items-center gap-2 px-2 py-1.5 rounded border border-zinc-700 hover:border-zinc-500 cursor-pointer transition-colors';

    // Radio fills the label so clicks anywhere on the swatch toggle it.
    // opacity-0 keeps it visually invisible while remaining interactable
    // (Playwright + screen readers + label-click all still work).
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'meshColor';
    radio.value = opt.id;
    radio.checked = opt.id === opts.currentId;
    radio.className = 'absolute inset-0 opacity-0 cursor-pointer m-0';

    const swatch = document.createElement('span');
    swatch.className = 'inline-block w-5 h-5 rounded border border-zinc-600';
    swatch.style.backgroundColor = `#${opt.hex.toString(16).padStart(6, '0')}`;
    swatch.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.className = 'text-xs text-zinc-200';
    label.textContent = opt.label;

    row.appendChild(radio);
    row.appendChild(swatch);
    row.appendChild(label);

    if (opt.id === opts.defaultId) {
      row.appendChild(defaultBadge());
    }

    radio.addEventListener('change', () => {
      if (radio.checked) {
        opts.onChange(opt.id);
        syncSelectionRings();
      }
    });
    group.appendChild(row);
  }
  syncSelectionRings();
  return group;
}

function defaultBadge(): HTMLElement {
  const badge = document.createElement('span');
  badge.className =
    'text-[9px] uppercase tracking-wide text-emerald-400 border border-emerald-400/30 rounded px-1 py-px';
  badge.textContent = 'Default';
  return badge;
}
