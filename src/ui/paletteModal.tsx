// Filament color palette manager. A standalone modal (opened from the AI panel
// header) where the user records the real filament colors they own, sets how
// many can be loaded at once (AMS slots), toggles AI enforcement, and — the fun
// part — auto-fills the palette from photos/screenshots via their active AI
// model. Changes save live to localStorage (src/color/palette.ts); the AI reads
// them each turn through buildPaletteDirective + the getColorPalette tool.

import { signal, type Signal } from '@preact/signals';
import { useRef } from 'preact/hooks';
import { mountPreactModal } from './preact/mount';
import {
  loadPalette,
  savePalette,
  resetPaletteToDefaults,
  makeFilamentColor,
  dedupeColors,
  clampMaxSimultaneous,
  MIN_MAX_SIMULTANEOUS,
  MAX_MAX_SIMULTANEOUS,
  type ColorPaletteSettings,
  type FilamentColor,
} from '../color/palette';
import { fileToImageSource } from '../ai/images';
import { analyzeFilamentPhotos } from '../ai/filament';
import { loadSettings, providerLabel } from '../ai/settings';
import { resolveLocalModel } from '../ai/local';
import { activeModel } from '../ai/types';
import type { ImageSource } from '../ai/types';

/** Short note about which model the photo analysis will use, plus a warning
 *  when the active local model can't see images. */
function AnalysisModelNote() {
  const toggles = loadSettings().toggles;
  const model = activeModel(toggles);
  if (!model) {
    return (
      <p class="text-xs text-amber-300/90 leading-snug">
        No AI model selected. Pick one in AI settings (⚙) to analyze photos.
      </p>
    );
  }
  if (toggles.provider === 'local') {
    let supportsVision = false;
    try { supportsVision = resolveLocalModel(model).supportsVision; } catch { /* unknown */ }
    if (!supportsVision) {
      return (
        <div class="px-3 py-2 rounded border border-amber-700 bg-amber-950/40 text-xs text-amber-200 leading-snug">
          The active local model can’t see images. Switch to a cloud provider, or pick a Vision local model, to auto-fill from photos.
        </div>
      );
    }
  }
  return (
    <p class="text-xs text-zinc-500 leading-snug">
      Analyzes with your active model (<span class="text-zinc-300">{providerLabel(toggles.provider)} · {model}</span>). Screenshots or photos of spools / swatch cards work.
    </p>
  );
}

function ProposalReview(props: {
  proposal: Signal<FilamentColor[] | null>;
  selected: Signal<Set<string>>;
  onAdd: (picked: FilamentColor[]) => void;
}) {
  const { proposal, selected, onAdd } = props;
  const list = proposal.value;
  if (!list) return null;
  const sel = selected.value;

  function toggle(id: string) {
    const next = new Set(selected.value);
    if (next.has(id)) next.delete(id); else next.add(id);
    selected.value = next;
  }

  const pickedCount = list.filter(c => sel.has(c.id)).length;
  return (
    <div class="flex flex-col gap-2 rounded border border-indigo-800/60 bg-indigo-950/30 px-3 py-2.5">
      <p class="text-xs text-indigo-200 font-semibold">Found {list.length} color{list.length === 1 ? '' : 's'} — pick which to add:</p>
      <div class="flex flex-col gap-1">
        {list.map(c => (
          <label key={c.id} class="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={sel.has(c.id)}
              onChange={() => toggle(c.id)}
            />
            <span class="inline-block w-4 h-4 rounded-sm border border-zinc-600 shrink-0" style={`background:${c.hex}`} />
            <span class="text-xs text-zinc-200 flex-1 truncate">{c.name || 'Unnamed'}</span>
            <code class="text-[11px] text-zinc-500">{c.hex}</code>
          </label>
        ))}
      </div>
      <div class="flex items-center gap-2 pt-1">
        <button
          type="button"
          class="px-3 py-1 rounded text-xs font-medium bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white"
          disabled={pickedCount === 0}
          onClick={() => onAdd(list.filter(c => sel.has(c.id)))}
        >Add {pickedCount} to palette</button>
        <button
          type="button"
          class="px-3 py-1 rounded text-xs text-zinc-300 hover:bg-zinc-700"
          onClick={() => { proposal.value = null; }}
        >Discard</button>
      </div>
    </div>
  );
}

