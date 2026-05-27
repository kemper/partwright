// Modeling-quality settings modal — accessible from the toolbar gear.
// Lets users pick the default circular-segment count used by every run.
// Defaults to "Highest" so curves look smooth out of the box; users on
// slower machines can drop to a lower preset, and power users can dial
// in an exact "Custom" segment count.

import { signal, type Signal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { mountPreactModal } from './preact/mount';
import {
  loadQualitySettings,
  saveQualitySettings,
  getDefaultCircularSegments,
  clampCustomSegments,
  QUALITY_OPTIONS,
  MIN_CUSTOM_SEGMENTS,
  MAX_CUSTOM_SEGMENTS,
} from '../geometry/qualitySettings';

interface QualityState {
  quality: ReturnType<typeof loadQualitySettings>['quality'];
  customSegments: number;
}

function QualityBody(props: { state: Signal<QualityState>; noteVersion: Signal<number> }) {
  const { state, noteVersion } = props;
  const customRef = useRef<HTMLInputElement>(null);

  // Note text reads getDefaultCircularSegments() directly so saved changes
  // are reflected without us mirroring all of qualitySettings into a signal.
  // The bare `noteVersion.value` read below isn't dead — it subscribes this
  // component to noteVersion so bumping it re-evaluates the note.
  noteVersion.value;
  const noteText = `Currently using ${getDefaultCircularSegments()} segments per full circle. Changes take effect on the next render.`;

  function pickPreset(id: typeof state.value.quality): void {
    state.value = { ...state.value, quality: id };
    saveQualitySettings({ quality: id, customSegments: state.value.customSegments });
    noteVersion.value++;
  }

  function pickCustom(): void {
    state.value = { ...state.value, quality: 'custom' };
    saveQualitySettings({ quality: 'custom', customSegments: state.value.customSegments });
    noteVersion.value++;
    // Focus + select for fast editing — defer one frame so the disabled
    // attribute has flipped.
    requestAnimationFrame(() => {
      customRef.current?.focus();
      customRef.current?.select();
    });
  }

  // Live-persist while typing (clamped), but leave the field text alone
  // mid-edit to avoid fighting the cursor.
  function onInput(raw: string): void {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) return;
    const clamped = clampCustomSegments(n);
    state.value = { ...state.value, customSegments: clamped };
    saveQualitySettings({ quality: 'custom', customSegments: clamped });
    noteVersion.value++;
  }

  // On blur, normalise the field to the stored clamped integer.
  function onBlur(raw: string): void {
    const parsed = parseInt(raw, 10);
    const next = Number.isNaN(parsed) ? state.value.customSegments : clampCustomSegments(parsed);
    state.value = { ...state.value, customSegments: next };
    saveQualitySettings({ quality: 'custom', customSegments: next });
    noteVersion.value++;
  }

  const customDisabled = state.value.quality !== 'custom';

  return (
    <>
      <p class="text-xs text-zinc-400 leading-relaxed">
        Controls the default number of segments used to approximate circles, spheres, cylinders, and other curved primitives. Higher values produce smoother curves but slower renders. Scripts can still override per-primitive via the segments argument, or call setCircularSegments() / set $fn directly.
      </p>
      <div class="flex flex-col gap-2" role="radiogroup" aria-label="Modeling quality preset">
        {QUALITY_OPTIONS.map(opt => (
          <label
            key={opt.id}
            class="flex items-start gap-3 px-3 py-2 rounded border border-zinc-700 hover:border-zinc-500 cursor-pointer transition-colors"
          >
            <input
              type="radio"
              name="quality"
              value={opt.id}
              class="mt-1 accent-blue-500"
              checked={state.value.quality === opt.id}
              onChange={e => { if ((e.currentTarget as HTMLInputElement).checked) pickPreset(opt.id); }}
            />
            <div class="flex flex-col gap-0.5 flex-1">
              <div class="flex items-center gap-2">
                <span class="text-sm font-medium text-zinc-100">{opt.label}</span>
                {opt.id === 'highest' && (
                  <span class="text-[9px] uppercase tracking-wide text-emerald-400 border border-emerald-400/30 rounded px-1 py-px">
                    Default
                  </span>
                )}
              </div>
              <span class="text-xs text-zinc-400">{opt.hint}</span>
            </div>
          </label>
        ))}
        <label class="flex items-start gap-3 px-3 py-2 rounded border border-zinc-700 hover:border-zinc-500 cursor-pointer transition-colors">
          <input
            type="radio"
            name="quality"
            value="custom"
            class="mt-1 accent-blue-500"
            checked={state.value.quality === 'custom'}
            onChange={e => { if ((e.currentTarget as HTMLInputElement).checked) pickCustom(); }}
          />
          <div class="flex flex-col gap-1 flex-1">
            <span class="text-sm font-medium text-zinc-100">Custom</span>
            <div class="flex items-center gap-2">
              <input
                ref={customRef}
                id="quality-custom-input"
                type="number"
                min={MIN_CUSTOM_SEGMENTS}
                max={MAX_CUSTOM_SEGMENTS}
                step={1}
                disabled={customDisabled}
                value={String(state.value.customSegments)}
                class="w-24 px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-sm text-zinc-100 disabled:opacity-40 disabled:cursor-not-allowed focus:border-blue-500 focus:outline-none"
                onInput={e => onInput((e.currentTarget as HTMLInputElement).value)}
                onChange={e => onBlur((e.currentTarget as HTMLInputElement).value)}
              />
              <span class="text-xs text-zinc-400">segments per full circle</span>
            </div>
            <span class="text-xs text-zinc-500">
              Any whole number from {MIN_CUSTOM_SEGMENTS} to {MAX_CUSTOM_SEGMENTS}.
            </span>
          </div>
        </label>
      </div>
      <p class="text-xs text-zinc-500 leading-snug">{noteText}</p>
    </>
  );
}

export function showQualitySettingsModal(): void {
  const initial = loadQualitySettings();
  const state = signal<QualityState>({ quality: initial.quality, customSegments: initial.customSegments });
  const noteVersion = signal(0);

  mountPreactModal(
    { title: 'Modeling Quality' },
    close => ({
      body: <QualityBody state={state} noteVersion={noteVersion} />,
      footer: (
        <button
          type="button"
          class="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 text-white"
          onClick={close}
        >Done</button>
      ),
    }),
    { bodyClassPatches: [['gap-3', 'gap-4']] },
  );
}
