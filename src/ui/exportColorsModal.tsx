// "Filament colors" step of the 3MF exports. Every distinct painted colour
// becomes its own filament in Bambu Studio / OrcaSlicer, so a model painted with
// five slightly different blacks opens with five black filaments. This dialog
// lists the export palette, pre-merges near-identical shades (tolerance slider +
// optional filament cap), and lets the user re-assign or recolour each filament
// before the file is written. Export-only: the session's paint is untouched.
//
// The merge maths lives in src/export/exportColors.ts; this file is only UI.

import { signal } from '@preact/signals';
import type { Signal } from '@preact/signals';
import { mountPreactModal } from './preact/mount';
import { BUTTON_PRIMARY, BUTTON_CANCEL, BUTTON_SMALL_SECONDARY } from './styleConstants';
import {
  suggestColorMerges, normalizeHex,
  type ExportColor, type ColorRemap,
} from '../export/exportColors';
import { MAX_BAMBU_FILAMENTS } from '../export/threemfProject';

export interface ExportColorsModalOptions {
  /** Distinct export colours, most-used first (collectExportColors). */
  colors: ExportColor[];
  /** Optional names per hex (paint-region / part names) shown next to swatches. */
  names?: Record<string, string[]>;
  /** Initial merge tolerance (ΔE). */
  tolerance: number;
  /** Upper bound of the tolerance slider. */
  maxTolerance?: number;
  /** The user's printer filament-slot count (palette capacity). When the export
   *  needs more filaments, the dialog offers a one-click "Fit to N". */
  slotCapacity?: number;
}

export interface ExportColorsChoice {
  /** source hex → export hex (only changed entries). */
  remap: ColorRemap;
  /** Number of filaments the export will carry. */
  filaments: number;
}


interface State {
  tolerance: number;
  /** 0 = no cap. */
  maxColors: number;
  /** source hex → representative (kept) source hex. */
  assign: Record<string, string>;
  /** representative hex → recoloured export hex. */
  overrides: Record<string, string>;
}

interface Group {
  rep: string;
  members: ExportColor[];
  share: number;
  finalHex: string;
}

function autoAssign(colors: ExportColor[], tolerance: number, maxColors: number): Record<string, string> {
  const remap = suggestColorMerges(colors, { tolerance, ...(maxColors > 0 ? { maxColors } : {}) });
  const out: Record<string, string> = {};
  for (const c of colors) out[c.hex] = remap[c.hex] ?? c.hex;
  return out;
}

function groupsOf(colors: ExportColor[], s: State): Group[] {
  const byRep = new Map<string, Group>();
  for (const c of colors) {
    const rep = s.assign[c.hex] ?? c.hex;
    let g = byRep.get(rep);
    if (!g) { g = { rep, members: [], share: 0, finalHex: s.overrides[rep] ?? rep }; byRep.set(rep, g); }
    g.members.push(c);
    g.share += c.share;
  }
  return [...byRep.values()].sort((a, b) => b.share - a.share);
}

/** The export remap + filament count a state resolves to. */
function resolve(colors: ExportColor[], s: State): ExportColorsChoice {
  const remap: ColorRemap = {};
  const finals = new Set<string>();
  for (const c of colors) {
    const rep = s.assign[c.hex] ?? c.hex;
    const final = s.overrides[rep] ?? rep;
    finals.add(final);
    if (final !== c.hex) remap[c.hex] = final;
  }
  return { remap, filaments: finals.size };
}

const pct = (share: number) => share >= 0.995 ? '100%' : share < 0.001 ? '<0.1%' : `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%`;

function labelFor(c: ExportColor, names?: Record<string, string[]>): string {
  const n = names?.[c.hex];
  if (n && n.length) return n.join(', ');
  return c.unpainted ? 'unpainted' : c.hex.toUpperCase();
}

function Swatch(props: { hex: string; size?: 'sm' | 'md' }) {
  const cls = props.size === 'md' ? 'w-4 h-4' : 'w-3 h-3';
  return <span class={`inline-block ${cls} rounded-sm border border-zinc-500 shrink-0`} style={{ background: props.hex }} />;
}

