// Multi-object mesh import chooser. Shown when an imported file holds several
// objects — a 3MF with more than one object (often across several Bambu/Orca
// build plates) — or when several mesh files (STL / 3MF) are imported at once.
// The user picks which objects to bring in, how to divide them into Partwright
// objects (one per object, per plate or per file, or everything as one), and —
// when the open session holds real work — where they go. A multi-file import
// also asks how to lay the models out and whether to convert them to code.
//
// Pure UI over the plan in `src/import/meshImportSplit.ts`: it previews the
// object count with `planImportSplit` and resolves with the user's choice; the
// caller does the splitting and placement.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { mountPreactModal } from './preact/mount';
import { BUTTON_CANCEL, BUTTON_PRIMARY } from './styleConstants';
import { planImportSplit, type ImportSplitMode } from '../import/meshImportSplit';
import type { MultiFileLayout } from '../import/multiFileImport';

export type MeshImportDestination = 'new-session' | 'this-session' | 'current-object';

interface MeshImportModalItem {
  name: string;
  triangleCount: number;
  plate?: number;
  /** Source file (multi-file imports): index into `files`. */
  file?: number;
  /** Starts unticked, with this note beside it (e.g. "Already in this session"). */
  skipNote?: string;
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
  /** Multi-file imports: the files, listed as sections in place of plates. */
  files?: string[];
  /** Multi-file imports: the layout choices, and the one picked at first. */
  layouts?: MultiFileLayout[];
  initialLayout?: MultiFileLayout;
  /** Multi-file imports: offer "convert to code" next to "mesh only". */
  offerConvert?: boolean;
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
    /** The current object is still empty (a new one): the import fills it — the
     *  first object, when it makes several — in any mode, and that's the
     *  default destination. */
    currentIsEmpty?: boolean;
    /** The session's objects: "An existing object" then offers a picker
     *  (default: the current one). */
    objects?: { id: string; name: string }[];
    currentObjectId?: string;
  };
}

interface MeshImportModalResult {
  mode: ImportSplitMode;
  /** Indices into `items`, in list order. */
  selected: number[];
  destination: MeshImportDestination;
  /** With destination 'current-object': the object picked (absent = the open one). */
  objectId?: string;
  /** Multi-file imports only. */
  layout?: MultiFileLayout;
  convert?: boolean;
}

type ModeText = { title: string; desc: (n: number, grouped: boolean) => string };

const MODE_TEXT: Record<ImportSplitMode, ModeText> = {
  object: {
    title: 'One object per 3MF object',
    desc: (n, grouped) => `${n} object${n === 1 ? '' : 's'}${grouped ? ', grouped by plate in the object list' : ''}.`,
  },
  file: {
    title: 'One object per file',
    desc: n => `${n} object${n === 1 ? '' : 's'}; a file's objects become named parts.`,
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

/** The wording for a multi-file import, where items are models, not 3MF objects. */
const FILE_MODE_TEXT: Partial<Record<ImportSplitMode, ModeText>> = {
  object: {
    title: 'One object per model',
    desc: (n, grouped) => `${n} object${n === 1 ? '' : 's'}${grouped ? ', a 3MF’s objects grouped under its file' : ''}.`,
  },
  none: {
    title: 'Everything as one object',
    desc: () => 'One object; each model becomes a named part.',
  },
};

const LAYOUT_TEXT: Record<MultiFileLayout, { title: string; desc: string }> = {
  keep: { title: 'Keep file positions', desc: 'Where each file puts them, e.g. parts of one assembly.' },
  center: { title: 'Centre each on the plate', desc: 'All in the same spot, centred and sitting on the plate.' },
  grid: { title: 'Arrange in a grid', desc: 'Side by side on the plate, so nothing overlaps.' },
};

function modeText(opts: MeshImportModalOptions, mode: ImportSplitMode): ModeText {
  return (opts.files ? FILE_MODE_TEXT[mode] : undefined) ?? MODE_TEXT[mode];
}

// Body and footer are separate Preact trees (modalShell owns both slots), so
// they share the choice through this tiny store.
interface State { mode: ImportSplitMode; selected: boolean[]; destination: MeshImportDestination; layout: MultiFileLayout; convert: boolean; objectId: string }
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
    opts.items.map(it => ({ name: it.name, triangles: [], plate: it.plate, file: it.file })),
    mode,
    { selected, plates: opts.plates, files: opts.files, baseName: opts.baseName },
  ).length;
}

/** The section an item is listed under: its file, or its plate. */
const sectionOf = (opts: MeshImportModalOptions, it: MeshImportModalItem) => (opts.files ? it.file : it.plate);

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