function PaletteBody(props: {
  palette: Signal<ColorPaletteSettings>;
  busy: Signal<boolean>;
  error: Signal<string | null>;
  proposal: Signal<FilamentColor[] | null>;
  selected: Signal<Set<string>>;
}) {
  const { palette, busy, error, proposal, selected } = props;
  const fileRef = useRef<HTMLInputElement>(null);
  const p = palette.value;

  function commit(next: ColorPaletteSettings) {
    // Reflect exactly what was persisted (savePalette sanitizes) so the UI,
    // localStorage, and the cache the AI reads can never drift apart.
    palette.value = savePalette(next);
  }
  function updateColor(id: string, patch: Partial<Pick<FilamentColor, 'name' | 'hex'>>) {
    commit({ ...p, colors: p.colors.map(c => (c.id === id ? { ...c, ...patch } : c)) });
  }
  function removeColor(id: string) {
    commit({ ...p, colors: p.colors.filter(c => c.id !== id) });
  }
  function addBlank() {
    const fc = makeFilamentColor('', '#cccccc');
    if (fc) commit({ ...p, colors: [...p.colors, fc] });
  }
  function addProposed(picked: FilamentColor[]) {
    commit({ ...p, colors: dedupeColors([...p.colors, ...picked]) });
    proposal.value = null;
  }

  async function onFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    busy.value = true;
    error.value = null;
    proposal.value = null;
    try {
      const imgs: ImageSource[] = [];
      for (const f of Array.from(files)) {
        const i = await fileToImageSource(f);
        if (i) imgs.push(i);
      }
      if (fileRef.current) fileRef.current.value = '';
      if (imgs.length === 0) throw new Error('No readable image files were selected.');
      const colors = await analyzeFilamentPhotos(imgs);
      selected.value = new Set(colors.map(c => c.id));
      proposal.value = colors;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      busy.value = false;
    }
  }

  return (
    <>
      <p class="text-xs text-zinc-400 leading-snug">
        Record the filament colors you actually own. When enforcement is on, AI sessions are told to color models using only these colors and to stay within your loaded-at-once limit.
      </p>

      {/* Enforcement + AMS limit */}
      <div class="flex flex-col gap-2 rounded border border-zinc-700 bg-zinc-900/40 px-3 py-2.5">
        <label class="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={p.enforce}
            onChange={e => commit({ ...p, enforce: (e.currentTarget as HTMLInputElement).checked })}
          />
          <span class="text-sm text-zinc-200 font-medium">Enforce in AI sessions</span>
        </label>
        <p class="text-[11px] text-zinc-500 leading-snug -mt-1 ml-6">
          {p.colors.length === 0
            ? 'Add at least one color below for enforcement to take effect.'
            : 'AI will use only palette colors and at most the limit below.'}
        </p>
        <label class="flex items-center gap-2">
          <span class="text-xs text-zinc-300">Max colors loaded at once</span>
          <input
            type="number"
            min={MIN_MAX_SIMULTANEOUS}
            max={MAX_MAX_SIMULTANEOUS}
            value={p.maxSimultaneous}
            class="w-16 px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs focus:border-blue-500 outline-none"
            onChange={e => commit({ ...p, maxSimultaneous: clampMaxSimultaneous(Number((e.currentTarget as HTMLInputElement).value)) })}
          />
          <span class="text-[11px] text-zinc-500">AMS slots</span>
        </label>
      </div>

      {/* Color list */}
      <h3 class="text-xs uppercase tracking-wider text-zinc-500 font-semibold mt-1">
        Filaments ({p.colors.length})
      </h3>
      {p.colors.length === 0 ? (
        <p class="text-xs text-zinc-500 italic">No filament colors yet — add one below, or auto-fill from a photo.</p>
      ) : (
        <div class="flex flex-col gap-1.5">
          {p.colors.map(c => (
            <div key={c.id} class="flex items-center gap-2">
              <input
                type="color"
                value={c.hex}
                class="w-7 h-7 rounded border border-zinc-600 bg-transparent cursor-pointer shrink-0"
                title="Pick color"
                onInput={e => updateColor(c.id, { hex: (e.currentTarget as HTMLInputElement).value })}
              />
              <input
                type="text"
                value={c.name}
                placeholder="Unnamed"
                class="flex-1 min-w-0 px-2 py-1 rounded bg-zinc-900 border border-zinc-600 text-zinc-100 text-xs focus:border-blue-500 outline-none"
                onInput={e => updateColor(c.id, { name: (e.currentTarget as HTMLInputElement).value })}
              />
              <code class="text-[11px] text-zinc-500 shrink-0">{c.hex}</code>
              <button
                type="button"
                class="shrink-0 w-6 h-6 rounded text-zinc-400 hover:text-white hover:bg-red-600 text-xs leading-none"
                title="Remove"
                onClick={() => removeColor(c.id)}
              >✕</button>
            </div>
          ))}
        </div>
      )}
      <div>
        <button
          type="button"
          class="px-3 py-1.5 rounded text-xs font-medium bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
          onClick={addBlank}
        >+ Add color</button>
      </div>

      {/* Photo auto-fill */}
      <h3 class="text-xs uppercase tracking-wider text-zinc-500 font-semibold mt-2">Auto-fill from photos</h3>
      <AnalysisModelNote />
      <div class="flex items-center gap-2">
        <button
          type="button"
          class="px-3 py-1.5 rounded text-xs font-medium bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white"
          disabled={busy.value}
          onClick={() => fileRef.current?.click()}
        >{busy.value ? 'Analyzing…' : 'Choose photos…'}</button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          class="hidden"
          onChange={e => { void onFiles((e.currentTarget as HTMLInputElement).files); }}
        />
        <span class="text-xs text-zinc-500">PNG, JPEG, GIF, or WebP.</span>
      </div>
      {error.value && (
        <div class="px-3 py-2 rounded border border-red-800 bg-red-950/40 text-xs text-red-300 leading-snug">
          {error.value}
        </div>
      )}
      <ProposalReview proposal={proposal} selected={selected} onAdd={addProposed} />
    </>
  );
}

export function showPaletteModal(): void {
  // Read once on open; edits write back through savePalette (which updates the
  // shared cache the AI reads), so we don't need a live subscription here.
  const palette = signal<ColorPaletteSettings>(loadPalette());
  const busy = signal(false);
  const error = signal<string | null>(null);
  const proposal = signal<FilamentColor[] | null>(null);
  const selected = signal<Set<string>>(new Set());

  mountPreactModal(
    { title: 'Filament palette', maxWidth: 'lg', scrollable: true },
    close => ({
      body: <PaletteBody palette={palette} busy={busy} error={error} proposal={proposal} selected={selected} />,
      footer: (
        <>
          <button
            type="button"
            class="mr-auto px-3 py-1.5 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700"
            title="Restore the built-in 16-color default palette"
            onClick={() => { palette.value = resetPaletteToDefaults(); }}
          >Reset to defaults</button>
          <button
            type="button"
            class="px-3 py-1.5 rounded text-xs text-zinc-300 hover:bg-zinc-700"
            onClick={close}
          >Done</button>
        </>
      ),
    }),
  );
}
