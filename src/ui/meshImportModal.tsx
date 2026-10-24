// Multi-object mesh import chooser. Shown when an imported file holds several
// objects — a 3MF with more than one object (often across several Bambu/Orca
// build plates). The user picks which objects to bring in, how to divide them
// into Partwright objects (one per 3MF object, one per plate, or everything as
// one), and — when the open session holds real work — where they go.
//
// Pure UI over the plan in `src/import/meshImportSplit.ts`: it previews the
// object count with `planImportSplit` and resolves with the user's choice; the
// caller does the splitting and placement.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { mountPreactModal } from './preact/mount';
import { BUTTON_CANCEL, BUTTON_PRIMARY } from './styleConstants';
import { planImportSplit, type ImportSplitMode } from '../import/meshImportSplit';

export type MeshImportDestination = 'new-session' | 'this-session' | 'current-object';

interface MeshImportModalItem {
  name: string;
  triangleCount: number;
  plate?: number;
}

interface MeshImportModalPlate {
  id: number;
  name: string;
  /** PNG preview of the plate (the slicer's own render). */
  thumbnail?: Uint8Array;
}

interface MeshImportModalOptions {
  filename: string;
  /** Modal heading. Default "Import 3MF". */
  title?: string;
  /** One line about the file (e.g. "Bambu Studio project"). */
  summary?: string;
  items: MeshImportModalItem[];
  plates: MeshImportModalPlate[];
  /** Split modes on offer, in display order. The first is the default. */
  modes: ImportSplitMode[];
  /** Name of the single object in `none` mode (the file's base name). */
  baseName: string;
  /** Most objects one import may create. */
  maxObjects: number;
  /** Destination choices, shown when the open session holds real work. Omit
   *  when there's nothing to protect: the import lands in a new session. */
  destinations?: {
    currentObjectName: string | null;
    /** Whether "Add to current object" is possible at all (single-object mode only). */
    canAddToCurrent: boolean;
  };
}

interface MeshImportModalResult {
  mode: ImportSplitMode;
  /** Indices into `items`, in list order. */
  selected: number[];
  destination: MeshImportDestination;
}

const MODE_TEXT: Record<ImportSplitMode, { title: string; desc: (n: number, grouped: boolean) => string }> = {
  object: {
    title: 'One object per 3MF object',
    desc: (n, grouped) => `${n} object${n === 1 ? '' : 's'}${grouped ? ', grouped by plate in the object list' : ''}.`,
  },
  plate: {
    title: 'One object per plate',
    desc: n => `${n} object${n === 1 ? '' : 's'}, each keeping its plate's layout.`,
  },
  piece: {
    title: 'One object per piece',
    desc: n => `${n} object${n === 1 ? '' : 's'}, one per separate solid.`,
  },
  none: {
    title: 'Everything as one object',
    desc: () => 'One object, keeping the layout of everything selected.',
  },
};

// Body and footer are separate Preact trees (modalShell owns both slots), so
// they share the choice through this tiny store.
interface State { mode: ImportSplitMode; selected: boolean[]; destination: MeshImportDestination }
function createStore(initial: State) {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch: Partial<State>) { state = { ...state, ...patch }; listeners.forEach(l => l()); },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
  };
}
type Store = ReturnType<typeof createStore>;

function useStore(store: Store): State {
  const [, force] = useState(0);
  useEffect(() => store.subscribe(() => force(n => n + 1)), [store]);
  return store.get();
}

function selectedIndices(selected: boolean[]): number[] {
  const out: number[] = [];
  selected.forEach((s, i) => { if (s) out.push(i); });
  return out;
}

function objectCount(opts: MeshImportModalOptions, mode: ImportSplitMode, selected: number[]): number {
  return planImportSplit(
    opts.items.map(it => ({ name: it.name, triangles: [], plate: it.plate })),
    mode,
    { selected, plates: opts.plates, baseName: opts.baseName },
  ).length;
}

function TriCount(props: { n: number }) {
  return <span class="text-[10px] text-zinc-500 tabular-nums shrink-0">{props.n.toLocaleString()} tris</span>;
}

/** A checkbox that can show the indeterminate (some-selected) state. */
function Check(props: { checked: boolean; indeterminate?: boolean; label: string; onChange: (v: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ref.current) ref.current.indeterminate = !!props.indeterminate; }, [props.indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      class="accent-blue-500 shrink-0 w-4 h-4"
      aria-label={props.label}
      checked={props.checked}
      onChange={e => props.onChange((e.target as HTMLInputElement).checked)}
    />
  );
}