function ItemRow(props: { item: MeshImportModalItem; checked: boolean; indent: boolean; showNote: boolean; onToggle: (v: boolean) => void }) {
  const { item, checked, indent } = props;
  return (
    <label class={`flex items-center gap-2 min-h-11 md:min-h-0 py-1 px-1.5 rounded hover:bg-zinc-800 cursor-pointer ${indent ? 'pl-6' : ''}`}>
      <Check checked={checked} label={`Import ${item.name}`} onChange={props.onToggle} />
      <span class="text-[12px] text-zinc-200 truncate flex-1 min-w-0" title={item.name}>{item.name}</span>
      {item.skipNote && props.showNote && <span class="text-[10px] text-amber-400 shrink-0" data-skip-note>{item.skipNote}</span>}
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

function RadioList<T extends string>(props: {
  label: string;
  name: string;
  value: T;
  options: { value: T; title: string; desc: string; enabled: boolean }[];
  onChange: (v: T) => void;
}) {
  return (
    <div class="flex flex-col gap-1" role="radiogroup" aria-label={props.label}>
      <div class="text-xs text-zinc-400">{props.label}</div>
      {props.options.map(o => (
        <label
          key={o.value}
          class={`flex items-start gap-2 rounded px-1.5 py-1 min-h-11 md:min-h-0 ${o.enabled ? 'cursor-pointer hover:bg-zinc-800' : 'opacity-50 cursor-not-allowed'}`}
        >
          <input
            type="radio"
            name={props.name}
            class="accent-blue-500 mt-0.5 shrink-0"
            value={o.value}
            disabled={!o.enabled}
            checked={props.value === o.value}
            onChange={() => props.onChange(o.value)}
          />
          <span class="flex flex-col min-w-0">
            <span class="text-[12px] text-zinc-100">{o.title}</span>
            <span class="text-[11px] text-zinc-500 leading-snug">{o.desc}</span>
          </span>
        </label>
      ))}
    </div>
  );
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

  // Sections: a multi-file import's files (a file with one model lists it
  // without a header), else the plates in the file's order, objects with no
  // plate last.
  const sections = useMemo(() => {
    const out: { plate: MeshImportModalPlate | null; items: number[] }[] = [];
    if (opts.files) {
      opts.files.forEach((name, f) => {
        const items = opts.items.map((it, i) => (it.file === f ? i : -1)).filter(i => i >= 0);
        if (items.length === 1) out.push({ plate: null, items });
        else if (items.length > 1) out.push({ plate: { id: f, name }, items });
      });
      return out;
    }
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
  const perSection = new Map<number, number>();
  for (const i of sel) {
    const s = sectionOf(opts, opts.items[i]);
    if (s !== undefined) perSection.set(s, (perSection.get(s) ?? 0) + 1);
  }
  const grouped = opts.files ? perSection.size > 1 && [...perSection.values()].some(n => n > 1) : perSection.size > 1;
  // "Already in this session" means nothing for a new session: there the
  // flagged models start ticked like the rest.
  const toNew = st.destination === 'new-session';
  const skipped = toNew ? 0 : opts.items.filter(it => it.skipNote).length;
  const setDestination = (destination: MeshImportDestination) => {
    const wasNew = st.destination === 'new-session', isNew = destination === 'new-session';
    if (wasNew === isNew) { store.set({ destination }); return; }
    store.set({ destination, selected: st.selected.map((on, i) => (opts.items[i].skipNote ? isNew : on)) });
  };

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
              onClick={() => store.set({ mode: m, ...(m !== 'none' && st.destination === 'current-object' && !opts.destinations?.currentIsEmpty ? { destination: 'this-session' as const } : {}) })}
            >
              <div class="text-sm text-zinc-100 font-medium">{modeText(opts, m).title}</div>
              <div class="text-[11px] text-zinc-400 leading-snug mt-0.5">{modeText(opts, m).desc(n, grouped)}</div>
            </button>
          );
        })}
      </div>

      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between">
          <div class="text-xs text-zinc-400">{opts.files ? 'Models' : 'Objects'} ({sel.length} of {opts.items.length})</div>
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
                <ItemRow key={i} item={opts.items[i]} checked={st.selected[i]} indent={false} showNote={!toNew} onToggle={v => setItem(i, v)} />
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
                    label={opts.files ? `Import everything in ${plate.name}` : `Import everything on ${plate.name}`}
                    onChange={v => {
                      const next = st.selected.slice();
                      for (const i of sec.items) next[i] = v;
                      store.set({ selected: next });
                    }}
                  />
                  {plate.id >= 0 && !opts.files && <PlateThumb png={(plate as MeshImportModalPlate).thumbnail} />}
                  <span class="text-[12px] text-zinc-100 font-medium truncate flex-1 min-w-0">{plate.name}</span>
                  <span class="text-[10px] text-zinc-500 shrink-0">{sec.items.length} {opts.files ? 'model' : 'object'}{sec.items.length === 1 ? '' : 's'} · {tris.toLocaleString()} tris</span>
                </label>
                {sec.items.map(i => (
                  <ItemRow key={i} item={opts.items[i]} checked={st.selected[i]} indent={true} showNote={!toNew} onToggle={v => setItem(i, v)} />
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {skipped > 0 && (
        <p class="text-[11px] text-zinc-500 leading-snug -mt-1">
          {skipped} {skipped === 1 ? 'model is' : 'models are'} already in this session (same file, same triangle count), so {skipped === 1 ? 'it starts' : 'they start'} unticked. Tick {skipped === 1 ? 'it' : 'them'} to import again.
        </p>
      )}

      {opts.layouts && opts.layouts.length > 1 && (
        <RadioList
          label="Lay out"
          name="mesh-import-layout"
          value={st.layout}
          options={opts.layouts.map(l => ({ value: l, title: LAYOUT_TEXT[l].title, desc: LAYOUT_TEXT[l].desc, enabled: true }))}
          onChange={v => store.set({ layout: v })}
        />
      )}

      {opts.offerConvert && (
        <RadioList
          label="Bring in as"
          name="mesh-import-convert"
          value={st.convert ? 'code' : 'mesh'}
          options={[
            { value: 'mesh', title: 'Mesh only', desc: 'Fast. You can convert any object to code later (Tools → Convert model to code).', enabled: true },
            {
              value: 'code',
              title: 'Convert to editable code',
              desc: st.destination === 'current-object' && !opts.destinations?.currentIsEmpty
                ? 'Not when adding to the current object — it would rebuild that object’s own code too.'
                : st.mode === 'object' || st.mode === 'piece'
                  ? 'Rebuilds each object as smooth, editable code. Takes a few seconds per object; models that aren’t clean solids stay meshes.'
                  : 'Rebuilds each object as smooth, editable code. Its named parts aren’t kept. Takes a few seconds per object.',
              enabled: st.destination !== 'current-object' || !!opts.destinations?.currentIsEmpty,
            },
          ]}
          onChange={v => store.set({ convert: v === 'code' })}
        />
      )}

      {opts.destinations && (
        <RadioList
          label="Put it in"
          name="mesh-import-destination"
          value={st.destination}
          options={[
            { value: 'this-session', title: 'This session', desc: 'Add as new objects, each with its own version history.', enabled: true },
            { value: 'new-session', title: 'A new session', desc: 'Leave the current session untouched.', enabled: true },
            opts.destinations.currentIsEmpty ? {
              value: 'current-object',
              title: `The current object${opts.destinations.currentObjectName ? ` — "${opts.destinations.currentObjectName}"` : ''} (empty)`,
              desc: st.mode === 'none' ? 'Make the import its contents.' : 'The first object fills it; any others become new objects.',
              enabled: true,
            } : {
              value: 'current-object',
              title: (opts.destinations.objects?.length ?? 0) > 1 ? 'An existing object' : `The current object${opts.destinations.currentObjectName ? ` — "${opts.destinations.currentObjectName}"` : ''}`,
              desc: st.mode !== 'none'
                ? 'Only when importing everything as one object.'
                : st.convert ? 'Not with Convert to editable code — it would rebuild that object’s own code too.'
                : opts.destinations.canAddToCurrent ? 'Each model becomes a named part of it, beside its geometry. A JavaScript object keeps its code.' : 'This mesh can’t be combined into an existing object.',
              enabled: st.mode === 'none' && !st.convert && opts.destinations.canAddToCurrent,
            },
          ]}
          onChange={setDestination}
        />
      )}
      {opts.destinations && !opts.destinations.currentIsEmpty && st.destination === 'current-object' && (opts.destinations.objects?.length ?? 0) > 1 && (
        <label class="flex items-center gap-2 text-[11px] text-zinc-400 pl-7 -mt-1">
          Object
          <select
            data-import-object
            class="flex-1 min-w-0 min-h-[44px] md:min-h-0 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 text-zinc-200 text-[11px]"
            value={st.objectId}
            onChange={e => store.set({ objectId: (e.target as HTMLSelectElement).value })}
          >
            {opts.destinations.objects!.map(o => <option key={o.id} value={o.id}>{o.name}{o.id === opts.destinations!.currentObjectId ? ' (open)' : ''}</option>)}
          </select>
        </label>
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
      selected: opts.items.map(it => !it.skipNote),
      destination: opts.destinations ? (opts.destinations.currentIsEmpty ? 'current-object' : 'this-session') : 'new-session',
      layout: opts.initialLayout ?? opts.layouts?.[0] ?? 'keep',
      convert: false,
      objectId: opts.destinations?.currentObjectId ?? '',
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
              result = {
                mode: st.mode,
                selected: selectedIndices(st.selected),
                destination: st.destination,
                ...(st.destination === 'current-object' && st.objectId ? { objectId: st.objectId } : {}),
                ...(opts.layouts ? { layout: st.layout } : {}),
                ...(opts.offerConvert ? { convert: st.convert } : {}),
              };
              close();
            }}
          />
        ),
      }),
    );
  });
}