function ColorsBody(props: { opts: ExportColorsModalOptions; state: Signal<State> }) {
  const { opts, state } = props;
  const { colors, names } = opts;
  const s = state.value;
  const groups = groupsOf(colors, s);
  const { filaments } = resolve(colors, s);
  const maxTol = opts.maxTolerance ?? 30;
  const fitTo = opts.slotCapacity !== undefined ? Math.min(opts.slotCapacity, MAX_BAMBU_FILAMENTS) : 0;

  const set = (patch: Partial<State>) => { state.value = { ...state.value, ...patch }; };
  const reMerge = (tolerance: number, maxColors: number) => {
    const assign = autoAssign(colors, tolerance, maxColors);
    // Keep recolours for filaments that still exist under the new grouping.
    const reps = new Set(Object.values(assign));
    const overrides: Record<string, string> = {};
    for (const [rep, hex] of Object.entries(state.value.overrides)) if (reps.has(rep)) overrides[rep] = hex;
    set({ tolerance, maxColors, assign, overrides });
  };
  const reassign = (src: string, target: string) => {
    const assign = { ...state.value.assign };
    if (target === src) {
      assign[src] = src;
    } else {
      // A filament merged into another takes its members along.
      for (const k of Object.keys(assign)) if (assign[k] === src) assign[k] = target;
      assign[src] = target;
    }
    set({ assign });
  };

  return (
    <div class="flex flex-col gap-3" data-testid="export-colors">
      <p class="text-[11px] text-zinc-400 leading-relaxed">
        Each distinct colour becomes its own filament in the slicer. This model uses{' '}
        <span class="text-zinc-200 font-medium">{colors.length} colours</span>; near-identical shades are merged
        below. Only the exported file changes — your paint stays as it is.
      </p>

      <div class="flex flex-col gap-1.5">
        <div class="flex items-center justify-between gap-2">
          <label for="export-colors-tolerance" class="text-xs text-zinc-300">
            Merge similar colours{' '}
            <span class="text-zinc-500 tabular-nums" data-testid="export-colors-tolerance-value">
              {s.tolerance === 0 ? '(off)' : `(ΔE ${s.tolerance})`}
            </span>
          </label>
          <span class="text-[11px] text-zinc-400 tabular-nums" data-testid="export-colors-summary">
            {colors.length} colours → <span class="text-zinc-100 font-medium">{filaments} filament{filaments === 1 ? '' : 's'}</span>
          </span>
        </div>
        <input
          id="export-colors-tolerance"
          type="range"
          min={0}
          max={maxTol}
          step={1}
          value={s.tolerance}
          class="w-full accent-blue-500"
          aria-valuetext={s.tolerance === 0 ? 'off' : `ΔE ${s.tolerance}`}
          onInput={e => reMerge(Number((e.currentTarget as HTMLInputElement).value), s.maxColors)}
        />
        <div class="flex justify-between text-[10px] text-zinc-500">
          <span>Keep every shade</span>
          <span>Merge more</span>
        </div>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <label for="export-colors-max" class="text-xs text-zinc-300">Max filaments</label>
        <select
          id="export-colors-max"
          class="bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200"
          value={String(s.maxColors)}
          onChange={e => reMerge(s.tolerance, Number((e.currentTarget as HTMLSelectElement).value))}
        >
          <option value="0">No limit</option>
          {Array.from({ length: Math.min(MAX_BAMBU_FILAMENTS, colors.length) }, (_, i) => i + 1).map(n => (
            <option key={n} value={String(n)}>{n}</option>
          ))}
        </select>
        <button
          type="button"
          class={`${BUTTON_SMALL_SECONDARY} ml-auto`}
          data-action="keep-all"
          title="Export every colour as its own filament"
          onClick={() => set({ tolerance: 0, maxColors: 0, assign: autoAssign(colors, 0, 0), overrides: {} })}
        >Keep all colours</button>
      </div>

      {opts.slotCapacity !== undefined && fitTo > 0 && filaments > opts.slotCapacity && (
        <div class="flex flex-wrap items-center gap-2 rounded border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-xs text-amber-200" data-testid="export-colors-over-slots">
          <span class="flex-1 min-w-[12rem]">
            {filaments} filaments, but your palette has {opts.slotCapacity} printer slot{opts.slotCapacity === 1 ? '' : 's'}.
          </span>
          <button
            type="button"
            class={BUTTON_SMALL_SECONDARY}
            data-action="fit-slots"
            onClick={() => reMerge(s.tolerance, fitTo)}
          >Fit to {fitTo}</button>
        </div>
      )}

      <div class="flex flex-col gap-1" data-testid="export-colors-filaments">
        <div class="text-xs text-zinc-400">Filaments</div>
        {groups.map((g, i) => (
          <div key={g.rep} class="flex items-start gap-2 py-1.5 px-2 rounded bg-zinc-900/50 border border-zinc-700/60" data-filament={i + 1}>
            <span class="text-[11px] text-zinc-500 w-4 pt-1 tabular-nums">{i + 1}</span>
            <input
              type="color"
              value={g.finalHex}
              class="w-7 h-7 shrink-0 rounded cursor-pointer bg-transparent border border-zinc-600"
              aria-label={`Filament ${i + 1} colour`}
              title="Change this filament's colour"
              onInput={e => {
                const hex = normalizeHex((e.currentTarget as HTMLInputElement).value);
                if (hex) set({ overrides: { ...state.value.overrides, [g.rep]: hex } });
              }}
            />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 text-xs text-zinc-200">
                <span class="font-mono">{g.finalHex.toUpperCase()}</span>
                <span class="text-zinc-500">{pct(g.share)}</span>
              </div>
              <div class="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                {g.members.map(m => (
                  <span key={m.hex} class="inline-flex items-center gap-1 text-[10px] text-zinc-400" title={`${m.hex.toUpperCase()} · ${pct(m.share)}`}>
                    <Swatch hex={m.hex} />{labelFor(m, names)}
                  </span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <details class="text-xs" data-testid="export-colors-sources">
        <summary class="cursor-pointer text-zinc-400 [@media(hover:hover)]:hover:text-zinc-200 select-none py-2">Fine-tune merges</summary>
        <div class="flex flex-col gap-1 mt-2">
          {colors.map(c => {
            const current = s.assign[c.hex] ?? c.hex;
            return (
              <div key={c.hex} class="flex flex-wrap items-center gap-2 py-1">
                <Swatch hex={c.hex} size="md" />
                <span class="font-mono text-[11px] text-zinc-300">{c.hex.toUpperCase()}</span>
                <span class="text-[10px] text-zinc-500 truncate max-w-[10rem]">{labelFor(c, names)} · {pct(c.share)}</span>
                <select
                  class="ml-auto bg-zinc-900 border border-zinc-700 rounded px-1.5 py-1 text-[11px] text-zinc-200 max-w-[12rem]"
                  aria-label={`Filament for ${c.hex.toUpperCase()}`}
                  data-source={c.hex}
                  value={current}
                  onChange={e => reassign(c.hex, (e.currentTarget as HTMLSelectElement).value)}
                >
                  <option value={c.hex}>Own filament</option>
                  {groups.filter(g => g.rep !== c.hex).map(g => (
                    <option key={g.rep} value={g.rep}>
                      Merge into {g.finalHex.toUpperCase()} ({labelFor(g.members[0], names)})
                    </option>
                  ))}
                </select>
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

/** Show the filament-colours step. Resolves with the chosen remap, or null when
 *  the user cancels (abort the export). */
export function showExportColorsModal(opts: ExportColorsModalOptions): Promise<ExportColorsChoice | null> {
  return new Promise(resolvePromise => {
    let result: ExportColorsChoice | null = null;
    const tolerance = Math.max(0, Math.min(opts.maxTolerance ?? 30, opts.tolerance));
    const state = signal<State>({ tolerance, maxColors: 0, assign: autoAssign(opts.colors, tolerance, 0), overrides: {} });

    mountPreactModal(
      {
        title: 'Filament colors',
        scrollable: true,
        onClose: () => resolvePromise(result),
      },
      close => ({
        body: <ColorsBody opts={opts} state={state} />,
        footer: (
          <>
            <button type="button" class={BUTTON_CANCEL} onClick={() => { result = null; close(); }}>Cancel</button>
            <button
              type="button"
              class={BUTTON_PRIMARY}
              data-action="export-colors"
              onClick={() => { result = resolve(opts.colors, state.value); close(); }}
            >Export</button>
          </>
        ),
      }),
    );
  });
}