function ItemRow(props: { item: MeshImportModalItem; checked: boolean; indent: boolean; onToggle: (v: boolean) => void }) {
  const { item, checked, indent } = props;
  return (
    <label class={`flex items-center gap-2 min-h-11 md:min-h-0 py-1 px-1.5 rounded hover:bg-zinc-800 cursor-pointer ${indent ? 'pl-6' : ''}`}>
      <Check checked={checked} label={`Import ${item.name}`} onChange={props.onToggle} />
      <span class="text-[12px] text-zinc-200 truncate flex-1 min-w-0" title={item.name}>{item.name}</span>
      <TriCount n={item.triangleCount} />
    </label>
  );
}

function PlateThumb(props: { png?: Uint8Array }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!props.png) return;
    const u = URL.createObjectURL(new Blob([props.png as BlobPart], { type: 'image/png' }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [props.png]);
  if (!url) return <div class="w-10 h-10 rounded bg-zinc-800 border border-zinc-700 shrink-0" />;
  return <img src={url} alt="" class="w-10 h-10 rounded bg-zinc-800 border border-zinc-700 object-contain shrink-0" />;
}

function Body(props: { opts: MeshImportModalOptions; store: Store }) {
  const { opts, store } = props;
  const st = useStore(store);
  const sel = selectedIndices(st.selected);
  const setItem = (i: number, v: boolean) => {
    const next = st.selected.slice();
    next[i] = v;
    store.set({ selected: next });
  };

  // Plate sections, in the file's plate order; objects with no plate last.
  const sections = useMemo(() => {
    const out: { plate: MeshImportModalPlate | null; items: number[] }[] = [];
    if (opts.plates.length === 0 || opts.items.every(it => it.plate === undefined)) {
      return [{ plate: null, items: opts.items.map((_, i) => i) }];
    }
    for (const p of opts.plates) {
      const items = opts.items.map((it, i) => (it.plate === p.id ? i : -1)).filter(i => i >= 0);
      if (items.length > 0) out.push({ plate: p, items });
    }
    const loose = opts.items.map((it, i) => (it.plate === undefined || !opts.plates.some(p => p.id === it.plate) ? i : -1)).filter(i => i >= 0);
    if (loose.length > 0) out.push({ plate: { id: -1, name: 'Not on a plate' }, items: loose });
    return out;
  }, [opts]);

  const allSelected = sel.length === opts.items.length;
  const grouped = new Set(sel.map(i => opts.items[i].plate).filter(p => p !== undefined)).size > 1;

  return (
    <>
      <p class="text-[11px] text-zinc-400 leading-relaxed">
        <span class="text-zinc-200 font-medium">{opts.filename}</span>
        {opts.summary ? <> — {opts.summary}</> : null}
      </p>

      <div class="flex flex-col gap-1" role="radiogroup" aria-label="Import as">
        <div class="text-xs text-zinc-400">Import as</div>
        {opts.modes.map(m => {
          const active = st.mode === m;
          const n = objectCount(opts, m, sel);
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              data-mode={m}
              class={`w-full text-left rounded-lg border px-3 py-2 transition-colors ${active ? 'border-blue-500 bg-blue-500/10' : 'border-zinc-700 hover:border-zinc-500'}`}
              onClick={() => store.set({ mode: m, ...(m !== 'none' && st.destination === 'current-object' ? { destination: 'this-session' as const } : {}) })}
            >
              <div class="text-sm text-zinc-100 font-medium">{MODE_TEXT[m].title}</div>
              <div class="text-[11px] text-zinc-400 leading-snug mt-0.5">{MODE_TEXT[m].desc(n, grouped)}</div>
            </button>
          );
        })}
      </div>

      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <div class="text-xs text-zinc-400">Objects ({sel.length} of {opts.items.length})</div>
          <button
            type="button"
            class="text-[11px] text-blue-400 hover:text-blue-300 min-h-11 md:min-h-0"
            onClick={() => store.set({ selected: opts.items.map(() => !allSelected) })}
          >{allSelected ? 'Select none' : 'Select all'}</button>
        </div>
        <div class="flex flex-col gap-0.5 max-h-[38vh] overflow-y-auto rounded border border-zinc-800 p-1" data-import-objects>
          {sections.map(sec => {
            if (!sec.plate) {
              return sec.items.map(i => (
                <ItemRow key={i} item={opts.items[i]} checked={st.selected[i]} indent={false} onToggle={v => setItem(i, v)} />
              ));
            }
            const on = sec.items.filter(i => st.selected[i]).length;
            const tris = sec.items.reduce((s, i) => s + opts.items[i].triangleCount, 0);
            const plate = sec.plate;
            return (
              <div key={plate.id} class="flex flex-col" data-plate={plate.id}>
                <label class="flex items-center gap-2 min-h-11 md:min-h-0 py-1 px-1.5 rounded hover:bg-zinc-800 cursor-pointer">
                  <Check
                    checked={on === sec.items.length}
                    indeterminate={on > 0 && on < sec.items.length}
                    label={`Import everything on ${plate.name}`}
                    onChange={v => {
                      const next = st.selected.slice();
                      for (const i of sec.items) next[i] = v;
                      store.set({ selected: next });
                    }}
                  />
                  {plate.id >= 0 && <PlateThumb png={(plate as MeshImportModalPlate).thumbnail} />}
                  <span class="text-[12px] text-zinc-100 font-medium truncate flex-1 min-w-0">{plate.name}</span>
                  <span class="text-[10px] text-zinc-500 shrink-0">{sec.items.length} object{sec.items.length === 1 ? '' : 's'} · {tris.toLocaleString()} tris</span>
                </label>
                {sec.items.map(i => (
                  <ItemRow key={i} item={opts.items[i]} checked={st.selected[i]} indent={true} onToggle={v => setItem(i, v)} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {opts.destinations && (
        <div class="flex flex-col gap-1" role="radiogroup" aria-label="Destination">
          <div class="text-xs text-zinc-400">Put it in</div>
          {([
            ['this-session', 'This session', 'Add as new objects, each with its own version history.', true],
            ['new-session', 'A new session', 'Leave the current session untouched.', true],
            ['current-object', `The current object${opts.destinations.currentObjectName ? ` — "${opts.destinations.currentObjectName}"` : ''}`,
              st.mode !== 'none'
                ? 'Only when importing everything as one object.'
                : opts.destinations.canAddToCurrent ? 'Combine it with the geometry already in this object.' : 'This mesh can’t be combined into an existing object.',
              st.mode === 'none' && opts.destinations.canAddToCurrent],
          ] as [MeshImportDestination, string, string, boolean][]).map(([d, title, desc, enabled]) => (
            <label
              key={d}
              class={`flex items-start gap-2 rounded px-1.5 py-1 min-h-11 md:min-h-0 ${enabled ? 'cursor-pointer hover:bg-zinc-800' : 'opacity-50 cursor-not-allowed'}`}
            >
              <input
                type="radio"
                name="mesh-import-destination"
                class="accent-blue-500 mt-0.5 shrink-0"
                value={d}
                disabled={!enabled}
                checked={st.destination === d}
                onChange={() => store.set({ destination: d })}
              />
              <span class="flex flex-col min-w-0">
                <span class="text-[12px] text-zinc-100">{title}</span>
                <span class="text-[11px] text-zinc-500 leading-snug">{desc}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </>
  );
}

function Footer(props: { opts: MeshImportModalOptions; store: Store; onCancel: () => void; onImport: () => void }) {
  const { opts, store } = props;
  const st = useStore(store);
  const sel = selectedIndices(st.selected);
  const n = objectCount(opts, st.mode, sel);
  const tooMany = n > opts.maxObjects;
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const raf = requestAnimationFrame(() => ref.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <>
      {tooMany && (
        <span class="text-[11px] text-amber-400 mr-auto self-center">
          {n} objects is over the {opts.maxObjects}-object limit (Advanced settings → Import).
        </span>
      )}
      <button type="button" class={BUTTON_CANCEL} onClick={props.onCancel}>Cancel</button>
      <button
        ref={ref}
        type="button"
        data-import-confirm
        class={`${BUTTON_PRIMARY} disabled:opacity-50 disabled:cursor-not-allowed`}
        disabled={sel.length === 0 || tooMany}
        onClick={props.onImport}
      >{sel.length === 0 ? 'Import' : `Import ${n} object${n === 1 ? '' : 's'}`}</button>
    </>
  );
}

/** Ask how to import a multi-object file. Resolves with the choice, or null
 *  when the user cancels. */
export function showMeshImportModal(opts: MeshImportModalOptions): Promise<MeshImportModalResult | null> {
  return new Promise(resolve => {
    let result: MeshImportModalResult | null = null;
    const store = createStore({
      mode: opts.modes[0] ?? 'none',
      selected: opts.items.map(() => true),
      destination: opts.destinations ? 'this-session' : 'new-session',
    });
    mountPreactModal(
      {
        title: opts.title ?? 'Import 3MF',
        maxWidth: 'lg',
        scrollable: true,
        onClose: () => resolve(result),
      },
      close => ({
        body: <Body opts={opts} store={store} />,
        footer: (
          <Footer
            opts={opts}
            store={store}
            onCancel={() => { result = null; close(); }}
            onImport={() => {
              const st = store.get();
              result = { mode: st.mode, selected: selectedIndices(st.selected), destination: st.destination };
              close();
            }}
          />
        ),
      }),
    );
  });
}
